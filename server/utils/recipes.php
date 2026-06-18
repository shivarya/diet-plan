<?php
/**
 * Recipe row helpers shared by the recipe controller and PlanEngine.
 */

/** Decode JSON columns and cast numeric/boolean columns for clean output. */
function hydrateRecipe(?array $row): ?array
{
  if (!$row) {
    return null;
  }
  $intCols = ['id', 'servings', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
    'calcium_mg', 'vitamin_score', 'prep_time_min'];
  foreach ($intCols as $c) {
    if (isset($row[$c])) {
      $row[$c] = (int)$row[$c];
    }
  }
  $boolCols = ['contains_egg', 'contains_onion', 'contains_garlic', 'is_kid_friendly',
    'is_high_protein', 'is_low_carb', 'is_weight_loss'];
  foreach ($boolCols as $c) {
    if (isset($row[$c])) {
      $row[$c] = (int)$row[$c] === 1;
    }
  }
  if (isset($row['ingredients']) && is_string($row['ingredients'])) {
    $decoded = json_decode($row['ingredients'], true);
    $row['ingredients'] = is_array($decoded) ? $decoded : [];
  }
  return $row;
}
