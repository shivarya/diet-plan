const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseVersionPath = path.join(rootDir, 'release-version.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function bumpPatch(version) {
  const parts = version.split('.').map(Number);

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver version in release-version.json: ${version}`);
  }

  parts[2] += 1;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function bumpReleaseVersion() {
  if (!fs.existsSync(releaseVersionPath)) {
    throw new Error('release-version.json is missing');
  }

  const current = readJson(releaseVersionPath);

  if (!current.version || typeof current.version !== 'string') {
    throw new Error('release-version.json must contain a string "version"');
  }

  if (!Number.isInteger(current.versionCode) || current.versionCode <= 0) {
    throw new Error('release-version.json must contain a positive integer "versionCode"');
  }

  const next = {
    version: bumpPatch(current.version),
    versionCode: current.versionCode + 1,
  };

  writeJson(releaseVersionPath, next);
  console.log(`Bumped release-version.json version -> ${next.version}`);
  console.log(`Bumped release-version.json versionCode -> ${next.versionCode}`);
}

bumpReleaseVersion();
