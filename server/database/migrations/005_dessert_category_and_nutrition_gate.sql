-- Migration 005 — dessert dish_category + a per-user "show all recipes" toggle.
--
-- Recipes: widen dish_category to include 'dessert' so sweet dishes (increasingly
-- common after the YouTube import pipeline) get their own label instead of being
-- lumped into 'snack'. No PlanEngine change needed for the category itself --
-- 'dessert' falls through the existing bucketing exactly like 'snack'/'beverage'
-- do today (only 'bread'/'rice' get special routing).
--
-- dietary_preferences: nutrition_gate_enabled (default 1 = today's behavior).
-- When a user sets it to 0, PlanEngine.php stops applying nutrient-based scoring
-- bonuses/penalties (protein/calcium/vitamin weighting, low-carb/weight-loss/
-- high-protein bonuses, carb-budget penalty) in both plan generation and shuffle --
-- variety/repeat penalties and diet/onion/garlic hard filters are unaffected.
--
-- Idempotent-ish: re-running errors on the duplicate column/enum value already
-- present -- that's fine, it means the migration already applied.
-- Run: mysql -u <user> -p <db> < database/migrations/005_dessert_category_and_nutrition_gate.sql

ALTER TABLE recipes
  MODIFY COLUMN dish_category ENUM('main','bread','rice','snack','beverage','dessert')
    NOT NULL DEFAULT 'main';

ALTER TABLE dietary_preferences
  ADD COLUMN nutrition_gate_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER dal_per_week;
