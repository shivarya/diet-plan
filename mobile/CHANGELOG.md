# Changelog

All notable changes to this project will be documented in this file.

The version + build number live in `release-version.json`; `npm run version:bump:production`
bumps the patch + versionCode and syncs them into `package.json`, `app.json` and the
Android `build.gradle`. Add an entry here for every feature/fix before bumping.

## [1.0.5] - 2026-08-14

### Fixed (server)
- **Plan tab shuffle no longer cycles back to a recipe it just showed you.** `shuffleItem()` only ever excluded recipes currently sitting elsewhere in the week's plan — the instant a dish was shuffled away it became eligible again immediately, and since the top-scored shortlist barely changes between calls, a handful of taps would loop back to something you'd just seen. Each plan slot now remembers its last few shuffled-away recipes (new `meal_plan_items.shuffle_history` column) and excludes them too.
- **"Veg" could still surface a recipe containing egg.** A recipe's `food_type` (the diet filter's source of truth) and its `contains_egg` flag are judged independently during recipe import and had drifted apart for 17 recipes in the catalogue — tagged `food_type: veg` despite containing egg. The hard filter now also checks `contains_egg` directly (not just `food_type`), so drift like this can't slip an egg dish past a strict veg day again; the 17 already-mistagged recipes have also been corrected in the database.

### Google Play Notes
- Fixed: shuffling a dish repeatedly on the Plan tab could loop back to something you'd just seen — you should now see genuinely fresh options each time.
- Fixed: a small number of recipes miscategorized as vegetarian could appear on a strict veg day; corrected the data and hardened the filter.

## [1.0.4] - 2026-08-14

### Changed
- **Cook from ingredients now suggests 5 dishes instead of 2–3**, shown as a compact list (name, meta, twist) — tap one to open its full recipe (ingredients, steps, tips). Previously all 2–3 dishes rendered fully expanded on one long page.
- **Browse tab filter chips** (category and veg/egg/non-veg) no longer clip their labels. Switched from a fixed-height horizontal scroll list to the same content-driven, wrapping chip layout already used on the Cook AI tab — category chips now wrap onto two rows instead of requiring a horizontal scroll.

### Fixed (server)
- Asking Groq for 5 full recipes in one JSON response occasionally failed the model's own JSON-schema validation (`json_validate_failed`) — a per-attempt generation hiccup, not a bad request — and that specific failure was never retried, so "Could not generate a dish" showed up more often than it should. `AIClient::chatCompletion()` now retries on it (same backoff as rate limits) and takes a `maxTokens` override so the ingredients endpoint can ask for more headroom (6000 vs. the 4000 default) for the larger payload.

### Google Play Notes
- Cook from ingredients now gives you 5 recipe ideas to pick from — tap one to see the full recipe.
- Fixed Browse tab filter labels not showing on some devices.

## [1.0.3] - 2026-07-16

### Added
- **"Prioritize healthy recipes" toggle** (Settings → Daily targets). Turn it off to stop the weekly plan and dish shuffle from favoring high-protein/low-carb/weight-loss-tagged dishes — useful now that the catalogue includes a much wider variety of recipes (desserts, foreign dishes, off-beat picks) beyond the health-optimized defaults. Diet rules (veg/egg/non-veg, onion/garlic) are unaffected either way.
- **New "Browse" tab** — search and filter every recipe in the catalogue directly (by category including a new Dessert filter, and veg/egg/non-veg), independent of the auto-generated weekly plan. Tap any result to open its full recipe detail.
- **Dessert recipes** now get their own category instead of being lumped in with savory snacks.

### Changed
- **YouTube-sourced recipes' "Watch" button and share link** now include the source channel name in the search, so that creator's own video ranks at the top of results.

### Google Play Notes
- New "Prioritize healthy recipes" toggle in Settings — turn it off to see the full recipe catalogue (including desserts and off-beat dishes) in your plan and shuffles, not just the health-optimized picks.
- New Browse tab: search and filter every recipe in the catalogue, including a new Desserts category.
- Recipes imported from YouTube now link straight to that creator's channel when you tap Watch.

## [1.0.2] - 2026-06-21

### Added
- **Bigger recipe catalogue (≈145 → ≈187 dishes).** Filled out the everyday vegetarian mains — ~28 breakfasts, ~33 lunches and ~32 dinners — plus more egg mains for egg days and a few extra breads/rice and non-veg dishes, so a full month can run without the same dish coming back.
- **Weekly plan now shows the date for each day** and **starts on the current day** — today is the first card (tagged "Today"), then the next six days, each with its calendar date.
- **Dal lunches per week** (new Settings control, default 3). Choose how many lunches each week should be a dal/legume dish (dal, sambar, kadhi, rajma, chana…); the planner reserves that many lunches, spreads them across the week, and respects each day's veg/egg + onion/garlic rules.

### Changed
- **Cook from ingredients (premium) is now a full recipe designer.** Beyond the ingredient list and veg/egg/non-veg + no-onion/garlic, you can now set the **meal, servings, time available, cuisine style, spice level, cooking equipment**, an **output language** (any of the 12 Indian languages), and a free-text "anything special" note (e.g. *give it a twist, make it unique, extra protein*). The AI returns **2–3 distinct dishes**, each with a creative twist, **quantified ingredients, numbered steps, tips and approximate macros** — and respects every preference and dietary constraint.
- **Less repetition across weeks.** The planner now remembers dishes from your recent weeks and rotates through the catalogue, so meals stay varied over a month instead of repeating every week.

### Google Play Notes
- The weekly plan now starts on today and shows the date for each day.
- New "dal lunches per week" setting — pick how often you want dal (default 3).
- Many more recipes and smarter variety — far fewer repeats across the month.
- Cook from ingredients got a big upgrade: tell it the meal, servings, time, cuisine, spice, equipment, language and any special wish, and premium AI returns 2–3 unique dishes with full step-by-step recipes.

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
