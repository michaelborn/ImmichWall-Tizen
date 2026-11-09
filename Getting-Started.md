# Getting Started

This guide takes ImmichWall from a fresh checkout to an installed, paired TV. See [README.md](README.md) for the feature list and verified versions.

## Prerequisites

- Node.js 20 or newer and npm
- Docker
- A Samsung Tizen TV with Developer Mode enabled for sideloading
- An Immich server reachable from the TV
- A dedicated read-only Immich API key with asset-read and album-read permissions
- DNS and a trusted HTTPS certificate for the pairing host

## Configure `.env`

Copy the example file and provide values for this installation:

```sh
cp .env.example .env
```

Set these variables in `.env`:

```dotenv
PAIRING_BASE_URL=https://<your-pairing-host>
IMMICH_SERVER_URL=https://<your-immich-host>
TV_IP=<tv-lan-ip>
TV_NAME=<device-name-from-sdb>
```

`IMMICH_API_KEY` is optional for the app; the key is entered on the phone during pairing. The TV IP/name and hostnames stay in the gitignored `.env`; do not commit that file.

## Start the pairing service

The phone's `/pair` page and pairing API are served by the Node server. Make the host in `PAIRING_BASE_URL` reverse-proxy to this server on port `4173`, using HTTPS at the proxy.

For a local development session:

```sh
npm ci
npm start
```

For a Docker/SWAG deployment, build the slim runtime image:

```sh
docker build -f Dockerfile.server -t immichwall-server .
```

Run it on the same Docker network as the reverse proxy, with `output/runtime-config.env` as its env file after the deploy step below. The generated file contains only `PAIRING_BASE_URL` and `IMMICH_SERVER_URL` — not the Immich key or TV address.

Example SWAG service configuration:

```yaml
immichwall:
  build:
    context: /path/to/ImmichWall
    dockerfile: Dockerfile.server
  image: immichwall-server
  env_file:
    - /path/to/ImmichWall/output/runtime-config.env
  environment:
    HOST: 0.0.0.0
    IMMICH_API_KEY: ""
  networks:
    - proxy
  restart: unless-stopped
```

In SWAG, proxy the configured pairing hostname to `http://immichwall:4173`. The Immich host/reverse proxy must allow the TV app's cross-origin requests with the `x-api-key` header because TV photo traffic goes directly to Immich.

## Build, install, and pair the TV

1. Put the TV and build machine on the same LAN.
2. On the TV, open **Apps**, enter `12345`, enable **Developer Mode**, set the developer host to the build machine's LAN IP, and reboot if prompted.
3. Run:

   ```sh
   npm run deploy
   ```

   This builds/signs `output/ImmichWall.wgt`, installs it using `TV_IP` and `TV_NAME` from `.env`, and launches it. It also generates `output/runtime-config.env` for the server container.

4. If using SWAG, start/rebuild the Node service after the runtime-config file is generated:

   ```sh
   docker compose up -d --build immichwall
   ```

5. On the TV, note the PIN. On your phone/computer, open the pairing URL displayed by the TV. Verify the PIN on step 1, then enter the Immich URL and API key on step 2. The TV validates the connection, saves it in KeyManager when available (or app storage as a compatibility fallback), and starts the slideshow.

The PIN refreshes automatically if it expires. The TV never asks you to enter a URL or API key with the remote. Unpair is in the playback Settings drawer.

## Local desktop use

Run `npm start`, open `http://127.0.0.1:4173`, and enter an Immich URL and read-only key. The key stays in the Node server's memory and the local server proxies Immich requests. For a physical TV's built-in browser, the same shared frontend can be opened at the server's LAN URL.

## Verify and refresh screenshots

```sh
npm run test:all
npm run screenshots
```

The automated suite uses mock assets (no personal photos or credentials). The screenshot command recreates the setup and settings images under `docs/screenshots/` with a PIN and an abstract, face-free background.
