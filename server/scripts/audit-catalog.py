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
  D. meat, fish or seafood (incl. fish/oyster sauce, meat stock, gelatin) in the ingredients while food_type is
     not 'nonveg' — such recipes land on veg days, and an 'egg' one even on veg days that allow egg.
  E. contains_egg = 1 while food_type = 'veg' — the planner and app already treat it as egg, but keep them in step.
Exit code 1 if A, B, D or E finds anything (so it can gate a merge step).
apply-nutrition-corrections.py fixes B, D and E.
"""
import json
import re
import sys
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "database" / "seed" / "recipes.json"

EGG = re.compile(r"\b(eggs?|anda|ande|egg (yolks?|whites?))\b", re.I)
NOT_EGG = re.compile(r"eggless|egg ?plant|egg[- ]free|no egg|without egg|egg (replacer|substitute)|flax egg", re.I)

MEAT = re.compile(
    r"\b(chicken|murgh?|mutton|lamb|goat|gosht|keema|kheema|qeema|beef|pork|bacon|ham|sausages?|salami|pepperoni|"
    r"turkey|duck|fish|machh?li|macher|prawns?|shrimps?|jhinga|crabs?|lobsters?|squid|calamari|octopus|mussels?|"
    r"clams?|oysters?|scallops?|tuna|salmon|sardines?|mackerel|surmai|pomfret|rohu|hilsa|ilish|bangda|anchov(y|ies)|"
    r"seafood|meat|meatballs?|liver|kaleji|chorizo|prosciutto|gelatine?)\b",
    re.I,
)
# Vegetarian look-alikes, removed before MEAT is searched.
NOT_MEAT = re.compile(
    r"\b(soya?|veg|vegan|vegetarian|vegetable|mock|plant[- ]based|jackfruit|mushroom|nutri|paneer|tofu)"
    r"[- ](chicken|keema|kheema|meat|fish|mutton|sausages?|nuggets?|oyster sauce|gelatine?|chunks? kh?eema)\b"
    r"|\b(chicken|mutton|meat|fish|biryani)\s+masala\b"
    r"|\boyster mushrooms?\b|\bgoat'?s? cheese\b"
    r"|\bgelatine? or agar|\bagar[- ]?(agar)?\s*(\(veg(etarian)? gelatine?\)|or gelatine?)",
    re.I,
)
# Flagged by D but checked against their ingredients (2026-10-23) and kept as tagged: the meat is an optional extra.
REVIEWED_NOT_MEAT = {
    "egg-pizza-roll-with-chapati-yourfoodlab",  # "toppings: chopped vegetables or chicken chunks"
}

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


def meat_words(r):
    """Meat/fish words in the ingredients of a recipe not tagged nonveg (empty when none, or reviewed)."""
    if r.get("food_type") == "nonveg" or r["slug"] in REVIEWED_NOT_MEAT:
        return []
    ing = NOT_MEAT.sub(" ", " | ".join(r.get("ingredients") or []))
    return sorted({m.group(0).lower() for m in MEAT.finditer(ing)})


def egg_tagged_veg(r):
    return bool(r.get("contains_egg")) and r.get("food_type") == "veg"


def kcal_mismatch(r):
    k = r.get("calories") or 0
    m = 4 * (r.get("protein_g") or 0) + 4 * (r.get("carbs_g") or 0) + 9 * (r.get("fat_g") or 0)
    return k > 0 and abs(k - m) > 150 and abs(k - m) / k > 0.35


def main():
    recipes = json.loads(SEED.read_text(encoding="utf-8"))
    a = [r for r in recipes if implausible(r) and r["slug"] not in REVIEWED_HEAVY]
    b = [r for r in recipes if egg_unflagged(r)]
    c = [r for r in recipes if kcal_mismatch(r) and not implausible(r)]
    d = [r for r in recipes if meat_words(r)]
    e = [r for r in recipes if egg_tagged_veg(r)]
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
    print(f"D. meat/fish listed but food_type not nonveg: {len(d)} (plus {len(REVIEWED_NOT_MEAT)} reviewed and kept)")
    for r in d:
        print(f"   {r['slug']} ({r.get('food_type')}): {', '.join(meat_words(r))}")
    print(f"E. contains_egg = 1 but food_type = veg: {len(e)}")
    for r in e:
        print(f"   {r['slug']}")
    return 1 if (a or b or d or e) else 0


if __name__ == "__main__":
    sys.exit(main())
