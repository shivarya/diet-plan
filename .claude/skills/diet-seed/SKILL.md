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

- Recipes live in `server/database/seed/recipes.json`. Each entry needs a unique `slug`, a `meal_type` (`breakfast|lunch|dinner|snack`), nutrition fields, and accurate flags: `contains_egg`, `contains_onion`, `contains_garlic`, `is_kid_friendly`, `is_high_protein`, `is_low_carb`, `is_weight_loss`.
- Flag accuracy matters: the `PlanEngine` hard-filters on egg/onion/garlic per day and scores on the rest. Keep enough egg-free **and** onion/garlic-free options per meal type so constrained days (e.g. Thursday) still have variety.
- After editing, re-run the seeder. No restart of the API is needed (recipes are read per request).
