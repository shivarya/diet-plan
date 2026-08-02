# YouTube Recipe Import — Pipeline & Progress

Living doc for the recurring recipe-import cycle. Read this first in any new session before touching the pipeline — it has the current state, the exact runbook, and the standing rules.

## What this is

We're building out the recipe catalogue by pulling recipes from 6 Indian cooking YouTube channels: their video titles/descriptions/captions get fed to Claude Haiku (via Claude Code subagents, not the Anthropic API — no separate API key needed) to extract structured recipe JSON, which then merges into `server/database/seed/recipes.json` and gets deployed to both the local DB and production.

No YouTube login is used or needed (unofficial `timedtext` caption scraping via `youtube-transcript-api`, which must run from a residential IP — cloud IPs get blocked).

## Standing rules (do not relitigate these)

- **Ask for confirmation before starting each new fetch batch.** (Set 2026-07-17 — a prior broader "auto-continue until all channels exhausted" authorization was explicitly revoked. Finishing a batch already in progress — extract → merge → deploy — does *not* need re-confirmation; only *starting the next fetch* does.)
- **`merge.py` skips videos already merged (fixed 2026-07-17).** Before this fix, `load_enriched()` re-read *every* `chunk_NN.json` ever produced on every run (they're never deleted), and the only duplicate guard was slug-collision suffixing (`-2`, `-3`, ...) — so every merge re-appended every already-merged video as a "new" row under a bumped slug instead of skipping it. This had been silently inflating `recipes.json` for many batches: by batch 9 it had reached 6,329 rows, of which only **1,682 were actually unique** (4,647 were exact re-merges of the same 1,682 videos, some duplicated up to 9×). Root-caused, fixed (`merge.py` now builds `already_merged_video_ids` from existing `video_url`s and skips them), `recipes.json` was cleaned back to the true 1,682 uniques, and both local + production DBs had the same stale duplicate rows deleted (prod kept 9 stale rows still referenced by real `meal_plan_items` — `ON DELETE RESTRICT` — harmless leftovers, not worth a manual reassignment). **If `recipes.json`'s row count or a merge dry-run's growth number ever looks implausibly large again relative to this batch's actual new-video count, re-check for this same class of bug before trusting the number.**
- **Cross-channel duplicates**: when the same dish name appears from multiple channels/videos, keep only the most-viewed version (by `view_count`), drop the rest. Handled automatically in `merge.py` — **but only across the current run's own accepted videos** (fixed partially 2026-07-17; see next bullet for the cross-*batch* gap that was still open).
- **Cross-channel dedup now also checks the existing catalogue, not just the current run (fixed 2026-07-17).** The `by_name` cross-channel dedup above only ever compared videos accepted *within a single merge.py run* against each other — it never checked already-merged recipes. Since each batch runs independently, the same dish from a different channel merged in an *earlier* batch was never caught, so the same dish name kept accumulating one row per batch it happened to appear in (e.g. "Aam Panna" had ended up with 3 separate rows, one each from batches ~1, ~7, and 10, from 3 different channels — none were exact-video duplicates, so the earlier video_id fix didn't catch them). Fixed: `merge.py` now builds `existing_names` from the catalogue and skips a new video if its dish name is already present under any channel. Cleaned up 145 existing cross-channel duplicates the same way (kept most-viewed per name), `recipes.json` 1,892 → 1,747. **If you ever see the same dish name appear more than once in Browse Recipes with different channels/thumbnails, that's this bug — check `already_covered` in a merge.py run's output before assuming it's something else.**
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

**Use the `youtube-extractor` custom subagent (`.claude/agents/youtube-extractor.md`), not `general-purpose`.** (Added 2026-07-21, batch 14, for token preservation — see "Token discipline" below for why.) It's scoped to `tools: [Read, Write]` only and has the full extraction criteria + schema baked into its own persistent definition, mirroring `server/scripts/youtube/extract.py`'s `SYSTEM`/`SCHEMA` — **that agent file (and `extract.py`) are the source of truth**; if the criteria ever needs to change, update both and keep them in sync.

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

2. Launch waves of 5–6 parallel Haiku subagents (`Agent` tool, `subagent_type: youtube-extractor`, `model: haiku`, `run_in_background: true`), each given **only** the 8 raw file paths and the output path — **do not re-paste the criteria/schema in the per-call prompt, the agent definition already has it.** A minimal per-call prompt looks like:
   ```
   Extract chunk_NN. Input files:
   <8 absolute paths>
   Write output to: <absolute path to enriched/chunk_NN.json>
   ```
3. Repeat waves until all chunks in the manifest are done. A batch of 150–250 new videos is typically 20–30 chunks = 4–6 waves; a batch of ~1000 is closer to 125 chunks / 21 waves.

Required JSON shape per video (mirror `extract.py::SCHEMA` / `youtube-extractor.md`'s schema block, verify against those files if in doubt):
```
is_recipe, reason, name, cuisine, meal_type, food_type, dish_category, servings,
ingredients[], instructions, contains_onion, contains_garlic, contains_egg,
is_kid_friendly, is_high_protein, is_low_carb, is_weight_loss, difficulty,
prep_time_min, estimated_calories, estimated_protein_g, estimated_carbs_g,
estimated_fat_g, estimated_fiber_g, estimated_calcium_mg
```

**Token discipline (why `youtube-extractor` exists, added batch 14):** Batches 1–13 used `subagent_type: general-purpose` with the full ~450-word criteria + schema pasted fresh into every single subagent prompt. That's expensive twice over: (a) `general-purpose` has `tools: *`, so every one of the ~100+ subagent invocations a large batch needs pays a fixed token tax just loading schemas for Bash/Glob/Grep/Edit/WebFetch/WebSearch/Agent/Artifact/NotebookEdit/TodoWrite — tools this task never touches; (b) the orchestrating session had to *generate* that ~450-word block as output text on every single call, ~100+ times a batch, purely as duplication. `youtube-extractor` fixes both: `tools: [Read, Write]` only (no unused-tool tax), and the criteria lives once in the agent's own definition instead of being repeated per call (per-call prompts shrink to just the file list + output path). If a rate limit is hit repeatedly within a batch again, this is the first thing to check is actually in effect (`subagent_type: youtube-extractor` in the `Agent` call, not `general-purpose`) before assuming there's nothing more to trim.

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

## Current state (as of 2026-08-02, batch 14 COMPLETE — extracted, merged, and deployed)

- **Catalogue: 5,295 recipes** (up from 3,023 after batch 13). Production DB verified at 5,306 rows = 5,295 + the established stable +11 offset (harmless legacy rows, see the batch-9 cleanup note above).
- **Fetch limit reached: 2000** (per-channel, newest-first; bumped from 1000, a +1000 jump — 5x the typical +100/+200 increment, deliberately larger to build a bigger buffer given how much manual Stage B orchestration each batch costs). This produced 3,609 new videos and the largest Stage B workload yet: **452 chunks** (chunk_473–924), vs. 99 in batch 13 (the previous max).
- **Stage B extraction: all 452 chunks done, 100%, spanning 57 waves.** 3,609 videos processed, **3,190 `is_recipe:true`** (raw count before merge/dedup, ~88% yield — high because the `--limit 2000` fetch skewed toward each channel's still-plentiful easy/recent content rather than deep back-catalog). Channel boundaries crossed within the batch: KabitasKitchen→KunalKapur (wave 15, per batch-14's earlier "in progress" state), then KunalKapur→RanveerBrar (chunk_602), RanveerBrar→YourFoodLab (chunk_682), YourFoodLab→nishamadhulika (chunk_761), and nishamadhulika→sanjeevkapoorkhazana (chunk_886, wave 53) — all 6 configured channels touched in one batch for the first time.
- **Stage C merge**: of the full accumulated corpus (7,328 videos across all batches ever extracted), 2,586 were already-merged from prior batches, 1,306 were already-covered (same dish name already in the catalogue under a different channel), 2,416 were newly accepted, 1,020 dropped as not-a-recipe, 0 rejected (missing raw metadata/invalid fields). Cross-channel dedup within this run dropped 144 more (kept the most-viewed video per dish name) → **final +2,272 recipes**. Nutrition: 68 verified against the INDB workbook, 2,348 fell back to AI-estimated.
- **Deploy**: local `php scripts/seed.php` (5,295 recipes), committed+pushed `recipes.json` (commit `05a031f`), production `scp` + `seed.php` (5,295 recipes) + `backfill-images.php` (437 recipes populated — all missing `image_url`s from this batch's new dishes). Verified prod row count 5,306 matches 5,295 + 11 offset.
- **Extraction used the same token-saving pattern established in batch 13**: `general-purpose` subagents (model: haiku) each `Read` `.claude/agents/youtube-extractor.md` for the extraction criteria/schema instead of having it re-pasted into every prompt, then `Read` their 8 assigned raw video JSONs and `Write` one `chunk_NNN.json`. The custom `youtube-extractor` agent type itself remained un-invokable directly in the session that ran this batch (launched from the monorepo root, not `diet-plan/` — see gotcha below) — only usable this way, as a reference file a `general-purpose` subagent reads.
- **This batch hit the Claude session rate limit many more times than any prior batch (10+ distinct interruptions across the full 57-wave run)**, every single time recovered via the same well-established pattern with **zero data loss**: verify the affected chunk(s) directly on disk (existence, entry count, `is_recipe:true` count) before assuming any work was lost. In every case, the vast majority (usually all) of the "failed" chunks had actually completed writing before the harness's error surfaced.
- **New failure mode this batch, distinct from a session-limit hit**: the `claude-sonnet-5[1m]` safety classifier periodically became "temporarily unavailable," causing `Agent` tool calls to fail immediately at launch (before any subagent work started) with "claude-sonnet-5[1m] is temporarily unavailable, so auto mode cannot determine the safety of Agent right now." Unlike a session-limit hit, there's nothing to verify on disk — the chunk never started. Fix: simply retry the same `Agent` launch call once the classifier becomes available again (confirmed by the next call succeeding normally).
- **The OS-level dead-man's-switch shutdown pattern (established for this batch) was explicitly overridden mid-batch by the user**: after a shutdown sequence was initiated following a session-limit hit, the user said "continue, don't shutdown this time." The pending shutdown was cancelled (`shutdown /a`) and the timer was **not** re-armed for the remainder of that session — work continued through further session-limit interruptions via the disk-verification pattern alone, with no shutdown safety net. This was treated as scoped to that specific interruption, not a permanent revocation of the standing "shut down once the batch is fully complete" instruction from a prior session — worth explicitly confirming with the user at the start of a future large batch whether the dead-man's-switch should be armed again by default, since its value (protecting against a session dying mid-turn with zero warning) is unchanged, but the user may prefer to be asked before any shutdown rather than have one fire automatically.
- Mobile app: no mobile *code* changes shipped alongside this recipe batch (only server-side data), consistent with prior batches.

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
| — cleanup | 88af650 | — | — | −4,647 (video-id dedup cleanup) | 1,682 (true unique baseline) |
| 10 | 88af650 | 218 new videos, 172 accepted | 222 (incl. 50 previously-orphaned by the bug) | +210 (12 cross-channel dupes dropped) | 1,892 |
| — cleanup 2 | 111865c | — | — | −145 (cross-batch cross-channel name dedup) | 1,747 (true unique baseline) |
| 11 | 2f50264 | 745 new videos, 610 accepted | 490 (277 already-covered by existing catalogue, 481 dropped as not-a-recipe) | +476 (14 cross-channel dupes dropped) | 2,223 |
| 12 | ce48349 | 371 new videos, 348 accepted | 264 (375 already-covered by existing catalogue, 504 dropped as not-a-recipe) | +263 (1 cross-channel dupe dropped) | 2,486 |
| 13 | 44f59b1 | 790 new videos, 693 accepted | 543 (526 already-covered by existing catalogue, 601 dropped as not-a-recipe) | +537 (6 cross-channel dupes dropped) | 3,023 |
| 14 | 05a031f | 3,609 new videos, 3,190 is_recipe:true (extraction yield) | 2,416 (1,306 already-covered by existing catalogue, 1,020 dropped as not-a-recipe) | +2,272 (144 cross-channel dupes dropped) | 5,295 |

(Batches 0–3 predate the cross-channel dedup feature and per-batch commit-message accuracy; batch 4's commit message is misleadingly generic — "Refactor code structure..." — but its diff confirms +497 recipes, matching the count reconciliation. **Batches 4–9's "Videos processed"/"Accepted" columns were cumulative full-corpus reprocessing counts under the pre-fix `merge.py`, and their "Recipes added" deltas include re-merged duplicates, not just genuinely new content** — don't use them as a model for expected batch-10-onward numbers, which now reflect only truly new videos. Batch 11/12's "Accepted" column in merge.py's own terminology counts only videos newly added to the catalogue this run, separate from the "already_covered" bucket — a video whose dish name already exists in the catalogue from a prior batch/channel is neither accepted nor dropped-as-not-a-recipe, it's silently skipped as a duplicate; this is why "Accepted" + "Recipes added" don't need to match exactly.)

### Per-channel totals vs. scraped so far (recounted directly from `raw/` folders, 2026-08-02, after batch 14)

| Channel | Long-form scraped | Total channel uploads (incl. Shorts, via API, as of batch 10 — stale) |
|---|---|---|
| YourFoodLab | 1,501 | 1,848 |
| KabitasKitchen | 1,374 | 2,476 |
| nishamadhulika | 1,883 | 2,570 |
| RanveerBrar | 1,033 | 1,857 |
| sanjeevkapoorkhazana | 620 | **17,142** |
| KunalKapur | 917 | 1,259 |

**Note:** the numbers above are a fresh direct count of `raw/<channel>/*.json` files, confirmed to sum to 7,328 matching `merge.py`'s own `videos=7328` corpus-size line. Re-derive this way (not from memory/prior doc text) whenever it's next updated. Batch 14's huge `--limit 2000` jump pushed YourFoodLab, KabitasKitchen, nishamadhulika, and KunalKapur to within striking distance of their (stale, Shorts-inclusive) total-upload counts — the next batch or two should watch for these channels reporting 0 new videos, meaning they're exhausted of long-form content near the front of their upload history.

Caveats: total-uploads column is stale (last checked batch 10) and includes Shorts (which we filter, min 90s duration) — recent-window skip ratios suggest roughly 25–65% of each channel's uploads are Shorts, so true remaining long-form count is lower than the raw delta. **sanjeevkapoorkhazana is still the major outlier** on total uploads (17k+ vs. 1–1.9k for the rest) and, despite finally being touched substantially in batch 14 (chunks 886–924, ~39 chunks, its largest single-batch dose yet), its scraped count (620) remains the *lowest* of all 6 channels relative to its true remaining depth — still the weakest-yield channel by a wide margin, and still worth the "separate slower schedule" idea below.

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
- **A subagent hitting a rate-limit error (session or weekly) mid-run often still completes its `Write` call before the error surfaces the following turn.** Its `task-notification` will show `status: failed` with a truncated `result`, but the chunk file may already exist and be complete/valid. **Always check whether `enriched/chunk_NN.json` exists (and has 8 valid entries) before assuming a "failed" chunk needs re-extraction** — re-running an already-complete chunk wastes a wave for nothing. Confirmed twice: batch 11 hit a session rate limit mid-wave-8, batch 12 hit a **weekly** rate limit mid-wave-7 (resets ~11:30pm IST) — in both cases every "failed" chunk from that wave had actually written valid output.
- **A weekly rate limit is a much bigger blocker than a session one** — it doesn't clear in minutes, only at its fixed nightly reset time. When this happens mid-batch, pause and ask the user how they want to handle the wait (idle until reset, leave it for next session, or something else) rather than assuming a short retry loop will work, since auto mode should not silently idle-wait for hours without confirming that's what's wanted.
- **A context-compaction or process restart mid-batch can make the harness report previously-completed background subagents as "no completion record found" / orphaned / failed**, even though their `enriched/chunk_NN.json` output was written successfully before the restart. Confirmed in batch 13: after one such restart, 26 already-finished chunks across 5 waves got this stale notification. Same rule as the rate-limit case above applies — **check the actual chunk file on disk (existence + entry count + schema) before treating any such notification as real lost work**, especially right after a compaction/restart.
- **The custom `youtube-extractor` agent (`.claude/agents/youtube-extractor.md`) is only loadable as a real `subagent_type` when the session is launched from inside `diet-plan/`** — a session launched from the monorepo root gets `Agent type 'youtube-extractor' not found` (confirmed batch 14). Workaround that still captures most of the token savings: launch `general-purpose` subagents instead, but have each one `Read` `youtube-extractor.md` for the criteria/schema rather than re-pasting that ~450-word block into every prompt. This only saves prompt-length tokens, not the tool-schema-reduction benefit of the agent's `tools: [Read, Write]` scoping — a session launched properly from `diet-plan/` should get both.
- **OS-level dead-man's-switch shutdown, for when a session-limit hit leaves the session unable to react at all**: before/after every extraction wave, run (PowerShell) `shutdown /a 2>$null; shutdown /s /t 900 /c "<message>"` — cancels any pending shutdown and reschedules a fresh one 900s (15min) out. If the session keeps working, the deadline keeps getting pushed forward and the shutdown never fires. If the session dies mid-turn with zero warning (the worst case — a rate-limit hit on the orchestrating turn itself, not a subagent), the last-scheduled shutdown fires unattended, and the machine reboots into a clean state instead of sitting stuck indefinitely. This is a **standing user instruction for large batches** — arm it before starting extraction, renew it around every wave, and if a session-limit hit is confirmed (not just suspected), stop launching new waves, verify+document current state in this file, and let the batch resume in the next session rather than repeatedly retrying into the same limit. **The user can override this mid-batch** ("continue, don't shutdown this time" — batch 14) — treat that as scoped to the specific interruption it was said in reply to, not a permanent revocation; confirm at the start of the *next* large batch whether to re-arm it by default.
- **The `claude-sonnet-5[1m]` safety classifier can become "temporarily unavailable," causing `Agent` tool calls to fail immediately at launch** with an error like "claude-sonnet-5[1m] is temporarily unavailable, so auto mode cannot determine the safety of Agent right now." This is distinct from a session-limit hit: the subagent never started, so there's no chunk file to verify on disk — the fix is just to retry the same `Agent` launch call once the classifier becomes available again (confirmed by the next call succeeding normally). Seen repeatedly in batch 14's 57-wave run.

## Open items / ideas

- **Batch 11 bumped the increment to +200 (500→700)** — worked mechanically (94 chunks, 16 extraction waves) but yield dropped to ~64% net because it pulled deep into sanjeevkapoorkhazana's older, compilation-heavy back-catalog (10 of 94 chunks touched that channel). **Batch 12 dialed back to +100 (700→800)** specifically to limit how deep each batch reaches into that channel — worked as intended: only 4 of 47 chunks touched sanjeevkapoorkhazana this time, and net yield recovered to ~89%. This confirms the increment size is now the main lever for controlling how much of a batch gets "diluted" by that channel — smaller increments front-load the other 5 channels' still-plentiful easy content and defer sanjeevkapoorkhazana's harder content to later batches.
- Consider a separate, larger `--limit` schedule just for `@sanjeevkapoorkhazana` once the other 5 channels are closer to exhausted, rather than lock-stepping all 6 channels to the same limit — its scraped-so-far count (267) remains the *lowest* of all 6 channels despite having 17k+ total uploads, because so much of what gets fetched there is rejected as non-recipe.
- No mobile app code changes have been needed for any of these batches — if that changes (e.g. a schema-visible field is added), remember to bump `mobile/release-version.json` and ship a build, per the project's `diet-release` skill.
