# Immich Wall

Immich Wall is a local desktop slideshow proof of concept plus an early Samsung Tizen Web App. Its purpose and intended behavior are documented in [PRODUCT.md](PRODUCT.md).

The Tizen app is a foreground slideshow; it does not replace Samsung's home screen, ambient mode, or system screensaver. The desktop POC is the easiest way to try the slideshow settings and controls before installing anything on a TV.

## Run the desktop POC

The desktop app opens with a connection screen for the Immich URL and API key. It does not preload the root `.env`; the key is sent to the local server over `/api/connect` and kept only in server memory for that process. It is not written to browser storage or disk. The server proxies Immich calls, so browser CORS is not required.

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173), enter the server URL and API key, and connect. The desktop POC supports all photos, favorites, or an album; rotation interval and fill/fit framing; Previous/Next/Pause; photo details on demand; fullscreen; and bounded retries that preserve the current photo when Immich is unavailable. Slideshow preferences are saved in browser local storage; restart the Node server to clear its in-memory API key.

Keyboard shortcuts: **←/→** Previous/Next, **Space** Pause/Resume, **S** Settings, **I** photo details, **F** Fullscreen. The key is not included in API URLs or response data.

Requires Node.js 20 or newer. `.env` remains available to the standalone API smoke test and opt-in live tests; the desktop server does not automatically load it. To explicitly opt into dotenv startup configuration later, run `IMMICH_ENV_FILE=.env npm start`.

## Try it on the TV without installing a package

Samsung TVs require signed `.wgt` packages; Developer Mode does not provide a supported certificate bypass. For certificate-free testing, leave the desktop server running and open its LAN URL in the TV's built-in browser:

```text
http://<desktop-LAN-IP>:4173
```

Replace `<desktop-LAN-IP>` with the computer's address on your local network. Keep the TV and desktop on the same LAN. This runs the slideshow in the browser rather than installing an app tile. The local server proxies Immich requests, so the TV does not need direct Immich access or CORS configuration.

## Run the tests

```sh
npm ci
npm run test:all
```

The default tests use a local mock Immich server and do not read the real API key. Playwright downloads Chromium on first setup with `npx playwright install chromium`. The optional live, read-only smoke test uses `.env` and should only be run explicitly:

```sh
LIVE_IMMICH=1 npm run test:live
```

## Build and install the Tizen app

The `.wgt` must be signed—Samsung TVs do not install unsigned packages. The Docker image includes the public Tizen **development/test profile** used by the Jellyfin Docker installer, so the basic local-testing path needs no personal certificate or DUID. It is a shared development identity, not a publishing certificate. Newer TV models/firmware may reject it and require a Samsung certificate bound to the TV.

The packager defaults to this `dev` profile. For the no-personal-certificate flow below, do not set `TIZEN_PROFILE`, `TIZEN_PROFILES_XML`, or mount certificate files.

Build the packager image:

```sh
docker build --platform linux/amd64 \
  --ulimit nofile=65536:65536 \
  -f Dockerfile.tizen \
  -t immich-wall-builder .
```

Build a signed WGT without connecting to the TV:

```sh
mkdir -p output
docker run --rm --platform linux/amd64 \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/tizen-home \
  -v "$PWD/output:/output" \
  immich-wall-builder
```

The result is `output/ImmichWall.wgt`.

### Install on the TV

Add `TV_IP` and `TV_NAME` to `.env` (copy the placeholders from `.env.example`; get `TV_NAME` from `sdb devices`), then deploy, install, and launch with one command:

```sh
npm run deploy
```

The script rebuilds the Tizen builder image on every run (so the package always matches the current `frontend/`), then builds, installs, and launches the app. The resulting artifact stays at `output/ImmichWall.wgt`. Keep the TV IP/model out of the repo; they live only in the gitignored `.env`.

If you prefer running the steps by hand, the same flow is:

1. Put the TV and desktop on the same LAN.
2. On the TV, open **Apps**, enter `12345`, enable **Developer Mode**, set the developer host IP to the desktop's LAN IP, and reboot if prompted.
3. Build and install with the container, replacing the example TV values:

   ```sh
   docker run --rm --platform linux/amd64 --network host \
     --user "$(id -u):$(id -g)" \
     -e HOME=/tmp/tizen-home \
     -e TV_IP="TV_IP_ADDRESS" \
     -e TV_NAME="YOUR_TV_DEVICE_NAME" \
     -v "$PWD/output:/output" \
     immich-wall-builder
   ```

   `TV_NAME` is the model/device name shown by `sdb devices`. The container rebuilds the package, connects, and installs it. It skips the Samsung `install-permit` step for the shared development profile. This flow has been verified to install on a physical TV.

If your TV rejects the shared development signature with a certificate error, use a Samsung TV certificate profile that includes its DUID. The DUID is under **Menu/Settings → Support → Contact Samsung → Unique Device ID** (some models show it under **Support → About This TV → Unique ID**). In that case, use the VS Code extension's Samsung signing/launch workflow or a Tizen Studio CLI-compatible profile. VS Code-managed certificate passwords may not work with the generic Docker CLI signer.

## First launch

- On the TV, open `https://immichwall.theborns.xyz/pair` on a phone or computer. Step 1: verify the five-digit PIN shown on the TV. Step 2: submit the Immich server URL and a read-only API key.
- The TV validates the connection directly with Immich and, on error, reports it back to the phone, where it appears in red; the connection details stay editable on the phone until pairing completes. The TV saves the connection in Samsung Tizen KeyManager, confirms pairing, and the pairing service erases the submitted key in memory; it never proxies Immich photo traffic.
- An unpaired TV shows only the pairing screen: the PIN refreshes automatically when it expires (no remote input needed), and no settings or other controls are reachable until pairing completes. During playback, right/OK skips ahead, left returns to the previous photo, and Up/Down opens the settings panel, which contains **Unpair**. The remote's **Play/Pause** key toggles rotation; separate Play and Pause keys resume or pause directly. On a keyboard, Space toggles pause.
- The Immich server/reverse proxy must allow CORS requests from the TV app, including the `x-api-key` header. The Tizen app permits the Immich hostname entered on the phone; a CORS or TLS error is shown on the TV.
- The phone page can correct the URL or key without another PIN until pairing completes. Pairing PINs expire after five minutes; active handoffs expire after one hour. Pending sessions are in memory, so after a service restart, start a new PIN.

See [PAIRING.md](PAIRING.md) for the protocol, service behavior, and future ideas.

## Project layout

- `frontend/`: the single shared frontend served to desktop browsers **and** compiled into the TV package. Capability differences (the local proxy vs direct Immich, the connect form vs PIN pairing, remote media keys) are handled at runtime by checking for the Tizen device API.
  - `frontend/state.js`: slideshow settings/history state
  - `frontend/connection.js`: connection driver (desktop proxy vs TV direct + KeyManager)
  - `frontend/input.js`: keyboard and TV remote key mapping
  - `frontend/pairing.js`: TV pairing API client
  - `frontend/app.js`: shared slideshow controller, settings drawer, and pairing lifecycle
- `tizen/`: TV packaging config only (`config.xml`, icon, Tizen project yaml)
- `pair/`: phone setup page at `/pair`
- `services/pairingService.mjs`: short-lived TV PIN sessions and handoffs
- `Dockerfile.server`: slim image for hosting the pairing/desktop server (runtime code only)
- `Dockerfile.tizen` / `docker/package-tizen.sh`: builds and signs the `.wgt` from `frontend/`
- `config/immich.js`: centralized Immich configuration and dotenv parsing
- `scripts/immich-poc.mjs`: local Node-based API/thumbnail smoke test

## References

- [Samsung: Tizen TV Web App configuration](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html?device=htv)
- [Samsung: Tizen Studio CLI for TV apps](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)
- [Samsung: Creating TV certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
- [Jellyfin Tizen build and deployment instructions](https://github.com/jellyfin/jellyfin-tizen)
