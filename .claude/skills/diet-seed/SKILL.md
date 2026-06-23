---
name: diet-seed
description: Seed or refresh the Diet Plan recipe database from database/seed/recipes.json. Use after editing recipes or on a fresh database.
---

Load the curated recipe backbone into the `recipes` table. The loader (`server/scripts/seed.php`) upserts by unique `slug`, so it is safe to re-run after editing `recipes.json` — existing rows are updated, not duplicated.

## Steps

1. Ensure the database exists and the schema is imported (see `diet-dev`).
2. Run the seeder:
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; php scripts/seed.php
   ```
   Expected output: `Seeded/updated N recipes.`
3. Verify:
   ```powershell
   & "D:\xampp\mysql\bin\mysql.exe" -u root diet_plan -e "SELECT meal_type, COUNT(*) FROM recipes GROUP BY meal_type;"
   ```

## Editing recipes

- Recipes live in `server/database/seed/recipes.json`. Each entry needs a unique `slug`, a `meal_type` (`breakfast|brunch|lunch|dinner|snack`), nutrition fields, and accurate flags: `contains_egg`, `contains_onion`, `contains_garlic`, `is_kid_friendly`, `is_high_protein`, `is_low_carb`, `is_weight_loss`.
- **`food_type`** (`veg|egg|nonveg`) and **`dish_category`** (`main|bread|rice|snack|beverage`) drive the planner. `food_type` is the per-day diet filter (veg⊂egg⊂nonveg). `dish_category` `bread`/`rice` are the **accompaniment pool** (the roti/rice side paired with lunch/dinner) — never picked as a main or kid add-on. If omitted, `seed.php` derives `food_type` from `contains_egg` and `dish_category` from `meal_type` (so existing veg entries are fine), but **non-veg, bread and rice recipes must set them explicitly**.
- `image_url`/`video_url` are optional in the seed. Dish photos are normally populated by `php scripts/backfill-images.php` (resolves a LoremFlickr image per recipe, once, stored in the DB) — run it after adding recipes on a deployed DB. A curated `image_url` in the JSON always wins.
- Flag accuracy matters: the `PlanEngine` hard-filters on `food_type` + onion/garlic per day and scores on the rest. Keep enough veg **and** onion/garlic-free options per meal type so constrained days (e.g. Thursday = veg, no onion/garlic) still have variety, plus bread/rice options that are onion/garlic-free.
- **Dal lunches:** the planner reserves `dietary_preferences.dal_per_week` (default 3) lunch slots for dal/legume dishes, classified at runtime by name/ingredient keywords in `PlanEngine::isDalRecipe()` — **no manual tag**, so just make sure the catalogue has enough dal/legume mains for those slots to fill.
- After editing, re-run the seeder. No restart of the API is needed (recipes are read per request).

## Growing the catalogue from the INDB (bulk add)

To add many dishes at once, use the **Indian Nutrient Databank** enrichment pipeline in `server/scripts/indb/` (full docs: [scripts/indb/README.md](../../../server/scripts/indb/README.md)). It keeps INDB's authoritative per-serving nutrition as ground truth and uses a cheap Claude model only to backfill the descriptive fields INDB lacks (ingredients, method, flags, meal/food/category) and act as a suitability gate — **the model never produces nutrition**, so macros can't be hallucinated into the catalogue. Three stages, all resumable:

1. **`extract.py`** (deterministic, no AI) — downloads the workbook, drops beverages/sweets and Atwater-failing rows, dedups vs existing slugs → `database/seed/indb/indb_candidates.json` (nutrition locked).
2. **Enrich** — backfill the descriptive fields per candidate. `enrich.py` does this via the Anthropic Batches API (needs `ANTHROPIC_API_KEY`); the actual 250-dish run that grew the catalogue to ~437 instead used **Claude Code Haiku subagents** (no API billing) writing one JSON array per chunk into `database/seed/indb/indb_enriched/chunk_NN.json`.
3. **`merge.py`** — re-applies the INDB nutrition verbatim, validates/dedups, derives consistent flags, and appends accepted dishes to `recipes.json`. Run `--dry-run` first for counts.

⚠️ **Subagent self-reported counts are unreliable** — always audit enriched slugs against the candidate set independently before merging. ⚠️ The model sometimes mis-tags composed dishes (sandwiches, stuffed parathas) as `dish_category: bread/rice`, which would hide them in the accompaniment pool — verify INDB `dish_category` is `main`/`snack` for full dishes after merge. The whole `database/seed/indb/` working dir is git-ignored (only the merged dishes in `recipes.json` are committed); then seed + backfill-images as above.
