---
name: diet-youtube-extract
description: Run Stage B of the YouTube recipe-import pipeline (server/scripts/youtube/) using Claude Code subagents instead of the Anthropic Batches API — no ANTHROPIC_API_KEY needed, just an active Claude Code session. Use after fetch.py has produced raw video JSON and before merge.py.
---

Stage B of `server/scripts/youtube/` (see [scripts/youtube/README.md](../../../server/scripts/youtube/README.md))
turns each raw fetched video into a structured recipe (or gates it out as
"not a recipe"). The pipeline's default path (`extract.py`) does this via the
Anthropic Message Batches API, which needs a real `ANTHROPIC_API_KEY` (pay-
per-token/batch billing — a Claude Code subscription does not provide one).

**This skill is the no-API-key alternative**: Claude Code itself does the
extraction, using Haiku subagents, writing the exact same
`database/seed/youtube/enriched/chunk_NN.json` output shape `extract.py`
would have produced — `merge.py` (Stage C) doesn't care which one made them,
it just reads whatever chunk files exist. This mirrors how the INDB
pipeline's Stage B was actually run in practice (see `diet-seed` SKILL.md /
`scripts/indb/README.md`): "the actual 250-dish run ... used Claude Code
Haiku subagents (no API billing)".

## Before running this

1. `server/scripts/youtube/channels.json` has real channel handles, and
   `python scripts/youtube/fetch.py` (Stage A — needs only `YOUTUBE_API_KEY`,
   no Anthropic credential at all) has already produced raw video JSON under
   `database/seed/youtube/raw/<handle>/<video_id>.json`.

## What to do (Claude Code orchestrates this directly)

1. **Read the shared criteria from the single source of truth**: open
   `server/scripts/youtube/extract.py` and read its `SYSTEM` string and
   `SCHEMA` dict. Every subagent you spawn must be given this exact
   system prompt text and this exact required-field list/enums verbatim —
   don't paraphrase or drift from it, since `merge.py` validates against
   those same enums (`meal_type`, `food_type`, `dish_category`, `difficulty`)
   and requires `name`/`ingredients`/`instructions` to be non-empty.

2. **List the raw videos and figure out what's left to do**:
   - `glob` all `database/seed/youtube/raw/*/*.json` files.
   - `glob` existing `database/seed/youtube/enriched/chunk_*.json` files —
     these are already done (each is a `{video_id: {...fields}}` object);
     collect the video_ids already covered so you don't reprocess them.
   - Chunk the *remaining* videos into groups of **8** (small on purpose —
     unlike the Batches API, which sends each video as an independent
     single-turn request, a subagent reads every raw JSON file in its chunk
     into its own context in one turn, so keep chunks small enough that a
     handful of ~10k-character transcripts plus output still fits
     comfortably). Number new chunk files continuing from the highest
     existing `chunk_NN` index (zero-padded, e.g. `chunk_07.json`).

3. **Spawn one subagent per chunk** (Agent tool, `subagent_type: general-purpose`,
   `model: haiku` — cost-efficient, matches the INDB precedent). Launch
   several in parallel per message (e.g. 4-6 at a time) rather than one at a
   time; wait for a wave to finish before starting the next if there are
   many chunks. Each subagent's prompt must be **fully self-contained**
   (it has no memory of this conversation) and must include:
   - The exact `SYSTEM` text from `extract.py`, verbatim.
   - The exact required JSON field list and enum values from `SCHEMA`,
     verbatim (spell out every field name, type, and allowed enum values —
     don't just say "see the schema").
   - The absolute paths of the raw video JSON files in this chunk, with an
     instruction to `Read` each one (fields: `video_id`, `title`,
     `description`, `transcript`).
   - An instruction to produce ONE JSON object keyed by `video_id`, each
     value matching the schema exactly, and `Write` it to the exact absolute
     output path `database/seed/youtube/enriched/chunk_NN.json` for this
     chunk — valid JSON only, no markdown fences, no commentary.
   - A reminder that `estimated_*` nutrition fields are a fallback only (used
     if Stage C finds no verified nutrition-database match) and should still
     be a genuine best-effort estimate, not a placeholder.

4. **Verify each chunk file after its subagent reports done**: read it back,
   confirm it's valid JSON, confirm it has one entry per video in that
   chunk, and spot-check that `is_recipe`/enum fields look sane. Subagent
   self-reports are not proof of correctness — same caution the INDB
   pipeline's docs already call out ("subagent self-reported counts are
   unreliable").

5. Once every raw video is covered by some `chunk_NN.json`, proceed exactly
   as the README describes: `python scripts/youtube/merge.py --dry-run`,
   review the accepted/dropped/rejected counts and the verified/estimated
   nutrition split, then `python scripts/youtube/merge.py` for real, then
   `php scripts/seed.php`.

## If the user later gets a real `ANTHROPIC_API_KEY`

`extract.py` still works as originally written and is likely less effort to
orchestrate for a very large one-time backfill (it's a single unattended
command instead of you managing waves of subagents). Either path produces
the same `chunk_NN.json` shape, so `merge.py` never needs to know or care
which one ran — you can even mix: some chunks from `extract.py`, others from
this skill, in the same import.
