# macOS implementation and validation

Validated locally on 2026-11-16 and 2026-11-17, on an Apple Silicon Mac running macOS 27. This is experimental development support for an identified Spotify build. Initial native tests used a separate complete Spotify copy; later normal-mode repairs patched `/Applications/Spotify.app` after full backups. Vendor originals remain preserved in recovery backups.

## Upstream v0.9.1 integration

The Mac changes now build on upstream v0.9.1 (`272a9cd`). Its native-only Marketplace, component discovery, version bump, and developer documentation link are retained. Upstream removed the Spicetify compatibility modules and cleans up imported catalog items at startup; those modules have not been reintroduced. Song Stats and other Spicetify-only add-ons therefore are not supported by this version. The generic native menu error handling and visible notification fix remain.

Toolbar placement combines upstream's stable lyric/home selectors with Mac test-attribute fallbacks. Five behavioral regression tests exercise stable styling, missing mappings, home-button ordering, exclusion of previously injected controls, and missing native anchors. Native context/profile actions and notifications have nine behavioral tests; the class-map tools retain 20 tests, for **34 JavaScript tests** in total. `tools/macos/validate-runtime.mjs` now checks native class-map selector translation and rendered stable-name CSS instead of removed Spicetify aliases.

The live Spotify/theme evidence below was recorded with SpotiKit 0.9.0 before this upstream integration. It remains evidence for the Mac mapping and bundle implementation; upstream's new component discovery and native Marketplace still need a fresh interactive runtime pass on a re-patched development copy. Integrating the source does not reapply the patch to the installed Spotify app.

## Implemented behavior

- **Build-aware mappings.** `SpotifyBuildDetector` reads the target Mach-O architecture, bundle version, canonical pristine UI identity, and CEF snapshot hash. Schema 2 catalog profiles distinguish platform builds. Exact matches take priority. Without an exact match, a Mac target uses the closest numeric version among nonempty Mac profiles for the same architecture, with an older version preferred for equal distance. Existing schema 1 mappings remain Windows mappings and cannot become Mac fallbacks. Fallback selections remain explicitly unverified.
- **Mac theme classes.** The verified profile supplies 5,360 stable names, including navigation, the main view, player, entity headers, sidebars, search, menus, and toolbar actions. New CSS rewrites preserve strings, comments, and URL contents. Repair and removal retain the original reversal rules for older patch manifests.
- **Shared controls.** Toolbar and player placement use verified classes and native test attributes, remount through rerenders, and exclude SpotiKit's own controls when copying sibling styling. Liquify's existing right-toolbar settings button works. Native Mac window controls retain their space; Windows controls stay hidden on Mac.
- **Diagnostics.** `SpotiKit.Diagnostics.themeSupport()` reports the selected profile, build, mapping count, and missing navigation/content/player hooks. Its `core-layout` scope describes those hooks; it does not certify every theme feature. Runtime validation probes the native class map and rendered stable-name CSS without depending on an imported-mod bridge.
- **Automatic local signing and recovery.** Complete Mac apps use full backups and a staged bundle transaction for install, repair, uninstall, and restore. Native tools preserve entitlements, identifier, and runtime flags, add the library-validation exception, sign the outer app, and verify deeply and strictly before publication. A valid pristine vendor signature can be restored without re-signing it.
- **Interrupted replacement recovery.** A flushed sibling journal and per-target native lock cover preparation and publication. Startup recovery runs off the UI thread before Spotify detection, checks recorded full fingerprints and signatures, and restores missing or uncommitted targets. Committed publications are kept after verification. The normal app only inspects the two normal Spotify locations; an override only inspects its selected target. External changes and uncertain copies are retained. An exact old copy with an already-invalid signature can be retained under a retired record after successful repair without blocking a later uninstall.
- **Permissions and process scope.** Complete Mac operations probe sibling-directory and journal-file creation, writing, rename, and removal before making a backup. This checks the app's actual parent permission instead of writing a probe inside the signed bundle. Normal and development process checks use the selected executable's native path; another Spotify copy is not closed by name matching.
- **Display availability.** Mac GUI startup waits up to 30 seconds when CoreGraphics reports zero active displays, then exits with a controlled startup diagnostic if the display remains unavailable. The exact observed Avalonia native timer error `-6661` is handled with its full exception retained in the log; unrelated initialization errors are not relabelled. Headless developer-tool commands bypass GUI initialization. Native hardware sleep/wake and multi-monitor behavior still need interactive acceptance beyond the deterministic guard tests.
- **Update protection.** The transaction uses the pre-operation full bundle fingerprint, checks native running executables, and rechecks the source before publication. It refuses external replacements, including same-version replacements between backup and staging. Post-publication rollback checks the exact published receipt and retains recovery when it cannot safely restore it. The app detects missing patches from changed builds and offers the compatibility/reinstall path.

The main code is in `Services/ClassMap.cs`, `SpotifyBuildDetector.cs`, `XpuiPatcher.ClassMap.cs`, `CssClassRenamer.cs`, `BackupService.cs`, `InstallerService.cs`, `MacBundleFiles.cs`, `MacBundleSigner.cs`, and `MacBundleTransaction.cs`. Runtime changes are in `Framework/loader.js`, `Framework/api/08-bars.js`, and `17-diagnostics.js`. The previous Mac bundle detection, native quit behavior, traffic-light layout, and Windows-only update guards remain in use.

## Tested identities

| Component | Identity |
| --- | --- |
| Spotify | 1.3.9.2055, macOS ARM64 |
| Mapping profile | `macos-arm64-1.3.9.2055` |
| Canonical pristine UI fingerprint | `12232976DCDC95DB295239897C34C086AF177ADA61E81FF50D293D7DF60E4820` |
| CEF snapshot SHA-256 | `8E2B14A51E2FA79C8552D82718FAE4EAF9F6FE14DCF63FE113559272DE382A52` |
| Liquify revision | `7548edd08447fbe84ec0fa19e9e1d206f01d366a` |
| Liquify stylesheet SHA-256 | `8e69d0dfc8ae4c25166a47fa780ec145d2e5aee50af37a188d72eaa62c55fb71` |
| Liquify script SHA-256 | `676374252fa6949ca8a681831ce03b2bd25628dc822594659a3cbe9e7764c2a9` |

Liquify was kept unchanged. Runtime acceptance used its existing stylesheet, script, settings, and Marketplace installation. The pristine UI fingerprint is content based: it survives ZIP recompression and reverses verified SpotiKit changes in memory, so repair recognizes the original build.

The embedded catalog contains generated class identifiers paired with SpotiKit's existing stable names, plus hashes that identify the Spotify build. The compact evidence summary and reviewed observations under `classmaps/macos-arm64/1.3.9.2055/` document how those pairs were checked. Spicetify's preprocessor and mapping script informed the capture approach. The inputs were a local Spotify installation and SpotiKit's existing Windows snapshot.

Keep downloaded clients, extracted CSS and modules, local fingerprint snapshots, and runtime captures in the ignored capture directory. The published catalog and evidence summary need only the class identifiers, checksums, and review results.

Pull-request CI in `.github/workflows/ci.yml` runs Release tests on Windows x64, Apple Silicon, and Intel Mac runners, plus both JavaScript suites. Mac jobs check shell/plist syntax, publish a native Release build, and validate a self-contained development app's icon, metadata, executable, and architecture. Owned signed fixtures run without an installed Spotify client. Optional real-client tests explicitly skip when no complete local `.app` is available; an invalid explicit `SPOTIKIT_TEST_SPOTIFY_BUNDLE` fails. Separate pristine and already-patched scenarios normalize only temporary copies, verify full recovery and source preservation, and never assume a patched source supplied a pristine backup.

## Validation results

After upstream integration, the native Release .NET suite passes **255 tests**, with **6 Windows-only tests skipped** (261 total); upstream removed the obsolete compatibility-data test. Before upstream integration, both JavaScript suites passed **32 tests**: 20 class-map tests and 12 framework API tests. The integrated v0.9.1 suites now contain **34 tests**: 20 class-map tests and 14 native framework API tests. The two real-client scenarios also pass separately against a preserved pristine vendor-signed Spotify 1.3.6.1921 bundle; the full suite uses the already-patched installed 1.3.9.2055 source. All changes, signing, and restoration occur on temporary copies, and source fingerprints are checked afterward. Cross-building does not execute Intel or Windows platform code.

The integrated results are recorded in `bin/upstream-integration/dotnet-tests.log` and `node-tests.log`. The capture output regression brings the JavaScript suite to **35 passing tests** and verifies that captured CSS stays in the local snapshot. A fresh offline capture reproduced the 5,360 published mappings and both build fingerprints. The v0.9.1 ARM64 self-contained Release publish, Intel Mac Release cross-build, and Windows x64 Release cross-build also pass without warnings; receipts are `arm64-release-publish.log`, `intel-release-build.log`, and `windows-release-build.log` in that directory. Existing development `.app` bundles and live Spotify were not replaced during the source integration.

PR-readiness regression coverage includes 19 persisted recovery/locking tests, parent-directory permissions before backups, native and synthetic multi-copy process selection, moved processes and PID reuse, pristine/patched source handling, explicit optional-fixture skips, and display startup grace/timeout/error classification. The complete Release build emits no warnings. Local receipts are `bin/macos-implementation/mac-pr-fixes-tests.log`, `mac-pr-fixes-pristine-tests.log`, and `mac-pr-fixes-node-tests.log`.

Before upstream integration, the local packaging and GUI checks also passed: self-contained ARM64 Release publish, ARM64 and Intel development `.app` packaging with native architecture checks, and the Windows x64 Release cross-build. The rebuilt ARM64 patcher cold-launched in normal mode with one active display, its expected native name/icon/bundle identity, and an empty startup error log. An isolated `--devtools status` invocation exits successfully without initializing the GUI. Receipts are `mac-pr-fixes-release-publish.log`, `mac-pr-fixes-app-build.log`, `mac-pr-fixes-intel-build.log`, `mac-pr-fixes-windows-build.log`, `mac-pr-fixes-branding.json`, and `mac-pr-fixes-cli.log` under the same ignored directory. The native screen guard's zero-display, wake-during-grace, timeout, and timer-error paths are deterministic test cases; no physical sleep/wake cycle was forced. The new hosted CI jobs have not run locally and will execute when the branch or PR triggers the workflow.

Fallback coverage checks numeric version ordering, equal-distance ties, exact-build priority, platform/architecture separation, invalid versions, source-versus-target metadata, partial matches, zero matches, and exact resource identity after removal. Compatibility retains a warning for an unverified fallback. Runtime diagnostics expose `fallback` and `sourceSpotifyVersion` separately from the target build and core-layout readiness.

An archive-copy check against the preserved Mac ARM64 Spotify 1.3.6.1921 bundle selects `macos-arm64-1.3.9.2055` as a fallback and applies 4,608 entries, skipping 752. Its target resource identity remains unchanged after canonical reversal and removal. The local receipt is `bin/macos-implementation/fallback-preview-1.3.6/preview.json`. This demonstrates the fallback mechanism and reversibility; it does not certify all 1.3.6 theme features.

After adding the fallback, the normal `/Applications/Spotify.app` reports 1.3.9.2055 and correctly selects its exact profile. A production repair applies all 5,360 entries, signs the complete app locally, and passes deep strict signature verification. The running client reports `fallback: false`, `verified: true`, and no missing core layout targets. Liquify is enabled with its glass/blur player styling, and both Marketplace and theme settings controls are visible and clickable. The fresh receipts are `bin/macos-implementation/fallback-normal-install.log` and `fallback-runtime.json`, with the rendered web content in `fallback-runtime.png`. The rebuilt SpotiKit development app runs in normal mode with its native name and icon; a Windows Release cross-build passes without warnings or errors.

Native tests cover exact full-bundle copying and restoration, permissions and symlinks, JIT entitlement preservation, deep signature checks, refusal of running and incomplete targets, stale identities, signing and publication failures, retained recovery, state-write rollback, same-version external replacements, legacy backups, and install/repair/uninstall/restore against a complete copied Spotify bundle. Synthetic archive tests cover mapping selection, selector boundaries, legacy reversal, and canonical identity across repair and removal.

Mac installation and repair expose five actual stages: Checking Spotify, Backing up, Installing, Signing Spotify, and Checking. The working bundle is patched during Installing, then signed, verified, and published during Signing Spotify. Tests assert that the original app remains unchanged when signing begins, that final checking sees a verified signed app, and that a signing-stage failure preserves the original and never reaches final checking. The UI uses the operation's reported plan for progress calculation; Windows and partial archive fixtures retain four stages. The signing-stage test receipt is `bin/macos-implementation/signing-stage-tests.log`.

The actual local Spotify repair applied **5,360 of 5,360 mappings**, with **zero skips**, rewriting **17,381 selector occurrences in 89 stylesheets**. It automatically signed the complete app and passed `codesign --verify --deep --strict`. The app was closed normally and relaunched, and its loaded framework still reported the verified profile.

| Live check before v0.9.1 integration | Result |
| --- | --- |
| Loader and bindings | SpotiKit 0.9.0, React, ReactDOM, Platform, Player, and Queue available |
| Core layout | Navigation, main view, player, and right toolbar targets present |
| Marketplace | One visible, clickable button; opens and reopens after navigation |
| Liquify settings | One visible, clickable gear; panel opens and closes |
| Page coverage | Home, Liked Songs, search, current album, current artist, and lyrics routes retain core layout and unique controls; no error screen detected |
| Theme lifecycle | Disable removes the stylesheet and settings gear; re-enable restores one of each; saved Liquify settings remain identical |
| Effects | Actual glass/blur styling, transparent surfaces, artwork colors, rounded panels, and player inspected in the running client; player computed radius 30 px and backdrop blur/filter present |
| Player and queue | A muted next/previous transition produces real track and queue events; artwork metadata available afterward |
| Playback restoration | Original track, paused state, position, volume, and first five queue entries restored |
| Historical Spicetify aliases | 227 aliases were generated in 0.9.0; this bridge was removed upstream in 0.9.1 |
| Mac controls | No injected Windows-style controls; navigation retains its Mac traffic-light inset |

The local receipts are `bin/macos-implementation/final-runtime.json`, `playback-runtime.json`, `final-install.log`, `tests-final.log`, and `tests-node.log`. The visual capture is `final-runtime.png`. These files are local development evidence, not shipped fixtures.

## Development and capture workflow

Use the complete development launcher described in the README. The partial archive sandbox cannot validate native launch or signing. SpotiKit development data is isolated; Spotify's own profile is shared when the development copy runs.

The launcher now runs a self-contained `SpotiKit.app` from `bin/macos-app/<runtime>/`, rather than hosting the UI through `dotnet`. `Application.Name` and the bundle's `CFBundleName`/`CFBundleDisplayName` are all `SpotiKit`; its Dock/Finder icon is generated from the existing 1024 px logo. The native menu includes About SpotiKit. Build the bundle independently with `tools/macos/build-dev-app.sh`; use the development launcher to supply the intended target and isolated SpotiKit data paths.

Both ARM64 and Intel development bundles were published and their self-contained runtime, icon, and debug dependencies checked. A native Apple Silicon launch with the existing development paths reports the running app's name as `SpotiKit`, bundle identifier `com.nmwplays.spotikit.dev`, and the expected logo through `NSRunningApplication`. The app remains running without startup errors. The receipts and native icon capture are in ignored `bin/macos-implementation/branding-native.json` and `branding-native.png`. A Windows Release cross-build also passes with zero warnings or errors. Debug publishing explicitly includes Avalonia's inspector assembly, which the SDK otherwise excludes for a `PrivateAssets=All` dependency; Release publishing keeps its previous exclusion.

To reproduce the Apple Silicon profile, use Node 22+ and install the capture dependencies once:

```sh
npm ci --prefix tools/class-map
node tools/class-map/scripts/new-version.mjs capture 1.3.9.2055 \
  --spotify-path "/path/to/pristine/Spotify.app" \
  --platform macos --architecture arm64 --offline \
  --work bin/mac-capture \
  --from classmaps/1.3.9.2055/snapshot.json \
  --observations classmaps/macos-arm64/1.3.9.2055/observations.json
```

Use a pristine bundle. The capture CLI checks its version and executable architecture, extracts available module source from the selected CEF snapshot without executing the app, computes provenance hashes, and proposes stable names. `--offline` avoids runtime crawling. A supported clean running client can also supply module and page evidence; `--observations` accepts reviewed generated/stable name anchors.

Review `derived-platform.evidence.json`, unresolved candidates, and relevant live selectors. Exact CSS fingerprints require unique or independent semantic evidence; low numerical scores alone do not authorize a mapping. Then emit the reviewed catalog and generate the local snapshot:

```sh
node tools/class-map/scripts/new-version.mjs finish 1.3.9.2055 \
  --platform macos --architecture arm64 --work bin/mac-capture \
  --catalog bin/mac-capture/catalog.json
```

The snapshot is written to `bin/mac-capture/snapshot.json`. For a later build, pass that local file with `--from` and use a separate `--work` directory. The default work tree under `tools/class-map/work/` is also ignored and is searched for prior local snapshots. Use `--catalog bin/mac-capture/catalog.json` when validating the tooling against a scratch catalog. A complete offline capture and finish run against the preserved pristine Mac app reproduced the frozen mappings and both native fingerprints exactly. The installed app applies the embedded profile without capture tools or snapshots.

For live acceptance, use `tools/macos/validate-runtime.mjs` with `--exercise --pages --lifecycle --screenshot`. `--playback` explicitly enables the controlled muted transition and restoration check. The tool writes a JSON report, optionally captures the rendered page, and exits unsuccessfully if its required checks fail. Restart normally after testing to close the debugging port.

## Remaining validation limits

- **Intel Mac:** the app compiles for `osx-x64`; this machine cannot provide native Intel runtime evidence. Capture and review an Intel Spotify bundle and run the same native acceptance checks before claiming Intel theme support. A universal app selects the relevant executable slice rather than assuming every slice has the same UI snapshot.
- **Windows:** existing version maps are preserved and the app cross-builds, but Windows-specific update/ACL/executable-replacement checks and the real Windows mapping fixture require a Windows host. Six such tests are skipped here.
- **Theme breadth:** 21 names referenced by Liquify's stylesheet remain unresolved in this build's evidence. They include optional artist variants, placeholders, cinema states, and dialogs. The inspected artist page and main layouts work, but those names must be validated where active rather than mapped speculatively. Successful native Liquify checks do not certify every theme feature. Upstream v0.9.1 no longer supports imported Spicetify themes or extensions.
- **Extension data dependencies:** native SpotiKit extensions still depend on their required APIs and external data. In the earlier 0.9.0 investigation, imported Song Stats registered its context menu but Spotify returned HTTP 429 and the script failed before opening a modal. Those receipts remain under `bin/macos-implementation/song-stats/` as historical evidence. Upstream v0.9.1 removes the import/Spicetify bridge, so Song Stats compatibility is no longer claimed. Native context and profile actions retain synchronous/asynchronous error handling, and notifications use Spotify's registered default renderer. No third-party extension source or user credentials are shipped as fixtures.
- **Native window modes:** normal Mac layout and restart were checked; native fullscreen, multi-monitor behavior, and all resize combinations still need an interactive Mac pass. The validation screenshot captures Spotify's web content, not its native frame.
- **Distribution:** local modified-Spotify signing is implemented. A distributable signed/notarized SpotiKit app, installer, and release process remain separate work.

Spotify updates may change UI resources or replace the patched bundle. On an unknown build, use the Theme support warning, capture/review a new profile, and repair that build. Keep its matching full recovery backup; do not restore a different build's executable or signature metadata.
