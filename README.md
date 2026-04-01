# Qualia

Qualia is a Tauri desktop workplace for remote data-review operators. The app uses:

- Tauri v2 with a Rust backend
- React 19 + Tailwind v4 for the desktop UI
- Convex for realtime sessions, balances, task state, admin analytics, and AI review logs
- Groq for admin-triggered task generation and country-close AI reviews

## Local Setup

1. Install dependencies with `npm install`
2. Make sure Rust and Cargo are installed
3. Set `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` in `.env.local`
4. Run `npx convex codegen`
5. Start the app with `npm run tauri dev`

## Convex Environment

The deployed Convex backend expects these environment variables:

- `GROQ_API_KEY`
- `GROQ_MODEL`
- `SYSTEM_ADMIN_EMAIL`
- `IPINFO_TOKEN`

## Signed Auto Updates

Qualia is configured for Tauri updater v2 using signed update artifacts.

- Public updater key is embedded in [`src-tauri/tauri.conf.json`](C:\Users\USER\qualia\src-tauri\tauri.conf.json)
- Private signing key lives outside the repo at `C:\Users\USER\.tauri\qualia.updater.key`
- Release builds must set:
  - `TAURI_SIGNING_PRIVATE_KEY_PATH`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The app is currently configured to look for releases at:

- `https://github.com/okeymeta/qualia/releases/latest/download/latest.json`

That means remote updates can be shipped through GitHub Releases without running a separate update website, as long as each release publishes the signed updater artifacts and `latest.json`.

## GitHub Release Secrets

To ship signed desktop updates from GitHub Actions, add these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `VITE_CONVEX_URL`
- `CONVEX_DEPLOYMENT`
- `CONVEX_DEPLOY_KEY`

The release workflow lives at [`.github/workflows/release.yml`](C:\Users\USER\qualia\.github\workflows\release.yml) and publishes signed Windows installers plus `latest.json` for the built-in updater.
