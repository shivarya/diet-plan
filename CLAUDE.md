# CLAUDE.md — Diet Plan

Guidance for Claude Code when working inside `diet-plan/`. Launch Claude from this directory so the project's skills (in `.claude/`) load automatically.

## Terminal Command Rules

**CRITICAL**: Always combine directory change and command in a single line, and use absolute Windows paths.

```powershell
# ✅ Correct
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; php -S localhost:8000
```

---

## What this app does

A weekly meal-planner: high-protein, high-calcium, vitamin-rich, **very low carb**, balanced for weight loss. Food is Indian (plus Indian-twist foreign dishes — pasta, Hakka noodles, fried rice). Key rules:

- Vegetarian; **egg allowed except Tue/Thu/Sat** (default, editable per day).
- **No onion/garlic on Thursday** by default; any day's onion/garlic/egg rule is editable in Settings.
- A **kid add-on** dish is added per day when "kid at home" is on.
- Any dish can be **shuffled** for an alternative that still satisfies that day's rules.
- Free **rule-based** planner; **premium** AI features (AI-generated plan + "cook from ingredients").

## Project Layout

| Sub-app | Path | Stack |
|---------|------|-------|
| Mobile | `mobile/` | React Native 0.81 + Expo 54 + React Navigation 7 (TypeScript) |
| Server | `server/` | PHP 8.0+ + MySQL 8.0+ (front-controller REST API) |

Production API target: `https://shivarya.dev/diet_plan/` (cPanel). Mobile dev points to `http://localhost:8000` via an `adb reverse tcp:8000 tcp:8000` tunnel (more reliable than the `10.0.2.2` host alias).

---

## Commands

### Server (`server/`)
```powershell
composer install                                   # firebase/php-jwt + google/apiclient
copy .env.example .env                             # set DB, JWT_SECRET, GROQ_API_KEY, GOOGLE_CLIENT_ID
mysql -u root diet_plan < database/schema.sql      # import schema (create DB first)
php scripts/seed.php                               # load curated recipes from database/seed/recipes.json
php -S localhost:8000                              # local dev server
```
Set `ALLOW_DEV_LOGIN=true` in `.env` to use `POST /auth/login` (a no-Google test login) locally.

### Mobile (`mobile/`)
```powershell
npm install --legacy-peer-deps                     # (peer-dep conflict on @types/react, same as other RN apps)
npm run typecheck                                  # tsc --noEmit
npm run generate-icons                             # regenerate Play Store assets from assets/images/*.svg (or root play-store-assets skill)
npm start                                          # Expo dev server
npm run android                                    # build + install on Android emulator (expo run:android; needs a dev build, not Expo Go)
```

---

## Architecture

### Server — PHP front-controller (`server/index.php`)
Single entry point parses the URI (strips a `/diet_plan` or `/api` base path) and dispatches by prefix to a controller file; controllers are **functions** (`handleXxxRoutes($uri, $method)`), not classes. Mirrors the `expense-tracker` server conventions — the shared utils (`config/config.php`, `config/database.php` PDO singleton `getDB()`, `utils/jwt.php` `JWTHandler`, `utils/response.php` `Response`, `utils/aiClient.php`) are copied from there.

- **Auth**: `controllers/authController.php` — `POST /auth/google` (verifies Google ID token via `google/apiclient`, issues our JWT), `GET /auth/me`, `POST /auth/premium` (dev/v1 premium toggle — replace with real billing), dev-only `POST /auth/login`.
- **Recipes**: `controllers/recipeController.php` — `GET /recipes` (filterable), `GET /recipes/{id}`.
- **Preferences**: `controllers/preferenceController.php` + `utils/preferences.php` — per-user targets and `day_rules` JSON. `loadOrCreatePreferences()` seeds defaults (egg off Tue/Thu/Sat; onion/garlic off Thu).
- **Meal plans**: `controllers/mealPlanController.php` → `services/PlanEngine.php`. `POST /meal-plans/generate` (`mode=rule` free / `mode=ai` premium), `GET /meal-plans/current`, `GET /meal-plans/{id}`, `POST /meal-plans/items/{id}/shuffle`.
- **AI (premium)**: `controllers/aiController.php` — `generateAiPlan()` (AI selects recipe ids from the curated catalog; **server re-validates every id against the day's rules and backfills invalid/missing slots from the rule engine**) and `POST /ai/from-ingredients`.
- All routes except `/health` and `/auth/*` require `Authorization: Bearer <jwt>` (`JWTHandler::requireAuth()`). Premium routes gate on `users.is_premium` via `utils/access.php`.

### PlanEngine (`services/PlanEngine.php`) — the core
Per day: apply egg/onion/garlic rules as a **hard filter**, then **soft-score** the remaining recipes (protein, calcium, low-carb, vitamins, weight-loss tag; penalties for repeating within the week and exceeding the daily carb budget; small jitter for variety). Fills breakfast/lunch/dinner + one kid add-on (when `has_kid`). `shuffleItem()` re-runs a single slot excluding dishes already in the plan.

### Data model (`server/database/schema.sql`)
`users` (+`is_premium`), `recipes` (nutrition + flags: `contains_egg/onion/garlic`, `is_kid_friendly/high_protein/low_carb/weight_loss`, `ingredients` JSON), `dietary_preferences` (`day_rules` JSON), `meal_plans`, `meal_plan_items` (`is_kid_addon`). Recipes seeded from `database/seed/recipes.json` (~96 curated dishes) via `scripts/seed.php` (idempotent upsert by `slug`).

### Mobile — React Native (`mobile/`)
`App.tsx` wraps `ThemeProvider > AuthProvider > NavigationContainer > RootNavigator`. `RootNavigator` gates Login vs the bottom-tab `AppNavigator` (Plan stack, Cook AI, Settings). `src/services/api.ts` is an Axios client with a JWT request interceptor and 401→logout. Screens: `WeeklyPlanScreen` (day cards, constraint badges, per-dish shuffle, rule/AI generate), `RecipeDetailScreen`, `SettingsScreen` (per-day rule editor, targets, kid toggle, theme, **dev Premium switch**), `CookFromIngredientsScreen` (premium).

---

## AI provider

Server AI is provider-agnostic (`utils/aiClient.php`). Default **Groq** (`AI_PROVIDER=groq`, `AI_MODEL=llama-3.3-70b-versatile`, `GROQ_API_KEY=...`) — free tier + fast, ideal for this low-volume use. Swap to Gemini Flash-Lite or another provider via env only. If no key is set, AI plan generation falls back to the rule engine and `/ai/from-ingredients` returns 503.

---

## Environment Variables (`server/.env`)
```
DB_HOST, DB_PORT, DB_NAME=diet_plan, DB_USER, DB_PASS
JWT_SECRET
ALLOW_DEV_LOGIN=false                 # POST /auth/login backdoor; keep false in prod
GOOGLE_CLIENT_ID                      # Google Sign-In (ID tokens verified against this)
GOOGLE_ALLOWED_AUDIENCES              # optional extra native client IDs (comma-separated)
AI_PROVIDER=groq, AI_MODEL=llama-3.3-70b-versatile, GROQ_API_KEY
```

### Mobile (`app.json` extra)
```
apiUrl=https://shivarya.dev/diet_plan   apiUrlDev=http://localhost:8000   googleClientId=...
```

---

## Deployment

- API → cPanel at `https://shivarya.dev/diet_plan/` (live). Deploy under **`~/public_html/shivarya.dev/diet_plan`** — that folder is `shivarya.dev`'s docroot, **not** `~/public_html/` (deploying there gets shadowed by the portfolio SPA). SSH via root `connect_ssh.ps1`; host has PHP 8.4 + Composer 2.9. Flow: scp a source tarball (exclude `.env`/`vendor`), extract, `composer install --no-dev`, write `.env` (600), then **DB is set up separately** (create DB matching `.env` `DB_NAME`/`DB_USER`, import `schema.sql`, run `scripts/seed.php`). The repo `composer.json` sets `audit.block-insecure=false` because `firebase/php-jwt`/`google/apiclient` pin versions flagged by recent advisories. See the `diet-deploy-api` skill for the exact commands.
- Mobile via Google Play (EAS). Google Sign-In and the `@react-native-google-signin` native module require a dev/prod build (not Expo Go); use the dev login for quick local testing. App icons/branding are generated from `mobile/assets/images/app-icon-modern.svg` + `app-logo.svg` via `npm run generate-icons` (or the root `play-store-assets` skill) → `mobile/play-store-assets/`.
- Full step-by-step cPanel deploy: [server/CPANEL_DEPLOYMENT.md](server/CPANEL_DEPLOYMENT.md).
