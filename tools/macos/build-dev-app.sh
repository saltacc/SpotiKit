#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
    echo "Building the Mac development app requires macOS." >&2
    exit 1
fi

task_repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
task_rid="${1:-}"
if [ -z "$task_rid" ]; then
    case "$(uname -m)" in
        arm64) task_rid=osx-arm64 ;;
        x86_64) task_rid=osx-x64 ;;
    esac
fi
case "$task_rid" in
    osx-arm64|osx-x64) ;;
    *) echo "Usage: $0 [osx-arm64|osx-x64]" >&2; exit 2 ;;
esac

task_cached_sdk="$HOME/Library/Caches/SpotiKit-dev/dotnet"
if command -v dotnet >/dev/null 2>&1; then
    task_dotnet="$(command -v dotnet)"
elif [ -x "$task_cached_sdk/dotnet" ]; then
    task_dotnet="$task_cached_sdk/dotnet"
    export DOTNET_ROOT="$task_cached_sdk"
else
    echo "Install the .NET 10 SDK, then run this script again." >&2
    exit 1
fi

task_output="$task_repo_dir/bin/macos-app/$task_rid"
task_app="$task_output/SpotiKit.app"
if [ -f "$task_app/Contents/MacOS/SpotiKit" ] && \
   /usr/sbin/lsof -t "$task_app/Contents/MacOS/SpotiKit" >/dev/null 2>&1; then
    echo "Quit the existing SpotiKit development app before rebuilding it." >&2
    exit 1
fi
mkdir -p "$task_output"
task_stage="$(mktemp -d "$task_output/build.XXXXXX")"
trap 'rm -rf "$task_stage"' EXIT

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
"$task_dotnet" publish "$task_repo_dir/SpotiKit.csproj" \
    --configuration Debug --runtime "$task_rid" --self-contained true \
    -p:PublishReadyToRun=false --output "$task_stage/publish" >&2
task_version="$("$task_dotnet" msbuild "$task_repo_dir/SpotiKit.csproj" -nologo -getProperty:Version)"
task_bundle_version="${task_version%%[-+]*}"

task_staged_app="$task_stage/SpotiKit.app"
mkdir -p "$task_staged_app/Contents/MacOS" "$task_staged_app/Contents/Resources"
/usr/bin/ditto "$task_stage/publish" "$task_staged_app/Contents/MacOS"
cp "$task_repo_dir/LICENSE" "$task_repo_dir/THIRD-PARTY-NOTICES.md" "$task_staged_app/Contents/Resources/"
/usr/bin/ditto "$task_repo_dir/LICENSES" "$task_staged_app/Contents/Resources/LICENSES"
cp "$task_repo_dir/tools/macos/Info.plist" "$task_staged_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $task_bundle_version" "$task_staged_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $task_bundle_version" "$task_staged_app/Contents/Info.plist"
printf 'APPL????' > "$task_staged_app/Contents/PkgInfo"

# Reuse the existing logo, with the standard macOS icon sizes and Retina variants.
task_iconset="$task_stage/SpotiKit.iconset"
mkdir "$task_iconset"
for task_size in 16 32 128 256 512; do
    /usr/bin/sips -z "$task_size" "$task_size" "$task_repo_dir/tools/icon/SpotiKit-1024.png" \
        --out "$task_iconset/icon_${task_size}x${task_size}.png" >/dev/null
    task_retina_size=$((task_size * 2))
    /usr/bin/sips -z "$task_retina_size" "$task_retina_size" "$task_repo_dir/tools/icon/SpotiKit-1024.png" \
        --out "$task_iconset/icon_${task_size}x${task_size}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$task_iconset" -o "$task_staged_app/Contents/Resources/SpotiKit.icns"
/usr/bin/plutil -lint "$task_staged_app/Contents/Info.plist" >&2

if [ -e "$task_app" ]; then rm -rf "$task_app"; fi
mv "$task_staged_app" "$task_app"
# Keep stdout limited to the bundle path so the development launcher can use it.
printf '%s\n' "$task_app"
