const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const appJsonPath = path.join(rootDir, 'app.json');
const androidGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
const releaseVersionPath = path.join(rootDir, 'release-version.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readReleaseVersion() {
  if (!fs.existsSync(releaseVersionPath)) {
    throw new Error('release-version.json is missing');
  }

  const releaseVersion = readJson(releaseVersionPath);

  if (!releaseVersion.version || typeof releaseVersion.version !== 'string') {
    throw new Error('release-version.json must contain a string "version"');
  }

  if (!Number.isInteger(releaseVersion.versionCode) || releaseVersion.versionCode <= 0) {
    throw new Error('release-version.json must contain a positive integer "versionCode"');
  }

  return releaseVersion;
}

function syncAndroidVersion(version, versionCode) {
  if (!fs.existsSync(androidGradlePath)) {
    return null;
  }

  const gradleContent = fs.readFileSync(androidGradlePath, 'utf8');
  const versionNameRegex = /versionName\s+"[^"]+"/;
  const versionCodeRegex = /versionCode\s+\d+/;

  if (!versionNameRegex.test(gradleContent)) {
    throw new Error('android/app/build.gradle does not contain a versionName entry');
  }

  if (!versionCodeRegex.test(gradleContent)) {
    throw new Error('android/app/build.gradle does not contain a versionCode entry');
  }

  const updated = gradleContent
    .replace(versionNameRegex, `versionName "${version}"`)
    .replace(versionCodeRegex, `versionCode ${versionCode}`);

  fs.writeFileSync(androidGradlePath, updated, 'utf8');
  console.log(`Synced android/app/build.gradle versionName -> ${version}`);
  console.log(`Synced android/app/build.gradle versionCode -> ${versionCode}`);

  return versionCode;
}

function syncVersion() {
  const releaseVersion = readReleaseVersion();
  const pkg = readJson(packageJsonPath);
  const app = readJson(appJsonPath);

  if (!app.expo) {
    throw new Error('app.json expo config is missing');
  }

  pkg.version = releaseVersion.version;
  writeJson(packageJsonPath, pkg);
  console.log(`Synced package.json version -> ${releaseVersion.version}`);

  app.expo.version = releaseVersion.version;

  const syncedAndroidVersionCode = syncAndroidVersion(releaseVersion.version, releaseVersion.versionCode);
  if (syncedAndroidVersionCode !== null) {
    app.expo.android = app.expo.android || {};
    app.expo.android.versionCode = syncedAndroidVersionCode;
    console.log(`Synced app.json expo.android.versionCode -> ${syncedAndroidVersionCode}`);
  }

  writeJson(appJsonPath, app);
  console.log(`Synced app.json expo.version -> ${releaseVersion.version}`);
}

syncVersion();
