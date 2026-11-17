#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This development launcher requires macOS." >&2
    exit 1
fi

task_repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
task_dev_dir="$task_repo_dir/bin/macos-dev"
task_full=false
case "${1:-}" in
    --full-bundle) task_full=true; task_dev_dir="$task_repo_dir/bin/macos-full-dev" ;;
    "") ;;
    *) echo "Usage: $0 [--full-bundle]" >&2; exit 2 ;;
esac
case "$(uname -m)" in
    arm64) task_rid=osx-arm64 ;;
    x86_64) task_rid=osx-x64 ;;
    *) echo "Unsupported Mac architecture." >&2; exit 1 ;;
esac

mkdir -p "$task_dev_dir/data" "$task_dev_dir/spotify-local"
task_client="${SPOTIKIT_DEV_TARGET:-$task_dev_dir/Spotify.app}"
if [ -n "${SPOTIKIT_DEV_TARGET:-}" ]; then
    if ! $task_full || [ ! -f "$task_client/Contents/Resources/Apps/xpui.spa" ]; then
        echo "SPOTIKIT_DEV_TARGET requires --full-bundle and an existing complete Spotify .app." >&2
        exit 2
    fi
fi
if [ ! -f "$task_client/Contents/Resources/Apps/xpui.spa" ]; then
    task_source="${SPOTIKIT_DEV_SOURCE:-}"
    if [ -z "$task_source" ]; then
        for task_candidate in /Applications/Spotify.app "$HOME/Applications/Spotify.app"; do
            if [ -f "$task_candidate/Contents/Resources/Apps/xpui.spa" ]; then
                task_source="$task_candidate"
                break
            fi
        done
    fi
    if [ -n "$task_source" ]; then
        task_stage="$(mktemp -d "$task_dev_dir/client.XXXXXX")"
        trap 'rm -rf "$task_stage"' EXIT
        if $task_full; then
            if [ ! -d "$task_source/Contents/Frameworks/Chromium Embedded Framework.framework" ]; then
                echo "Full development mode needs a complete Spotify bundle with its frameworks." >&2
                exit 1
            fi
            /usr/bin/ditto "$task_source" "$task_stage/Spotify.app"
        else
            mkdir -p "$task_stage/Spotify.app/Contents/Resources/Apps" "$task_stage/Spotify.app/Contents/MacOS"
            cp -p "$task_source/Contents/Info.plist" "$task_stage/Spotify.app/Contents/Info.plist"
            cp -p "$task_source/Contents/MacOS/Spotify" "$task_stage/Spotify.app/Contents/MacOS/Spotify"
            cp -p "$task_source/Contents/Resources/Apps/xpui.spa" "$task_stage/Spotify.app/Contents/Resources/Apps/xpui.spa"
        fi
        mv "$task_stage/Spotify.app" "$task_client"
        rmdir "$task_stage"
        trap - EXIT
        echo "Prepared the Spotify development copy at $task_client."
    else
        echo "Spotify was not found. The development UI will show that no client is installed."
    fi
fi

if $task_full && [ -f "$task_client/Contents/Resources/Apps/xpui.spa" ] && \
   [ ! -d "$task_client/Contents/Frameworks/Chromium Embedded Framework.framework" ]; then
    echo "The development target is incomplete. Choose a complete Spotify .app with its frameworks." >&2
    exit 1
fi

if [ ! -f "$task_dev_dir/data/settings.json" ]; then
    cat > "$task_dev_dir/data/settings.json" <<'JSON'
{
  "Version": 3,
  "LaunchSpotifyAfterInstall": false,
  "CheckForUpdates": false,
  "RunInBackground": false,
  "UpdateMode": "All"
}
JSON
fi

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export SPOTIKIT_DATA_DIR="$task_dev_dir/data"
export SPOTIKIT_SPOTIFY_DIR="$task_client/Contents/Resources"
export SPOTIKIT_SPOTIFY_LOCAL_DIR="$task_dev_dir/spotify-local"
if $task_full; then
    export SPOTIKIT_FULL_BUNDLE_DEV=1
    echo "Starting SpotiKit with a complete development bundle ($task_rid)."
    echo "Install and signing target this copy. Spotify itself uses your normal Spotify profile when launched."
else
    export SPOTIKIT_FULL_BUNDLE_DEV=0
    echo "Starting SpotiKit in archive sandbox mode ($task_rid). Spotify is not launched."
fi
task_app="$("$task_repo_dir/tools/macos/build-dev-app.sh" "$task_rid")"
exec "$task_app/Contents/MacOS/SpotiKit"
