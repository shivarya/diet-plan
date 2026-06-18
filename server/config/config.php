<?php
// Load .env file
$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
  $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  foreach ($lines as $line) {
    if (strpos($line, '=') !== false && strpos($line, '#') !== 0) {
      list($name, $value) = explode('=', $line, 2);
      $_ENV[trim($name)] = trim($value);
      putenv(trim($name) . '=' . trim($value));
    }
  }
}

// Database configuration
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_PORT', getenv('DB_PORT') ?: '3306');
define('DB_NAME', getenv('DB_NAME') ?: 'diet_plan');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');

// JWT configuration
define('JWT_SECRET', getenv('JWT_SECRET') ?: 'your-secret-key-change-in-production');
define('JWT_EXPIRES_IN', 30 * 24 * 60 * 60); // 30 days in seconds

// Google OAuth (Sign-In) — ID tokens are verified against GOOGLE_CLIENT_ID
define('GOOGLE_CLIENT_ID', getenv('GOOGLE_CLIENT_ID') ?: '');
define('GOOGLE_CLIENT_SECRET', getenv('GOOGLE_CLIENT_SECRET') ?: '');

// Dev-only login backdoor (POST /auth/login). Keep false in production.
define('ALLOW_DEV_LOGIN', filter_var(getenv('ALLOW_DEV_LOGIN') ?: 'false', FILTER_VALIDATE_BOOLEAN));

// AI provider — handled by utils/aiClient.php (provider-agnostic). Default: Groq.
//   AI_PROVIDER = groq | gemini | openai | azure | openai_compatible
//   groq: GROQ_API_KEY, AI_MODEL (default llama-3.3-70b-versatile)
define('AI_PROVIDER', getenv('AI_PROVIDER') ?: 'groq');

// Timezone
date_default_timezone_set('Asia/Kolkata');

// Error reporting
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/../php_errors.log');

// CORS settings
define('ALLOWED_ORIGINS', [
  'http://localhost:19006', // Expo web
  'http://localhost:8081',  // Metro bundler
  'exp://*',                // Expo Go
]);
