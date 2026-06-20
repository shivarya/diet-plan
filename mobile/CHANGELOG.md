# Changelog

All notable changes to this project will be documented in this file.

The version + build number live in `release-version.json`; `npm run version:bump:production`
bumps the patch + versionCode and syncs them into `package.json`, `app.json` and the
Android `build.gradle`. Add an entry here for every feature/fix before bumping.

## [1.0.1] - 2026-06-18
First build submitted to Google Play (internal testing track).

### Fixed
- The **"Use dev login" button no longer appears in release builds** — it's a development-only control, now gated behind `__DEV__` (the server already rejected it in production).

### Google Play Notes
- First release: plan a high-protein, low-carb Indian week — choose veg / egg / non-veg per day, get roti/rice sides, dish photos, step-by-step recipes in 12 Indian languages, WhatsApp share, and (premium) AI plans + cook-from-ingredients.

## [1.0.0] - 2026-06-18
First public release — a high-protein, high-calcium, very-low-carb weekly Indian meal planner.

### Added
- **Weekly rule-based planner**: breakfast / lunch / dinner for all 7 days, scored for protein, calcium, vitamins and low carb, with per-dish shuffle and daily nutrition totals.
- **Per-day food rules**: choose the diet level for each weekday — **Veg / Egg / Non-veg** — plus no-onion / no-garlic toggles. Defaults stay vegetarian (egg on most days, no onion/garlic on Thursday).
- **Full non-veg support**: ~145 curated recipes including chicken, fish, prawn, mutton and egg mains alongside the vegetarian catalogue.
- **Roti / rice sides**: lunch and dinner pair the main dish with a bread or rice accompaniment, each independently shuffleable. Toggle off in Settings.
- **Optional meal slots**: opt into a **brunch** and an **evening snack** slot per the Settings toggles.
- **Kid add-on**: an extra kid-friendly dish per day when "kid at home" is on.
- **Dish photos**: every recipe shows a relevant photo, resolved once on the server and stored in the DB (shared by all users); a clean food-emoji tile is the fallback.
- **Recipe detail**: hero photo, ingredients, quick method, macro stats and dietary tags.
- **Step-by-step recipes in 12 Indian languages** (English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu) — AI-generated with quantities, numbered steps and tips, cached server-side so they're instant after the first view.
- **Share** a recipe (WhatsApp etc.) and a **"Watch on YouTube"** link (searches the dish).
- **Cook from ingredients (premium)**: enter what you have, pick the food type, and the AI suggests a healthy dish that respects your constraints.
- **AI weekly plan (premium)**: the AI selects from the curated catalogue; the server re-validates every pick against the day's rules.
- **Dark mode**: light / dark / auto with a modern neutral-dark palette.
- **Premium via email allowlist** and an **admin/curator role** (admins can set the correct recipe photo for everyone from the app) — both configured server-side, no billing yet.
- **Google Sign-In** with server-side ID-token verification.

### Google Play Notes
- Plan a full week of high-protein, low-carb Indian meals tailored to your diet — vegetarian, egg or non-veg, set per day.
- Indian-style meals pair curries with roti or rice, with optional brunch and evening-snack slots and a kid-friendly add-on.
- Every recipe has a photo, and you can get a detailed step-by-step recipe in 12 Indian languages.
- Share recipes to WhatsApp and jump to a YouTube how-to in a tap.
- Premium unlocks AI plan generation and "cook from what's in your kitchen".
