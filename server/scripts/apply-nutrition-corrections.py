"""
Apply catalogue data fixes to database/seed/recipes.json (then deploy + `php scripts/seed.php`).

  python scripts/apply-nutrition-corrections.py database/seed/nutrition-corrections-2026-10.json

1. Nutrition: each slug in the corrections file gets its re-estimated per-serving values (and `servings` where given),
   nutrition_source = "estimated", and is_high_protein / is_low_carb / is_weight_loss recomputed with the same
   thresholds as scripts/indb/merge.py (protein >= 12; carbs <= 18; kcal <= 400 and protein >= 8).
2. Egg flags: every recipe whose ingredients list egg (see audit-catalog.py) gets contains_egg = 1, and a "veg"
   food_type becomes "egg" (nonveg stays nonveg).

Only the affected lines of recipes.json are rewritten (one recipe per line), so the diff stays reviewable.
Idempotent: running it twice changes nothing the second time.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module  # noqa: E402

audit = import_module("audit-catalog")
SEED = audit.SEED


def recompute_flags(r):
    p, c, k = r["protein_g"], r["carbs_g"], r["calories"]
    r["is_high_protein"] = 1 if p >= 12 else 0
    r["is_low_carb"] = 1 if c <= 18 else 0
    r["is_weight_loss"] = 1 if (k <= 400 and p >= 8) else 0


def main(corrections_path):
    corrections = json.loads(Path(corrections_path).read_text(encoding="utf-8"))["corrections"]
    raw = SEED.read_bytes().decode("utf-8")
    lines = raw.split("\n")
    seen, nutrition_fixed, egg_fixed = set(), [], []
    for i, line in enumerate(lines):
        body = line.rstrip("\r")
        stripped = body.strip()
        if not stripped.startswith("{"):
            continue
        trailing_comma = stripped.endswith(",")
        r = json.loads(stripped[:-1] if trailing_comma else stripped)
        before = dict(r)
        fix = corrections.get(r.get("slug"))
        if fix:
            seen.add(r["slug"])
            for key, value in fix.items():
                r[key] = value
            r["nutrition_source"] = "estimated"
            recompute_flags(r)
        if audit.egg_unflagged(r):
            r["contains_egg"] = 1
            if r.get("food_type", "veg") == "veg":
                r["food_type"] = "egg"
        if r != before:
            if fix:
                nutrition_fixed.append(r["slug"])
            if r.get("contains_egg") != before.get("contains_egg"):
                egg_fixed.append(r["slug"])
            cr = "\r" if body != line else ""
            lines[i] = "  " + json.dumps(r, ensure_ascii=False) + ("," if trailing_comma else "") + cr
    missing = sorted(set(corrections) - seen)
    if missing:
        sys.exit(f"Slugs not found in recipes.json: {missing}")
    SEED.write_bytes("\n".join(lines).encode("utf-8"))
    json.loads(SEED.read_text(encoding="utf-8"))  # still valid JSON
    print(f"nutrition corrected: {len(nutrition_fixed)}; egg flags fixed: {len(egg_fixed)}")
    for s in egg_fixed:
        print(f"   egg: {s}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
