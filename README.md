<p align="center">
  <img src="tools/icon/SpotiKit-1024.png" width="96" alt="SpotiKit">
</p>

<h1 align="center">SpotiKit</h1>

<p align="center">
  Give Spotify a new look and new features.<br>
  Pick themes and extensions right inside Spotify, install them with one click and switch back anytime.
</p>

<p align="center">
  <a href="https://spotikit.com">Website</a> ·
  <a href="https://spotikit.com/docs/introduction">Docs</a> ·
  <a href="https://github.com/NMWplays/SpotiKit/releases">Releases</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-open%20beta-4C6FFF" alt="Status: open beta">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20and%2011-4C6FFF" alt="Platform: Windows 10 and 11">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-4C6FFF" alt="License: AGPL-3.0">
</p>

---

## What is SpotiKit

SpotiKit lets you change how Spotify looks and add new features to it. It's free, with Windows support and an experimental macOS development build.

- **Themes** give Spotify a new look.
- **Extensions** add new buttons and features.
- **Custom apps** add whole new pages to Spotify.
- **CSS snippets** are small tweaks, like rounder corners or hiding a button.
- **Setup profiles** save which theme, extensions and snippets are on, so you can switch between looks with one click.

You find all of it in the Marketplace, a page right inside Spotify. Glowify, Liquify and Liquid Lyrics are the first themes and extensions made for SpotiKit.

## What you can do

**In Spotify**

- **Themes and extensions.** Browse them right inside Spotify. One click to install, one click to remove.
- **Your colors.** Change the colors of any theme and watch Spotify change with you. Share your colors with friends.
- **Small tweaks.** CSS snippets for rounder corners, hidden buttons and more. Mix them on top of any theme.
- **Made for your Spotify.** Everything says which Spotify versions it works on, so nothing breaks by surprise.
- **Setup profiles.** Save your theme and extensions as a profile and switch with one click. Upload it so others can use it too.
- **Ratings and reviews.** See what others think before you install, and leave a review yourself. Creators can answer them.
- **Updates and undo.** Installed themes and extensions update with one click. Didn't like the update? Go back to the last one.
- **Watched over.** Anything harmful gets removed from the Marketplace and switched off for everyone who has it.

**In the SpotiKit app**

- **One click to install.** Install or remove SpotiKit with one click. Your PC is checked before anything changes.
- **Nothing gets lost.** SpotiKit saves a copy of Spotify before every change. Uninstall it and Spotify is back to normal.
- **Spotify update protection on Windows.** Spotify only updates once SpotiKit is ready for the new version. On Mac, check compatibility and reapply SpotiKit after Spotify updates.
- **Safe mode.** Something acting up? Start Spotify with everything off, then turn things back on one by one.
- **Updates itself on Windows.** New versions of SpotiKit install by themselves. Mac development builds are updated from source.

## Status

SpotiKit **0.9.2** is in open beta. Some things may still be rough. If something breaks or looks off, tell us in the [issues](https://github.com/NMWplays/SpotiKit/issues).

| Platform | State |
| --- | --- |
| Windows 10 and 11 | Open beta |
| Linux | Planned. Most of it already works, but Flatpak, AUR and other installs still need work. |
| macOS Apple Silicon | Experimental development support. Spotify 1.3.9.2055 and unchanged Liquify validated locally; build-specific mappings, complete bundle recovery, and automatic local signing. |
| macOS Intel | Development build compiles. Native runtime validation and an Intel Spotify mapping profile are still required. |

You need Spotify from [spotify.com](https://www.spotify.com/download). The version from the Microsoft Store doesn't work.

## Install

For Windows, download SpotiKit on [spotikit.com](https://spotikit.com) or from the [Releases](https://github.com/NMWplays/SpotiKit/releases) page. The experimental Mac app is currently built from source using the development instructions below.

1. Download `SpotiKit.exe` and run it.
2. Open **Installation** and press **Install SpotiKit**.
3. Spotify starts again with SpotiKit. Open the Marketplace with the shopping bag icon next to the back and forward arrows.

To get plain Spotify back, press **Uninstall** in the same place. The [docs](https://spotikit.com/docs/installation) explain every step.

## Make your own

Want to build a theme, extension, app or snippet yourself? Open **Developer** in the SpotiKit app and start from a template, in JavaScript or TypeScript. You see your changes in Spotify while you work, and **Check** tells you what would break before you publish.

Your projects are in `%APPDATA%\SpotiKit\Themes`, `Extensions`, `Custom Apps` and `Snippets`, and go into Spotify with **Apply to Spotify**.

If you work in a Git repository, there's `spotikit-kit` ([`tools/kit`](tools/kit)). Start with `npm create spotikit`, then use `spotikit-kit build`, `check`, `dev` (live in Spotify) and `pack`. New projects come with a GitHub workflow that builds, checks and makes releases for you.

You'll find examples in [`examples/`](examples) and a full guide in the [docs](https://spotikit.com/docs/development).

To put your project in the Marketplace, publish it in a public GitHub repository and give it the topic `spotikit-themes`, `spotikit-extensions`, `spotikit-apps` or `spotikit-snippets`. The Marketplace finds it by itself.

## Build from source

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download).

```
dotnet run --project SpotiKit.csproj
dotnet test tests/SpotiKit.Tests
```

On macOS, use a complete Spotify development copy for native testing:

```sh
./tools/run-macos-dev.sh --full-bundle
```

The launcher uses a .NET 10 SDK from your PATH or `~/Library/Caches/SpotiKit-dev/dotnet`, and selects `osx-arm64` or `osx-x64`. It builds and runs a self-contained `bin/macos-app/<runtime>/SpotiKit.app`, with the SpotiKit menu name, Dock/Finder logo, and a branded About item. Quit the existing bundled development app before rebuilding. Its first run copies the complete installed Spotify app to `bin/macos-full-dev/Spotify.app`. SpotiKit settings, backups, and logs stay under `bin/macos-full-dev`; the source app is preserved. Spotify itself uses your normal Spotify profile when launched. Set `SPOTIKIT_DEV_SOURCE` to choose the source for the first copy. Subsequent runs keep the development copy and its changes.

To build just the Mac development app, run `./tools/macos/build-dev-app.sh osx-arm64` (or `osx-x64`). The script packages the published executable, .NET runtime, native bundle metadata, and an ICNS generated from the existing logo. The `.app` runs without a separately installed .NET runtime. Launching through `run-macos-dev.sh` also supplies the isolated development paths; opening the bundle directly uses the app's normal paths. `dotnet run` remains available, but the Mac launcher provides the complete native application identity. Public signing and notarization remain separate from this local development package.

To work on an existing complete development copy:

```sh
SPOTIKIT_DEV_TARGET="$HOME/Applications/Spotify-SpotiKit-Local.app" \
  ./tools/run-macos-dev.sh --full-bundle
```

The default `./tools/run-macos-dev.sh` remains a faster archive sandbox under `bin/macos-dev`. It copies only metadata, the executable, and the UI archive. That fixture supports patch/restore tests and the SpotiKit UI; use full-bundle mode for signing, launch, and process-control validation.

On a complete Mac app, install, repair, uninstall, and restore now prepare a separate complete working bundle, verify the recovery snapshot, apply the resource change, sign locally, verify with `codesign --verify --deep --strict`, and publish the verified app. The signer preserves existing entitlements, identifier, and runtime flags, adding `com.apple.security.cs.disable-library-validation` so the locally signed executable can load Spotify's vendor-signed Chromium framework. No paid developer account, Node, Go, Spicetify CLI, or Xcode project is needed for this runtime signing step; it uses macOS's built-in tools.

Mac installation and repair show a separate **Signing Spotify** progress stage between **Installing** and the final **Checking** stage. Spotify's original app stays in place while the working copy is patched; the signing stage signs and verifies the copy before publishing it. A signing failure stops installation before the final checks or launch. Windows and partial archive fixtures retain their four-stage flow.

Full backups include the executable, signature metadata, file permissions, and symlinks. An unchanged valid vendor-signed pristine backup can be restored exactly. Old archive-only backups remain readable, but cannot recover an original executable or signature. A running app, incomplete native bundle, changed build, or failed signature check stops publication. The manual `tools/sign-macos-spotify.sh` helper is still available for separate development experiments.

Mac publication writes a durable sibling recovery record before either app rename and holds a lock for the selected bundle. If a replacement is interrupted, the next launch verifies the recorded app copies and restores a missing or uncommitted app before detecting Spotify. External changes remain untouched. The permission check tests sibling creation, writing, rename, and removal in the app's parent folder before a backup is made; it does not probe inside the signed app. Process detection and quitting select the same Spotify bundle, including when multiple copies are running.

When macOS has no active display, the patcher waits up to 30 seconds for one before initializing its window. If no display becomes available, it exits cleanly with wake/connect instructions in the startup log. The observed native display-timer failure also produces a controlled diagnostic instead of an unhandled exception. Command-line developer-tool status commands remain available without a display.

The verified Mac profile is **`macos-arm64-1.3.9.2055`**. Selection first checks the exact Spotify version, architecture, pristine UI fingerprint, and CEF snapshot fingerprint. If no exact profile matches, Mac builds automatically use the closest numeric Spotify version among Mac profiles for the same architecture. Version components are compared in major/minor/build/revision order, preferring an older profile for an equal distance. Windows maps and maps for another CPU architecture are not Mac fallback candidates. The patcher identifies the source version and marks the fallback as unverified in Compatibility, the install preview, logs, and runtime diagnostics. Missing class names are skipped; the actual target build identity remains in backups and install records. A fallback can leave some theme styling incomplete. The [Mac implementation and validation notes](docs/macos-validation.md) describe the tested identity, capture workflow, results, and remaining limits.

Spotify update holds, background maintenance, and automatic SpotiKit executable replacement remain Windows-only. On Mac, Spotify manages its own updates and may replace the patched app on launch. SpotiKit detects missing patches and changed build identity, including a reissued build with the same version. Recheck **Compatibility**, obtain a verified mapping for the new build, and reinstall. Signed/notarized SpotiKit `.app` distribution is outside this development implementation.

For a runtime report, launch your development copy with the local debugging port and run the Node 22+ validation tool:

```sh
open -a "$HOME/Applications/Spotify-SpotiKit-Local.app" --args --remote-debugging-port=9229
node tools/macos/validate-runtime.mjs --exercise --pages --lifecycle --screenshot
```

These flags exercise navigation and theme disable/re-enable, preserving the previous route and theme settings. Add `--playback` only for an intentional playback check: it requires a paused track and nonempty queue, performs a muted next/previous transition, and restores the track, position, pause state, and volume. Runtime captures stay in ignored development storage. Restart Spotify normally afterward to close the debugging port.

Open the Marketplace using the shopping-bag button in Spotify's top-left toolbar, beside the back and forward arrows. Hovering it shows the "Marketplace" tooltip. The button remains available when you navigate to another Spotify page.

## License

[AGPL-3.0](LICENSE).

Parts of SpotiKit's JavaScript API are based on [Spicetify](https://github.com/spicetify/cli) (LGPL-2.1). [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists them.

SpotiKit is an independent project. It is not affiliated with or endorsed by Spotify AB. Spotify is a trademark of Spotify AB.
