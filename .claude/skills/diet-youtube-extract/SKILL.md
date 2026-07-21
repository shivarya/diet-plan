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

1. **Use the `youtube-extractor` custom subagent** (`.claude/agents/youtube-extractor.md`),
   not `general-purpose`. It's scoped to `tools: [Read, Write]` only (this
   task never needs Bash/Glob/Grep/Edit/WebFetch/etc., and loading those
   schemas into every one of the ~100+ subagent invocations a large batch
   needs is pure waste — see "Token discipline" in that agent file) and has
   the full `SYSTEM`/`SCHEMA` criteria from `server/scripts/youtube/extract.py`
   baked into its own persistent definition, so you do **not** need to
   re-paste that ~450-word block into every subagent prompt — that
   duplication across ~100+ calls a batch was the other half of the token
   waste this agent fixes. If the extraction criteria ever changes, update
   both `extract.py` and `youtube-extractor.md` together to keep them in sync.

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

3. **Spawn one subagent per chunk** (Agent tool, `subagent_type: youtube-extractor`,
   `model: haiku` — cost-efficient, matches the INDB precedent). Launch
   several in parallel per message (e.g. 5-6 at a time) rather than one at a
   time; wait for a wave to finish before starting the next if there are
   many chunks. Since the criteria/schema already live in the agent
   definition, each subagent's prompt only needs to be:
   - The absolute paths of the raw video JSON files in this chunk (fields:
     `video_id`, `title`, `description`, `transcript`).
   - The exact absolute output path `database/seed/youtube/enriched/chunk_NN.json`
     for this chunk.
   Do **not** re-paste the `SYSTEM`/`SCHEMA` text per call — that's the
   duplication `youtube-extractor` exists to eliminate.

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
