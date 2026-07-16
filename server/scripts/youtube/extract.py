#!/usr/bin/env python3
"""
Stage B of the YouTube recipe-import pipeline (see scripts/youtube/README.md).

Uses Claude Haiku via the Message Batches API -- same pattern as
server/scripts/indb/enrich.py -- to turn each raw video (title + description +
transcript) into a structured recipe, or gate it out if it isn't actually a
recipe video. NUTRITION HERE IS A FALLBACK ONLY: merge.py (Stage C) tries to
match each dish against the INDB workbook for verified nutrition first, and
only falls back to this stage's estimated_* fields when no match is found.

Needs a real ANTHROPIC_API_KEY (pay-per-token/batch billing) -- a Claude Code
subscription does not provide one. If you don't have one, use the
`diet-youtube-extract` Claude Code skill instead: it has Claude Code itself
do this stage via Haiku subagents (no API key), writing the identical
chunk_NN.json shape below -- merge.py doesn't care which path produced them.
This script's SYSTEM prompt and SCHEMA below are the single source of truth
that skill copies from, so keep them in sync if you change the criteria.

  export ANTHROPIC_API_KEY=...
  python scripts/youtube/extract.py --smoke 10     # tiny preview batch for review
  python scripts/youtube/extract.py                # full run, chunked + resumable

Output: server/database/seed/youtube/enriched/chunk_NN.json   (full run)
        server/database/seed/youtube/_smoke.json               (--smoke)
"""
import argparse
import glob
import json
import os
import sys
import time

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERE, "..", "..", "database", "seed", "youtube")
RAW_DIR = os.path.join(WORK_DIR, "raw")
ENRICHED_DIR = os.path.join(WORK_DIR, "enriched")

MODEL = "claude-haiku-4-5"   # same choice as the INDB pipeline; no effort/thinking on 4.5

SYSTEM = (
    "You are an Indian chef and nutritionist reviewing a YouTube cooking channel's videos "
    "to add its recipes to a meal-planner catalogue.\n"
    "For each video you get its title, description, and (if available) a caption transcript.\n"
    "First decide: is this actually a cooking video that demonstrates making ONE specific dish "
    "with ingredients and a method? If it's a vlog, haul, grocery trip, compilation, Q&A, "
    "restaurant review, or any non-recipe content, set \"is_recipe\": false and explain why in "
    "\"reason\". Otherwise set \"is_recipe\": true and fill every field accurately:\n"
    "  name: the dish's name (not the video title -- strip 'How to make'/channel branding/emoji).\n"
    "  cuisine: short label e.g. Indian, South Indian, Indo-Chinese, Continental.\n"
    "  meal_type: breakfast|brunch|lunch|dinner|snack ONLY (best fit for Indian eating habits) -- "
    "this is a time-of-day slot, never 'dessert' or 'beverage' (those go in dish_category below). "
    "A dessert or drink still needs a real meal_type -- use snack unless it clearly fits another slot.\n"
    "  food_type: veg|egg|nonveg. nonveg if it contains ANY meat/fish/poultry (incl. ham, bacon, "
    "sausage, prawn); egg if it has egg but no meat/fish; otherwise veg.\n"
    "  dish_category: main|bread|rice|snack|beverage|dessert. Use dessert for sweets/sweet dishes "
    "(e.g. kheer, halwa, cake, ice cream, ladoo) -- don't lump them into snack.\n"
    "  servings: how many people the recipe as shown serves (integer, guess 2 if unclear).\n"
    "  ingredients: every ingredient actually used, short lowercase names with quantity if stated.\n"
    "  instructions: the method as clear plain steps, based on what's actually shown/said.\n"
    "  contains_onion / contains_garlic / contains_egg: 1 if used in this specific recipe, else 0.\n"
    "  is_kid_friendly: 1 if mild and child-appealing, else 0.\n"
    "  is_high_protein / is_low_carb / is_weight_loss: tag HONESTLY based on the dish itself -- "
    "these are informational tags, not a filter. A dessert or deep-fried snack should get 0s, "
    "not be rejected; never set is_recipe:false just because the dish doesn't fit a diet.\n"
    "  difficulty: easy|medium|hard.  prep_time_min: integer total minutes.\n"
    "  estimated_calories/protein_g/carbs_g/fat_g/fiber_g/calcium_mg: your best-effort per-serving "
    "nutrition estimate from the ingredients and quantities shown -- this is a FALLBACK only, used "
    "if no verified nutrition-database match is found later, so make a genuine best estimate "
    "rather than a placeholder.\n"
    "If is_recipe is false, still fill every other field with any value (they will be discarded) "
    "-- only \"is_recipe\" and \"reason\" matter in that case.\n"
    "Respond ONLY with the JSON object."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "is_recipe": {"type": "boolean"},
        "reason": {"type": "string"},
        "name": {"type": "string"},
        "cuisine": {"type": "string"},
        "meal_type": {"type": "string", "enum": ["breakfast", "brunch", "lunch", "dinner", "snack"]},
        "food_type": {"type": "string", "enum": ["veg", "egg", "nonveg"]},
        "dish_category": {"type": "string", "enum": ["main", "bread", "rice", "snack", "beverage", "dessert"]},
        "servings": {"type": "integer"},
        "ingredients": {"type": "array", "items": {"type": "string"}},
        "instructions": {"type": "string"},
        "contains_onion": {"type": "integer", "enum": [0, 1]},
        "contains_garlic": {"type": "integer", "enum": [0, 1]},
        "contains_egg": {"type": "integer", "enum": [0, 1]},
        "is_kid_friendly": {"type": "integer", "enum": [0, 1]},
        "is_high_protein": {"type": "integer", "enum": [0, 1]},
        "is_low_carb": {"type": "integer", "enum": [0, 1]},
        "is_weight_loss": {"type": "integer", "enum": [0, 1]},
        "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
        "prep_time_min": {"type": "integer"},
        "estimated_calories": {"type": "integer"},
        "estimated_protein_g": {"type": "integer"},
        "estimated_carbs_g": {"type": "integer"},
        "estimated_fat_g": {"type": "integer"},
        "estimated_fiber_g": {"type": "integer"},
        "estimated_calcium_mg": {"type": "integer"},
    },
    "required": ["is_recipe", "reason", "name", "cuisine", "meal_type", "food_type", "dish_category",
                 "servings", "ingredients", "instructions", "contains_onion", "contains_garlic",
                 "contains_egg", "is_kid_friendly", "is_high_protein", "is_low_carb", "is_weight_loss",
                 "difficulty", "prep_time_min", "estimated_calories", "estimated_protein_g",
                 "estimated_carbs_g", "estimated_fat_g", "estimated_fiber_g", "estimated_calcium_mg"],
    "additionalProperties": False,
}


def load_raw_videos():
    videos = []
    for path in sorted(glob.glob(os.path.join(RAW_DIR, "*", "*.json"))):
        videos.append(json.load(open(path, encoding="utf-8")))
    return videos


def build_request(video):
    transcript = (video.get("transcript") or "")[:10000]
    user = (
        f"Title: {video['title']}\n\n"
        f"Description:\n{(video.get('description') or '')[:3000]}\n\n"
        + (f"Transcript (auto-generated captions, may be imperfect):\n{transcript}\n"
           if transcript else "(no transcript available for this video)\n")
    )
    return Request(
        custom_id=video["video_id"],
        params=MessageCreateParamsNonStreaming(
            model=MODEL,
            max_tokens=1500,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        ),
    )


def run_batch(client, reqs, label, poll):
    print(f"[{label}] submitting batch of {len(reqs)} videos...")
    batch = client.messages.batches.create(requests=reqs)
    while True:
        b = client.messages.batches.retrieve(batch.id)
        if b.processing_status == "ended":
            break
        rc = b.request_counts
        print(f"[{label}] {b.processing_status}: processing={rc.processing} "
              f"succeeded={rc.succeeded} errored={rc.errored}")
        time.sleep(poll)

    enriched, usage = {}, {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
    errors = 0
    for result in client.messages.batches.results(batch.id):
        if result.result.type != "succeeded":
            errors += 1
            print(f"[{label}] {result.custom_id}: {result.result.type}")
            continue
        msg = result.result.message
        u = msg.usage
        usage["in"] += u.input_tokens
        usage["out"] += u.output_tokens
        usage["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0
        usage["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0
        text = next((blk.text for blk in msg.content if blk.type == "text"), "")
        try:
            enriched[result.custom_id] = json.loads(text)
        except json.JSONDecodeError:
            errors += 1
            print(f"[{label}] {result.custom_id}: bad JSON")

    # Batch pricing for Haiku 4.5: input $0.50/MTok, output $2.50/MTok, cache read ~$0.05.
    cost = (usage["in"] / 1e6) * 0.50 + (usage["out"] / 1e6) * 2.50 + (usage["cache_read"] / 1e6) * 0.05
    print(f"[{label}] done: {len(enriched)} enriched, {errors} errors | "
          f"tokens in={usage['in']} out={usage['out']} "
          f"cache_read={usage['cache_read']} | ~${cost:.3f}")
    return enriched, usage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", type=int, default=0, help="process first N into _smoke.json for review")
    ap.add_argument("--chunk-size", type=int, default=100)
    ap.add_argument("--poll", type=int, default=20, help="seconds between status polls")
    ap.add_argument("--force", action="store_true", help="re-run chunks that already exist")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ERROR: set ANTHROPIC_API_KEY in the environment first.")
    videos = load_raw_videos()
    if not videos:
        sys.exit(f"No raw videos found under {RAW_DIR} -- run fetch.py first.")
    client = anthropic.Anthropic(max_retries=5)

    if args.smoke:
        reqs = [build_request(v) for v in videos[:args.smoke]]
        enriched, _ = run_batch(client, reqs, "smoke", args.poll)
        out = os.path.join(WORK_DIR, "_smoke.json")
        json.dump(enriched, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        kept = sum(1 for e in enriched.values() if e.get("is_recipe"))
        print(f"\nReview preview ({kept}/{len(enriched)} are recipes) -> {out}")
        for vid, e in list(enriched.items())[:8]:
            tag = "RECIPE " if e.get("is_recipe") else "SKIP   "
            print(f"  {tag}{vid}: {e.get('name') if e.get('is_recipe') else e.get('reason')}")
        return

    os.makedirs(ENRICHED_DIR, exist_ok=True)
    chunks = [videos[i:i + args.chunk_size] for i in range(0, len(videos), args.chunk_size)]
    print(f"{len(videos)} videos -> {len(chunks)} chunks of up to {args.chunk_size}")
    grand = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
    for idx, chunk in enumerate(chunks):
        out = os.path.join(ENRICHED_DIR, f"chunk_{idx:02d}.json")
        if os.path.exists(out) and not args.force:
            print(f"[chunk {idx:02d}] exists, skipping (use --force to redo)")
            continue
        enriched, usage = run_batch(client, [build_request(v) for v in chunk], f"chunk {idx:02d}", args.poll)
        json.dump(enriched, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        for k in grand:
            grand[k] += usage[k]
    total_cost = (grand["in"] / 1e6) * 0.50 + (grand["out"] / 1e6) * 2.50 + (grand["cache_read"] / 1e6) * 0.05
    print(f"\nALL CHUNKS DONE | tokens in={grand['in']} out={grand['out']} "
          f"cache_read={grand['cache_read']} | ~${total_cost:.3f}")
    print("Next: python scripts/youtube/merge.py --dry-run")


if __name__ == "__main__":
    sys.exit(main())
