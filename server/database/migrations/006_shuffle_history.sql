-- Migration 006 — per-slot shuffle history, to fix shuffle repeating recipes.
--
-- PlanEngine::shuffleItem() only ever excluded recipes currently sitting
-- elsewhere in the week's plan. The moment a recipe was shuffled OUT of a
-- slot it immediately became eligible again for that same slot's very next
-- shuffle -- and since selectRandomTop()'s top-12 shortlist is nearly static
-- between calls (jitter is only 0-5 vs a much wider score spread), repeated
-- taps on one dish would cycle back to a recently-seen recipe within a
-- handful of shuffles. This column lets shuffleItem() remember (and exclude)
-- the last few recipes shown to THIS slot, independent of the rest of the plan.
--
-- Run: mysql -u <user> -p <db> < database/migrations/006_shuffle_history.sql

ALTER TABLE meal_plan_items
  ADD COLUMN shuffle_history JSON NULL AFTER servings;
