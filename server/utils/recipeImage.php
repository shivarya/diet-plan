<?php
/**
 * Resolve a dish photo from LoremFlickr, server-side, ONCE per recipe. The result
 * is stored in recipes.image_url so it is never fetched again (avoiding the rate
 * limits that broke per-device/per-view fetching) and is shared by all users.
 */

/** Pick the most photo-relevant single food keyword for a dish. */
function recipeImageKeyword(array $recipe): string
{
  $name = strtolower($recipe['name'] ?? '');
  // Ordered by how recognisable the photo is (specific protein/dish first).
  $known = [
    'paneer', 'chicken', 'fish', 'prawn', 'mutton', 'tofu', 'soya', 'egg', 'mushroom',
    'rajma', 'chana', 'chickpea', 'biryani', 'pulao', 'dal', 'rice', 'roti', 'paratha',
    'thepla', 'dosa', 'idli', 'uttapam', 'poha', 'upma', 'dhokla', 'sandwich', 'omelette',
    'noodles', 'pasta', 'salad', 'soup', 'curry', 'sabzi', 'bhurji', 'tikka', 'kebab',
    'keema', 'makhana', 'chaat',
  ];
  foreach ($known as $k) {
    if (strpos($name, $k) !== false) {
      return $k;
    }
  }
  $cat = $recipe['dish_category'] ?? 'main';
  if ($cat === 'bread') return 'roti';
  if ($cat === 'rice') return 'rice';
  if ($cat === 'beverage') return 'drink';
  return 'indian,food';
}

/** Probe a URL without following redirects: returns [httpCode, redirectUrl|null]. */
function loremflickrProbe(string $url): array
{
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_USERAGENT => 'DietPlan/1.0 (+https://shivarya.dev)',
  ]);
  curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $redirect = curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: null;
  curl_close($ch);
  return [$code, $redirect];
}

/**
 * Resolve a stable, directly-loadable image URL for a recipe, or null on failure.
 * Prefers the CDN cache URL LoremFlickr redirects to; if it serves the image
 * directly the (locked, deterministic) request URL is used. Skips the grey
 * "defaultImage" placeholder by falling through to broader queries.
 */
function resolveRecipeImageUrl(array $recipe): ?string
{
  $seed = (int)($recipe['id'] ?? 1);
  $kw = recipeImageKeyword($recipe);
  $candidates = [
    "https://loremflickr.com/600/400/{$kw}?lock={$seed}",
    "https://loremflickr.com/600/400/{$kw},indian,food/all?lock={$seed}",
    "https://loremflickr.com/600/400/food/all?lock={$seed}",
  ];
  foreach ($candidates as $url) {
    [$code, $redirect] = loremflickrProbe($url);
    if ($redirect && strpos($redirect, 'defaultImage') === false) {
      return $redirect; // direct CDN image — fastest at view time
    }
    if (!$redirect && $code >= 200 && $code < 300) {
      return $url; // served the image directly; the locked URL is stable
    }
  }
  return null;
}
