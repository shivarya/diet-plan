<?php
/**
 * Seed the recipes table from database/seed/recipes.json.
 *
 * Usage: php scripts/seed.php
 *
 * Idempotent: upserts by unique `slug`, so re-running updates existing rows
 * rather than duplicating them.
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

$seedFile = __DIR__ . '/../database/seed/recipes.json';
if (!file_exists($seedFile)) {
  fwrite(STDERR, "Seed file not found: $seedFile\n");
  exit(1);
}

$recipes = json_decode(file_get_contents($seedFile), true);
if (!is_array($recipes)) {
  fwrite(STDERR, "Could not parse recipes.json\n");
  exit(1);
}

$db = getDB();

$sql = "INSERT INTO recipes
  (slug, name, cuisine, meal_type, food_type, dish_category, servings,
   calories, protein_g, carbs_g, fat_g, fiber_g, calcium_mg, vitamin_score, nutrition_source,
   contains_egg, contains_onion, contains_garlic,
   is_kid_friendly, is_high_protein, is_low_carb, is_weight_loss,
   ingredients, instructions, prep_time_min, difficulty, image_url, video_url, source_channel)
  VALUES
  (:slug, :name, :cuisine, :meal_type, :food_type, :dish_category, :servings,
   :calories, :protein_g, :carbs_g, :fat_g, :fiber_g, :calcium_mg, :vitamin_score, :nutrition_source,
   :contains_egg, :contains_onion, :contains_garlic,
   :is_kid_friendly, :is_high_protein, :is_low_carb, :is_weight_loss,
   :ingredients, :instructions, :prep_time_min, :difficulty, :image_url, :video_url, :source_channel)
  ON DUPLICATE KEY UPDATE
   name=VALUES(name), cuisine=VALUES(cuisine), meal_type=VALUES(meal_type),
   food_type=VALUES(food_type), dish_category=VALUES(dish_category), servings=VALUES(servings),
   calories=VALUES(calories), protein_g=VALUES(protein_g), carbs_g=VALUES(carbs_g), fat_g=VALUES(fat_g),
   fiber_g=VALUES(fiber_g), calcium_mg=VALUES(calcium_mg), vitamin_score=VALUES(vitamin_score),
   nutrition_source=VALUES(nutrition_source),
   contains_egg=VALUES(contains_egg), contains_onion=VALUES(contains_onion), contains_garlic=VALUES(contains_garlic),
   is_kid_friendly=VALUES(is_kid_friendly), is_high_protein=VALUES(is_high_protein),
   is_low_carb=VALUES(is_low_carb), is_weight_loss=VALUES(is_weight_loss),
   ingredients=VALUES(ingredients), instructions=VALUES(instructions),
   prep_time_min=VALUES(prep_time_min), difficulty=VALUES(difficulty),
   image_url=VALUES(image_url), video_url=VALUES(video_url), source_channel=VALUES(source_channel)";

$count = 0;
foreach ($recipes as $r) {
  $db->query($sql, [
    ':slug' => $r['slug'],
    ':name' => $r['name'],
    ':cuisine' => $r['cuisine'] ?? 'Indian',
    ':meal_type' => $r['meal_type'],
    ':food_type' => $r['food_type'] ?? ((($r['contains_egg'] ?? 0)) ? 'egg' : 'veg'),
    ':dish_category' => $r['dish_category'] ?? (($r['meal_type'] ?? '') === 'snack' ? 'snack' : 'main'),
    ':servings' => $r['servings'] ?? 2,
    ':calories' => $r['calories'] ?? 0,
    ':protein_g' => $r['protein_g'] ?? 0,
    ':carbs_g' => $r['carbs_g'] ?? 0,
    ':fat_g' => $r['fat_g'] ?? 0,
    ':fiber_g' => $r['fiber_g'] ?? 0,
    ':calcium_mg' => $r['calcium_mg'] ?? 0,
    ':vitamin_score' => $r['vitamin_score'] ?? 0,
    ':nutrition_source' => $r['nutrition_source'] ?? 'verified',
    ':contains_egg' => $r['contains_egg'] ?? 0,
    ':contains_onion' => $r['contains_onion'] ?? 0,
    ':contains_garlic' => $r['contains_garlic'] ?? 0,
    ':is_kid_friendly' => $r['is_kid_friendly'] ?? 0,
    ':is_high_protein' => $r['is_high_protein'] ?? 0,
    ':is_low_carb' => $r['is_low_carb'] ?? 0,
    ':is_weight_loss' => $r['is_weight_loss'] ?? 0,
    ':ingredients' => json_encode($r['ingredients'] ?? [], JSON_UNESCAPED_UNICODE),
    ':instructions' => $r['instructions'] ?? null,
    ':prep_time_min' => $r['prep_time_min'] ?? 0,
    ':difficulty' => $r['difficulty'] ?? 'easy',
    ':image_url' => $r['image_url'] ?? null,
    ':video_url' => $r['video_url'] ?? null,
    ':source_channel' => $r['source_channel'] ?? null,
  ]);
  $count++;
}

echo "Seeded/updated {$count} recipes.\n";
