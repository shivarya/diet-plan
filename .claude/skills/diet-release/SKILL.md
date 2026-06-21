---
name: diet-release
description: Build and ship the Diet Plan mobile app to Google Play via EAS — bump the version, update the changelog, run the production build, upload the AAB, and register the signing-key SHA-1s for Google Sign-In. Use when releasing or updating the Diet Plan Android app.
---

Release the Diet Plan **mobile** app (`mobile/`, Expo SDK 54, package `dev.shivarya.dietplan`) to Google Play via EAS. The EAS project is already linked (`app.json` → `extra.eas.projectId`); CLI logged in as `shivarya3`. `eas.json` uses `appVersionSource: "remote"`, so **EAS auto-increments `versionCode`** on each build — `release-version.json`/`version` only drives the human `versionName` + the changelog.

## 1. Changelog + version (do this first)

**ALWAYS add a `mobile/CHANGELOG.md` entry for every user-facing feature/fix before building** — new `## [x.y.z] - YYYY-MM-DD` heading, `### Added/Changed/Fixed`, and a **Google Play Notes** block (copied verbatim into the Play "What's new" field).

- `release-version.json` (`{version, versionCode}`) is the source of truth.
- `npm run version:bump:production` bumps patch + versionCode and syncs into `package.json`, `app.json`, `android/app/build.gradle`. For a minor/major bump, edit `release-version.json` first, then `npm run version:sync:config`.

## 2. Build (EAS cloud → AAB)

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\mobile"
npm run build:production   # bumps version, then EAS production build (AAB), --non-interactive --no-wait
```
- A pure rebuild with no version bump (e.g. to get a fresh versionCode for a re-upload): `eas build --platform android --profile production --non-interactive --no-wait`.
- Commit before building — EAS archives the committed git state. The build prints a logs URL; the `.aab` is downloadable there (~10–15 min).
- The AAB is signed with the EAS upload key; Play App Signing re-signs the installs Google serves.

## 3. Play Store upload

Play Console (app `dev.shivarya.dietplan`) → **Test and release** → **Testing → Closed/Internal testing → Create new release** → upload the `.aab` → review → roll out. Add testers, install via the opt-in link. Promote to **Production** only after sign-in is confirmed on a test track. Paste the changelog's Google Play Notes into the release notes. Icons/graphics: `npm run generate-icons` → `mobile/play-store-assets/`.

## 4. Google Sign-In SHA-1s (the gotcha — `DEVELOPER_ERROR`)

`app.json` `extra.googleClientId` must be the **Web** OAuth client ID, and the server `.env` `GOOGLE_CLIENT_ID` must match it. Then register **one Android OAuth client per signing key**, all with package `dev.shivarya.dietplan`, in the **same Google Cloud project** as the Web client (`1080529324514`). A missing key → `DEVELOPER_ERROR` on that install path.

| Install path | SHA-1 (current) | How to get it |
|---|---|---|
| `npm run android` (debug) | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` | `keytool -list -v -keystore mobile/android/app/debug.keystore -alias androiddebugkey -storepass android` |
| EAS build / upload key | `26:F7:57:39:5E:02:3E:85:BE:EA:62:6E:60:92:05:D7:FF:6B:9C:B8` | `eas credentials --platform android`, or `keytool -printcert -jarfile <the .aab>` |
| **Installed from Play** | `82:97:10:87:84:E9:89:8F:DB:EC:8C:39:5F:AC:14:E6:DC:8D:96:D7` | Play Console → Protected with Play → Play Store protection → Play app signing; **or** install from a Play track and extract: `adb shell pm path dev.shivarya.dietplan` → `adb pull <base.apk>` → `apksigner verify --print-certs` (the signer with `O=Google Inc.` is the Play app signing key) |

After registering, wait a few minutes and force-relaunch the app.

## Rules / notes

- The "Use dev login" button is gated behind `__DEV__` — it only appears in development builds, never in release. (Server also rejects `/auth/login` when `ALLOW_DEV_LOGIN=false`.)
- Premium/admin are env-driven on the server (`PREMIUM_EMAILS`/`ADMIN_EMAILS`) — no app change needed; users get it on next launch.
- Windows long-path build issues (local gradle builds): see the workspace-root `CLAUDE.md` (64-bit ABIs only + `C:\` junction).
- The Play app signing key never changes for the app, so its SHA-1 only needs registering once.
