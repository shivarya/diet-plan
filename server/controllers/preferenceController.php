<?php

require_once __DIR__ . '/../utils/preferences.php';

function handlePreferenceRoutes($uri, $method)
{
  if ($uri === '/preferences' && $method === 'GET') {
    getPreferences();
  } elseif ($uri === '/preferences' && ($method === 'PUT' || $method === 'POST')) {
    updatePreferences();
  } else {
    Response::error('Route not found', 404);
  }
}

function getPreferences()
{
  $tokenData = JWTHandler::requireAuth();
  $db = getDB();
  $prefs = loadOrCreatePreferences($db, (int)$tokenData['userId']);
  Response::success($prefs, 'Preferences retrieved');
}

function updatePreferences()
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $input = getJsonInput();

  $db = getDB();
  $current = loadOrCreatePreferences($db, $userId);

  // Merge: only overwrite provided fields.
  $calorie  = isset($input['daily_calorie_target']) ? (int)$input['daily_calorie_target'] : $current['daily_calorie_target'];
  $protein  = isset($input['protein_floor_g'])      ? (int)$input['protein_floor_g']      : $current['protein_floor_g'];
  $carb     = isset($input['carb_ceiling_g'])       ? (int)$input['carb_ceiling_g']       : $current['carb_ceiling_g'];
  $calcium  = isset($input['calcium_target_mg'])    ? (int)$input['calcium_target_mg']    : $current['calcium_target_mg'];
  $hasKid   = isset($input['has_kid'])              ? (int)!!$input['has_kid']            : $current['has_kid'];
  $kidAge   = array_key_exists('kid_age', $input)   ? ($input['kid_age'] !== null ? (int)$input['kid_age'] : null) : $current['kid_age'];
  $brunch   = isset($input['include_brunch'])        ? (int)!!$input['include_brunch']        : $current['include_brunch'];
  $evSnack  = isset($input['include_evening_snack'])  ? (int)!!$input['include_evening_snack'] : $current['include_evening_snack'];
  $accomp   = isset($input['include_accompaniment'])  ? (int)!!$input['include_accompaniment'] : $current['include_accompaniment'];
  $dalWeek  = isset($input['dal_per_week'])            ? max(0, min(7, (int)$input['dal_per_week'])) : $current['dal_per_week'];
  $gate     = isset($input['nutrition_gate_enabled'])   ? (int)!!$input['nutrition_gate_enabled'] : $current['nutrition_gate_enabled'];
  $dayRules = array_key_exists('day_rules', $input) ? normalizeDayRules($input['day_rules']) : $current['day_rules'];

  $db->execute(
    "UPDATE dietary_preferences
       SET daily_calorie_target = ?, protein_floor_g = ?, carb_ceiling_g = ?,
           calcium_target_mg = ?, has_kid = ?, kid_age = ?,
           include_brunch = ?, include_evening_snack = ?, include_accompaniment = ?,
           dal_per_week = ?, nutrition_gate_enabled = ?, day_rules = ?
     WHERE user_id = ?",
    [$calorie, $protein, $carb, $calcium, $hasKid, $kidAge,
     $brunch, $evSnack, $accomp, $dalWeek, $gate, json_encode($dayRules), $userId]
  );

  $prefs = loadOrCreatePreferences($db, $userId);
  Response::success($prefs, 'Preferences updated');
}
