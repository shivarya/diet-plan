# Diet Plan API — cPanel Deployment Guide

Deploy the PHP backend (`server/`) to the GoDaddy cPanel host so the API is live at **`https://shivarya.dev/diet_plan/`**. The same host already serves `expense_tracker` and `split_cash` the same way.

> **The one thing that bites you:** `shivarya.dev`'s document root is **`~/public_html/shivarya.dev/`**, *not* `~/public_html/`. The APIs are subfolders **inside** it. The docroot also runs a portfolio SPA with a catch-all rewrite to `index.html`, so anything deployed to the wrong place is silently served as the portfolio page instead of the API. Always deploy to **`~/public_html/shivarya.dev/diet_plan`**.

---

## Host facts

| | |
|---|---|
| SSH | `ssh -i C:\Users\Ash\.ssh\cpanel_key hm5pno1wummg@184.168.101.66` (root helper: `connect_ssh.ps1`) |
| cPanel user | `hm5pno1wummg` → MySQL DBs/users are prefixed `hm5pno1wummg_` |
| PHP / Composer | PHP 8.4, Composer 2.9 on PATH |
| Deploy dir | `~/public_html/shivarya.dev/diet_plan` |
| Public URL | `https://shivarya.dev/diet_plan/` |

---

## 1. Pre-flight (local)

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server"
composer install
php -S localhost:8000        # then: Invoke-RestMethod http://localhost:8000/health
```

## 2. Upload source + install deps on the host

Ship source only (no local `.env`, no `vendor/`); build `vendor/` on the host.

```powershell
tar -czf "$env:TEMP\dp.tgz" -C "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" --exclude=./vendor --exclude=./.env --exclude=./php_errors.log .
scp -i C:\Users\Ash\.ssh\cpanel_key "$env:TEMP\dp.tgz" hm5pno1wummg@184.168.101.66:~/dp.tgz
ssh -i C:\Users\Ash\.ssh\cpanel_key hm5pno1wummg@184.168.101.66 "mkdir -p ~/public_html/shivarya.dev/diet_plan && tar xzf ~/dp.tgz -C ~/public_html/shivarya.dev/diet_plan && rm ~/dp.tgz && cd ~/public_html/shivarya.dev/diet_plan && composer install --no-dev --optimize-autoloader"
```

`composer.json` sets `audit.block-insecure=false` because `google/apiclient` pins `firebase/php-jwt` versions flagged by recent advisories — required, not optional.

## 3. `.htaccess`

Already in the bundle. It uses `RewriteBase /diet_plan/` and routes to the **absolute** `/diet_plan/index.php` so the parent SPA catch-all can't shadow it, forces HTTPS, passes the `Authorization` header to PHP, and blocks `.env`/dotfiles. Don't replace it with a generic relative-rewrite version.

## 4. Create the MySQL database (cPanel → MySQL Databases)

- Database: `hm5pno1wummg_diet_plan`
- User: `hm5pno1wummg_diet` (generate a password) → **Add user to DB, ALL PRIVILEGES**

These names must match the `.env` below (or edit `.env` to match what you created).

## 5. Get your API keys

### 5a. Groq API key (AI features)

1. Go to **[console.groq.com](https://console.groq.com)** and sign up (free).
2. In the sidebar: **API Keys → Create API Key** — give it a name (e.g. `diet-plan-prod`).
3. Copy the key immediately (it's only shown once). It starts with `gsk_…`.
4. Paste it as `GROQ_API_KEY` in `.env` below.

> **Free tier limits:** 30 requests/min, 6 000 tokens/min, 500 000 tokens/day — more than enough for a personal app. No credit card required.

### 5b. Google OAuth Web Client ID (Google Sign-In)

The server uses a **Web** client ID to verify Google ID tokens. The Android app uses a separate **Android** client ID to sign in (set up when you do the mobile build — see [mobile-deployment.md](mobile-deployment.md)).

1. Open **[Google Cloud Console](https://console.cloud.google.com)** → create or select a project (e.g. `Diet Plan`).
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `Diet Plan`, support email: your Gmail
   - Scopes: add `email` and `profile`
   - Save and continue (no need to publish for personal use — leave in Testing and add your Gmail as a test user)
3. **APIs & Services → Credentials → + Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: `Diet Plan Web`
   - Authorised JavaScript origins: `https://shivarya.dev`
   - Click **Create** → copy the **Client ID** (ends in `.apps.googleusercontent.com`)
4. Paste it as `GOOGLE_CLIENT_ID` in `.env` below.

## 6. Configure `.env` on the host

Create `~/public_html/shivarya.dev/diet_plan/.env` (never upload your local one):

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=hm5pno1wummg_diet_plan
DB_USER=hm5pno1wummg_diet
DB_PASS=<the password you generated>

JWT_SECRET=<run: php -r "echo bin2hex(random_bytes(32));">
ALLOW_DEV_LOGIN=false

GOOGLE_CLIENT_ID=<Web client ID from step 5b>
# GOOGLE_ALLOWED_AUDIENCES=   # leave blank — only needed if you add iOS later

AI_PROVIDER=groq
AI_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=<key from step 5a — optional; without it AI falls back to the rule engine>
```

Then lock it down: `chmod 600 .env` (files `644`, dirs `755`).

## 7. Import schema + seed recipes

```bash
cd ~/public_html/shivarya.dev/diet_plan
mysql -u hm5pno1wummg_diet -p hm5pno1wummg_diet_plan < database/schema.sql   # or import via phpMyAdmin
php scripts/seed.php                                                          # loads ~90 curated recipes
```

Creates 5 tables: `users`, `recipes`, `dietary_preferences`, `meal_plans`, `meal_plan_items`.

## 8. Verify

```powershell
Invoke-RestMethod https://shivarya.dev/diet_plan/health        # { success: true, ... }  (works before DB exists)
```
- `GET /diet_plan/recipes` with **no** token must return **401 JSON** — that proves routing reaches `index.php` and the SPA isn't shadowing it (if you get HTML, you deployed to the wrong folder).
- With a Bearer token: `POST /diet_plan/meal-plans/generate?mode=rule` returns a full week; confirm **Thursday has no egg/onion/garlic** and Tue/Thu/Sat have no egg.

## 9. Point the mobile app at production

In `mobile/app.json` → `extra`: `apiUrl` is already `https://shivarya.dev/diet_plan`; set `googleClientId` to your Web client ID, then build with EAS.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/health` returns the portfolio HTML | Wrong folder — must be `~/public_html/shivarya.dev/diet_plan`, and `.htaccess` must target `/diet_plan/index.php`. |
| 500 error | Check `php_errors.log` in the app dir; verify `vendor/` exists and `.env` is valid. |
| "Database connection failed" | DB not created yet, or `.env` DB_* don't match the cPanel DB/user; `DB_HOST=localhost`. |
| 401 on every route | Expected without a token. If a valid token still 401s, confirm `.htaccess` Authorization passthrough is intact. |
| AI endpoints 503 / plan falls back to rule | `GROQ_API_KEY` not set in `.env`. |

## Security checklist

- [ ] `.env` is `600`; `ALLOW_DEV_LOGIN=false` in production.
- [ ] `.htaccess` blocks `.env`/dotfiles and forces HTTPS.
- [ ] DB user limited to the one database.
- [ ] `GOOGLE_CLIENT_ID` set so `/auth/google` can verify ID tokens.
