# Immich Wall Product Definition

## Purpose

Immich Wall turns a Samsung Tizen TV (plus a desktop web browser) into a calm picture frame for a self-hosted Immich library. Photos should feel present in the room; the app is not a media browser, dashboard, or social feed.

## Principles

- **Calm by default:** photos are the focus; controls and metadata stay out of the way during playback.
- **Local and private:** photos come only from the user's own Immich instance. Credentials are never embedded in the package, and the TV stores its connection in Samsung KeyManager.
- **Remote-first:** after setup, the TV app is fully driven by the remote.
- **Predictable:** rotation, navigation, and failure recovery never blank the screen or silently swap the current photo.
- **Simple setup:** connecting a TV should not require typing credentials on the TV.

## How the TV app works

1. On first launch the TV shows a five-digit PIN and the pairing URL (`https://immichwall.theborns.xyz/pair`).
2. On a phone, step 1 verifies the PIN; step 2 submits the Immich server URL and a read-only API key. No Immich username/password is ever requested.
3. The TV validates image-search access directly with Immich, saves the connection in Samsung KeyManager, and acknowledges the pairing service, which then erases the submitted credentials from memory. The service never proxies TV photo traffic.
5. The slideshow rotates automatically on a configurable interval shared with the desktop app (10 s, 30 s, 1 m, 5 m, 10 m, 30 m, or 60 m; default 5 minutes) with a slow cross-fade; photos come straight from Immich.
5. Remote controls: right/OK or the arrow-advance jumps to a new photo, left shows the previous one, Up/Down opens a settings panel containing Unpair, and the Play/Pause (or separate Play/Pause) media keys pause and resume rotation.
6. Immich outages keep the current photo on screen with an on-screen message instead of blanking or rotating away.

The pairing PIN expires after five minutes; the phone's one-hour correction window survives server restarts only while that process runs. Unpair removes the KeyManager entry and starts pairing over.

## Desktop web app

The desktop app (served by the same local Node server) keeps a manual connection screen: the user types the server URL and an API key, which stays in server memory; the server proxies Immich requests so the browser needs no CORS. It supports all photos, favorites, or a specific album, configurable interval and framing, previous/next/pause, photo details, fullscreen, and bounded retry with backoff.

## API key scope

Use a read-only API key limited to `asset.read` and `album.read` permissions; the app only searches images, lists albums, and downloads thumbnails.

## Out of scope for v1

- Browsing/searching the Immich timeline by text or people
- Upload, edit, delete, or download from the TV
- Replacing Samsung's home screen, ambient mode, or screensaver
- Multi-user accounts, QR pairing, and service-managed per-TV API keys (possible v2 work)

## Success criteria

A household member pairs the TV once, chooses nothing further, and the TV displays personal photos for hours with no visible controls, no blank frames, no repeated photos back-to-back, and no runaway Immich traffic.
