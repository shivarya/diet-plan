---
name: diet-dev
description: Run the Diet Plan app locally — start MySQL + the PHP API (port 8000) and the Expo mobile app. Use to develop or test diet-plan.
---

Start the Diet Plan backend and mobile app for local development. The mobile app (Android emulator) reaches the host PHP server at `http://10.0.2.2:8000`.

## One-time setup

1. **Server deps**: `cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; composer install`
2. **Server env**: copy `.env.example` → `.env`; set `DB_*`, `JWT_SECRET`, and (optional) `GROQ_API_KEY`. For quick testing without Google Sign-In, set `ALLOW_DEV_LOGIN=true`.
3. **Database**: ensure MySQL/MariaDB is running (XAMPP: `D:\xampp\mysql\bin\mysqld.exe --defaults-file=D:\xampp\mysql\bin\my.ini`), then:
   ```powershell
   & "D:\xampp\mysql\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS diet_plan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   cmd /c '"D:\xampp\mysql\bin\mysql.exe" -u root diet_plan < "c:\Users\Ash\Documents\Projects\apps\diet-plan\server\database\schema.sql"'
   ```
4. **Seed recipes** (idempotent): `cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; php scripts/seed.php` (or use the `diet-seed` skill).
5. **Mobile deps**: `cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\mobile" ; npm install --legacy-peer-deps`

## Run (two processes)

1. **PHP API** — bind to `0.0.0.0` (all IPv4) so the Android emulator can reach it via an adb reverse tunnel. `php -S localhost:8000` binds IPv6 `::1` only on Windows and the tunnel (IPv4 `127.0.0.1`) will hang:
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; php -S 0.0.0.0:8000
   ```
   Verify: `Invoke-RestMethod http://127.0.0.1:8000/health`
2. **Expo app** (dev build, since Google Sign-In is a native module):
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\mobile" ; npm run android
   ```
3. **Reverse-tunnel the API to the device** (the dev app calls `http://localhost:8000` — see `app.json` `extra.apiUrlDev`):
   ```powershell
   & "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe" reverse tcp:8000 tcp:8000
   ```

## Quick API smoke test (dev login)

```powershell
$t = (Invoke-RestMethod http://localhost:8000/auth/login -Method Post -ContentType 'application/json' -Body '{}').data.token
$H = @{ Authorization = "Bearer $t" }
Invoke-RestMethod "http://localhost:8000/meal-plans/generate?mode=rule" -Method Post -Headers $H -ContentType 'application/json' -Body '{}'
```

## Notes

- `npm run typecheck` (mobile) runs `tsc --noEmit`.
- Google Sign-In and the `@react-native-google-signin` native module require a dev/prod build (not Expo Go); use the dev login for fast iteration.
- AI features need `GROQ_API_KEY`. Without it, `mode=ai` plan generation falls back to the rule engine and `/ai/from-ingredients` returns 503.
