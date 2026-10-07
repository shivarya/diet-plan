"""
Audit database/seed/recipes.json for data that misleads the planner. Read-only.

  python scripts/audit-catalog.py

Reports:
  A. implausible per-serving nutrition — kcal > 700, fat > 60 g, carbs > 130 g or protein > 70 g — or servings
     outside 1..255 (the DB column is TINYINT UNSIGNED). Typical causes from the import pipelines: the whole
     deep-frying oil counted as eaten, whole-batch totals stored per serving, or a batch weight read as servings.
     Fix by adding re-estimated values to a nutrition-corrections JSON and running apply-nutrition-corrections.py.
  B. egg in the ingredients while contains_egg = 0 — such recipes can land on strict veg days.
  C. per-serving kcal far from 4*protein + 4*carbs + 9*fat (> 35% and > 150 kcal apart).
Exit code 1 if A or B finds anything (so it can gate a merge step).
"""
import json
import re
import sys
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "database" / "seed" / "recipes.json"

EGG = re.compile(r"\b(eggs?|anda|ande|egg (yolks?|whites?))\b", re.I)
NOT_EGG = re.compile(r"eggless|egg ?plant|egg[- ]free|no egg|without egg|egg (replacer|substitute)|flax egg", re.I)

# Flagged by A but checked against their ingredients (2026-10-07) and kept: genuinely heavy dishes.
REVIEWED_HEAVY = {
    "murgh-makhani-quesadillas-sanjeevkapoorkhazana", "aloo-pyaaz-paratha-kunalkapur",
    "cheese-burst-tawa-pizza-kunalkapur", "deep-pan-pizza-sanjeevkapoorkhazana-2",
    "gur-poli-nishamadhulika", "korean-chicken-burger-ranveerbrar",
}


def implausible(r):
    return ((r.get("calories") or 0) > 700 or (r.get("fat_g") or 0) > 60
            or (r.get("carbs_g") or 0) > 130 or (r.get("protein_g") or 0) > 70
            or not 1 <= (r.get("servings") or 2) <= 255)


def egg_unflagged(r):
    ing = " | ".join(r.get("ingredients") or [])
    return bool(EGG.search(ing)) and not NOT_EGG.search(ing) and not r.get("contains_egg")


def kcal_mismatch(r):
    k = r.get("calories") or 0
    m = 4 * (r.get("protein_g") or 0) + 4 * (r.get("carbs_g") or 0) + 9 * (r.get("fat_g") or 0)
    return k > 0 and abs(k - m) > 150 and abs(k - m) / k > 0.35


def main():
    recipes = json.loads(SEED.read_text(encoding="utf-8"))
    a = [r for r in recipes if implausible(r) and r["slug"] not in REVIEWED_HEAVY]
    b = [r for r in recipes if egg_unflagged(r)]
    c = [r for r in recipes if kcal_mismatch(r) and not implausible(r)]
    print(f"{len(recipes)} recipes")
    print(f"A. implausible per-serving nutrition: {len(a)} (plus {len(REVIEWED_HEAVY)} reviewed and kept)")
    for r in sorted(a, key=lambda r: -(r.get("calories") or 0)):
        print(f"   {r['slug']}: {r.get('calories')} kcal  P{r.get('protein_g')} C{r.get('carbs_g')} F{r.get('fat_g')}  serves {r.get('servings')}")
    print(f"B. egg listed but contains_egg = 0: {len(b)}")
    for r in b:
        print(f"   {r['slug']} ({r.get('food_type')})")
    print(f"C. kcal inconsistent with macros: {len(c)}")
    for r in c[:30]:
        print(f"   {r['slug']}: {r.get('calories')} kcal vs macros P{r.get('protein_g')} C{r.get('carbs_g')} F{r.get('fat_g')}")
    return 1 if (a or b) else 0


if __name__ == "__main__":
    sys.exit(main())
