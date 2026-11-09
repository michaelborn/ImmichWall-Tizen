#!/bin/sh
# Build, install, and launch ImmichWall on the target TV.
# TV_IP, TV_NAME, and public hostnames stay in the gitignored .env.
set -eu

cd "$(dirname "$0")/.."

ENV_FILE=${IMMICH_ENV_FILE:-.env}
if [ ! -f "$ENV_FILE" ]; then
    printf 'Missing %s. Copy .env.example to .env and set the TV and host values.\n' "$ENV_FILE" >&2
    exit 1
fi
set -a
. ./"$ENV_FILE"
set +a

: "${TV_IP:?Set TV_IP in .env}"
: "${TV_NAME:?Set TV_NAME in .env}"
: "${PAIRING_BASE_URL:?Set PAIRING_BASE_URL in .env}"
: "${IMMICH_SERVER_URL:?Set IMMICH_SERVER_URL in .env}"

mkdir -p output
rm -f output/ImmichWall.wgt
printf 'IMMICH_SERVER_URL=%s\nPAIRING_BASE_URL=%s\n' "$IMMICH_SERVER_URL" "$PAIRING_BASE_URL" > output/runtime-config.env

BASE_VERSION=$(tail -n +2 tizen/config.xml | sed -n 's/.*[^_]version="\([^"]*\)".*/\1/p' | head -1)
BUILD_VERSION="v${BASE_VERSION}+$(date -u +%Y%m%dT%H%M%SZ)"
printf 'Build version: %s\n' "$BUILD_VERSION"

BUILD_CONTEXT=$(mktemp -d)
cleanup() { rm -rf "$BUILD_CONTEXT"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir -p "$BUILD_CONTEXT/frontend" "$BUILD_CONTEXT/tizen" "$BUILD_CONTEXT/docker"
cp Dockerfile.tizen "$BUILD_CONTEXT/Dockerfile.tizen"
cp docker/package-tizen.sh "$BUILD_CONTEXT/docker/package-tizen.sh"
cp tizen/config.xml tizen/icon.png tizen/icon.svg tizen/tizen_web_project.yaml "$BUILD_CONTEXT/tizen/"
cp -R frontend/. "$BUILD_CONTEXT/frontend/"

PAIRING_BASE_URL="$PAIRING_BASE_URL" \
IMMICH_SERVER_URL="$IMMICH_SERVER_URL" \
BUILD_VERSION="$BUILD_VERSION" \
OUTPUT_FRONTEND="$BUILD_CONTEXT/frontend" \
node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = process.env.OUTPUT_FRONTEND;
    const runtime = {
        pairingBaseUrl: process.env.PAIRING_BASE_URL,
        defaultImmichServerUrl: process.env.IMMICH_SERVER_URL,
    };
    fs.writeFileSync(path.join(dir, "runtime-config.js"), "window.ImmichWallRuntimeConfig = " + JSON.stringify(runtime) + ";");
    fs.writeFileSync(path.join(dir, "build-version.js"), "window.ImmichWallBuildVersion = " + JSON.stringify(process.env.BUILD_VERSION) + ";");
'

docker build --platform linux/amd64 \
    --ulimit nofile=65536:65536 \
    -f "$BUILD_CONTEXT/Dockerfile.tizen" \
    -t immich-wall-builder "$BUILD_CONTEXT"

printf 'Building and installing on the TV…\n'
docker run --rm --platform linux/amd64 --network host \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/tizen-home \
    -e TV_IP="$TV_IP" \
    -e TV_NAME="$TV_NAME" \
    -v "$PWD/output:/output" \
    immich-wall-builder

printf 'Launching the app on the TV…\n'
docker run --rm --platform linux/amd64 --network host \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/tizen-home \
    -e TV_IP="$TV_IP" \
    -e TV_NAME="$TV_NAME" \
    --entrypoint /bin/bash \
    immich-wall-builder \
    -c 'sdb connect "$TV_IP" >/dev/null 2>&1 || true; tizen run -t "$TV_NAME" -p ImTvWall01.ImmichWall 2>&1 | tail -2'

printf 'Deploy finished.\n'
