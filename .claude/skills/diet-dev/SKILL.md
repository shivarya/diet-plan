---
name: diet-dev
description: Run the Diet Plan app locally — start MySQL + the PHP API (port 8000) and the native Android app (android/, Kotlin + Compose) on an emulator/device against it. Use to develop or test diet-plan.
---

Start the Diet Plan backend and the native Android app (`android/`) for local development. The app reaches the host PHP
server at `http://localhost:8000` through an `adb reverse tcp:8000 tcp:8000` tunnel (more reliable than the `10.0.2.2`
emulator alias). The legacy React Native app (`mobile/`) is kept only until the native app has replaced it on Play.

## One-time setup

1. **Server deps**: `cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; composer install`
2. **Server env**: copy `.env.example` → `.env`; set `DB_*`, `JWT_SECRET`, and (optional) `GROQ_API_KEY`. For testing without Google Sign-In, set `ALLOW_DEV_LOGIN=true`.
3. **Database**: ensure MySQL/MariaDB is running (XAMPP: `D:\xampp\mysql\bin\mysqld.exe --defaults-file=D:\xampp\mysql\bin\my.ini`), then:
   ```powershell
   & "D:\xampp\mysql\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS diet_plan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   cmd /c '"D:\xampp\mysql\bin\mysql.exe" -u root diet_plan < "c:\Users\Ash\Documents\Projects\apps\diet-plan\server\database\schema.sql"'
   ```
   An existing local DB needs the newer `database/migrations/NNN_*.sql` applied instead (e.g. `006`, `007`).
4. **Seed recipes** (idempotent): `cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; php scripts/seed.php` (or use the `diet-seed` skill).
5. **Android**: `android/local.properties` (`sdk.dir=D\:/Android_SDK`) and `android/debug.keystore` (copy of
   `mobile/android/app/debug.keystore` — its SHA-1 is registered for Google Sign-In). Both are gitignored.

## Run

1. **PHP API** — bind to `0.0.0.0` (all IPv4) so the adb reverse tunnel works. `php -S localhost:8000` binds IPv6 `::1` only on Windows and the tunnel (IPv4 `127.0.0.1`) will hang:
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; php -S 0.0.0.0:8000
   ```
   Verify: `Invoke-RestMethod http://127.0.0.1:8000/health`
2. **Bundled catalogue from the local server** (the app's ids must match the server it talks to; rebuild after re-seeding):
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\android" ; .\gradlew.bat :app:refreshCatalog -PcatalogBaseUrl=http://127.0.0.1:8000/
   ```
3. **Emulator/device + tunnel**: start the `Medium_Phone_API_36.1` AVD (`emulator -avd Medium_Phone_API_36.1`), then
   `adb reverse tcp:8000 tcp:8000`.
4. **Install the debug app against the local API** (this also enables the "Use dev login" button, which exists only in
   debug builds aimed at a local server):
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\android" ; .\gradlew.bat :app:installDebug -PapiBaseUrl=http://localhost:8000/
   ```
   Without `-PapiBaseUrl` a debug build talks to production (and has no dev login).

## Tests

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\android" ; .\gradlew.bat :app:testDebugUnitTest
```
Includes `PlanEngineParityTest`: the guest-mode Kotlin engine must match the PHP engine's goldens. After changing either
`server/services/PlanEngine.php` or `core/engine/PlanEngine.kt`, port the change to the other and regenerate:
`cd ..\server ; php scripts/engine-golden.php`.

## Quick API smoke test (dev login)

```powershell
$t = (Invoke-RestMethod http://localhost:8000/auth/login -Method Post -ContentType 'application/json' -Body '{}').data.token
$H = @{ Authorization = "Bearer $t" }
Invoke-RestMethod "http://localhost:8000/meal-plans/generate?mode=rule" -Method Post -Headers $H -ContentType 'application/json' -Body '{}'
Invoke-RestMethod "http://localhost:8000/catalog/meta"   # public, no token
```

## Notes

- Guest mode ("Use without an account") needs no server at all — test it in airplane mode.
- AI features need `GROQ_API_KEY`. Without it, `mode=ai` plan generation falls back to the rule engine and the AI
  endpoints return 503 ("AI is not configured on the server" in the app).
- The emulator's data partition is small (~6 GB, nearly full): if `adb install -r` fails with `INSUFFICIENT_STORAGE`,
  uninstall first (`scripts\fix-emulator-storage.ps1 -Package dev.shivarya.dietplan`).
- Uninstall debug builds from the user's real phone after testing (see the project `CLAUDE.md` note on Work profile /
  Private space).
- Legacy RN app (until cutover): `cd mobile ; npm install --legacy-peer-deps ; npm run android`.
