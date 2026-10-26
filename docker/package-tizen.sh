#!/bin/sh
set -eu

profile_name=${TIZEN_PROFILE:-dev}
profiles_xml=${TIZEN_PROFILES_XML:-}

if [ -z "$profiles_xml" ] && [ -n "${TIZEN_PROFILE:-}" ] && [ -n "${HOST_HOME:-}" ]; then
    for candidate in \
        "${HOST_HOME}/tizen-studio-data/profile/profiles.xml" \
        "${HOST_HOME}/.tizen-studio-data/profile/profiles.xml" \
        "${HOST_HOME}/.tizen-extension-platform/server/sdktools/sdk-data/profile/profiles.xml"; do
        if [ -r "$candidate" ]; then
            profiles_xml=$candidate
            break
        fi
    done
fi
if [ -z "$profiles_xml" ]; then
    profiles_xml=/home/developer/tizen-studio-data/profile/profiles.xml
fi
if [ ! -r "$profiles_xml" ]; then
    printf 'Certificate profiles not readable: %s\n' "$profiles_xml" >&2
    printf 'Set TIZEN_PROFILES_XML to your Tizen Studio profiles.xml path.\n' >&2
    exit 1
fi

mkdir -p /output
mkdir -p "$HOME"
project_dir=$(mktemp -d /tmp/immich-wall.XXXXXX)
trap 'rm -rf "$project_dir"' EXIT INT TERM
cp -R /app/. "$project_dir/"
cd "$project_dir"

tizen cli-config "default.profiles.path=${profiles_xml}"
tizen build-web
mkdir "$project_dir/package"
tizen package -t wgt -s "$profile_name" -o "$project_dir/package" -- .buildResult

set -- "$project_dir"/package/*.wgt
if [ ! -f "$1" ]; then
    printf 'Tizen CLI did not produce a .wgt package.\n' >&2
    exit 1
fi
mv "$1" /output/ImmichWall.wgt
printf 'Created /output/ImmichWall.wgt\n'

if [ -n "${TV_IP:-}" ]; then
    : "${TV_NAME:?Set TV_NAME to the target shown by sdb devices}"
    sdb connect "$TV_IP"
    if [ "$profile_name" != dev ]; then
        tizen install-permit -t "$TV_NAME"
    fi
    tizen install -n /output/ImmichWall.wgt -t "$TV_NAME"
fi
