const fs = require('fs');
const path = require('path');

const aabPath = path.resolve(
  __dirname,
  '..',
  'android',
  'app',
  'build',
  'outputs',
  'bundle',
  'release',
  'app-release.aab'
);

if (fs.existsSync(aabPath)) {
  const stats = fs.statSync(aabPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('AAB build complete.');
  console.log(`AAB path: ${aabPath}`);
  console.log(`AAB size: ${sizeMb} MB`);
} else {
  console.error('AAB build finished, but artifact was not found at expected location.');
  console.error(`Expected: ${aabPath}`);
  process.exit(1);
}
