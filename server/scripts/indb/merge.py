#!/usr/bin/env python3
"""
Stage C of the INDB enrichment pipeline (see scripts/indb/README.md).

Joins the Haiku enrichment back to the candidates, RE-APPLIES the authoritative
INDB nutrition (so the model can never have altered macros), validates, dedups,
derives consistent flags, and appends the accepted dishes to recipes.json.

  python scripts/indb/merge.py --dry-run     # counts only, writes nothing
  python scripts/indb/merge.py               # append accepted dishes to recipes.json

Then reseed with the existing idempotent scripts:
  php scripts/seed.php && php scripts/backfill-images.php
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_DIR = os.path.join(HERE, "..", "..", "database", "seed")
WORK_DIR = os.path.join(SEED_DIR, "indb")
CANDIDATES = os.path.join(WORK_DIR, "indb_candidates.json")
ENRICHED_DIR = os.path.join(WORK_DIR, "indb_enriched")
RECIPES = os.path.join(SEED_DIR, "recipes.json")

MEAL = {"breakfast", "lunch", "dinner", "snack"}
FOOD = {"veg", "egg", "nonveg"}
CAT = {"main", "bread", "rice", "snack"}
DIFF = {"easy", "medium", "hard"}


def _as_dict(data):
    # Chunk files may be a list of objects (each with "slug") or a {slug: obj} dict.
    if isinstance(data, list):
        return {o["slug"]: o for o in data if isinstance(o, dict) and o.get("slug")}
    return data


def load_enriched(source):
    if source == "smoke":
        return _as_dict(json.load(open(os.path.join(WORK_DIR, "_smoke.json"), encoding="utf-8")))
    merged = {}
    if not os.path.isdir(ENRICHED_DIR):
        sys.exit(f"No enriched chunks at {ENRICHED_DIR} — run enrich.py first.")
    for f in sorted(os.listdir(ENRICHED_DIR)):
        if f.startswith("chunk_") and f.endswith(".json"):
            merged.update(_as_dict(json.load(open(os.path.join(ENRICHED_DIR, f), encoding="utf-8"))))
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source", choices=["chunks", "smoke"], default="chunks")
    args = ap.parse_args()

    cands = {c["slug"]: c for c in json.load(open(CANDIDATES, encoding="utf-8"))}
    enriched = load_enriched(args.source)
    existing = json.load(open(RECIPES, encoding="utf-8"))
    existing_slugs = {r["slug"] for r in existing}

    accepted, dropped, rejected = [], [], []
    seen = set()
    for slug, e in enriched.items():
        cand = cands.get(slug)
        if not cand:
            rejected.append((slug, "no candidate"))
            continue
        if not e.get("keep"):
            dropped.append((slug, e.get("reason", "keep=false")))
            continue
        # validate AI fields
        if (e.get("meal_type") not in MEAL or e.get("food_type") not in FOOD
                or e.get("dish_category") not in CAT or e.get("difficulty") not in DIFF
                or not e.get("ingredients") or not e.get("instructions")):
            rejected.append((slug, "invalid/missing fields"))
            continue
        if slug in existing_slugs or slug in seen:
            rejected.append((slug, "duplicate slug"))
            continue
        seen.add(slug)

        food = e["food_type"]
        cal, prot, carb = cand["calories"], cand["protein_g"], cand["carbs_g"]
        accepted.append({
            "slug": slug,
            "name": cand["name"],
            "cuisine": (e.get("cuisine") or "Indian").strip()[:64],
            "meal_type": e["meal_type"],
            "food_type": food,
            "dish_category": e["dish_category"],
            "servings": 2,
            # authoritative INDB nutrition, re-applied verbatim:
            "calories": cal, "protein_g": prot, "carbs_g": carb,
            "fat_g": cand["fat_g"], "fiber_g": cand["fiber_g"],
            "calcium_mg": cand["calcium_mg"], "vitamin_score": cand["vitamin_score"],
            # flags: derived from nutrition where possible, else from the model
            "contains_egg": 1 if food == "egg" else 0,
            "contains_onion": 1 if e.get("contains_onion") else 0,
            "contains_garlic": 1 if e.get("contains_garlic") else 0,
            "is_kid_friendly": 1 if e.get("is_kid_friendly") else 0,
            "is_high_protein": 1 if prot >= 12 else 0,
            "is_low_carb": 1 if carb <= 18 else 0,
            "is_weight_loss": 1 if (cal <= 400 and prot >= 8) else 0,
            "ingredients": [str(x).strip().lower() for x in e["ingredients"] if str(x).strip()][:14],
            "instructions": e["instructions"].strip(),
            "prep_time_min": int(e.get("prep_time_min") or 20),
            "difficulty": e["difficulty"],
            "image_url": None,
        })

    print(f"enriched={len(enriched)} | accepted={len(accepted)} "
          f"dropped(keep=false)={len(dropped)} rejected={len(rejected)}")
    if dropped[:5]:
        print("  sample drops:", "; ".join(f"{s}({r})" for s, r in dropped[:5]))
    if rejected[:5]:
        print("  sample rejects:", "; ".join(f"{s}({r})" for s, r in rejected[:5]))
    by_food = {}
    for a in accepted:
        by_food[a["food_type"]] = by_food.get(a["food_type"], 0) + 1
    print("  accepted by food_type:", by_food)

    if args.dry_run:
        print(f"\n[dry-run] would grow recipes.json {len(existing)} -> {len(existing) + len(accepted)}")
        return
    if not accepted:
        print("\nNothing to append.")
        return

    # Append in the file's existing one-object-per-line compact style (minimal git diff),
    # rather than re-serialising the whole array.
    text = open(RECIPES, encoding="utf-8").read()
    cut = text.rstrip().rfind("]")
    head = text[:cut].rstrip()            # "... last entry }"
    block = ",\n" + ",\n".join("  " + json.dumps(a, ensure_ascii=False) for a in accepted) + "\n"
    open(RECIPES, "w", encoding="utf-8").write(head + block + "]\n")

    total = len(existing) + len(accepted)
    print(f"\nrecipes.json now has {total} dishes (+{len(accepted)}). "
          "Run: php scripts/seed.php && php scripts/backfill-images.php")


if __name__ == "__main__":
    sys.exit(main())
