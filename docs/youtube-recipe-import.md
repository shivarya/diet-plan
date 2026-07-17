# YouTube Recipe Import — Pipeline & Progress

Living doc for the recurring recipe-import cycle. Read this first in any new session before touching the pipeline — it has the current state, the exact runbook, and the standing rules.

## What this is

We're building out the recipe catalogue by pulling recipes from 6 Indian cooking YouTube channels: their video titles/descriptions/captions get fed to Claude Haiku (via Claude Code subagents, not the Anthropic API — no separate API key needed) to extract structured recipe JSON, which then merges into `server/database/seed/recipes.json` and gets deployed to both the local DB and production.

No YouTube login is used or needed (unofficial `timedtext` caption scraping via `youtube-transcript-api`, which must run from a residential IP — cloud IPs get blocked).

## Standing rules (do not relitigate these)

- **Ask for confirmation before starting each new fetch batch.** (Set 2026-07-17 — a prior broader "auto-continue until all channels exhausted" authorization was explicitly revoked. Finishing a batch already in progress — extract → merge → deploy — does *not* need re-confirmation; only *starting the next fetch* does.)
- **`merge.py` skips videos already merged (fixed 2026-07-17).** Before this fix, `load_enriched()` re-read *every* `chunk_NN.json` ever produced on every run (they're never deleted), and the only duplicate guard was slug-collision suffixing (`-2`, `-3`, ...) — so every merge re-appended every already-merged video as a "new" row under a bumped slug instead of skipping it. This had been silently inflating `recipes.json` for many batches: by batch 9 it had reached 6,329 rows, of which only **1,682 were actually unique** (4,647 were exact re-merges of the same 1,682 videos, some duplicated up to 9×). Root-caused, fixed (`merge.py` now builds `already_merged_video_ids` from existing `video_url`s and skips them), `recipes.json` was cleaned back to the true 1,682 uniques, and both local + production DBs had the same stale duplicate rows deleted (prod kept 9 stale rows still referenced by real `meal_plan_items` — `ON DELETE RESTRICT` — harmless leftovers, not worth a manual reassignment). **If `recipes.json`'s row count or a merge dry-run's growth number ever looks implausibly large again relative to this batch's actual new-video count, re-check for this same class of bug before trusting the number.**
- **Cross-channel duplicates**: when the same dish name appears from multiple channels/videos, keep only the most-viewed version (by `view_count`), drop the rest. Handled automatically in `merge.py`.
- **`meal_type`** is a time-of-day slot only (`breakfast|brunch|lunch|dinner|snack`) — never `dessert`/`beverage`. Those go in `dish_category` (`main|bread|rice|snack|beverage|dessert`). `merge.py` also auto-recovers the common subagent mistake of putting `dessert`/`beverage` into `meal_type` by remapping to `snack`.
- **Nutrition** is hybrid: fuzzy-matched against the INDB workbook first (`nutrition_source='verified'`), AI-estimated fallback otherwise (`nutrition_source='estimated'`).
- Extraction rejects: vlogs/hauls/grocery trips/Q&A/reviews, multi-dish compilation videos ("3 ways to make X"), and pure technique/tips clips with no full recipe. These are expected, not errors — typically 15–35% of any batch.

## The pipeline (4 stages)

### Stage A — Fetch (`server/scripts/youtube/fetch.py`)
Pulls the newest `--limit` videos per channel (via `playlistItems.list` on the uploads playlist, quota-efficient), skips ones already fetched, skips Shorts (`--min-duration 90`, default), scrapes the caption transcript (or falls back to title+description if no captions), and writes one raw JSON file per video under `server/database/seed/youtube/raw/<channel>/<video_id>.json`.

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server"
export YOUTUBE_API_KEY=$(grep "^YOUTUBE_API_KEY=" .env | cut -d= -f2- | tr -d '\r\n')   # must re-export every session, Bash tool
python scripts/youtube/fetch.py --limit <N>
```

Bump `--limit` by **50 each cycle** historically (5→50→100→...→450 so far). Consider bumping the increment for future batches — see "Open items" below.

**A channel is exhausted when a fetch finds fewer videos than `--limit`, or fetches 0 new.** Check the per-channel summary lines (`grep -E "^===|videos found|fetched="` on the output).

### Stage B — Extract (Claude Code subagents, no API key needed)
Read `server/scripts/youtube/extract.py`'s `SYSTEM` prompt and `SCHEMA` dict — **that file is the source of truth** for the extraction criteria and required JSON shape (schema below is a snapshot, may drift).

1. Build a chunk manifest — groups of 8 raw video files not yet present in any `enriched/chunk_*.json`. Run from `server/database/seed/youtube/`:

```python
import json, glob, os
enriched_ids = set()
for f in glob.glob('enriched/chunk_*.json'):
    with open(f, encoding='utf-8') as fh:
        enriched_ids.update(json.load(fh).keys())
raw_files = sorted(glob.glob('raw/*/*.json'))
new_files = [f for f in raw_files if os.path.splitext(os.path.basename(f))[0] not in enriched_ids]
existing_chunks = [int(os.path.basename(f).split('_')[1].split('.')[0]) for f in glob.glob('enriched/chunk_*.json')]
next_chunk = max(existing_chunks) + 1 if existing_chunks else 1
manifest = {}
for i in range(0, len(new_files), 8):
    manifest[f'chunk_{next_chunk + i//8}'] = [os.path.abspath(p) for p in new_files[i:i+8]]
# write manifest to scratchpad, print chunk count/range
```

2. Launch waves of 5 parallel Haiku subagents (`Agent` tool, `subagent_type: general-purpose`, `model: haiku`, `run_in_background: true`), each given 8 raw file paths, the verbatim criteria from `extract.py`, and told to write one JSON object (keyed by video_id) to `enriched/chunk_NN.json`.
3. Repeat waves until all chunks in the manifest are done. A batch of 150–250 new videos is typically 20–30 chunks = 4–6 waves.

Required JSON shape per video (mirror `extract.py::SCHEMA`, verify against the file if in doubt):
```
is_recipe, reason, name, cuisine, meal_type, food_type, dish_category, servings,
ingredients[], instructions, contains_onion, contains_garlic, contains_egg,
is_kid_friendly, is_high_protein, is_low_carb, is_weight_loss, difficulty,
prep_time_min, estimated_calories, estimated_protein_g, estimated_carbs_g,
estimated_fat_g, estimated_fiber_g, estimated_calcium_mg
```

### Stage C — Merge (`server/scripts/youtube/merge.py`)
```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server"
python scripts/youtube/merge.py --dry-run   # sanity check counts first — background it, can exceed 60s once catalogue is large
python scripts/youtube/merge.py             # writes to database/seed/recipes.json — background it too
```
Reports: `accepted`/`dropped(not-a-recipe)`/`cross-channel duplicates dropped`/`final`. Both commands slow down as the catalogue and raw-video corpus grow (fuzzy INDB matching scales with recipe count) — run them with `run_in_background: true` once past a few thousand recipes rather than assuming they'll finish in 60s.

### Deploy — local + production
```powershell
# Local
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server"
php scripts/seed.php   # background if slow

# Commit + push (recipes.json only — raw/enriched youtube/ dirs are gitignored)
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan"
git add server/database/seed/recipes.json
git commit -m "Add N more YouTube recipes (videos X-Y/channel)"
git push

# Production (Bash tool — MSYS/Git-Bash needs forward-slash paths, not C:\... backslash paths, or scp/ssh mis-parse them)
scp -i "/c/Users/Ash/.ssh/cpanel_key" "/c/Users/Ash/Documents/Projects/apps/diet-plan/server/database/seed/recipes.json" hm5pno1wummg@184.168.101.66:~/public_html/shivarya.dev/diet_plan/database/seed/recipes.json
ssh -i "/c/Users/Ash/.ssh/cpanel_key" hm5pno1wummg@184.168.101.66 "cd ~/public_html/shivarya.dev/diet_plan && php scripts/seed.php"
ssh -i "/c/Users/Ash/.ssh/cpanel_key" hm5pno1wummg@184.168.101.66 "cd ~/public_html/shivarya.dev/diet_plan && php scripts/backfill-images.php"   # only fills empty image_url, safe to always run
```
Verify row counts match without printing credentials — read `.env` into local shell vars over SSH and query without echoing them (see `diet-deploy-api` skill for the exact one-liner; strip `\r` from CRLF-edited `.env` values).

## Current state (as of 2026-07-17, after batch 10)

- **Catalogue: 1,892 recipes** (local + production in sync — production has 1,901 rows total, 9 of which are stale pre-fix duplicates still referenced by real `meal_plan_items` and deliberately left in place; see the merge.py bug note above). This number is *not* comparable to earlier batches' "Running total" column below — those were inflated by the merge.py duplication bug; 1,892 is the true unique count after the 2026-07-17 cleanup + this batch's real new content.
- **Fetch limit reached: 500** (per-channel, newest-first; bumped from 450 this batch). No channel exhausted yet — every channel still returns the full `--limit` requested.
- Chunk numbering is at **chunk_232** (next new manifest starts at chunk_233).
- Mobile app: debug build installed and confirmed running on the dev Pixel 10 and on a Windows Android emulator; no mobile *code* changes have shipped alongside these recipe batches (only server-side data).

### Batch history

| Batch | Commit | Videos processed | Accepted | Recipes added | Running total |
|---|---|---|---|---|---|
| 0 (pipeline + smoke) | 67109b2 | — | — | — | ~440 |
| 1 | 74871b7 | — | — | +125 | 565 |
| 2 | b7eba62 | — | — | +240 | 805 |
| 3 | 734cbe1 | — | — | +370 | 1,175 |
| 4 | f9c2458 | 846 | 684 | +497 (34 dupes dropped) | 1,672 |
| 5 | 50756bd | 846 | 684 | +650 | 2,322 |
| 6 | 2661fc6 | 1,048 | 854 | +811 | 3,133 |
| 7 | a9da30c | 1,224 | 997 | +933 | 4,066 |
| 8 | 3718e56 | 1,401 | 1,143 | +1,066 | 5,132 |
| 9 | 430e69d | 1,595 | 1,295 | +1,197 | 6,329 (⚠ inflated, see below) |
| — cleanup | uncommitted | — | — | −4,647 (dedup cleanup) | 1,682 (true unique baseline) |
| 10 | uncommitted | 218 new videos, 172 accepted | 222 (incl. 50 previously-orphaned by the bug) | +210 (12 cross-channel dupes dropped) | 1,892 |

(Batches 0–3 predate the cross-channel dedup feature and per-batch commit-message accuracy; batch 4's commit message is misleadingly generic — "Refactor code structure..." — but its diff confirms +497 recipes, matching the count reconciliation. **Batches 4–9's "Videos processed"/"Accepted" columns were cumulative full-corpus reprocessing counts under the pre-fix `merge.py`, and their "Recipes added" deltas include re-merged duplicates, not just genuinely new content** — don't use them as a model for expected batch-10-onward numbers, which now reflect only truly new videos.)

### Per-channel totals vs. scraped so far (checked 2026-07-17, after batch 10)

| Channel | Long-form scraped | Total channel uploads (incl. Shorts, via API) |
|---|---|---|
| YourFoodLab | 418 | 1,848 |
| KabitasKitchen | 255 | 2,476 |
| nishamadhulika | 396 | 2,570 |
| RanveerBrar | 200 | 1,857 |
| sanjeevkapoorkhazana | 173 | **17,142** |
| KunalKapur | 371 | 1,259 |

Caveats: total uploads includes Shorts (which we filter, min 90s duration) — recent-window skip ratios suggest roughly 25–65% of each channel's uploads are Shorts, so true remaining long-form count is lower than the raw delta. **sanjeevkapoorkhazana is a major outlier** (17k+ total uploads vs. 1.2–2.6k for the rest) — at +50/batch this channel alone would take dozens more batches to get anywhere near exhausted.

## Runbook for a new session

1. Read this doc.
2. Check current state is still accurate: `git log --oneline -3` on `recipes.json`, and a quick recipe count (`grep -o '"slug"' server/database/seed/recipes.json | wc -l`).
3. **Ask the user before starting a fetch** (standing rule above) unless they've already said to proceed in this conversation.
4. Run the fetch → build manifest → extract waves → merge → deploy sequence above.
5. Update this doc's "Current state" section (recipe count, fetch limit, batch table row, chunk number) before ending the session or handing off.

## Known gotchas

- **`YOUTUBE_API_KEY` env var doesn't persist across Bash tool sessions/reboots** — re-export from `.env` at the start of every fetch.
- **`merge.py`/`seed.php` exceed the 60s default Bash timeout** once the catalogue is in the thousands — always launch with `run_in_background: true` past ~batch 4.
- **CRLF in `.env` values read over SSH** breaks `mysql -h "$DB_HOST"` — strip with `tr -d '\r\n'`.
- **Windows path backslashes break `scp`/`ssh` in the Bash (Git-Bash/MSYS) tool** — use forward-slash paths (`/c/Users/Ash/...`), not `C:\Users\Ash\...`.
- **Transient `IpBlocked`/`NoTranscriptFound` caption errors** are normal for a handful of videos per large batch — subagents fall back to title+description, no action needed.
- **`INSTALL_FAILED_VERSION_DOWNGRADE`** when installing a local debug APK on a device that has a higher-versionCode store build installed — `adb uninstall dev.shivarya.dietplan` then reinstall.
- A subagent occasionally puts `dessert`/`beverage` into `meal_type` instead of `dish_category` — `merge.py` auto-corrects this, no manual fix needed.

## Open items / ideas

- Consider bumping the per-batch `--limit` increment (e.g. 50 → 200) to reduce total round-trips, especially to make a dent in sanjeevkapoorkhazana's much larger backlog. Larger increments mean bigger extraction waves (more chunks) but fewer fetch/merge/deploy round-trips.
- Consider a separate, larger `--limit` schedule just for `@sanjeevkapoorkhazana` once the other 5 channels are closer to exhausted, rather than lock-stepping all 6 channels to the same limit.
- No mobile app code changes have been needed for any of these batches — if that changes (e.g. a schema-visible field is added), remember to bump `mobile/release-version.json` and ship a build, per the project's `diet-release` skill.
