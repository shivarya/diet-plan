# Diet Plan branding

The native app's logo, **Thali Week**: a brass-rimmed thali holding seven katoris, one for each day of the week
(dal, palak, tomato, raita, beetroot, gajar, sabzi), around a leaf, on the brand green `#1E7D52` → `#2E9A66`.

| File | What it is |
|------|------------|
| `thali-icon.svg` | Master icon on the 108×108 adaptive-icon canvas (full-bleed green square, thali inside the 66dp safe zone) |
| `thali-mark.svg` | The thali alone (transparent background), cropped to its bounds |
| `feature-graphic.svg` | Google Play feature graphic (1024×500), set in Segoe UI |
| `play-icon-512.png`, `feature-graphic.png` | Rendered Play Store uploads — regenerate with `render.js` |

Render the PNGs (uses the resvg and sharp copies installed for the legacy app's icon script):

```bash
node branding/render.js mobile/scripts/node_modules
```

The feature graphic's text uses the system's Segoe UI (Windows). Rendering elsewhere substitutes a fallback font,
so check the PNG before uploading it.

The Android app draws the logo from vectors, not these files — change them together:

- `android/app/src/main/res/drawable/ic_launcher_foreground.xml` — the thali on the adaptive canvas; also the splash
  icon (`themes.xml`) and the welcome-screen logo
- `android/app/src/main/res/drawable/ic_launcher_background.xml` — the green gradient layer
- `android/app/src/main/res/drawable/ic_launcher_monochrome.xml` — the themed (Material You) icon: rim, katoris and
  leaf in one colour

The legacy React Native app (`mobile/`) keeps its old plate-and-leaf icon and its own generator
(`mobile/scripts/generate-icons.js`, output in `mobile/play-store-assets/`).
