# CLAUDE.md — Diet Plan

Guidance for Claude Code when working inside `diet-plan/`. Launch Claude from this directory so the project's skills (in `.claude/`) load automatically. (Terminal command rules: see the workspace-root `CLAUDE.md`, which loads automatically alongside this one.)

## What this app does

A weekly meal-planner: high-protein, high-calcium, vitamin-rich, **very low carb**, balanced for weight loss. Food is Indian (plus Indian-twist foreign dishes — pasta, Hakka noodles, fried rice). Key rules:

- **Per-day diet level**, editable in Settings: `veg` / `egg` (veg + egg) / `nonveg` (meat/fish). Defaults are vegetarian — egg on Mon/Wed/Fri/Sun, veg on Tue/Thu/Sat. Stored as `diet` in the `day_rules` JSON (the legacy `egg` flag is derived from it for back-compat).
- **No onion/garlic on Thursday** by default; any day's onion/garlic/diet rule is editable.
- **Roti/rice side**: lunch & dinner get a main dish + a bread/rice accompaniment (each shuffleable). Opt-out via `include_accompaniment`.
- **Optional slots**: brunch and an evening snack are opt-in per user (`include_brunch`, `include_evening_snack`); base slots are breakfast/lunch/dinner.
- A **kid add-on** dish is added per day when "kid at home" is on.
- Any dish can be **shuffled** for an alternative that still satisfies that day's rules (a side shuffles within the bread/rice pool).
- **Guest mode** ("Use without an account"): the whole rule-based planner, shuffle, per-day rules and recipe browsing work offline with no login — data stays on the phone. Signing in later moves the guest's plan + rules into the account.
- Recipe detail has **share** (system share sheet) and **YouTube** (the recipe's `video_url`, else a channel+name search).
- Free **rule-based** planner; **premium** AI features (AI-generated plan + "cook from ingredients"; both diet-aware). AI step-by-step recipes need sign-in but not premium.

## Project Layout

| Sub-app | Path | Stack |
|---------|------|-------|
| Android | `android/` | **Native** Kotlin + Jetpack Compose (Material 3 Expressive), Hilt, Room, Retrofit — its **own git repo** `shivarya/diet-plan-android` (nested checkout, ignored by this repo). See [android/README.md](android/README.md). |
| Server | `server/` | PHP 8.0+ + MySQL 8.0+ (front-controller REST API) |
| Mobile (legacy) | `mobile/` | React Native 0.81 + Expo 54 — replaced in place by `android/` (same package + upload key). Native 2.0.0 (11) is on Play closed testing since 2026-10-07; archive `mobile/` once it's rolled out to production (it also holds the EAS-downloaded upload keystore copy) |

Production API target: `https://shivarya.dev/diet_plan/` (cPanel). Local Android dev points at `http://localhost:8000` via an `adb reverse tcp:8000 tcp:8000` tunnel (more reliable than the `10.0.2.2` host alias).

---

## Commands

### Server (`server/`)
```powershell
composer install                                   # firebase/php-jwt + google/apiclient
copy .env.example .env                             # set DB, JWT_SECRET, GROQ_API_KEY, GOOGLE_CLIENT_ID
mysql -u root diet_plan < database/schema.sql      # import schema (create DB first)
php scripts/seed.php                               # load curated recipes from database/seed/recipes.json
php -S 0.0.0.0:8000                                # local dev server (0.0.0.0, not localhost, for adb reverse)
php scripts/engine-golden.php                      # regenerate the Android engine-parity goldens (see PlanEngine)
```
Set `ALLOW_DEV_LOGIN=true` in `.env` to use `POST /auth/login` (a no-Google test login) locally.

### Android (`android/`)
```powershell
.\gradlew.bat :app:refreshCatalog -PcatalogBaseUrl=http://127.0.0.1:8000/   # bundled catalogue from the local server (prod: omit the flag)
.\gradlew.bat :app:installDebug -PapiBaseUrl=http://localhost:8000/          # debug app on the local API (+ dev login)
.\gradlew.bat :app:testDebugUnitTest                                         # incl. PlanEngine parity vs PHP goldens
.\gradlew.bat :app:lintRelease :app:bundleRelease :app:assembleRelease       # release (needs keystore.properties)
```
Version: `android/version.properties` (bump by hand). Releases: the `diet-release` skill; local dev: the `diet-dev` skill.

> **ALWAYS update `android/CHANGELOG.md` for every user-facing app feature or fix — before bumping the version or kicking a build.** Add it under a new `## [x.y.z] - YYYY-MM-DD` heading with `### Added/Changed/Fixed` sections plus a **Google Play Notes** block (that block is copied verbatim into the Play "What's new" field). Same pattern as `expense-tracker`. Do this as part of the feature's own change, not as an afterthought. (`mobile/CHANGELOG.md` holds the React Native history up to 1.0.5.)

> **After a debug install onto a physical device is done being used for testing, fully uninstall it — don't leave debug builds lingering on the user's real phone.** `adb -s <device> uninstall dev.shivarya.dietplan` normally suffices, but if Work profile / Private Space is enabled the app may have landed in a non-default user profile where a bare uninstall silently no-ops (expect a `SecurityException` on cross-profile queries — that's a standard shell restriction, not a bug). Check `adb -s <device> shell pm list users`, find the profile via `pm list packages --user <id>`, then `pm uninstall --user <id> dev.shivarya.dietplan`.

---

## Architecture

### Server — PHP front-controller (`server/index.php`)
Single entry point parses the URI (strips a `/diet_plan` or `/api` base path) and dispatches by prefix to a controller file; controllers are **functions** (`handleXxxRoutes($uri, $method)`), not classes. Mirrors the `expense-tracker` server conventions — the shared utils (`config/config.php`, `config/database.php` PDO singleton `getDB()`, `utils/jwt.php` `JWTHandler`, `utils/response.php` `Response`, `utils/aiClient.php`) are copied from there.

- **Auth**: `controllers/authController.php` — `POST /auth/google` (verifies Google ID token via `google/apiclient`, issues our JWT), `GET /auth/me`, `POST /auth/premium` (dev/v1 premium toggle — replace with real billing), `DELETE /auth/account`, dev-only `POST /auth/login`.
- **Recipes**: `controllers/recipeController.php` — `GET /recipes` (filterable, max 200), `GET /recipes/{id}`, photo lazy-resolve + admin curation.
- **Public catalogue** (no auth): `controllers/catalogController.php` — `GET /catalog/meta`, `GET /catalog/recipes?since=&after_id=` (keyset pages on `(updated_at, id)`, gzip), `GET /catalog/ids`. Feeds the Android app's bundled snapshot (`refreshCatalog`) and its daily delta sync.
- **Preferences**: `controllers/preferenceController.php` + `utils/preferences.php` — per-user targets and `day_rules` JSON. `loadOrCreatePreferences()` seeds defaults (egg off Tue/Thu/Sat; onion/garlic off Thu). `PUT` merges only the fields sent.
- **Meal plans**: `controllers/mealPlanController.php` → `services/PlanEngine.php`. `POST /meal-plans/generate` (`mode=rule` free / `mode=ai` premium), `GET /meal-plans/current`, `GET /meal-plans/{id}`, `POST /meal-plans/items/{id}/shuffle`, and `POST /meal-plans/import` (guest → account: plans built on the phone, recipes matched **by slug**, `replace` flag per call).
- **AI (premium)**: `controllers/aiController.php` — `generateAiPlan()` (AI selects recipe ids from the curated catalog; **server re-validates every id against the day's rules and backfills invalid/missing slots from the rule engine**), `POST /ai/from-ingredients`, `POST /ai/recipe-detail` (signed in, cached per language).
- All routes except `/health`, `/auth/*` and `/catalog/*` require `Authorization: Bearer <jwt>` (`JWTHandler::requireAuth()`). Premium routes gate on `users.is_premium` via `utils/access.php`.

### PlanEngine (`services/PlanEngine.php`) — the core, with a Kotlin twin
Per day: apply egg/onion/garlic rules as a **hard filter**, then **soft-score** the remaining recipes (protein, calcium, low-carb, vitamins, weight-loss tag; penalties for repeating within the week and exceeding the daily carb budget; small jitter for variety). Fills breakfast/lunch/dinner + one kid add-on (when `has_kid`). `shuffleItem()` re-runs a single slot excluding dishes already elsewhere in the plan *and* (migration `006`) the slot's own `shuffle_history`, so repeated taps don't cycle back to a recently-seen recipe.

**The Android app's guest mode runs a Kotlin port of this engine** (`android/app/src/main/java/dev/shivarya/dietplan/core/engine/PlanEngine.kt`). Change both together: `php scripts/engine-golden.php` regenerates golden plans (jitter fixed at 0, recipe fixture from `recipes.json`) into `android/app/src/test/resources/engine/`, and `PlanEngineParityTest` must pass. The PHP engine can be built from an in-memory recipe array + jitter callable for exactly this.

### Data model (`server/database/schema.sql`)
`users` (+`is_premium`), `recipes` (nutrition + flags: `contains_egg/onion/garlic`, `is_kid_friendly/high_protein/low_carb/weight_loss`, `food_type` veg/egg/nonveg, `dish_category` main/bread/rice/snack/beverage/dessert, `image_url`, `video_url`, `ingredients` JSON), `dietary_preferences` (`day_rules` JSON + `include_brunch/include_evening_snack/include_accompaniment`), `meal_plans`, `meal_plan_items` (`is_kid_addon`, `slot_role` main/side, `shuffle_history`). Recipes seeded from `database/seed/recipes.json` (9,266 as of 2026-10-07) via `scripts/seed.php` (idempotent upsert by `slug`; an `image_url` already in the DB wins). Audit the file with `python scripts/audit-catalog.py` before seeding — it catches implausible per-serving nutrition and egg-listing recipes without `contains_egg` (fix via `scripts/apply-nutrition-corrections.py`). Schema changes after the initial deploy ship as `database/migrations/NNN_*.sql` (ALTERs; latest `007_catalog_sync.sql`) — apply those to the live DB, don't re-import `schema.sql`.

### Android (`android/`, native)
Single `:app` module, package `dev.shivarya.dietplan` (`core/` auth, network, session, settings, db, catalog, engine, data, migration; `feature/` welcome, plan, recipe, browse, cook, settings, common; `ui/` theme, navigation). Toolchain and patterns copied from `expense-tracker/android` (AGP 9.4, Kotlin 2.3, Compose BOM 2026.09, material3 1.5 alpha for Expressive).
- **Modes** (`core/data/AccountManager.kt`): `Welcome` → `Guest` (on-device engine + Room) or `SignedIn` (server). `PlanRepository`/`PreferencesRepository` switch source by mode; the UI asks `AccountManager.gate(Feature)` for AI features. Guest → account merge: `core/data/AccountActions.kt`.
- **Catalogue on device**: Room `recipes` table created from the prebuilt `assets/catalog/catalog.db` (gitignored, built by `:app:refreshCatalog` from Room's exported schema), then delta-synced from `/catalog/*` (`CatalogSyncWorker`). Browse/search/detail always read it locally (no 200 cap).
- **Session**: JWT AES-GCM-encrypted with an Android Keystore key; 401 → silent Google re-auth; `LegacyMigration` imports the RN app's AsyncStorage (`RKStorage`: `auth_token`, `user_data`, `app_theme`) on first launch so upgraded users stay signed in.
- **Dev login** button exists only in debug builds pointed at a local server (`-PapiBaseUrl=http://localhost…`); never in release.

---

## AI provider

Server AI is provider-agnostic (`utils/aiClient.php`). Default **Groq** (`AI_PROVIDER=groq`, `AI_MODEL=llama-3.3-70b-versatile`, `GROQ_API_KEY=...`) — free tier + fast, ideal for this low-volume use. Swap to Gemini Flash-Lite or another provider via env only. If no key is set, AI plan generation falls back to the rule engine and the AI endpoints return 503.

---

## Environment Variables (`server/.env`)
```
DB_HOST, DB_PORT, DB_NAME=diet_plan, DB_USER, DB_PASS
JWT_SECRET
ALLOW_DEV_LOGIN=false                 # POST /auth/login backdoor; keep false in prod
GOOGLE_CLIENT_ID                      # Google Sign-In (ID tokens verified against this — the Web client)
GOOGLE_ALLOWED_AUDIENCES              # optional extra client IDs (comma-separated)
AI_PROVIDER=groq, AI_MODEL=llama-3.3-70b-versatile, GROQ_API_KEY
```

### Android (`app/build.gradle.kts` BuildConfig)
```
API_BASE_URL=https://shivarya.dev/diet_plan/   (debug: -PapiBaseUrl=...)   GOOGLE_WEB_CLIENT_ID=1080529324514-...   ALLOW_DEV_LOGIN (local debug only)
```

---

## Deployment

- API → cPanel at `https://shivarya.dev/diet_plan/` (live). Deploy under **`~/public_html/shivarya.dev/diet_plan`** — that folder is `shivarya.dev`'s docroot, **not** `~/public_html/` (deploying there gets shadowed by the portfolio SPA). SSH via root `connect_ssh.ps1`; host has PHP 8.4 + Composer 2.9. Flow: scp a source tarball (exclude `.env`/`vendor`), extract, `composer install --no-dev`, write `.env` (600), then **DB is set up separately** (create DB matching `.env` `DB_NAME`/`DB_USER`, import `schema.sql`, run `scripts/seed.php`). See the `diet-deploy-api` skill for the exact commands, migration list, and the `composer.json` audit-flag note.
- Android via Google Play closed testing (`diet-release` skill → `play-deploy`): plain Gradle, signed with the upload key the RN app used on EAS (download once with `eas credentials`). Rebuild the bundled catalogue from **prod** before every release. App icon/branding sources: `mobile/assets/images/app-icon-modern.svg` (+ `mobile/play-store-assets/` for the listing).
- Full step-by-step cPanel deploy: [docs/server-deployment.md](docs/server-deployment.md).

## YouTube recipe import (ongoing data pipeline)

Recipes are being bulk-imported from 6 Indian cooking YouTube channels via a fetch → extract (Claude Code Haiku subagents) → merge → deploy pipeline. **Read [docs/youtube-recipe-import.md](docs/youtube-recipe-import.md) before touching this** — it has the current recipe count, per-channel exhaustion status, exact runbook commands, and standing rules (notably: ask before starting each new fetch batch — a prior blanket auto-continue authorization was revoked). Also see the `diet-youtube-extract` skill for the Stage B subagent-orchestration mechanics.

## Known open issues

None currently tracked. (The catalogue data-quality issues — whole-batch nutrition stored per serving, egg recipes without `contains_egg` — were fixed 2026-10-07; `scripts/audit-catalog.py` now exits 0.)
