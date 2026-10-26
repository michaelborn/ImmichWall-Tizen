# Immich Wall

Immich Wall is a local desktop slideshow proof of concept plus an early Samsung Tizen Web App. Its purpose and intended behavior are documented in [PRODUCT.md](PRODUCT.md).

The Tizen app is a foreground slideshow; it does not replace Samsung's home screen, ambient mode, or system screensaver. The desktop POC is the easiest way to try the slideshow settings and controls before installing anything on a TV.

## Run the desktop POC

The local Node server reads the root `.env` and proxies Immich API calls, so the API key stays server-side and browser CORS is not required.

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The desktop POC supports all photos, favorites, or an album; rotation interval and fill/fit framing; Previous/Next/Pause; photo details on demand; fullscreen; and bounded retries that preserve the current photo when Immich is unavailable. Preferences are saved in browser local storage.

Keyboard shortcuts: **←/→** Previous/Next, **Space** Pause/Resume, **S** Settings, **I** photo details, **F** Fullscreen. The API key from `.env` is never sent to the browser.

Requires Node.js 20 or newer. Keep `.env` local; it is ignored by Git and Docker build context.

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

See [TESTING.md](TESTING.md) for coverage goals, test cases, and deployment checks.

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

1. Put the TV and computer on the same LAN.
2. On the TV, open **Apps**, enter `12345`, enable **Developer Mode**, set the developer host IP to the computer's LAN IP, and reboot if prompted.
3. Connect and install in one command, replacing the example TV values:

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

- Enter the Immich API key on the TV. The app is configured for `https://immich.theborns.xyz` and asks Immich for a random image every 30 seconds.
- Use the **Next** button or Enter/right on the remote to skip. Use **Settings** or `S` to change the API key.
- The key is saved in the app's local storage so it survives app restarts. It is not embedded in `.wgt`; anyone with access to the TV/app data could recover it, so use a read-only Immich key.
- Immich must allow the TV app's cross-origin requests. Tizen's `<access>` policy is scoped to the configured Immich hostname, but the Immich server/reverse proxy must also allow CORS requests including the `x-api-key` header. A CORS or TLS error is shown on screen.

## Project layout

- `tizen/`: Tizen Web App source and `config.xml`
- `desktop/`: desktop slideshow UI and controls
- `scripts/desktop-server.mjs`: local API proxy and static server
- `Dockerfile.tizen`: official Tizen Studio Web CLI builder image
- `docker/package-tizen.sh`: build, sign, and optionally install the `.wgt`
- `scripts/immich-poc.mjs`: local Node-based API/thumbnail smoke test

## References

- [Samsung: Tizen TV Web App configuration](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html?device=htv)
- [Samsung: Tizen Studio CLI for TV apps](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)
- [Samsung: Creating TV certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
- [Jellyfin Tizen build and deployment instructions](https://github.com/jellyfin/jellyfin-tizen)
