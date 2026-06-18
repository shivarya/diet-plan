/**
 * Icon Generator for Google Play Store — Diet Plan
 *
 * Renders the SVG sources in assets/images/ into all required PNG sizes for the
 * Play Store listing (play-store-assets/) and the runtime app icons (assets/images/).
 * Run: npm run generate-icons   (or: node scripts/generate-icons.js)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Auto-install the rendering deps (sharp + resvg) into this scripts/ folder.
try {
  require('sharp');
  require('@resvg/resvg-js');
} catch (err) {
  console.log('📦 Installing icon-generation dependencies (sharp, @resvg/resvg-js)...\n');
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  console.log('\n✅ Dependencies installed!\n');
}

const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'images');
const OUTPUT_DIR = path.join(__dirname, '..', 'play-store-assets');
const SVG_LOGO = path.join(ASSETS_DIR, 'app-logo.svg');
const SVG_ICON = path.join(ASSETS_DIR, 'app-icon-modern.svg');

const BRAND_DARK = '#0E1B12';
const BRAND_GREEN_1 = '#1E7D52';
const BRAND_GREEN_2 = '#3FB37A';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('🥗 Diet Plan — Play Store Icon Generator\n========================================\n');

async function svgToPng(svgPath, outputPath, width, height = null) {
  const actualHeight = height || width;
  const svgBuffer = fs.readFileSync(svgPath);
  const resvg = new Resvg(svgBuffer, { fitTo: { mode: 'width', value: width } });
  const pngBuffer = resvg.render().asPng();
  if (actualHeight !== width) {
    await sharp(pngBuffer).resize(width, actualHeight).toFile(outputPath);
  } else {
    fs.writeFileSync(outputPath, pngBuffer);
  }
}

// Render an SVG passed as a string (used for the feature graphic).
function svgStringToPng(svg, outputPath, width) {
  const resvg = new Resvg(Buffer.from(svg), { fitTo: { mode: 'width', value: width } });
  fs.writeFileSync(outputPath, resvg.render().asPng());
}

async function paddedIcon(svgPath, outputPath, size, innerRatio) {
  const tmp = path.join(OUTPUT_DIR, `__tmp-${path.basename(outputPath)}`);
  const inner = Math.round(size * innerRatio);
  const pad = Math.round((size - inner) / 2);
  await svgToPng(svgPath, tmp, Math.round(inner * 1.6));
  await sharp(tmp)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);
  fs.unlinkSync(tmp);
}

async function generateAppIcon() {
  console.log('📱 App icon (512)...');
  const out = path.join(OUTPUT_DIR, 'icon-512.png');
  // The icon SVG already has its own rounded tile, so no extra padding.
  await svgToPng(SVG_ICON, out, 512);
  fs.copyFileSync(out, path.join(ASSETS_DIR, 'icon.png'));
  console.log('   ✅ icon-512.png + assets/images/icon.png');
}

async function generateAdaptiveIcons() {
  console.log('📐 Adaptive icons...');
  // Foreground: the logo emblem with safe-area padding, transparent bg.
  const fg = path.join(OUTPUT_DIR, 'android-icon-foreground.png');
  await paddedIcon(SVG_LOGO, fg, 512, 0.66);
  fs.copyFileSync(fg, path.join(ASSETS_DIR, 'android-icon-foreground.png'));

  // Background: solid brand green.
  const bg = path.join(OUTPUT_DIR, 'android-icon-background.png');
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BRAND_DARK } }).png().toFile(bg);

  // Monochrome (Android 13+): white emblem on transparent.
  const mono = path.join(OUTPUT_DIR, 'android-icon-monochrome.png');
  const tmp = path.join(OUTPUT_DIR, '__tmp-mono.png');
  await svgToPng(SVG_LOGO, tmp, 512);
  await sharp(tmp).greyscale().resize(338, 338, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 87, bottom: 87, left: 87, right: 87, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(mono);
  fs.unlinkSync(tmp);
  console.log('   ✅ foreground / background / monochrome (512)');
}

async function generateFeatureGraphic() {
  console.log('🖼️  Feature graphic (1024x500)...');
  // Render the emblem, then composite it onto a green gradient banner.
  const emblem = path.join(OUTPUT_DIR, '__tmp-emblem.png');
  await svgToPng(SVG_LOGO, emblem, 360);
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND_GREEN_1}"/><stop offset="1" stop-color="${BRAND_GREEN_2}"/>
    </linearGradient></defs>
    <rect width="1024" height="500" fill="url(#g)"/>
    <circle cx="880" cy="80" r="180" fill="#FFFFFF" opacity="0.06"/>
    <circle cx="120" cy="440" r="160" fill="#FFFFFF" opacity="0.06"/>
  </svg>`;
  const base = path.join(OUTPUT_DIR, '__tmp-feature-bg.png');
  svgStringToPng(bgSvg, base, 1024);
  await sharp(base)
    .composite([{ input: emblem, left: 90, top: 70 }])
    .png()
    .toFile(path.join(OUTPUT_DIR, 'feature-graphic.png'));
  fs.unlinkSync(emblem);
  fs.unlinkSync(base);
  console.log('   ✅ feature-graphic.png (emblem on green gradient — add a title in an editor if desired)');
}

async function generateLauncherIcons() {
  console.log('🚀 Launcher icons...');
  for (const size of [48, 72, 96, 144, 192, 512]) {
    await svgToPng(SVG_ICON, path.join(OUTPUT_DIR, `launcher-icon-${size}.png`), size);
  }
  console.log('   ✅ 48 / 72 / 96 / 144 / 192 / 512');
}

async function generateWebAndSplash() {
  console.log('🌐 Web + splash assets...');
  for (const size of [16, 32, 48]) {
    const out = path.join(OUTPUT_DIR, `favicon-${size}.png`);
    await svgToPng(SVG_ICON, out, size);
    if (size === 48) fs.copyFileSync(out, path.join(ASSETS_DIR, 'favicon.png'));
  }
  for (const size of [512, 1024]) {
    const out = path.join(OUTPUT_DIR, `splash-icon-${size}.png`);
    await svgToPng(SVG_LOGO, out, size);
    if (size === 512) fs.copyFileSync(out, path.join(ASSETS_DIR, 'splash-icon.png'));
  }
  console.log('   ✅ favicons (16/32/48) + splash-icon (512/1024)');
}

async function generateScreenshotTemplates() {
  console.log('📸 Screenshot templates...');
  for (const s of [{ name: 'phone', w: 1080, h: 1920 }, { name: 'tablet-7', w: 1920, h: 1080 }]) {
    await sharp({ create: { width: s.w, height: s.h, channels: 4, background: BRAND_DARK } })
      .png().toFile(path.join(OUTPUT_DIR, `screenshot-${s.name}-template.png`));
  }
  console.log('   ✅ phone (1080x1920) + tablet-7 (1920x1080)');
}

function writeReadme() {
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), `# Diet Plan — Play Store Assets

Generated by \`npm run generate-icons\` from \`assets/images/app-icon-modern.svg\` and \`app-logo.svg\`.

## Required for the listing
- App icon: \`icon-512.png\` (512x512)
- Feature graphic: \`feature-graphic.png\` (1024x500)
- At least 2 phone screenshots — replace \`screenshot-phone-template.png\` with real captures.
- Adaptive icons: \`android-icon-foreground.png\`, \`android-icon-background.png\`, \`android-icon-monochrome.png\`.

## Runtime icons (copied into assets/images/, referenced by app.json)
- \`icon.png\`, \`android-icon-foreground.png\`, \`splash-icon.png\`, \`favicon.png\`

Regenerate after editing the SVGs: \`npm run generate-icons\`.
Generated: ${new Date().toLocaleString()}
`);
  console.log('📄 README.md');
}

async function main() {
  if (!fs.existsSync(SVG_LOGO) || !fs.existsSync(SVG_ICON)) {
    console.error('❌ Missing SVG sources in assets/images/ (app-logo.svg, app-icon-modern.svg)');
    process.exit(1);
  }
  await generateAppIcon();
  await generateAdaptiveIcons();
  await generateFeatureGraphic();
  await generateLauncherIcons();
  await generateWebAndSplash();
  await generateScreenshotTemplates();
  writeReadme();
  console.log(`\n✨ Done. Output: ${OUTPUT_DIR}`);
}

main().catch((e) => { console.error('\n❌ Error:', e.message); process.exit(1); });
