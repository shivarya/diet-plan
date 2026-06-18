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

  $weekStart = computeWeekStart($_GET['week_start'] ?? null);
  $row = $db->fetchOne(
    "SELECT id FROM meal_plans WHERE user_id = ? AND week_start_date = ?",
    [$userId, $weekStart]
  );
  // Fall back to the most recent plan if this week's isn't generated yet.
  if (!$row) {
    $row = $db->fetchOne(
      "SELECT id FROM meal_plans WHERE user_id = ? ORDER BY week_start_date DESC, id DESC LIMIT 1",
      [$userId]
    );
  }
  if (!$row) {
    Response::success(null, 'No meal plan yet');
    return;
  }

  $engine = new PlanEngine($db);
  Response::success($engine->getAssembledPlan($userId, (int)$row['id']), 'Current meal plan');
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
