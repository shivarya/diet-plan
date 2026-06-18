-- Migration 001 — "make it for everyone" expansion.
-- Adds: veg/egg/non-veg classification, dish categories (bread/rice sides),
-- a brunch meal slot, curated video links, per-meal main/side roles, and the
-- opt-in slot/accompaniment preference toggles.
--
-- Idempotent-ish: safe to run once on the live DB. Re-running will error on
-- duplicate columns — that's fine, it means the migration already applied.
-- Run: mysql -u <user> -p <db> < database/migrations/001_food_type_slots_sides.sql

-- recipes -------------------------------------------------------------------
ALTER TABLE recipes
  MODIFY COLUMN meal_type ENUM('breakfast','brunch','lunch','dinner','snack') NOT NULL,
  ADD COLUMN food_type     ENUM('veg','egg','nonveg') NOT NULL DEFAULT 'veg' AFTER meal_type,
  ADD COLUMN dish_category ENUM('main','bread','rice','snack','beverage') NOT NULL DEFAULT 'main' AFTER food_type,
  ADD COLUMN video_url     VARCHAR(512) NULL AFTER image_url,
  ADD KEY idx_recipes_food_type (food_type),
  ADD KEY idx_recipes_dish_category (dish_category);

-- Backfill existing rows: eggs -> 'egg', snacks -> snack category.
UPDATE recipes SET food_type = 'egg' WHERE contains_egg = 1;
UPDATE recipes SET dish_category = 'snack' WHERE meal_type = 'snack';

-- meal_plan_items -----------------------------------------------------------
ALTER TABLE meal_plan_items
  MODIFY COLUMN meal_type ENUM('breakfast','brunch','lunch','dinner','snack') NOT NULL,
  ADD COLUMN slot_role ENUM('main','side') NOT NULL DEFAULT 'main' AFTER is_kid_addon;

-- dietary_preferences -------------------------------------------------------
ALTER TABLE dietary_preferences
  ADD COLUMN include_brunch        TINYINT(1) NOT NULL DEFAULT 0 AFTER kid_age,
  ADD COLUMN include_evening_snack TINYINT(1) NOT NULL DEFAULT 0 AFTER include_brunch,
  ADD COLUMN include_accompaniment TINYINT(1) NOT NULL DEFAULT 1 AFTER include_evening_snack;
