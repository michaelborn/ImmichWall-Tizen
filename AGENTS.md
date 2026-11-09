# ImmichWall Agent Guide

## Product and UX

- ImmichWall is a calm, full-screen photo frame for a self-hosted Immich library; keep photos primary and controls unobtrusive.
- Desktop web and Tizen use the single shared frontend in `frontend/`. Detect Tizen capabilities at runtime; do not fork the slideshow or settings UI.
- TV setup is PIN-pairing only. Never show URL/API-key entry on the TV; the phone/computer `/pair` page verifies the PIN first, then collects the Immich URL and read-only API key.
- PINs expire after 5 minutes; five wrong attempts block that browser/IP fingerprint for 15 minutes. Handoffs last 1 hour, support corrected details, and erase pending credentials after TV acknowledgement.
- The TV validates and requests photos directly from Immich. The desktop app uses the local Node proxy.
- TV credentials use Samsung KeyManager when present; local WebApp storage is a compatibility fallback. Unpair clears the stored connection.
- Settings shared by desktop and TV: source (All/Favorites/Album), interval (10s, 30s, 1m, 5m, 10m, 30m, 60m), and Cover/Contain framing.
- Keep the current image visible through Immich/network failures; retry with backoff and show a clear warning.
- TV input: Left/Right previous/next, Up/Down settings, Play/Pause media keys pause/resume. Pairing screen refreshes expired PINs automatically and has no settings controls.

## Architecture and constraints

- `frontend/` is the source of the desktop UI and the Tizen package. Tizen packaging copies these files beside `tizen/config.xml`; keep runtime features in this shared frontend.
- `frontend/connection.js` owns the two data drivers. Desktop uses `/api/*`; Tizen calls Immich directly through XHR and KeyManager.
- Use Immich `POST /api/search/random` with album/Favorites filters. Keep the paginated `/api/search/metadata` fallback for older servers; preserve random selection across the full result set and avoid immediate repeats.
- `services/`, `controllers/`, and `routes/` implement the Express server and in-memory pairing lifecycle. Never return or log API keys.
- Deployment-specific URLs and TV identifiers belong in the gitignored `.env` (`IMMICH_SERVER_URL`, `PAIRING_BASE_URL`, `TV_IP`, `TV_NAME`). Never hardcode household hostnames or device identifiers in tracked files. The deploy script injects public URLs into the Tizen build; the server container receives only public URL configuration, not the Immich key.
- Keep JavaScript shipped to Tizen ES2019-safe: no nullish coalescing (`??`), optional chaining (`?.`), or optional catch binding. `npm run check` enforces this.

## Build and verification

- `npm ci` — install dependencies (Node.js 20+).
- `npm run check` — syntax, asset, Tizen XML, and TV syntax checks.
- `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` — targeted suites.
- `npm run test:all` — required full verification.
- `npm run screenshots` — regenerate the mock-based, face-free README screenshots.
- `npm run deploy` — build, install, and launch the Tizen app using `.env`; each WGT gets a timestamped build version. It also generates `output/runtime-config.env` for the SWAG server.

When changing shared UI, cover both desktop and TV capability modes in Playwright. Use only mock/abstract imagery in documentation screenshots; never capture personal Immich photos.
