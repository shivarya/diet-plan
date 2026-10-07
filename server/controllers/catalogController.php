<?php
/**
 * Public, read-only recipe catalogue for the native Android app.
 *
 * The app ships a snapshot of the whole catalogue (assets/catalog/catalog.json.gz,
 * built from these endpoints by the app's `refreshCatalog` Gradle task) so browse,
 * search and guest-mode planning work offline, then keeps it fresh with a daily
 * delta sync:
 *   GET /catalog/meta     → {count, max_updated_at, max_id}
 *   GET /catalog/recipes  → keyset page of rows changed after (since, after_id)
 *   GET /catalog/ids      → every live recipe id (to soft-delete removed rows)
 *
 * No auth: guests have no token, and recipes are not user data. Responses are
 * gzip-compressed and cacheable.
 */

require_once __DIR__ . '/../utils/recipes.php';

/** Columns the app stores (everything except created_at). */
const CATALOG_COLUMNS = 'id, slug, name, cuisine, meal_type, food_type, dish_category, servings,
  calories, protein_g, carbs_g, fat_g, fiber_g, calcium_mg, vitamin_score, nutrition_source,
  contains_egg, contains_onion, contains_garlic, is_kid_friendly, is_high_protein, is_low_carb, is_weight_loss,
  ingredients, instructions, prep_time_min, difficulty, image_url, video_url, source_channel, updated_at';

const CATALOG_PAGE_MAX = 1000;

function handleCatalogRoutes($uri, $method)
{
  if ($method !== 'GET') {
    Response::error('Route not found', 404);
    return;
  }
  if ($uri === '/catalog/meta') {
    catalogMeta();
    return;
  }
  if ($uri === '/catalog/recipes') {
    catalogRecipes();
    return;
  }
  if ($uri === '/catalog/ids') {
    catalogIds();
    return;
  }
  Response::error('Route not found', 404);
}

/** gzip the body when the client accepts it, and let clients/proxies cache it. */
function catalogStartResponse(int $maxAgeSeconds): void
{
  if (!headers_sent() && extension_loaded('zlib') && !ini_get('zlib.output_compression')) {
    ob_start('ob_gzhandler');
  }
  header("Cache-Control: public, max-age=$maxAgeSeconds");
}

function catalogMeta()
{
  catalogStartResponse(300);
  $row = getDB()->fetchOne("SELECT COUNT(*) AS c, MAX(updated_at) AS m, MAX(id) AS i FROM recipes");
  Response::success([
    'count' => (int)($row['c'] ?? 0),
    'max_updated_at' => $row['m'] ?? null,
    'max_id' => (int)($row['i'] ?? 0),
  ], 'Catalog meta');
}

/**
 * Rows ordered by (updated_at, id), strictly after the (since, after_id) cursor.
 * Omit both for a full export. `next` is the cursor for the following page, or
 * null when this page is the last one.
 */
function catalogRecipes()
{
  catalogStartResponse(3600);
  $since = trim((string)($_GET['since'] ?? ''));
  if ($since === '') {
    $since = '1970-01-02 00:00:00'; // before any TIMESTAMP the table can hold
  } elseif (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $since)) {
    Response::error('since must be "YYYY-MM-DD HH:MM:SS"', 400);
    return;
  }
  $afterId = max(0, (int)($_GET['after_id'] ?? 0));
  $limit = max(1, min(CATALOG_PAGE_MAX, (int)($_GET['limit'] ?? CATALOG_PAGE_MAX)));

  // Fetch one extra row to know whether another page follows.
  $rows = getDB()->fetchAll(
    "SELECT " . CATALOG_COLUMNS . " FROM recipes
      WHERE updated_at > ? OR (updated_at = ? AND id > ?)
      ORDER BY updated_at, id
      LIMIT " . ($limit + 1),
    [$since, $since, $afterId]
  );
  $hasMore = count($rows) > $limit;
  if ($hasMore) {
    array_pop($rows);
  }
  $recipes = array_map('hydrateRecipe', $rows);
  $last = end($recipes);

  Response::success([
    'recipes' => $recipes,
    'next' => $hasMore ? ['since' => $last['updated_at'], 'after_id' => (int)$last['id']] : null,
  ], 'Catalog page');
}

function catalogIds()
{
  catalogStartResponse(300);
  $rows = getDB()->fetchAll("SELECT id FROM recipes ORDER BY id");
  Response::success(array_map(fn($r) => (int)$r['id'], $rows), 'Catalog ids');
}
