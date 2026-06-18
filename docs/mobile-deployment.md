# Diet Plan Mobile — Deployment Guide

Build and publish the Android app to the Google Play Store.

---

## Prerequisites

- Node.js + `npm install --legacy-peer-deps` done
- [Expo account](https://expo.dev) (free)
- EAS CLI: `npm install -g eas-cli` → `eas login`
- Android keystore (see §3 below)
- Google Play Console account

---

## 1. Get your API keys

### 1a. Groq API key (AI features — server-side)

The Groq key lives in the **server** `.env`, not in the mobile app. If you haven't set it up yet, follow [docs/server-deployment.md §5a](server-deployment.md#5a-groq-api-key-ai-features).

### 1b. Google OAuth Client IDs (Google Sign-In)

You need a **Web** OAuth client and one or more **Android** OAuth clients — **all in the same Google Cloud project**. They play different roles:

- **The Web client ID is what goes in the app and the server.** Set `mobile/app.json` → `extra.googleClientId` to the **Web** client ID (it's passed as `webClientId`), and the server `.env` `GOOGLE_CLIENT_ID` to the **same** value. Google issues ID tokens with `aud = Web client ID`, which the server verifies.
  > ⚠️ Putting an **Android** client ID in `googleClientId` causes `DEVELOPER_ERROR`. It must be the **Web application** type.

- **Each Android client authorises one *signed build*** to use Google Sign-In (package name + SHA-1). It is **never referenced in code** — it just has to exist. Register one per signing key, all with package `dev.shivarya.dietplan`:

  | Build | Where its SHA-1 comes from |
  |---|---|
  | `npm run android` (debug) | `keytool -list -v -keystore mobile/android/app/debug.keystore -alias androiddebugkey -storepass android` |
  | EAS production build | `eas credentials --platform android` |
  | Google Play (after 1st release) | Play Console → *Test and release → App signing* |

**Setup:** in **[Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials**, create the **Web application** client (copy its ID into `app.json` + server `.env`), then a **+ Create Credentials → OAuth client ID → Android** for each SHA-1 above. Re-check the same project owns all of them.

`GOOGLE_ALLOWED_AUDIENCES` stays blank for an Android-only setup.

---

## 2. Configure EAS

`eas.json` is already present:

```json
{
  "cli": { "version": ">= 16.27.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": { "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

`appVersionSource: "remote"` + `autoIncrement` means **EAS manages `versionCode`** (bumped automatically each production build) — you don't set it in `app.json`. The human-facing `version` (e.g. `1.0.0`) does live in `app.json` and you bump it manually for releases.

The project is already linked (`extra.eas.projectId` is set in `app.json`); `eas build:configure` is only needed if that's ever missing.

---

## 3. Keystore

EAS manages the keystore automatically during the first production build. When prompted, choose **"Generate new keystore"** and let EAS store it securely. Back up the credentials:

```powershell
eas credentials
```

To get the SHA-1 fingerprint for the Google Android client ID:
```powershell
eas credentials --platform android
```

---

## 4. Build

### Development APK (local testing, no Play Store)
```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\mobile"
npm run android          # expo run:android — builds + installs on connected device/emulator
```

### Preview APK (internal distribution, no store)
```powershell
eas build --platform android --profile preview
```

### Production AAB (Play Store upload)
```powershell
eas build --platform android --profile production
```

EAS builds in the cloud and emails you a download link when done (~10–15 min). Download the `.aab` for Play Store upload.

---

## 5. Play Store submission

1. **Create the app** in [Google Play Console](https://play.google.com/console) — package `dev.shivarya.dietplan`
2. **Store listing**
   - Title: `Diet Plan` (or chosen display name)
   - Short description (max 80 chars): e.g. "High-protein Indian weekly meal planner"
   - Full description: features list, dietary rules, AI premium
   - Category: Health & Fitness
3. **Graphics** — all generated in `play-store-assets/` via `npm run generate-icons`:
   - App icon 512×512: `play-store-assets/icon-512.png`
   - Feature graphic 1024×500: `play-store-assets/feature-graphic.png`
   - Screenshots: replace `screenshot-*-template.png` with real captures (min 2, max 8)
4. **Content rating** — complete the questionnaire (no violence/sexual content → Everyone)
5. **Privacy policy** — required; host a page on `shivarya.dev` describing data collected (email, meal preferences)
6. **Upload AAB** — Releases → Production → Create release → upload the `.aab` from EAS
7. **Review** — first submission typically takes 1–3 days

---

## 6. Updates

For JS-only changes use **EAS Update** (OTA, no store re-review):
```powershell
eas update --branch production --message "Fix shuffle crash"
```

For native changes (new permissions, native modules) a full EAS build + Play Store release is required.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "apiClient is null — call configure() first" | `googleClientId` not set in `app.json` extra; use dev login for local testing |
| Network error on device | Run `adb reverse tcp:8000 tcp:8000`; PHP must be `php -S 0.0.0.0:8000` not `localhost:8000` |
| Build fails: peer dep conflict | `npm install --legacy-peer-deps` (an `.npmrc` with `legacy-peer-deps=true` is committed) |
| `DEVELOPER_ERROR` on Google Sign-In | (1) `googleClientId` must be the **Web** client ID, not Android; (2) the build's signing SHA-1 must be registered as an **Android** client (package `dev.shivarya.dietplan`) in the **same project** — see §1b. Get the EAS build SHA-1 from `eas credentials --platform android` |
| Premium/admin not unlocking | Set `PREMIUM_EMAILS` / `ADMIN_EMAILS` (comma-separated) in the **server** `.env`; the user re-launches to refresh |
| AI features return 503 | `GROQ_API_KEY` not set in server `.env` |
