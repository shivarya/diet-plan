<?php

require_once __DIR__ . '/../utils/recipes.php';
require_once __DIR__ . '/../utils/recipeImage.php';

function handleRecipeRoutes($uri, $method)
{
  // /recipes/{id}/image — lazily resolve & store a photo, once per recipe
  if (preg_match('#^/recipes/(\d+)/image$#', $uri, $m) && $method === 'POST') {
    populateRecipeImage((int)$m[1]);
    return;
  }

  // /recipes/{id}
  if (preg_match('#^/recipes/(\d+)$#', $uri, $m) && $method === 'GET') {
    getRecipe((int)$m[1]);
    return;
  }

  if ($uri === '/recipes' && $method === 'GET') {
    listRecipes();
    return;
  }

  Response::error('Route not found', 404);
}

/**
 * Resolve a dish photo from LoremFlickr and store it on the recipe — once, ever.
 * If the recipe already has an image_url it is returned as-is (never refetched).
 */
function populateRecipeImage(int $id)
{
  JWTHandler::requireAuth();
  $db = getDB();
  $row = $db->fetchOne("SELECT * FROM recipes WHERE id = ?", [$id]);
  if (!$row) {
    Response::error('Recipe not found', 404);
    return;
  }
  if (!empty($row['image_url'])) {
    Response::success(['image_url' => $row['image_url']], 'Image already set');
    return;
  }
  $url = resolveRecipeImageUrl($row);
  if (!$url) {
    Response::error('Could not fetch an image right now', 502);
    return;
  }
  $db->execute("UPDATE recipes SET image_url = ? WHERE id = ?", [$url, $id]);
  Response::success(['image_url' => $url], 'Image stored');
}

function listRecipes()
{
  JWTHandler::requireAuth();
  $db = getDB();

  $where = [];
  $params = [];

  // Filters
  if (!empty($_GET['meal_type']) && in_array($_GET['meal_type'], ['breakfast', 'lunch', 'dinner', 'snack'], true)) {
    $where[] = 'meal_type = ?';
    $params[] = $_GET['meal_type'];
  }
  foreach (['contains_egg', 'contains_onion', 'contains_garlic', 'is_kid_friendly',
    'is_high_protein', 'is_low_carb', 'is_weight_loss'] as $flag) {
    if (isset($_GET[$flag]) && $_GET[$flag] !== '') {
      $where[] = "$flag = ?";
      $params[] = (int)!!filter_var($_GET[$flag], FILTER_VALIDATE_BOOLEAN);
    }
  }
  if (!empty($_GET['search'])) {
    $where[] = 'name LIKE ?';
    $params[] = '%' . $_GET['search'] . '%';
  }

  $sql = 'SELECT * FROM recipes';
  if ($where) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
  }
  $sql .= ' ORDER BY name ASC';

  $limit = isset($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 200;
  $sql .= " LIMIT $limit";

  $rows = $db->fetchAll($sql, $params);
  $recipes = array_map('hydrateRecipe', $rows);
  Response::success($recipes, 'Recipes retrieved');
}

function getRecipe(int $id)
{
  JWTHandler::requireAuth();
  $db = getDB();
  $row = $db->fetchOne("SELECT * FROM recipes WHERE id = ?", [$id]);
  if (!$row) {
    Response::error('Recipe not found', 404);
    return;
  }
  Response::success(hydrateRecipe($row), 'Recipe retrieved');
}
