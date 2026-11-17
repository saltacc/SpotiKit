#!/bin/bash
# Locally re-sign a complete Spotify bundle after modifying its resources.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
    echo "Local Spotify signing requires macOS." >&2
    exit 1
fi
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 /absolute/path/to/Spotify.app" >&2
    exit 2
fi

task_app="$(cd "$1" && pwd -P)"
task_executable="$task_app/Contents/MacOS/Spotify"
task_framework="$task_app/Contents/Frameworks/Chromium Embedded Framework.framework"
if [[ "$task_app" != *.app ]] || [ ! -f "$task_executable" ] ||
   [ ! -f "$task_app/Contents/Resources/Apps/xpui.spa" ] || [ ! -d "$task_framework" ]; then
    echo "Choose a complete Spotify .app bundle, including its frameworks." >&2
    echo "The partial bin/macos-dev fixture cannot run Spotify." >&2
    exit 2
fi

for task_pid in $(/usr/sbin/lsof -t "$task_executable" 2>/dev/null || true); do
    # Spotlight and signature scanners can also briefly open a copied binary.
    if [ "$(/bin/ps -p "$task_pid" -o comm=)" = "$task_executable" ]; then
        echo "Quit this Spotify copy before signing it." >&2
        exit 1
    fi
done

task_repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$task_repo/bin/macos-signing"
task_work="$(mktemp -d "$task_repo/bin/macos-signing/sign.XXXXXX")"
task_entitlements="$task_work/entitlements.plist"

# Keep the exact pre-sign bundle so its original signature can be recovered.
/usr/bin/ditto "$task_app" "$task_work/Spotify.before-signing.app"
echo "Pre-sign backup: $task_work/Spotify.before-signing.app"
/usr/bin/codesign -d --entitlements :- "$task_app" > "$task_entitlements" 2> "$task_work/read-signature.log"
/usr/bin/plutil -lint "$task_entitlements" >/dev/null

# Ad-hoc signing removes the main executable's Spotify Team ID. Keep its
# existing entitlements and allow loading the still vendor-signed CEF framework.
task_key="com.apple.security.cs.disable-library-validation"
if ! /usr/libexec/PlistBuddy -c "Set :$task_key true" "$task_entitlements" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :$task_key bool true" "$task_entitlements"
fi

if /usr/bin/codesign --force --sign - --preserve-metadata=identifier,flags,runtime \
       --entitlements "$task_entitlements" "$task_app" &&
   /usr/bin/codesign --verify --deep --strict --verbose=2 "$task_app" \
       > "$task_work/verification.log" 2>&1; then
    echo "Local ad-hoc signature verified, including nested frameworks and helpers."
    echo "Signed app: $task_app"
else
    echo "Signing or verification failed. Details: $task_work" >&2
    echo "The pre-sign bundle is preserved at $task_work/Spotify.before-signing.app" >&2
    exit 1
fi
