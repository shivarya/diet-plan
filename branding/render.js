// Renders the Play Store PNGs from the SVG masters in this folder:
//   node branding/render.js mobile/scripts/node_modules      (any node_modules with @resvg/resvg-js and sharp)
// play-icon-512.png: full-bleed 512×512 square (Play applies its own mask). thali-icon.svg is drawn on the 108×108
//   adaptive canvas, whose outer bleed the Play tile doesn't need, so it is cropped to the central 80×80 and the thali
//   fills about three quarters of the tile.
// feature-graphic.png: 1024×500, flattened to 24-bit (Play rejects alpha in feature graphics).
const path = require('path');
const fs = require('fs');
const modules = path.resolve(process.argv[2] || 'node_modules');
const { Resvg } = require(path.join(modules, '@resvg/resvg-js'));
const sharp = require(path.join(modules, 'sharp'));
const here = (f) => path.join(__dirname, f);
const render = (svg, width) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng();
const read = (f) => fs.readFileSync(here(f), 'utf8');

(async () => {
  const playIcon = read('thali-icon.svg').replace('viewBox="0 0 108 108"', 'viewBox="14 14 80 80"');
  await sharp(render(playIcon, 512)).png().toFile(here('play-icon-512.png')); // Play wants 32-bit (RGBA) here
  await sharp(render(read('feature-graphic.svg'), 1024)).flatten({ background: '#1E7D52' }).removeAlpha().png().toFile(here('feature-graphic.png'));
  console.log('Wrote play-icon-512.png and feature-graphic.png');
})();
