<?php
/**
 * Golden fixtures for the Android app's Kotlin PlanEngine (guest mode).
 *
 * The native app runs a Kotlin twin of services/PlanEngine.php for signed-out
 * (guest) users. This script pins the PHP engine's behaviour so the twin can be
 * checked against it: it builds a small, deterministic recipe fixture from
 * database/seed/recipes.json, runs buildPlanForPreferences() with jitter fixed at
 * 0 over a set of preference combinations, and writes
 *   fixture-recipes.json   the recipe rows (ids assigned in slug order)
 *   golden-plans.json      [{name, prefs, recent_penalty, days: [...]}]
 * which the app's PlanEngineParityTest replays.
 *
 * Re-run whenever PlanEngine.php or utils/preferences.php changes, and port the
 * same change to the Kotlin engine:
 *   php scripts/engine-golden.php [outDir]
 * outDir defaults to ../android/app/src/test/resources/engine (the native app's
 * checkout, nested at diet-plan/android).
 */

require_once __DIR__ . '/../services/PlanEngine.php';

$outDir = $argv[1] ?? (__DIR__ . '/../../android/app/src/test/resources/engine');
if (!is_dir($outDir) && !mkdir($outDir, 0777, true)) {
  fwrite(STDERR, "Cannot create $outDir\n");
  exit(1);
}

$seed = json_decode(file_get_contents(__DIR__ . '/../database/seed/recipes.json'), true);
if (!is_array($seed)) {
  fwrite(STDERR, "Could not parse recipes.json\n");
  exit(1);
}

// ---- Fixture: a stratified, deterministic subset of the real catalogue -------------

$isDal = function (array $r): bool {
  $hay = strtolower(($r['name'] ?? '') . ' ' . implode(' ', $r['ingredients'] ?? []));
  foreach (['dal', 'daal', 'dhal', 'sambar', 'kadhi', 'khichdi', 'rajma', 'chana', 'chole',
    'chickpea', 'lentil', 'masoor', 'moong', 'toor', 'urad'] as $k) {
    if (strpos($hay, $k) !== false) return true;
  }
  return false;
};

$buckets = [];
foreach ($seed as $r) {
  // Same defaults scripts/seed.php applies to missing fields.
  $r['food_type'] = $r['food_type'] ?? (!empty($r['contains_egg']) ? 'egg' : 'veg');
  $r['dish_category'] = $r['dish_category'] ?? (($r['meal_type'] ?? '') === 'snack' ? 'snack' : 'main');
  if (in_array($r['dish_category'], ['bread', 'rice'], true)) {
    $bucket = $r['dish_category'];
  } elseif ($r['meal_type'] === 'lunch') {
    $bucket = $isDal($r) ? 'lunch-dal' : 'lunch';
  } else {
    $bucket = $r['meal_type'];
  }
  $buckets[$bucket][] = $r;
}
$sizes = ['bread' => 24, 'rice' => 18, 'breakfast' => 36, 'brunch' => 15, 'lunch-dal' => 27,
  'lunch' => 30, 'dinner' => 36, 'snack' => 36];

$picked = [];
foreach ($sizes as $bucket => $n) {
  $rows = $buckets[$bucket] ?? [];
  usort($rows, fn($a, $b) => strcmp($a['slug'], $b['slug']));
  // Round-robin across food types (and onion/garlic-free dishes) so every diet rule
  // has candidates; then take the first $n.
  $groups = [];
  foreach ($rows as $r) {
    $noAllium = empty($r['contains_onion']) && empty($r['contains_garlic']);
    $groups[$r['food_type'] . ($noAllium ? '-plain' : '')][] = $r;
  }
  ksort($groups);
  $take = [];
  for ($i = 0; count($take) < $n; $i++) {
    $added = false;
    foreach ($groups as $g) {
      if (isset($g[$i]) && count($take) < $n) {
        $take[] = $g[$i];
        $added = true;
      }
    }
    if (!$added) break;
  }
  foreach ($take as $r) {
    $picked[$r['slug']] = $r;
  }
}
ksort($picked);

$fixture = [];
$id = 0;
foreach ($picked as $r) {
  $fixture[] = [
    'id' => ++$id,
    'slug' => $r['slug'],
    'name' => $r['name'],
    'cuisine' => $r['cuisine'] ?? 'Indian',
    'meal_type' => $r['meal_type'],
    'food_type' => $r['food_type'],
    'dish_category' => $r['dish_category'],
    'calories' => (int)($r['calories'] ?? 0),
    'protein_g' => (int)($r['protein_g'] ?? 0),
    'carbs_g' => (int)($r['carbs_g'] ?? 0),
    'fat_g' => (int)($r['fat_g'] ?? 0),
    'fiber_g' => (int)($r['fiber_g'] ?? 0),
    'calcium_mg' => (int)($r['calcium_mg'] ?? 0),
    'vitamin_score' => (int)($r['vitamin_score'] ?? 0),
    'contains_egg' => (int)($r['contains_egg'] ?? 0),
    'contains_onion' => (int)($r['contains_onion'] ?? 0),
    'contains_garlic' => (int)($r['contains_garlic'] ?? 0),
    'is_kid_friendly' => (int)($r['is_kid_friendly'] ?? 0),
    'is_high_protein' => (int)($r['is_high_protein'] ?? 0),
    'is_low_carb' => (int)($r['is_low_carb'] ?? 0),
    'is_weight_loss' => (int)($r['is_weight_loss'] ?? 0),
    'ingredients' => array_values($r['ingredients'] ?? []),
  ];
}

// ---- Preference combinations -----------------------------------------------------

$base = [
  'daily_calorie_target' => 1500, 'protein_floor_g' => 80, 'carb_ceiling_g' => 120,
  'calcium_target_mg' => 1000, 'has_kid' => 0, 'kid_age' => null, 'include_brunch' => 0,
  'include_evening_snack' => 0, 'include_accompaniment' => 1, 'dal_per_week' => 3,
  'nutrition_gate_enabled' => 1, 'day_rules' => defaultDayRules(),
];
$allDays = function (string $diet, int $onion = 1, int $garlic = 1): array {
  $out = [];
  foreach (WEEKDAY_KEYS as $d) $out[$d] = dayRule($diet, $onion, $garlic);
  return $out;
};
$someRecentPenalty = [];
foreach ($fixture as $r) {
  if ($r['id'] % 7 === 0) $someRecentPenalty[$r['id']] = 64;
  elseif ($r['id'] % 5 === 0) $someRecentPenalty[$r['id']] = 32;
  elseif ($r['id'] % 3 === 0) $someRecentPenalty[$r['id']] = 16;
}

$cases = [
  ['defaults', $base, []],
  ['nonveg-all-slots-kid', array_merge($base, ['day_rules' => $allDays('nonveg'), 'include_brunch' => 1,
    'include_evening_snack' => 1, 'has_kid' => 1, 'kid_age' => 6]), []],
  ['veg-no-allium-no-sides-no-dal', array_merge($base, ['day_rules' => $allDays('veg', 0, 0),
    'include_accompaniment' => 0, 'dal_per_week' => 0]), []],
  ['gate-off-dal7-kid', array_merge($base, ['nutrition_gate_enabled' => 0, 'dal_per_week' => 7,
    'has_kid' => 1]), []],
  ['low-carb-ceiling', array_merge($base, ['carb_ceiling_g' => 60, 'include_evening_snack' => 1]), []],
  ['high-carb-egg-dal5', array_merge($base, ['carb_ceiling_g' => 220, 'dal_per_week' => 5,
    'day_rules' => $allDays('egg', 1, 0)]), []],
  ['defaults-with-recent-penalty', array_merge($base, ['has_kid' => 1]), $someRecentPenalty],
  ['legacy-egg-flag-rules', array_merge($base, ['day_rules' => [
    'monday' => ['egg' => 1], 'tuesday' => ['egg' => 0, 'onion' => 0], 'wednesday' => [],
    'thursday' => ['diet' => 'nonveg', 'garlic' => 0], 'friday' => ['diet' => 'bogus', 'egg' => 1],
  ]]), []],
];

$slug = fn(?array $r) => $r ? $r['slug'] : null;
$golden = [];
foreach ($cases as [$name, $prefs, $penalty]) {
  $engine = new PlanEngine(null, $fixture, fn() => 0.0);
  $plan = $engine->buildPlanForPreferences($prefs, $penalty);
  $days = [];
  foreach ($plan as $dow => $day) {
    $days[] = [
      'day_of_week' => $dow,
      'meals' => (object)array_map($slug, $day['meals']),
      'sides' => (object)array_map($slug, $day['sides']),
      'kid' => $slug($day['kid']),
    ];
  }
  $golden[] = [
    'name' => $name,
    'prefs' => $prefs,
    'recent_penalty' => (object)$penalty,
    'days' => $days,
  ];
}

$flags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
file_put_contents("$outDir/fixture-recipes.json", json_encode($fixture, $flags) . "\n");
file_put_contents("$outDir/golden-plans.json", json_encode($golden, $flags) . "\n");
printf("Wrote %d fixture recipes and %d golden plans to %s\n", count($fixture), count($golden), realpath($outDir));
