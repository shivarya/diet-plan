#!/usr/bin/env python3
"""
Stage B of the INDB enrichment pipeline (see scripts/indb/README.md).

Uses Claude Haiku via the Message Batches API to backfill the descriptive fields
INDB lacks (ingredients, method, flags, corrected meal/food/category/cuisine) and
to gate out unsuitable dishes. NUTRITION IS NEVER TOUCHED HERE — Stage C re-applies
the authoritative INDB values from indb_candidates.json.

  export ANTHROPIC_API_KEY=...           # required
  python scripts/indb/enrich.py --smoke 12     # tiny preview batch for review
  python scripts/indb/enrich.py                # full run, chunked + resumable

Output: server/database/seed/indb/indb_enriched/chunk_NN.json   (full run)
        server/database/seed/indb/_smoke.json                   (--smoke)
"""
import argparse
import json
import os
import sys
import time

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERE, "..", "..", "database", "seed", "indb")
CANDIDATES = os.path.join(WORK_DIR, "indb_candidates.json")
ENRICHED_DIR = os.path.join(WORK_DIR, "indb_enriched")

MODEL = "claude-haiku-4-5"   # the user explicitly chose Haiku; no effort/thinking on 4.5

SYSTEM = (
    "You are an Indian chef and nutritionist curating a meal-planner catalogue of "
    "high-protein, low-carb, weight-loss-friendly dishes.\n"
    "For each dish you get a name and its FIXED per-serving nutrition. Decide if it belongs:\n"
    "- If it is a dessert, sweet, sugary drink, condiment, plain raw ingredient, non-food, "
    "or a near-duplicate of a very common dish, set \"keep\": false with a short \"reason\".\n"
    "- Otherwise set \"keep\": true and fill every field accurately:\n"
    "  meal_type: breakfast|lunch|dinner|snack (best fit for Indian eating habits).\n"
    "  food_type: veg|egg|nonveg. nonveg if it contains ANY meat/fish/poultry (incl. ham, "
    "bacon, sausage, prawn); egg if it has egg but no meat/fish; otherwise veg.\n"
    "  dish_category: main|bread|rice|snack.\n"
    "  cuisine: short label e.g. Indian, South Indian, Indo-Chinese, Continental.\n"
    "  ingredients: the main ingredients, 6-12 short lowercase names.\n"
    "  instructions: 2-4 plain sentences on how to cook it.\n"
    "  contains_onion / contains_garlic: 1 if a typical recipe uses it, else 0.\n"
    "  is_kid_friendly: 1 if mild and child-appealing, else 0.\n"
    "  difficulty: easy|medium|hard.  prep_time_min: integer total minutes.\n"
    "Never output nutrition numbers — they are fixed elsewhere. Respond ONLY with the JSON object."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "keep": {"type": "boolean"},
        "meal_type": {"type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"]},
        "food_type": {"type": "string", "enum": ["veg", "egg", "nonveg"]},
        "dish_category": {"type": "string", "enum": ["main", "bread", "rice", "snack"]},
        "cuisine": {"type": "string"},
        "ingredients": {"type": "array", "items": {"type": "string"}},
        "instructions": {"type": "string"},
        "contains_onion": {"type": "integer", "enum": [0, 1]},
        "contains_garlic": {"type": "integer", "enum": [0, 1]},
        "is_kid_friendly": {"type": "integer", "enum": [0, 1]},
        "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
        "prep_time_min": {"type": "integer"},
        "reason": {"type": "string"},
    },
    "required": ["keep", "meal_type", "food_type", "dish_category", "cuisine", "ingredients",
                 "instructions", "contains_onion", "contains_garlic", "is_kid_friendly",
                 "difficulty", "prep_time_min"],
    "additionalProperties": False,
}


def build_request(cand):
    user = (
        f"Dish: {cand['name']}\n"
        f"Per-serving nutrition (fixed): {cand['calories']} kcal, {cand['protein_g']}g protein, "
        f"{cand['carbs_g']}g carbs, {cand['fat_g']}g fat, {cand['calcium_mg']}mg calcium.\n"
        f"Initial guess (verify/correct): meal={cand['meal_type_guess']}, food={cand['food_type_guess']}."
    )
    return Request(
        custom_id=cand["slug"],
        params=MessageCreateParamsNonStreaming(
            model=MODEL,
            max_tokens=700,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        ),
    )


def run_batch(client, reqs, label, poll):
    print(f"[{label}] submitting batch of {len(reqs)} dishes...")
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
    candidates = json.load(open(CANDIDATES, encoding="utf-8"))
    client = anthropic.Anthropic(max_retries=5)

    if args.smoke:
        reqs = [build_request(c) for c in candidates[:args.smoke]]
        enriched, _ = run_batch(client, reqs, "smoke", args.poll)
        out = os.path.join(WORK_DIR, "_smoke.json")
        json.dump(enriched, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        kept = sum(1 for e in enriched.values() if e.get("keep"))
        print(f"\nReview preview ({kept}/{len(enriched)} kept) -> {out}")
        for slug, e in list(enriched.items())[:8]:
            tag = "KEEP " if e.get("keep") else "DROP "
            print(f"  {tag}{slug}: {e.get('meal_type')}/{e.get('food_type')} "
                  f"ing={len(e.get('ingredients', []))} "
                  + (f"reason={e.get('reason')}" if not e.get("keep") else ""))
        return

    os.makedirs(ENRICHED_DIR, exist_ok=True)
    chunks = [candidates[i:i + args.chunk_size] for i in range(0, len(candidates), args.chunk_size)]
    print(f"{len(candidates)} candidates -> {len(chunks)} chunks of up to {args.chunk_size}")
    grand = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
    for idx, chunk in enumerate(chunks):
        out = os.path.join(ENRICHED_DIR, f"chunk_{idx:02d}.json")
        if os.path.exists(out) and not args.force:
            print(f"[chunk {idx:02d}] exists, skipping (use --force to redo)")
            continue
        enriched, usage = run_batch(client, [build_request(c) for c in chunk], f"chunk {idx:02d}", args.poll)
        json.dump(enriched, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        for k in grand:
            grand[k] += usage[k]
    total_cost = (grand["in"] / 1e6) * 0.50 + (grand["out"] / 1e6) * 2.50 + (grand["cache_read"] / 1e6) * 0.05
    print(f"\nALL CHUNKS DONE | tokens in={grand['in']} out={grand['out']} "
          f"cache_read={grand['cache_read']} | ~${total_cost:.3f}")


if __name__ == "__main__":
    sys.exit(main())
