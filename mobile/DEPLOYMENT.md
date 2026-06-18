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

## 1. Configure production API + Google Sign-In

In `app.json` → `extra`, set:

```json
{
  "apiUrl": "https://shivarya.dev/diet_plan",
  "googleClientId": "<your Web client ID from Google Cloud Console>"
}
```

**Getting a Google Client ID:**
1. [Google Cloud Console](https://console.cloud.google.com) → select/create a project
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Application type: **Android** for the Play Store build; **Web** for the server's `GOOGLE_CLIENT_ID` (used to verify ID tokens)
4. Android client ID needs your app's SHA-1 fingerprint (see §3)
5. Also add the `googleClientId` to `server/.env` → `GOOGLE_CLIENT_ID` on the server

---

## 2. Run EAS build configuration

`eas.json` is already present. Review it:

```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": {}
  }
}
```

Init the project with EAS (first time only):
```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\mobile"
eas build:configure
```

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
| Build fails: peer dep conflict | `npm install --legacy-peer-deps` |
| Google Sign-In fails on Play build | SHA-1 in Google Cloud Console doesn't match EAS keystore — run `eas credentials` to get the correct fingerprint |
| AI features return 503 | `GROQ_API_KEY` not set in server `.env` |
