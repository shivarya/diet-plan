<?php
/**
 * Premium feature gate. For v1 this is a simple per-user flag (users.is_premium)
 * toggled in the app's dev settings — no real billing yet. In addition, specific
 * emails listed in the PREMIUM_EMAILS env var (comma-separated) are always treated
 * as premium, so you can comp friends/family before payments exist.
 */

/** Lower-cased set of comped premium emails from the PREMIUM_EMAILS env var. */
function premiumEmailAllowlist(): array
{
  $raw = getenv('PREMIUM_EMAILS') ?: ($_ENV['PREMIUM_EMAILS'] ?? '');
  $out = [];
  foreach (explode(',', strtolower((string)$raw)) as $e) {
    $e = trim($e);
    if ($e !== '') {
      $out[] = $e;
    }
  }
  return $out;
}

function emailIsPremium(?string $email): bool
{
  if (!$email) {
    return false;
  }
  return in_array(strtolower(trim($email)), premiumEmailAllowlist(), true);
}

/** Lower-cased set of admin emails from the ADMIN_EMAILS env var (curators). */
function adminEmailAllowlist(): array
{
  $raw = getenv('ADMIN_EMAILS') ?: ($_ENV['ADMIN_EMAILS'] ?? '');
  $out = [];
  foreach (explode(',', strtolower((string)$raw)) as $e) {
    $e = trim($e);
    if ($e !== '') {
      $out[] = $e;
    }
  }
  return $out;
}

function emailIsAdmin(?string $email): bool
{
  if (!$email) {
    return false;
  }
  return in_array(strtolower(trim($email)), adminEmailAllowlist(), true);
}

function userIsAdmin($db, int $userId): bool
{
  $row = $db->fetchOne("SELECT email FROM users WHERE id = ?", [$userId]);
  return $row && emailIsAdmin($row['email'] ?? null);
}

/** Respond 403 and stop if the user is not an admin/curator. */
function requireAdmin($db, int $userId): void
{
  if (!userIsAdmin($db, $userId)) {
    Response::error('Admins only.', 403);
  }
}

function userIsPremium($db, int $userId): bool
{
  $row = $db->fetchOne("SELECT is_premium, email FROM users WHERE id = ?", [$userId]);
  if (!$row) {
    return false;
  }
  return (int)$row['is_premium'] === 1 || emailIsPremium($row['email'] ?? null);
}

/**
 * Decorate a user row for API responses with env-derived roles: is_admin from the
 * admin allowlist, and is_premium from the premium allowlist (admins are premium too).
 */
function applyPremiumFlag(?array $user): ?array
{
  if (!$user) {
    return null;
  }
  $email = $user['email'] ?? null;
  $admin = emailIsAdmin($email);
  $user['is_admin'] = $admin ? 1 : 0;
  if ($admin || emailIsPremium($email)) {
    $user['is_premium'] = 1;
  }
  return $user;
}

/** Respond 402 and stop if the user is not premium. */
function requirePremium($db, int $userId): void
{
  if (!userIsPremium($db, $userId)) {
    Response::error('This is a premium feature. Upgrade to unlock AI suggestions.', 402);
  }
}
