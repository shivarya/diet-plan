<?php
/**
 * Dietary-preference helpers shared by the preference controller and PlanEngine.
 *
 * day_rules is keyed by weekday name; each value is { diet, egg, onion, garlic }:
 *   - diet is one of veg | egg (vegetarian + egg) | nonveg (meat/fish allowed)
 *   - onion / garlic are 1 = allowed, 0 = excluded
 *   - egg is derived from diet (egg = diet !== 'veg') and kept for badges/AI/back-compat
 * Defaults encode a vegetarian standing diet:
 *   - egg excluded on Tuesday / Thursday / Saturday (diet 'veg')
 *   - onion & garlic excluded on Thursday
 * Everything else allows egg (diet 'egg'), and every value is editable per day.
 */

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DIET_LEVELS = ['veg', 'egg', 'nonveg'];

/** Map day_of_week index (0=Mon .. 6=Sun) to its weekday key. */
function weekdayKey(int $dow): string
{
  return WEEKDAY_KEYS[$dow % 7];
}

/** Build one day's rule from a diet level + onion/garlic flags (egg is derived). */
function dayRule(string $diet, int $onion = 1, int $garlic = 1): array
{
  $diet = in_array($diet, DIET_LEVELS, true) ? $diet : 'veg';
  return [
    'diet'   => $diet,
    'egg'    => $diet === 'veg' ? 0 : 1, // derived; kept for badges/AI/back-compat
    'onion'  => $onion,
    'garlic' => $garlic,
  ];
}

/** The default per-day rule set (vegetarian standing diet). */
function defaultDayRules(): array
{
  return [
    'monday'    => dayRule('egg'),
    'tuesday'   => dayRule('veg'),
    'wednesday' => dayRule('egg'),
    'thursday'  => dayRule('veg', 0, 0),
    'friday'    => dayRule('egg'),
    'saturday'  => dayRule('veg'),
    'sunday'    => dayRule('egg'),
  ];
}

/** Coerce arbitrary input into a complete, valid day_rules array. */
function normalizeDayRules($input): array
{
  $defaults = defaultDayRules();
  if (!is_array($input)) {
    return $defaults;
  }
  $out = [];
  foreach (WEEKDAY_KEYS as $day) {
    $src = is_array($input[$day] ?? null) ? $input[$day] : [];
    $base = $defaults[$day];

    // Resolve diet: explicit value wins; otherwise derive from a legacy egg flag.
    if (isset($src['diet']) && in_array($src['diet'], DIET_LEVELS, true)) {
      $diet = $src['diet'];
    } elseif (isset($src['egg'])) {
      $diet = $src['egg'] ? 'egg' : 'veg';
    } else {
      $diet = $base['diet'];
    }

    $onion  = isset($src['onion'])  ? (int)!!$src['onion']  : $base['onion'];
    $garlic = isset($src['garlic']) ? (int)!!$src['garlic'] : $base['garlic'];
    $out[$day] = dayRule($diet, $onion, $garlic);
  }
  return $out;
}

/**
 * Load a user's preferences, creating a default row if none exists.
 * Returns a normalized associative array with decoded day_rules.
 */
function loadOrCreatePreferences($db, int $userId): array
{
  $row = $db->fetchOne("SELECT * FROM dietary_preferences WHERE user_id = ?", [$userId]);

  if (!$row) {
    $defaults = defaultDayRules();
    $db->insert(
      "INSERT INTO dietary_preferences (user_id, day_rules) VALUES (?, ?)",
      [$userId, json_encode($defaults)]
    );
    $row = $db->fetchOne("SELECT * FROM dietary_preferences WHERE user_id = ?", [$userId]);
  }

  $row['day_rules'] = normalizeDayRules(json_decode($row['day_rules'] ?? 'null', true));
  // Cast numeric columns for clean JSON output.
  foreach (['daily_calorie_target', 'protein_floor_g', 'carb_ceiling_g', 'calcium_target_mg', 'has_kid', 'kid_age',
    'include_brunch', 'include_evening_snack', 'include_accompaniment'] as $k) {
    if (isset($row[$k]) && $row[$k] !== null) {
      $row[$k] = (int)$row[$k];
    }
  }
  return $row;
}
