<?php
/**
 * One-time backfill: resolve & store a LoremFlickr photo for every recipe that
 * doesn't have one yet, so the whole catalog (incl. grid thumbnails) shows images
 * without waiting for each recipe to be opened. Throttled to be polite.
 *
 * Usage: php scripts/backfill-images.php
 * Idempotent: only touches recipes where image_url IS NULL/''. Re-run any time.
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../utils/recipeImage.php';

$db = getDB();
$rows = $db->fetchAll("SELECT * FROM recipes WHERE image_url IS NULL OR image_url = '' ORDER BY id");
$total = count($rows);
echo "Recipes to populate: {$total}\n";

$ok = 0;
foreach ($rows as $r) {
  $url = resolveRecipeImageUrl($r);
  if ($url) {
    $db->execute("UPDATE recipes SET image_url = ? WHERE id = ?", [$url, $r['id']]);
    $ok++;
    echo "[{$r['id']}] {$r['name']} -> stored\n";
  } else {
    echo "[{$r['id']}] {$r['name']} -> FAILED (left null, will retry on view)\n";
  }
  usleep(700000); // 0.7s between requests
}

echo "Done: {$ok}/{$total} populated.\n";
