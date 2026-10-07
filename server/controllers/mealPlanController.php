<?php

require_once __DIR__ . '/../services/PlanEngine.php';
require_once __DIR__ . '/../utils/access.php';

function handleMealPlanRoutes($uri, $method)
{
  if ($uri === '/meal-plans/generate' && $method === 'POST') {
    generatePlan();
    return;
  }
  if ($uri === '/meal-plans/current' && $method === 'GET') {
    getCurrentPlan();
    return;
  }
  if ($uri === '/meal-plans/import' && $method === 'POST') {
    importPlans();
    return;
  }
  if (preg_match('#^/meal-plans/items/(\d+)/shuffle$#', $uri, $m) && $method === 'POST') {
    shufflePlanItem((int)$m[1]);
    return;
  }
  if (preg_match('#^/meal-plans/(\d+)$#', $uri, $m) && $method === 'GET') {
    getPlanById((int)$m[1]);
    return;
  }
  Response::error('Route not found', 404);
}

/** Monday (YYYY-MM-DD) of the week containing $date (defaults to today). */
function computeWeekStart(?string $date = null): string
{
  $dt = new DateTime($date ?: 'now');
  // ISO-8601: Monday = 1 .. Sunday = 7
  $dow = (int)$dt->format('N');
  if ($dow > 1) {
    $dt->modify('-' . ($dow - 1) . ' days');
  }
  return $dt->format('Y-m-d');
}

function generatePlan()
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $input = getJsonInput();

  $mode = $input['mode'] ?? ($_GET['mode'] ?? 'rule');
  $weekStart = computeWeekStart($input['week_start'] ?? ($_GET['week_start'] ?? null));

  $db = getDB();

  if ($mode === 'ai') {
    requirePremium($db, $userId); // 402s if not premium
    require_once __DIR__ . '/aiController.php';
    $plan = generateAiPlan($userId, $weekStart);
    Response::success($plan, 'AI meal plan generated');
    return;
  }

  $engine = new PlanEngine($db);
  $plan = $engine->generateWeeklyPlan($userId, $weekStart, 'rule');
  Response::success($plan, 'Meal plan generated');
}

function getCurrentPlan()
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $db = getDB();

  // Falls back to the most recent plan if this week's isn't generated yet.
  $planId = currentPlanId($db, $userId, $_GET['week_start'] ?? null);
  if (!$planId) {
    Response::success(null, 'No meal plan yet');
    return;
  }

  $engine = new PlanEngine($db);
  Response::success($engine->getAssembledPlan($userId, $planId), 'Current meal plan');
}

function getPlanById(int $id)
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $db = getDB();
  $engine = new PlanEngine($db);
  try {
    Response::success($engine->getAssembledPlan($userId, $id), 'Meal plan');
  } catch (Exception $e) {
    Response::error('Meal plan not found', 404);
  }
}

function shufflePlanItem(int $itemId)
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $db = getDB();
  $engine = new PlanEngine($db);
  try {
    $replacement = $engine->shuffleItem($userId, $itemId);
    Response::success($replacement, 'Dish shuffled');
  } catch (Exception $e) {
    Response::error($e->getMessage(), 400);
  }
}

/**
 * Import plans built on the device (the Android app's guest mode) into the
 * signed-in user's account. Recipes are matched by slug, never by id; items
 * whose recipe the server doesn't know are dropped.
 *
 * Body: {
 *   plans: [{ week_start_date: "YYYY-MM-DD", items: [{ day_of_week, meal_type, slot_role,
 *             is_kid_addon, servings, recipe_slug, shuffle_history_slugs: [] }] }],
 *   replace: bool  // true = overwrite an existing plan for that week, false = keep it
 * }
 * Returns { plan: <current plan or null>, imported_weeks, skipped_weeks, dropped_items }.
 */
function importPlans()
{
  $tokenData = JWTHandler::requireAuth();
  $userId = (int)$tokenData['userId'];
  $input = getJsonInput();

  $plans = $input['plans'] ?? null;
  if (!is_array($plans) || empty($plans)) {
    Response::error('plans must be a non-empty array', 400);
    return;
  }
  if (count($plans) > 8) {
    Response::error('At most 8 weeks can be imported at once', 400);
    return;
  }
  $replace = !empty($input['replace']);

  // Resolve every referenced slug to a recipe id in one query.
  $slugs = [];
  foreach ($plans as $p) {
    foreach (($p['items'] ?? []) as $it) {
      if (is_string($it['recipe_slug'] ?? null)) {
        $slugs[$it['recipe_slug']] = true;
      }
      foreach ((array)($it['shuffle_history_slugs'] ?? []) as $h) {
        if (is_string($h)) {
          $slugs[$h] = true;
        }
      }
    }
  }
  $db = getDB();
  $idBySlug = [];
  foreach (array_chunk(array_keys($slugs), 500) as $chunk) {
    $placeholders = implode(',', array_fill(0, count($chunk), '?'));
    foreach ($db->fetchAll("SELECT id, slug FROM recipes WHERE slug IN ($placeholders)", $chunk) as $row) {
      $idBySlug[$row['slug']] = (int)$row['id'];
    }
  }

  $mealTypes = ['breakfast', 'brunch', 'lunch', 'dinner', 'snack'];
  $imported = 0;
  $skipped = 0;
  $dropped = 0;
  $itemSql = "INSERT INTO meal_plan_items
      (meal_plan_id, day_of_week, meal_type, recipe_id, is_kid_addon, slot_role, servings, shuffle_history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

  $db->beginTransaction();
  try {
    $seenWeeks = [];
    foreach ($plans as $p) {
      $date = (string)($p['week_start_date'] ?? '');
      if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        $skipped++;
        continue;
      }
      $weekStart = computeWeekStart($date);
      if (isset($seenWeeks[$weekStart])) {
        $skipped++;
        continue;
      }
      $seenWeeks[$weekStart] = true;

      $existing = $db->fetchOne(
        "SELECT id FROM meal_plans WHERE user_id = ? AND week_start_date = ?",
        [$userId, $weekStart]
      );
      if ($existing && !$replace) {
        $skipped++;
        continue;
      }
      if ($existing) {
        $db->execute("DELETE FROM meal_plans WHERE id = ?", [$existing['id']]); // cascades items
      }
      $planId = $db->insert(
        "INSERT INTO meal_plans (user_id, week_start_date, generated_by) VALUES (?, ?, 'rule')",
        [$userId, $weekStart]
      );

      $slotsTaken = [];
      $inserted = 0;
      foreach (($p['items'] ?? []) as $it) {
        $dow = (int)($it['day_of_week'] ?? -1);
        $mealType = (string)($it['meal_type'] ?? '');
        $role = ($it['slot_role'] ?? 'main') === 'side' ? 'side' : 'main';
        $isKid = !empty($it['is_kid_addon']);
        $recipeId = $idBySlug[(string)($it['recipe_slug'] ?? '')] ?? null;
        if ($dow < 0 || $dow > 6 || !in_array($mealType, $mealTypes, true) || !$recipeId
          || ($isKid && $role === 'side')) {
          $dropped++;
          continue;
        }
        // One adult main/side per slot and one kid add-on per day, like the engine builds.
        $key = $isKid ? "$dow|kid" : "$dow|$mealType|$role";
        if (isset($slotsTaken[$key])) {
          $dropped++;
          continue;
        }
        $slotsTaken[$key] = true;

        $history = [];
        foreach ((array)($it['shuffle_history_slugs'] ?? []) as $h) {
          if (is_string($h) && isset($idBySlug[$h]) && !in_array($idBySlug[$h], $history, true)) {
            $history[] = $idBySlug[$h];
          }
        }
        $servings = max(1, min(12, (int)($it['servings'] ?? 1)));
        $db->insert($itemSql, [
          $planId, $dow, $mealType, $recipeId, $isKid ? 1 : 0, $role, $servings,
          $history ? json_encode(array_slice($history, 0, 6)) : null,
        ]);
        $inserted++;
      }

      if ($inserted === 0) {
        $db->execute("DELETE FROM meal_plans WHERE id = ?", [$planId]);
        $skipped++;
        continue;
      }
      $imported++;
    }
    $db->commit();
  } catch (Throwable $e) {
    $db->rollback();
    throw $e;
  }

  $currentId = currentPlanId($db, $userId);
  $engine = new PlanEngine($db);
  Response::success([
    'plan' => $currentId ? $engine->getAssembledPlan($userId, $currentId) : null,
    'imported_weeks' => $imported,
    'skipped_weeks' => $skipped,
    'dropped_items' => $dropped,
  ], 'Plans imported');
}

/** This week's plan id, else the most recent one, else null. */
function currentPlanId($db, int $userId, ?string $weekStartParam = null): ?int
{
  $row = $db->fetchOne(
    "SELECT id FROM meal_plans WHERE user_id = ? AND week_start_date = ?",
    [$userId, computeWeekStart($weekStartParam)]
  );
  if (!$row) {
    $row = $db->fetchOne(
      "SELECT id FROM meal_plans WHERE user_id = ? ORDER BY week_start_date DESC, id DESC LIMIT 1",
      [$userId]
    );
  }
  return $row ? (int)$row['id'] : null;
}
