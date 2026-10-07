---
name: diet-release
description: Build and ship the Diet Plan native Android app (android/, Kotlin + Compose) to Google Play closed testing — changelog, version bump, prod catalogue snapshot, signed AAB, R8 release smoke test, upgrade test, publish via play-deploy, and the signing-key SHA-1s for Google Sign-In. Use when releasing or updating the Diet Plan Android app.
---

Release the Diet Plan **native Android app** (`android/`, its own git repo `shivarya/diet-plan-android`, package
`dev.shivarya.dietplan`). It replaced the React Native app (`mobile/`, last release 1.0.5 / versionCode 10, built on
EAS) **in place**: same applicationId, same upload key, versionCode continuing upward. Plain Gradle — no EAS, no
Expo, no `C:\` junction (the 260-char path problem was React Native / NDK only).

## 1. Changelog + version (do this first)

- Add an `android/CHANGELOG.md` entry for every user-facing change: `## [x.y.z] - YYYY-MM-DD`, `### Added/Changed/Fixed`
  and a **Google Play Notes** block (pasted verbatim into Play's "What's new"; no leading `- ` on a one-line note).
- Bump `android/version.properties` by hand (`versionCode` +1, `versionName`). It must stay above every versionCode Play
  has seen (RN/EAS reached 10).

## 2. Prod catalogue snapshot

The APK bundles the whole recipe catalogue (`app/src/main/assets/catalog/catalog.db`, gitignored). Rebuild it from
**production** every release — recipe ids in the bundle must match the server the app talks to:

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\android" ; .\gradlew.bat :app:refreshCatalog
```

Check the printed count matches `GET https://shivarya.dev/diet_plan/catalog/meta` and `catalog-meta.json` says
`"source": "https://shivarya.dev/diet_plan/"`. Release builds enforce this: `verifyReleaseCatalog` (runs before
`preReleaseBuild`) fails the build if the bundled snapshot came from anywhere else. `-PallowDevCatalog` overrides it for
a local test APK only — never publish such a build. (Prod must have the `/catalog` endpoints + migration 007 — see
`diet-deploy-api`.)

## 3. Signing

`android/keystore.properties` (gitignored) points at the upload keystore:

```properties
storeFile=dietplan-upload.jks   # backup: Google Drive  My Drive\Website Data\diet-plan\@shivarya3__diet-plan-mobile.jks
storePassword=...
keyAlias=...
keyPassword=...
```

The upload key was created by EAS for the RN app; download it once with `eas credentials --platform android` (from
`mobile/`) → *Download existing keystore*, and keep the `.jks` in `android/` (gitignored by `*.jks`). The backup copy
lives in Google Drive (`My Drive\Website Data\diet-plan\`) — copy it from there on a new machine. Verify its SHA-1
is `26:F7:57:39:5E:02:3E:85:BE:EA:62:6E:60:92:05:D7:FF:6B:9C:B8`
(`keytool -list -v -keystore android\dietplan-upload.jks`). Without `keystore.properties` the release build silently
falls back to the debug key — never publish that.

## 4. Build + verify

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\diet-plan\android" ; .\gradlew.bat :app:testDebugUnitTest :app:lintRelease :app:bundleRelease :app:assembleRelease
```

- Unit tests include `PlanEngineParityTest` (Kotlin guest engine vs PHP goldens) — if `server/services/PlanEngine.php`
  changed, regenerate the goldens first: `cd ..\server ; php scripts/engine-golden.php`.
- `keytool -printcert -jarfile app\build\outputs\bundle\release\app-release.aab` must show the upload key SHA-1 above.
- **Smoke-test the R8 release APK** (`app\build\outputs\apk\release\app-release.apk`) on a device: launch, guest plan +
  shuffle, browse/search, recipe detail, sign in. R8 has broken launches in this monorepo before (Room/WorkManager
  `<init>` — kept by `proguard-rules.pro`).
- No "Use dev login" button may appear in the release APK (it exists only in debug builds aimed at a local server).
- **Upgrade test** (first native release, and whenever storage/migration code changes): install the current Play build,
  sign in, then `adb install -r app-release.apk` — the user must still be signed in, with their theme (`LegacyMigration`
  reads the RN AsyncStorage `RKStorage` DB). Different signatures (sideload vs Play) can't replace each other — uninstall
  first in that case, and check Work profile / Private space users too.
- Uninstall test builds from the user's real phone afterwards.

## 5. Publish (closed testing)

Use the `play-deploy` tool (`deploy diet-plan to closed testing`), which commits to the `alpha` track. Its `diet-plan`
entry in `play-deploy/config/apps.json` must build `diet-plan/android` with `gradle-direct`
(`.\gradlew.bat :app:bundleRelease`, AAB at `app/build/outputs/bundle/release/app-release.aab`) — until the first native
release it still describes the RN/EAS build, so switch it at cutover. Always `--dry-run` first.
Production rollout is a manual Play Console step — staged (20% → 100%), since the native app replaces the RN app for
existing users. Commit + push `android/` (and tag the release) before building.

## 6. Google Sign-In SHA-1s (the gotcha — "not registered to use OAuth2.0")

`BuildConfig.GOOGLE_WEB_CLIENT_ID` (`app/build.gradle.kts`) must be the **Web** OAuth client ID, matching the server
`.env` `GOOGLE_CLIENT_ID`. Each signing key needs its own **Android** OAuth client (package `dev.shivarya.dietplan`) in the
same Google Cloud project as the Web client (`1080529324514`). Credential Manager reports a missing one as a plain
cancellation — check `adb logcat -s GoogleAuthClient`.

| Install path | SHA-1 | How to get it |
|---|---|---|
| Debug build (`android/debug.keystore`, the RN debug key) | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` | `keytool -list -v -keystore android/debug.keystore -alias androiddebugkey -storepass android` |
| Upload key (sideloaded release builds) | `26:F7:57:39:5E:02:3E:85:BE:EA:62:6E:60:92:05:D7:FF:6B:9C:B8` | `keytool -printcert -jarfile <the .aab>` |
| **Installed from Play** | `82:97:10:87:84:E9:89:8F:DB:EC:8C:39:5F:AC:14:E6:DC:8D:96:D7` | Play Console → App integrity → Play app signing |
| Internal App Sharing | (IAS re-signs with its own key) | Play Console → App integrity → Internal app sharing |

## Rules / notes

- Premium/admin are env-driven on the server (`PREMIUM_EMAILS`/`ADMIN_EMAILS`); users pick it up on next launch.
- Icons/graphics for the listing: `mobile/play-store-assets/` (root `play-store-assets` skill). The launcher icon is the RN
  foreground + a monochrome vector (`res/drawable/ic_launcher_monochrome.xml`) for Pixel themed icons.
- Emulator storage on this machine is tight (6 GB data partition, ~95% full): if `adb install -r` fails with
  `INSUFFICIENT_STORAGE`, uninstall the app first (`scripts/fix-emulator-storage.ps1 -Package dev.shivarya.dietplan`).
