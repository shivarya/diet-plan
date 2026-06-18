<?php
/**
 * Premium feature gate. For v1 this is a simple per-user flag (users.is_premium)
 * toggled in the app's dev settings — no real billing yet.
 */

function userIsPremium($db, int $userId): bool
{
  $row = $db->fetchOne("SELECT is_premium FROM users WHERE id = ?", [$userId]);
  return $row && (int)$row['is_premium'] === 1;
}

/** Respond 402 and stop if the user is not premium. */
function requirePremium($db, int $userId): void
{
  if (!userIsPremium($db, $userId)) {
    Response::error('This is a premium feature. Upgrade to unlock AI suggestions.', 402);
  }
}
