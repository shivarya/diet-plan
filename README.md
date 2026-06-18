# Diet Plan

Weekly meal planner for weight loss — high-protein, high-calcium, very low carb, Indian + Indian-twist food. Rule-based planning free; AI-generated plans (Groq) and "cook from ingredients" behind a premium flag.

## Structure

| Folder | Stack | Purpose |
|--------|-------|---------|
| `server/` | PHP 8.4 + MySQL | REST API, deployed at `https://shivarya.dev/diet_plan/` |
| `mobile/` | React Native 0.81 + Expo 54 | Android app |

## Key features

- Vegetarian; egg allowed except Tue/Thu/Sat (default, editable per day)
- No onion/garlic on Thursday by default; any day's rules are editable in Settings
- Kid add-on dish per day (optional toggle)
- Shuffle any meal for an alternative that still satisfies that day's rules
- Premium: AI-generated weekly plan (Groq Llama 3.3 70B) + cook from ingredients

## Deployment

| Target | Doc |
|--------|-----|
| PHP API → cPanel | [server/CPANEL_DEPLOYMENT.md](server/CPANEL_DEPLOYMENT.md) |
| Android app → Play Store | [mobile/DEPLOYMENT.md](mobile/DEPLOYMENT.md) |

## Local development

See [CLAUDE.md](CLAUDE.md) or the `diet-dev` skill for the full local setup.

**Quick start:**
```powershell
# 1. Start the API (bind all IPv4 for adb reverse tunnel)
cd server ; php -S 0.0.0.0:8000

# 2. Tunnel the API to the Android emulator
adb reverse tcp:8000 tcp:8000

# 3. Start the app
cd mobile ; npm run android
```

## Environment variables

Copy `server/.env.example` → `server/.env` and fill in:

| Variable | Notes |
|----------|-------|
| `DB_*` | MySQL connection |
| `JWT_SECRET` | Long random secret |
| `ALLOW_DEV_LOGIN` | `true` locally for dev login (no Google needed) |
| `GOOGLE_CLIENT_ID` | Google Web client ID for Sign-In |
| `GROQ_API_KEY` | Free tier key from [console.groq.com](https://console.groq.com) — optional; without it AI features fall back to rule engine |
