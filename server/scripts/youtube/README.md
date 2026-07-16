# YouTube -> catalogue enrichment

Grows `database/seed/recipes.json` with recipes pulled from your favorite
YouTube cooking channels. No YouTube login is required anywhere in this
pipeline (see "No login, but two caveats" below).

**Principle:** nutrition is matched against the same INDB workbook
`scripts/indb/` uses whenever possible (`nutrition_source: verified`); only
when no confident match exists does the pipeline fall back to Claude's own
per-serving estimate (`nutrition_source: estimated`), and that flag travels
all the way into the `recipes` table so an estimate is never silently treated
as ground truth. Unlike the INDB pipeline, recipes that don't fit this app's
low-carb/high-protein/weight-loss focus (desserts, deep-fried snacks, etc.)
are **kept, not dropped** -- they came from a channel you specifically chose,
and the planner's existing hard-filter/soft-score already deprioritizes what
doesn't fit a given day.

**Cross-channel duplicates:** when the same dish (by normalized name) shows
up from more than one channel/video in a batch, `merge.py` keeps only the one
from the most-viewed video and drops the rest -- reported as "cross-channel
duplicates dropped" in its output. This only compares within a single
`merge.py` run, not against dishes already committed to `recipes.json` from a
previous run (view counts aren't persisted to the DB, only used transiently
during merge).

## Prerequisites

```
pip install youtube-transcript-api google-api-python-client anthropic openpyxl
export YOUTUBE_API_KEY=...      # free Google Cloud API key -- see below
export ANTHROPIC_API_KEY=...    # same key scripts/indb/enrich.py uses (Batches access)
```

**No `ANTHROPIC_API_KEY`?** (a Claude Code subscription doesn't provide one)
— skip `extract.py` and use the `diet-youtube-extract` Claude Code skill
instead. It has Claude Code do Stage B directly via Haiku subagents, writing
the same `chunk_NN.json` files `extract.py` would have, so Stage C
(`merge.py`) works identically either way.

### Getting a `YOUTUBE_API_KEY`
Google Cloud Console -> create/select a project -> enable "YouTube Data API
v3" -> Credentials -> "Create credentials" -> API key. This is a one-time
setup using your Google account to mint a key; it is **not** a YouTube login
-- the pipeline never authenticates as a YouTube user or opens a browser
session.

### No login, but two caveats
1. **Channel/video listing and descriptions** go through the official
   YouTube Data API (API key only, no OAuth).
2. **Caption transcripts** go through an unofficial but also login-free
   endpoint (`youtube-transcript-api`). It works for public videos with
   captions available, but YouTube blocks known cloud/VPS IP ranges from it
   -- **run `fetch.py` from your own machine**, not a server, or transcripts
   will silently fail. If a video's captions are disabled/blocked, the
   pipeline falls back to the description alone rather than dropping the
   video.

## Configure your channels

Edit `channels.json`:
```json
[
  { "handle": "@yourfavoritechannel", "name": "Display Name" }
]
```
Add more channels any time; re-running `fetch.py` only pulls videos it
hasn't already fetched.

## Run order

```
# Stage A -- deterministic, no AI. Run locally (see caveats above).
python scripts/youtube/fetch.py --limit 20      # small smoke test first
python scripts/youtube/fetch.py                 # then the full channel backfill
#   -> database/seed/youtube/raw/<handle>/<video_id>.json

# Stage B -- Claude Haiku enrichment via the Batches API (resumable, chunked).
# No ANTHROPIC_API_KEY? Use the `diet-youtube-extract` Claude Code skill instead --
# same chunk_NN.json output, done via Haiku subagents under your Claude Code subscription.
python scripts/youtube/extract.py --smoke 10    # tiny preview batch -> _smoke.json (review first!)
python scripts/youtube/extract.py               # full run: chunk_NN.json, skips finished chunks

# Stage C -- match INDB nutrition where possible, validate, dedup, append.
python scripts/youtube/merge.py --dry-run       # counts + verified/estimated split only
python scripts/youtube/merge.py                 # appends accepted dishes to recipes.json

# If you already have raw videos fetched without view_count (older runs),
# backfill it cheaply (no transcript re-fetch, no re-listing):
python scripts/youtube/fetch.py --refresh-stats

# Load into the DB:
php scripts/seed.php
```
`merge.py --source smoke` validates/merges the smoke output instead of the
chunks (useful to exercise Stage C end-to-end on the preview before the full
run).

## Working data

Everything under `database/seed/youtube/` (raw videos + enriched chunks) is
git-ignored. Only the final accepted dishes land in `recipes.json`. The
downloaded INDB workbook is shared/cached with `scripts/indb/` at
`database/seed/indb/Anuvaad_INDB_2024.11.xlsx`.

## What lands in the DB

- `video_url` is the actual source video (real provenance), not a generic
  name-search fallback.
- `image_url` defaults to the video's own YouTube thumbnail -- a real photo
  of that exact dish.
- `source_channel` and `nutrition_source` (added in
  `database/migrations/004_recipe_provenance.sql`) record where the recipe
  and its nutrition came from.
