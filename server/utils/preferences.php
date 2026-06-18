<?php
/**
 * Dietary-preference helpers shared by the preference controller and PlanEngine.
 *
 * day_rules is keyed by weekday name; each value is { egg, onion, garlic } with
 * 1 = allowed, 0 = excluded. Defaults encode the user's standing rules:
 *   - egg excluded on Tuesday / Thursday / Saturday
 *   - onion & garlic excluded on Thursday
 * Everything else is allowed, and every flag is editable per day.
 */

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Map day_of_week index (0=Mon .. 6=Sun) to its weekday key. */
function weekdayKey(int $dow): string
{
  return WEEKDAY_KEYS[$dow % 7];
}

/** The default per-day rule set. */
function defaultDayRules(): array
{
  $allow = ['egg' => 1, 'onion' => 1, 'garlic' => 1];
  return [
    'monday'    => $allow,
    'tuesday'   => ['egg' => 0, 'onion' => 1, 'garlic' => 1],
    'wednesday' => $allow,
    'thursday'  => ['egg' => 0, 'onion' => 0, 'garlic' => 0],
    'friday'    => $allow,
    'saturday'  => ['egg' => 0, 'onion' => 1, 'garlic' => 1],
    'sunday'    => $allow,
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
    $out[$day] = [
      'egg'    => isset($src['egg'])    ? (int)!!$src['egg']    : $base['egg'],
      'onion'  => isset($src['onion'])  ? (int)!!$src['onion']  : $base['onion'],
      'garlic' => isset($src['garlic']) ? (int)!!$src['garlic'] : $base['garlic'],
    ];
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
  foreach (['daily_calorie_target', 'protein_floor_g', 'carb_ceiling_g', 'calcium_target_mg', 'has_kid', 'kid_age'] as $k) {
    if (isset($row[$k]) && $row[$k] !== null) {
      $row[$k] = (int)$row[$k];
    }
  }
  return $row;
}
