<?php

require_once __DIR__ . '/../vendor/autoload.php'; // Google API client for ID token verification

function handleAuthRoutes($uri, $method)
{
  if ($uri === '/auth/login' && $method === 'POST') {
    devLogin();
  } elseif ($uri === '/auth/google' && $method === 'POST') {
    googleLogin();
  } elseif ($uri === '/auth/me' && $method === 'GET') {
    getMe();
  } elseif ($uri === '/auth/premium' && ($method === 'POST' || $method === 'PUT')) {
    setPremium();
  } elseif ($uri === '/auth/account' && $method === 'DELETE') {
    deleteAccount();
  } else {
    Response::error('Route not found', 404);
  }
}

/**
 * Toggle the current user's premium flag. v1 monetization is feature-gate only
 * (no real billing), so the app exposes this as a dev switch in Settings. Replace
 * with Google Play Billing verification when wiring real subscriptions.
 */
function setPremium()
{
  try {
    $tokenData = JWTHandler::requireAuth();
    $userId = (int)$tokenData['userId'];
    $input = getJsonInput();
    $enabled = array_key_exists('enabled', $input) ? (int)!!$input['enabled'] : 1;

    $db = getDB();
    $db->execute("UPDATE users SET is_premium = ?, updated_at = NOW() WHERE id = ?", [$enabled, $userId]);
    $user = $db->fetchOne("SELECT * FROM users WHERE id = ?", [$userId]);
    Response::success($user, 'Premium status updated');
  } catch (Exception $e) {
    error_log('setPremium error: ' . $e->getMessage());
    Response::error('Failed to update premium status', 500);
  }
}

/**
 * Dev-only login. Issues a token for a local test user with NO authentication,
 * so it must NEVER be reachable in production. Disabled unless ALLOW_DEV_LOGIN=true.
 * Handy for exercising the API locally without Google Sign-In configured.
 */
function devLogin()
{
  if (!ALLOW_DEV_LOGIN) {
    Response::error('This endpoint is disabled. Use POST /auth/google.', 410);
    return;
  }

  try {
    $db = getDB();
    $user = $db->fetchOne("SELECT * FROM users WHERE id = 1");

    if (!$user) {
      $db->execute("INSERT INTO users (id, email, name, is_premium) VALUES (1, 'dev@localhost', 'Dev User', 1)");
      $user = $db->fetchOne("SELECT * FROM users WHERE id = 1");
    }

    $token = JWTHandler::generate($user['id'], $user['email'], $user['name']);
    Response::success(['token' => $token, 'user' => $user], 'Login successful (dev)');
  } catch (Exception $e) {
    error_log('Dev login failed: ' . $e->getMessage());
    Response::error('Login failed', 500);
  }
}

/**
 * Audiences (OAuth client IDs) accepted on Google ID tokens. The React Native
 * Google Sign-In client mints tokens with aud = webClientId (GOOGLE_CLIENT_ID).
 * Additional native client IDs can be allowed via GOOGLE_ALLOWED_AUDIENCES.
 */
function getAllowedGoogleAudiences(): array
{
  $ids = [];

  if (defined('GOOGLE_CLIENT_ID') && trim((string)GOOGLE_CLIENT_ID) !== '') {
    $ids[] = trim((string)GOOGLE_CLIENT_ID);
  }

  $extra = getenv('GOOGLE_ALLOWED_AUDIENCES') ?: ($_ENV['GOOGLE_ALLOWED_AUDIENCES'] ?? '');
  foreach (explode(',', (string)$extra) as $aud) {
    $aud = trim($aud);
    if ($aud !== '') {
      $ids[] = $aud;
    }
  }

  return array_values(array_unique($ids));
}

/**
 * Verify a Google ID token: signature, expiry, issuer, audience (against our
 * allowed client IDs) and verified-email. Returns the payload or null.
 */
function verifyGoogleIdToken(string $idToken): ?array
{
  $allowed = getAllowedGoogleAudiences();
  if (empty($allowed)) {
    error_log('Google auth not configured: GOOGLE_CLIENT_ID is empty');
    return null;
  }

  try {
    $client = new Google\Client();
    $payload = $client->verifyIdToken($idToken); // validates signature, exp, iss

    if (!is_array($payload) || empty($payload['aud'])) {
      return null;
    }

    if (!in_array($payload['aud'], $allowed, true)) {
      error_log('Google ID token audience mismatch: ' . $payload['aud']);
      return null;
    }

    $emailVerified = $payload['email_verified'] ?? false;
    if ($emailVerified === false || $emailVerified === 'false' || $emailVerified === 0) {
      error_log('Google ID token email not verified');
      return null;
    }

    return $payload;
  } catch (Throwable $e) {
    error_log('Google ID token verification failed: ' . $e->getMessage());
    return null;
  }
}

function googleLogin()
{
  try {
    $input = getJsonInput();
    $idToken = $input['idToken'] ?? $input['id_token'] ?? null;

    if (!$idToken) {
      Response::error('ID token is required', 400);
      return;
    }

    $payload = verifyGoogleIdToken($idToken);
    if (!$payload) {
      Response::error('Invalid or unverified Google token', 401);
      return;
    }

    $email = $payload['email'] ?? null;
    if (!$email) {
      Response::error('Google token missing email', 400);
      return;
    }

    $name = $payload['name'] ?? $email;
    $googleId = $payload['sub'] ?? null;
    $picture = $payload['picture'] ?? null;

    $db = getDB();
    $user = $db->fetchOne("SELECT * FROM users WHERE email = ?", [$email]);

    if (!$user) {
      $sql = "INSERT INTO users (email, name, google_id, profile_picture, created_at, updated_at)
              VALUES (?, ?, ?, ?, NOW(), NOW())";
      $userId = $db->insert($sql, [$email, $name, $googleId, $picture]);
      $user = $db->fetchOne("SELECT * FROM users WHERE id = ?", [$userId]);
    } else {
      if (empty($user['google_id']) && $googleId) {
        $db->execute(
          "UPDATE users SET google_id = ?, updated_at = NOW() WHERE id = ?",
          [$googleId, $user['id']]
        );
        $user['google_id'] = $googleId;
      }
    }

    // Our own JWT (not Google's token)
    $token = JWTHandler::generate($user['id'], $user['email'], $user['name']);

    Response::success(['token' => $token, 'user' => $user], 'Google login successful');
  } catch (Exception $e) {
    error_log("Google login error: " . $e->getMessage());
    Response::error('Google login failed', 500);
  }
}

function getMe()
{
  try {
    $tokenData = JWTHandler::requireAuth();
    $db = getDB();
    $user = $db->fetchOne("SELECT * FROM users WHERE id = ?", [$tokenData['userId']]);

    if (!$user) {
      Response::error('User not found', 404);
    }

    Response::success($user, 'User data retrieved');
  } catch (Exception $e) {
    Response::error('Failed to get user: ' . $e->getMessage(), 500);
  }
}

function deleteAccount()
{
  try {
    $tokenData = JWTHandler::requireAuth();
    $userId = $tokenData['userId'];

    $db = getDB();
    $user = $db->fetchOne("SELECT id FROM users WHERE id = ?", [$userId]);
    if (!$user) {
      Response::error('User not found', 404);
      return;
    }

    // ON DELETE CASCADE clears dietary_preferences, meal_plans and meal_plan_items.
    $db->execute("DELETE FROM users WHERE id = ?", [$userId]);

    Response::success(null, 'Account and all associated data deleted successfully');
  } catch (Exception $e) {
    error_log("Delete account error: " . $e->getMessage());
    Response::error('Failed to delete account', 500);
  }
}
