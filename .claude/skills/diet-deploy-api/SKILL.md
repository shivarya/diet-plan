---
name: diet-deploy-api
description: Deploy the Diet Plan PHP backend to cPanel and verify it — upload server files, configure .env, import the DB schema, seed recipes, and health-check the live API. Use when deploying or updating the Diet Plan server.
---

Deploy the Diet Plan **PHP** API (`server/`) to cPanel at `https://shivarya.dev/diet_plan/`. Backend is PHP + MySQL (front-controller `index.php` with `.htaccess`). Same pattern as the expense-tracker / split-cash servers.

**Host (GoDaddy cPanel):** SSH via the root helper `connect_ssh.ps1` — `ssh -i C:\Users\Ash\.ssh\cpanel_key hm5pno1wummg@184.168.101.66`. PHP 8.4 + Composer 2.9 are on the host. **`shivarya.dev`'s document root is `~/public_html/shivarya.dev/` — NOT `~/public_html/`.** Each API is a subfolder there (`shivarya.dev/expense_tracker`, `shivarya.dev/split_cash`, `shivarya.dev/diet_plan`). Deploying to `~/public_html/diet_plan` will be shadowed by the portfolio SPA's catch-all and silently serve `index.html`.

## Steps

1. **Pre-flight (local)**: `cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\server" ; composer install` and smoke-test with `php -S localhost:8000` → `curl http://localhost:8000/health`.
2. **Upload** the `server/` contents to `~/public_html/shivarya.dev/diet_plan` (scp a tarball excluding `.env`/`vendor`/`php_errors.log`, extract on host, then `composer install --no-dev --optimize-autoloader` on the host). Keep `.htaccess` — it uses `RewriteBase /diet_plan/` and routes to the absolute `/diet_plan/index.php` so the parent SPA catch-all does not shadow it; it also protects `.env`.
   ```powershell
   tar -czf "$env:TEMP\dp.tgz" -C server --exclude=./vendor --exclude=./.env --exclude=./php_errors.log .
   scp -i C:\Users\Ash\.ssh\cpanel_key "$env:TEMP\dp.tgz" hm5pno1wummg@184.168.101.66:~/dp.tgz
   ssh -i C:\Users\Ash\.ssh\cpanel_key hm5pno1wummg@184.168.101.66 "mkdir -p ~/public_html/shivarya.dev/diet_plan && tar xzf ~/dp.tgz -C ~/public_html/shivarya.dev/diet_plan && rm ~/dp.tgz && cd ~/public_html/shivarya.dev/diet_plan && composer install --no-dev --optimize-autoloader"
   ```
3. **Configure** the production `.env` on the server (do NOT upload your local `.env`):
   - `DB_HOST, DB_NAME=<cpanelprefix>_diet_plan, DB_USER, DB_PASS`
   - `JWT_SECRET` (a long random secret)
   - `GOOGLE_CLIENT_ID` (+ `GOOGLE_ALLOWED_AUDIENCES` for native client IDs)
   - `AI_PROVIDER=groq`, `AI_MODEL=llama-3.3-70b-versatile`, `GROQ_API_KEY`
   - `ALLOW_DEV_LOGIN=false`
4. **Database**: create the MySQL DB + user in cPanel, import `server/database/schema.sql` (phpMyAdmin or `mysql < schema.sql`), then **seed recipes**: `php scripts/seed.php` on the host (or import a dump). Apply any numbered `database/migrations/*.sql` in order.
5. **Verify**: `Invoke-RestMethod https://shivarya.dev/diet_plan/health` returns `{ "success": true, ... }` (works before the DB exists — `/health` does not touch the DB). `GET /recipes` without a token must return a 401 JSON (proves routing reaches `index.php`, not the SPA). With a valid Bearer token, spot-check `POST /meal-plans/generate?mode=rule` and confirm Thursday has no egg/onion/garlic.
6. **Mobile**: point `app.json` `extra.apiUrl` at `https://shivarya.dev/diet_plan` and set `extra.googleClientId`; ship via EAS (see `play-store-assets` for icons).

## Rules

- Never overwrite the server `.env` with local secrets, and never commit `.env`.
- Set `.env` permissions to `600` on the host; keep `block-insecure=false` in `composer.json` (pins for `firebase/php-jwt`/`google/apiclient` are flagged by recent advisories but required by `google/apiclient`).
- Back up the DB before importing migrations on production.
- If `/health` fails after deploy: check `php_errors.log`, DB credentials, and that the `.htaccess` rewrite is intact.
