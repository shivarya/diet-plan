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
  if ($uri === '/ai/recipe-detail' && $method === 'POST') {
    aiRecipeDetail();
    return;
  }
  Response::error('Route not found', 404);
}

/** Languages we offer detailed recipes in (display name => kept verbatim in DB). */
const RECIPE_LANGUAGES = [
  'English', 'Hindi', 'Bengali', 'Telugu', 'Marathi', 'Tamil',
  'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Odia', 'Urdu',
];

/**
 * Detailed, beginner-friendly recipe in the requested Indian language. Available
 * to any signed-in user (not premium). Generated once per (recipe, language) via
 * AI and cached in recipe_details so repeat views are instant and free.
 */
function aiRecipeDetail()
{
  $tokenData = JWTHandler::requireAuth();
  $db = getDB();

  $input = getJsonInput();
  $recipeId = (int)($input['recipe_id'] ?? 0);
  $language = (string)($input['language'] ?? 'English');
  if (!in_array($language, RECIPE_LANGUAGES, true)) {
    $language = 'English';
  }
  if ($recipeId <= 0) {
    Response::error('recipe_id is required', 400);
    return;
  }

  $recipe = $db->fetchOne("SELECT * FROM recipes WHERE id = ?", [$recipeId]);
  if (!$recipe) {
    Response::error('Recipe not found', 404);
    return;
  }

  // Serve from cache if we've generated this (recipe, language) before.
  $cached = $db->fetchOne(
    "SELECT content FROM recipe_details WHERE recipe_id = ? AND language = ?",
    [$recipeId, $language]
  );
  if ($cached) {
    $decoded = json_decode($cached['content'], true);
    if (is_array($decoded)) {
      Response::success($decoded, 'Detailed recipe (cached)');
      return;
    }
  }

  $ai = new AIClient();
  if (!$ai->isConfigured()) {
    Response::error('AI is not configured on the server', 503);
    return;
  }

  $ingredients = json_decode($recipe['ingredients'] ?? '[]', true);
  $ingredients = is_array($ingredients) ? implode(', ', $ingredients) : '';

  $system = "You are an experienced Indian home chef. Expand the given dish into a "
    . "detailed, beginner-friendly recipe with precise quantities and clear numbered "
    . "steps. Keep it healthy (high-protein, low-carb friendly) and authentic. "
    . "Write ALL text — title, every ingredient item and quantity, every step and tip — "
    . "in {$language} using that language's native script (English may stay in Latin script). "
    . "Respond ONLY as JSON: {\"title\":string,\"serves\":number,\"total_time_min\":number,"
    . "\"ingredients\":[{\"item\":string,\"quantity\":string}],\"steps\":[string],\"tips\":[string]}.";

  $user = "Dish: {$recipe['name']} ({$recipe['cuisine']}, {$recipe['meal_type']}).\n"
    . "Known ingredients: {$ingredients}.\n"
    . "Short method for reference: " . ($recipe['instructions'] ?? '(none)') . "\n"
    . "Serves about {$recipe['servings']}. Produce the full detailed recipe in {$language}.";

  $detail = $ai->chatCompletion([
    ['role' => 'system', 'content' => $system],
    ['role' => 'user', 'content' => $user],
  ], 0.5, true);

  if (!$detail || empty($detail['steps'])) {
    Response::error('Could not generate the recipe right now. Please try again.', 502);
    return;
  }

  $detail['language'] = $language;

  // Cache for everyone (idempotent on recipe_id+language).
  $db->execute(
    "INSERT INTO recipe_details (recipe_id, language, content) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)",
    [$recipeId, $language, json_encode($detail, JSON_UNESCAPED_UNICODE)]
  );

  Response::success($detail, 'Detailed recipe generated');
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
      . "Cuisine is Indian or Indian-twist. Respect each day's rules strictly. "
      . "Each day has a diet level: 'veg' allows only food_type=veg; 'egg' allows food_type veg or egg; "
      . "'nonveg' allows any food_type. Never pick a recipe whose food_type exceeds the day's diet level. "
      . "When onion=0 do not pick onion=1; when garlic=0 do not pick garlic=1. "
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

    // AI fills breakfast/lunch/dinner; any other enabled slot (brunch/snack)
    // backfills from the rule plan below.
    foreach ($engine->enabledSlots($prefs) as $slot) {
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
 * Premium: "cook from my ingredients" — suggest 2-3 full, beginner-friendly
 * recipes from the user's available ingredients plus optional preferences
 * (meal type, servings, time, cuisine, spice, equipment, output language and a
 * free-text twist), honouring the chosen diet + onion/garlic rules.
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
  // Explicit diet/onion/garlic selection wins; else fall back to a day's rules;
  // else default to vegetarian with onion/garlic allowed.
  if (isset($input['diet']) && in_array($input['diet'], ['veg', 'egg', 'nonveg'], true)) {
    $diet = $input['diet'];
    $rules = [
      'diet'   => $diet,
      'egg'    => $diet === 'veg' ? 0 : 1,
      'onion'  => array_key_exists('onion', $input) ? (int)!!$input['onion'] : 1,
      'garlic' => array_key_exists('garlic', $input) ? (int)!!$input['garlic'] : 1,
    ];
  } else {
    $day = strtolower((string)($input['day'] ?? ''));
    $rules = in_array($day, WEEKDAY_KEYS, true)
      ? $prefs['day_rules'][$day]
      : ['diet' => 'veg', 'egg' => 0, 'onion' => 1, 'garlic' => 1];
  }

  $ai = new AIClient();
  if (!$ai->isConfigured()) {
    Response::error('AI is not configured on the server', 503);
    return;
  }

  $diet = $rules['diet'] ?? (empty($rules['egg']) ? 'veg' : 'egg');
  $ruleText = [];
  if ($diet === 'veg')         $ruleText[] = 'strictly vegetarian (no egg, no meat, no fish)';
  elseif ($diet === 'egg')     $ruleText[] = 'vegetarian, egg allowed (no meat or fish)';
  else                         $ruleText[] = 'non-vegetarian allowed (meat, fish or egg are fine)';
  if (empty($rules['onion']))  $ruleText[] = 'no onion';
  if (empty($rules['garlic'])) $ruleText[] = 'no garlic';
  $constraints = implode(', ', $ruleText);

  // --- Optional refinement parameters (all best-effort; defaults = "any") ---
  $mealType = strtolower((string)($input['meal_type'] ?? 'any'));
  if (!in_array($mealType, ['breakfast', 'lunch', 'dinner', 'snack', 'any'], true)) {
    $mealType = 'any';
  }

  $servings = (int)($input['servings'] ?? 0);
  if ($servings < 1 || $servings > 12) $servings = 0;

  $language = (string)($input['language'] ?? 'English');
  if (!in_array($language, RECIPE_LANGUAGES, true)) $language = 'English';

  $timeMap = [
    'quick'     => 'Ready in about 20 minutes or less.',
    'standard'  => 'About 30 to 45 minutes is fine.',
    'elaborate' => 'A more elaborate dish (around an hour) is welcome.',
  ];
  $cuisineMap = [
    'north-indian' => 'North Indian style.',
    'south-indian' => 'South Indian style.',
    'indo-chinese' => 'Indo-Chinese style (Hakka noodles, fried rice, Manchurian and the like).',
    'continental'  => 'Continental with an Indian twist (e.g. pasta, salads, grills).',
  ];
  $spiceMap = [
    'mild'   => 'Keep it mild.',
    'medium' => 'Medium spice level.',
    'spicy'  => 'Make it spicy / bold.',
  ];
  $time    = strtolower((string)($input['time'] ?? ''));
  $cuisine = strtolower((string)($input['cuisine'] ?? ''));
  $spice   = strtolower((string)($input['spice'] ?? ''));

  $equipment = is_array($input['equipment'] ?? null) ? $input['equipment'] : [];
  $equipment = array_slice(array_values(array_filter(array_map('strval', $equipment))), 0, 6);

  $prefsText = trim((string)($input['preferences'] ?? ''));
  if (mb_strlen($prefsText) > 400) $prefsText = mb_substr($prefsText, 0, 400);

  // Human-readable request lines fed to the model.
  $ask = [];
  $ask[] = $mealType === 'any'
    ? 'Meal: any — pick the most fitting for each dish.'
    : "Meal: {$mealType}.";
  if ($servings > 0)          $ask[] = "Serves: {$servings}.";
  if (isset($timeMap[$time]))       $ask[] = $timeMap[$time];
  if (isset($cuisineMap[$cuisine])) $ask[] = $cuisineMap[$cuisine];
  if (isset($spiceMap[$spice]))     $ask[] = $spiceMap[$spice];
  if ($equipment) {
    $ask[] = 'Cook using only: ' . implode(', ', $equipment) . '. Keep every step within this equipment.';
  }
  if ($prefsText !== '') $ask[] = "Extra preferences: {$prefsText}";

  $system = "You are an Indian home-cooking assistant for a weight-loss diet app. "
    . "Suggest 2 to 3 DISTINCT healthy dishes (Indian or popular Indian-twist like pasta/noodles/fried rice) "
    . "the user can cook mostly from their listed ingredients. Each dish must be high in protein, "
    . "rich in calcium/vitamins and low in carbs. Use mainly the user's available ingredients; "
    . "a few common extra ingredients are fine. "
    . "Strictly respect these dietary constraints: {$constraints}. "
    . "Honour the user's requests (meal, servings, time, cuisine, spice level, equipment and any extra "
    . "preferences) as closely as you can, and give each dish a short, creative twist that makes it unique. "
    . "Give full, beginner-friendly instructions: precise ingredient quantities and clear numbered steps. "
    . "Write ALL text — names, every ingredient item and quantity, the twist, steps, tips and notes — "
    . "in {$language} using that language's native script (English may stay in Latin script). "
    . "Respond ONLY as JSON: {\"dishes\":[{\"name\":string,\"meal_type\":\"breakfast|lunch|dinner|snack\","
    . "\"serves\":number,\"total_time_min\":number,\"twist\":string,"
    . "\"ingredients\":[{\"item\":string,\"quantity\":string}],\"extra_ingredients_needed\":[string],"
    . "\"steps\":[string],\"tips\":[string],"
    . "\"approx\":{\"calories\":number,\"protein_g\":number,\"carbs_g\":number},\"notes\":string}]}.";

  $userMsg = "Available ingredients: " . implode(', ', $ingredients) . ".\n"
    . "Dietary constraints: {$constraints}.\n"
    . "Requests:\n- " . implode("\n- ", $ask);

  $out = $ai->chatCompletion([
    ['role' => 'system', 'content' => $system],
    ['role' => 'user', 'content' => $userMsg],
  ], 0.7, true);

  // Be lenient: accept {dishes:[...]}, a bare list, or a single dish object.
  $dishes = [];
  if (is_array($out['dishes'] ?? null)) {
    $dishes = $out['dishes'];
  } elseif (isset($out['name'])) {
    $dishes = [$out];
  } elseif (is_array($out) && isset($out[0])) {
    $dishes = $out;
  }
  $dishes = array_values(array_filter($dishes, fn($d) => is_array($d) && !empty($d['name'])));
  $dishes = array_slice($dishes, 0, 3);

  if (!$dishes) {
    Response::error('Could not generate a dish right now. Please try again.', 502);
    return;
  }

  Response::success([
    'dishes'              => $dishes,
    'applied_constraints' => $constraints,
    'language'            => $language,
  ], 'Dishes suggested');
}
