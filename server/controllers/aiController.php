<?php

require_once __DIR__ . '/../services/PlanEngine.php';
require_once __DIR__ . '/../utils/aiClient.php';
require_once __DIR__ . '/../utils/preferences.php';
require_once __DIR__ . '/../utils/access.php';

function handleAiRoutes($uri, $method)
{
  if ($uri === '/ai/from-ingredients' && $method === 'POST') {
    aiFromIngredients();
    return;
  }
  Response::error('Route not found', 404);
}

/**
 * Premium: generate a weekly plan with the AI selecting recipes from the curated
 * catalog. The AI's output is re-validated server-side against each day's rules;
 * any invalid or missing slot is backfilled from the rule engine, so nutrition
 * and the egg/onion/garlic constraints are always honoured regardless of what the
 * model returns. Called by mealPlanController::generatePlan (premium already checked).
 */
function generateAiPlan(int $userId, string $weekStart): array
{
  $db = getDB();
  $engine = new PlanEngine($db);
  $prefs = loadOrCreatePreferences($db, $userId);
  $hasKid = (int)$prefs['has_kid'] === 1;

  // Rule-based plan is both the fallback source and the safety net for bad output.
  $ruleRows = $engine->buildRulePlanRows($userId);

  $ai = new AIClient();
  $aiOut = null;
  if ($ai->isConfigured()) {
    $catalog = $engine->compactRecipeCatalog();
    $system = "You are a meal-planning assistant for a weight-loss diet app. "
      . "You select recipes ONLY from the provided catalog by their numeric id. "
      . "Goals per day: high protein, high calcium, vitamin-rich, very low carb, balanced for weight loss. "
      . "Cuisine is Indian or Indian-twist. Respect each day's rules strictly: when egg=0 do not pick a recipe with egg=1; "
      . "when onion=0 do not pick onion=1; when garlic=0 do not pick garlic=1. "
      . "Pick breakfast, lunch and dinner for every weekday from recipes whose meal_type matches the slot. "
      . "Avoid repeating the same recipe id across the week. "
      . ($hasKid ? "Also pick one kid-friendly (kid=1) recipe id per day as 'kid'. " : "")
      . "Respond ONLY with JSON of the form: {\"monday\":{\"breakfast\":id,\"lunch\":id,\"dinner\":id"
      . ($hasKid ? ",\"kid\":id" : "") . "}, ... , \"sunday\":{...}}.";

    $user = "Per-day rules (1=allowed, 0=excluded): " . json_encode($prefs['day_rules'])
      . "\nDaily targets: " . json_encode([
        'calorie' => (int)$prefs['daily_calorie_target'],
        'protein_floor_g' => (int)$prefs['protein_floor_g'],
        'carb_ceiling_g' => (int)$prefs['carb_ceiling_g'],
        'calcium_target_mg' => (int)$prefs['calcium_target_mg'],
      ])
      . "\nRecipe catalog: " . json_encode($catalog);

    $aiOut = $ai->chatCompletion([
      ['role' => 'system', 'content' => $system],
      ['role' => 'user', 'content' => $user],
    ], 0.5, true);
  }

  // Resolve to [dow => ['meals' => [slot => id], 'kid' => [id]]], validating AI ids
  // and backfilling from the rule plan.
  $resolved = [];
  for ($dow = 0; $dow < 7; $dow++) {
    $rules = $prefs['day_rules'][weekdayKey($dow)];
    $aiDay = is_array($aiOut[weekdayKey($dow)] ?? null) ? $aiOut[weekdayKey($dow)] : [];
    $resolved[$dow] = ['meals' => [], 'kid' => []];

    foreach (['breakfast', 'lunch', 'dinner'] as $slot) {
      $id = isset($aiDay[$slot]) ? (int)$aiDay[$slot] : 0;
      $row = $id ? $engine->getRecipeRow($id) : null;
      $valid = $row && $row['meal_type'] === $slot && $engine->recipeSatisfiesRules($id, $rules);
      if ($valid) {
        $resolved[$dow]['meals'][$slot] = $id;
      } elseif (!empty($ruleRows[$dow]['meals'][$slot])) {
        $resolved[$dow]['meals'][$slot] = $ruleRows[$dow]['meals'][$slot]['id'];
      }
    }

    if ($hasKid) {
      $kidId = isset($aiDay['kid']) ? (int)$aiDay['kid'] : 0;
      $kidRow = $kidId ? $engine->getRecipeRow($kidId) : null;
      $kidValid = $kidRow && (int)$kidRow['is_kid_friendly'] === 1 && $engine->recipeSatisfiesRules($kidId, $rules);
      if ($kidValid) {
        $resolved[$dow]['kid'] = [$kidId];
      } elseif (!empty($ruleRows[$dow]['kid'])) {
        $resolved[$dow]['kid'] = [$ruleRows[$dow]['kid']['id']];
      }
    }
  }

  return $engine->persistResolvedPlan($userId, $weekStart, $resolved);
}

/**
 * Premium: "cook from my ingredients" — suggest one dish from the user's available
 * ingredients, honouring the chosen day's egg/onion/garlic rules.
 */
function aiFromIngredients()
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $db = getDB();
  requirePremium($db, $userId);

  $input = getJsonInput();
  $ingredients = $input['ingredients'] ?? [];
  if (!is_array($ingredients) || count($ingredients) === 0) {
    Response::error('Provide a non-empty ingredients array', 400);
    return;
  }
  $ingredients = array_slice(array_map('strval', $ingredients), 0, 40);

  $prefs = loadOrCreatePreferences($db, $userId);
  $day = strtolower((string)($input['day'] ?? ''));
  $rules = in_array($day, WEEKDAY_KEYS, true)
    ? $prefs['day_rules'][$day]
    : ['egg' => 1, 'onion' => 1, 'garlic' => 1];

  $ai = new AIClient();
  if (!$ai->isConfigured()) {
    Response::error('AI is not configured on the server', 503);
    return;
  }

  $ruleText = [];
  if (empty($rules['egg']))    $ruleText[] = 'no egg';
  if (empty($rules['onion']))  $ruleText[] = 'no onion';
  if (empty($rules['garlic'])) $ruleText[] = 'no garlic';
  $constraints = $ruleText ? implode(', ', $ruleText) : 'no special restrictions';

  $system = "You are an Indian home-cooking assistant for a weight-loss diet app. "
    . "Suggest ONE healthy dish (Indian or popular Indian-twist like pasta/noodles/fried rice) "
    . "that is high in protein, rich in calcium/vitamins, and low in carbs. "
    . "Use mainly the user's available ingredients; you may list a few common extra ingredients. "
    . "Strictly respect these dietary constraints: {$constraints}. "
    . "Respond ONLY as JSON: {\"name\":string,\"meal_type\":\"breakfast|lunch|dinner|snack\","
    . "\"ingredients_used\":[string],\"extra_ingredients_needed\":[string],\"steps\":[string],"
    . "\"approx\":{\"calories\":number,\"protein_g\":number,\"carbs_g\":number},\"notes\":string}.";

  $userMsg = "Available ingredients: " . implode(', ', $ingredients)
    . ".\nDietary constraints: {$constraints}.";

  $dish = $ai->chatCompletion([
    ['role' => 'system', 'content' => $system],
    ['role' => 'user', 'content' => $userMsg],
  ], 0.6, true);

  if (!$dish) {
    Response::error('Could not generate a dish right now. Please try again.', 502);
    return;
  }

  $dish['applied_constraints'] = $constraints;
  Response::success($dish, 'Dish suggested');
}
