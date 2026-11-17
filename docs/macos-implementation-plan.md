# macOS theme compatibility implementation plan

Status: Implemented and validated on Apple Silicon for the pinned Spotify build. Intel runtime, native Windows regression testing, and broader theme coverage remain validation work. See [the implementation and validation record](macos-validation.md).

The sections below preserve the original implementation design. The current result uses a verified Mac profile with 5,360 mappings, automatic local signing, complete bundle recovery, a platform-aware capture CLI, and runtime diagnostics. Liquify's source files were kept unchanged.

Make SpotiKit provide the same theme classes and APIs on macOS and Windows. Use the existing Liquify theme, without editing its files, as the first acceptance test. Start with Spotify 1.3.9.2055 on Apple Silicon, then validate Intel and Windows before claiming support for those targets.

The initial implementation belongs in SpotiKit. Change Liquify only if a specific issue remains after SpotiKit supplies its expected classes and APIs and the issue is demonstrated to come from the theme's layout or rendering assumptions.

Upstream v0.9.1 subsequently removed the imported Spicetify catalog and compatibility bridge. The alias-bridge portion of phase 5 below is historical and superseded; the current integration retains native SpotiKit theme support and diagnostics. See the validation record for the integrated behavior.

## Original baseline (before implementation)

The full local Spotify copy opens with an ad-hoc signature and loads SpotiKit 0.9.0, including its React and Platform bindings. The Marketplace button has a working fallback for the Mac navigation layout.

Liquify is enabled and its CSS and JavaScript load. However, its `.global-nav-bar`, `.main-view-panel`, and `.now-playing-bar-area` selectors each match zero elements. The corresponding Spotify navigation and player elements exist under their native attributes and generated classes. The right toolbar container and Liquify settings gear are also missing from SpotiKit's view of the DOM.

On this bundle, 852 class mappings applied and 5,514 were skipped. SpotiKit has cached the current Spicetify map, but the bridge produces zero aliases because its alias generation requires hashes shared with SpotiKit's applied map. These counts describe this build; they are not percentages of theme compatibility. The local diagnostic record is `bin/macos-theme-review/findings.json`, an ignored development output; the baseline above is sufficient to understand the plan without that file.

## Implementation decisions

- Keep the existing stable theme names, such as `main-view-panel`. Liquify and other themes should retain one set of selectors.
- Select mappings using the target Spotify build, including its platform and resource identity. Version alone is insufficient.
- Keep the current loader architecture initially. Use Spicetify's mapping and resource extraction techniques as references where they solve a demonstrated gap.
- Keep native macOS traffic lights and their required space. Preserve the existing Windows behavior.
- Automate signing of the modified Spotify bundle. SpotiKit signing, notarization, and public distribution are outside this work.
- Use a complete development copy for runtime validation. Keep the partial `bin/macos-dev` fixture for fast archive tests; it cannot validate Spotify launch or native process control.

## 1 Establish reproducible fixtures

Preserve a complete, unmodified Mac bundle and record its version, executable architecture, UI archive hash, and relevant snapshot hashes. Pin Liquify to commit `7548edd08447fbe84ec0fa19e9e1d206f01d366a`, recording the hashes of its manifest, stylesheet, script, and assets. Use those exact theme files throughout the initial acceptance run.

Capture the missing selectors, toolbar controls, and representative screenshots as the failing baseline. Keep raw Spotify bundles and runtime captures in ignored development storage. Commit small synthetic fixtures and sanitized mapping evidence rather than Spotify application binaries or account data.

Add a full-bundle development path alongside the existing partial fixture. It must identify the exact target bundle and keep SpotiKit's settings and backups separate from normal app data. Separate data isolation from permission to launch that explicit development target: a skipped quit or launch must not count as a successful native test. Spotify profile isolation must be verified separately before the launcher claims to provide it.

**Affected files:** `tools/run-macos-dev.sh`, `Services/SpotiKitPaths.cs`, `Services/SpotifyService.cs`, `tests/SpotiKit.Tests/Sandbox.cs`, and a new Mac runtime validation tool.

**Completion criterion:** The same clean Mac bundle and unchanged Liquify release reproduce the current failures, and the full development copy can be launched, inspected, and closed through the intended development workflow.

## 2 Add platform and build identity to mapping selection

Introduce a target-build identity containing the Spotify version, platform, executable architecture, and hashes of the pristine UI resources used to derive the mapping. Detect architecture from the target bundle rather than assuming it matches the SpotiKit process, particularly under Rosetta or with a universal executable.

Extend the catalog format to hold separate mapping profiles for platform builds of the same Spotify version. Retain the ability to read the existing schema. Confirm the provenance of existing profiles and preserve verified Windows mappings. A Mac target must never silently select a Windows profile because the version matches.

Replace production `For(client.Version)` calls with selection using the target identity. Return a structured selection result that identifies the chosen profile or explains why no matching profile exists. Use that same result in installation preview, installation, and compatibility reporting.

Record the selected profile and original resource identity in the patch manifest. Repair must recover the pristine identity from a verified patch record or matching backup; it must not treat the hash of an already patched archive as the original build fingerprint. A bundle with unreadable version or identity must fail the Mac mutation preflight before files change.

Extend backup matching and pruning to distinguish platform builds. Restoring files from a different platform or incompatible build must be refused, even when the display version matches.

**Affected files:** `Models/SpotifyInstallation.cs`, `Services/SpotifyService.cs`, `Services/MacApplicationBundle.cs`, `Services/ClassMap.cs`, `Framework/class-map.json`, `Services/InstallerService.cs`, `Services/CompatibilityService.cs`, `Models/BackupInfo.cs`, and `Services/BackupService.cs`.

**Tests:** Same version with different platforms selects different profiles; mismatched fingerprints and architecture do not select a profile; legacy Windows records remain readable; repair recognizes an already patched client; incompatible backups are refused.

## 3 Generate mappings from the Mac client

Make the class-map capture tools accept an explicit Spotify installation path. Resolve `.app/Contents/Resources/Apps/xpui.spa` on Mac and retain the Windows path handling. Record platform, architecture, resource hashes, and capture provenance in snapshots and generated output.

Capture CSS, module exports, and the live DOM from the clean Mac bundle. If required module information is stored in the CEF V8 snapshot, add read-only extraction for mapping generation. Spicetify already handles the Mac framework resource location and extraction in its [preprocessor](https://github.com/spicetify/cli/blob/867df4af012a07f0b9d5c6b4bc8d7c29badb8ca9/src/preprocess/preprocess.go). This does not require replacing SpotiKit's working React or Platform discovery.

Derive Mac hashes for the existing stable names using module exports, test attributes, DOM relationships, and stylesheet evidence. Use fingerprints to propose matches, but review ambiguous matches rather than assigning names from appearance alone. Spicetify's [mapping generation script](https://github.com/spicetify/cli/blob/867df4af012a07f0b9d5c6b4bc8d7c29badb8ca9/scripts/update-cssmap.mjs) is a reference for matching exported classes across builds.

Reuse the existing Node capture dependencies, including Acorn and Acorn Walk. Keep these tools as development dependencies; the shipped app must not require Node, Go, or the Spicetify CLI to apply a generated mapping.

Prioritize the navigation, main content, sidebars, player, menus, and controls used by Liquify. Build a list of Liquify's required selectors and validate them on the pages where they should exist. Do not require a playlist-specific selector to exist on Home.

**Affected files:** `tools/class-map/scripts/new-version.mjs`, `extract2.mjs`, `port.mjs`, `emit.mjs`, `snapshot.mjs`, `Framework/class-map.json`, and platform-specific evidence summaries under `classmaps/`. The detailed snapshots stay in the local capture directory.

**Completion criterion:** The Mac profile restores the core missing names and has reviewed evidence for its mappings. The existing Windows profiles retain their mappings.

## 4 Restore the shared runtime contract

Apply the selected profile consistently to Spotify's CSS and the loader's DOM translation. Preserve reversibility, handle runtime-only classes, and verify that adding the theme names does not remove Spotify's own styling or break its queries. Validate selector boundaries, collisions, and dynamically created elements.

Finish the shared placement adapters for the right toolbar, player controls, widget actions, and navigation buttons. Prefer stable Spotify attributes and verified relationships, with existing named-class selectors as supported alternatives. Reuse the placement mechanism for all callers, including Liquify's existing settings-button code.

The adapters must survive navigation and React rerenders, avoid duplicate controls, preserve click targets, and leave traffic-light space clear. Keep observer work bounded and avoid observing SpotiKit's own changes indefinitely.

Audit the APIs Liquify actually uses: React and ReactDOM, Player state and events, Queue, artwork colors, Navigation, and platform data. Exercise track changes and queue updates rather than treating an existing global object as proof of correct behavior. Preserve the normal Mac quit path in `Services/MacProcessControl.cs` and the native window-control behavior in `Framework/api/16-window.js`.

At this point, run the first visual acceptance check with unchanged Liquify on the complete development copy. Use the existing manual signing helper until phase 6 supplies the automated transaction. This establishes the theme result before expanding diagnostics and imported-theme support.

**Affected files:** `Services/XpuiPatcher.ClassMap.cs`, `Framework/loader.js`, `Framework/api/03-platform.js`, `08-bars.js`, and `16-window.js` as needed by demonstrated failures.

**Tests:** CSS remains styled after translation; install and removal restore archive contents; rerenders remount one control; both toolbar sides work; controls remain visible and clickable; player and navigation events produce the expected updates.

## 5 Report theme compatibility and repair the alias bridge

Expose the active mapping profile and missing core hooks through diagnostics. Distinguish a loaded theme file from a theme whose required targets are available. Report unsupported or partially mapped builds without presenting mapping counts as a theme success score.

Generate Spicetify aliases from the selected platform profile and verified correspondences. Retain attribution for imported data. Do not rename an otherwise unmapped native class using a remote name unless the corresponding CSS and DOM behavior remain consistent.

Liquify's native SpotiKit path remains the first acceptance target. Validate the Spicetify bridge separately with a representative imported theme; passing Liquify does not establish compatibility with every Spicetify extension or theme.

**Affected files:** `Framework/api/15-spicetify.js`, `12-marketplace.js`, relevant compatibility view models, and `tools/spicetify/build-data.mjs` if bundled data changes.

**Completion criterion:** Diagnostics identify the selected Mac profile and actionable missing hooks. Alias tests demonstrate correct translation without breaking native styling, including the current zero-overlap case.

## 6 Make Mac mutations preserve a launchable bundle

Move the proven signing procedure from `tools/sign-macos-spotify.sh` into a C# service that invokes native tools with structured arguments. Preserve the identifier, runtime flags, and existing entitlements. Add the local library-validation entitlement needed by the current Spotify build, sign the outer app, and verify the complete bundle with `codesign --verify --deep --strict`.

Use a complete bundle snapshot for recovery in the first implementation. Signing changes the executable and signature metadata, so the existing archive-only backup cannot promise exact bundle recovery. Version the backup metadata, retain the ability to read old backups, and distinguish archive restoration from full bundle restoration. Recalculate disk-space requirements and include full snapshots in retention rules.

Use this operation order:

1. Identify the exact target and confirm that Spotify has exited normally.
2. Verify the recovery snapshot and prepare a complete working bundle.
3. Patch and validate the working archive.
4. Sign and verify the working bundle.
5. Recheck that the destination has not been replaced by a Spotify update, then publish the verified bundle to the explicit target.
6. Commit installation state and offer the normal launch behavior.

Installed-app write restrictions must produce a clear, actionable error before replacement. Use the development copy where appropriate; do not modify global trust settings. Reuse the transaction for install, repair, uninstall, and backup restore. A failed operation must retain a usable recovery copy, and rollback must verify the restored signature before reporting success. Never restore an older executable over a newly detected Spotify update.

**Affected files:** A new `Services/MacBundleSigner.cs`, a bundle transaction helper, `Services/InstallerService.cs`, `Services/BackupService.cs`, `Models/BackupInfo.cs`, `Services/FriendlyError.cs`, and `tools/sign-macos-spotify.sh`.

**Tests:** Signing preserves existing JIT entitlements; a bundle without the library-validation exception gains it; running targets are refused; signing, verification, and publication failures retain or restore a usable bundle; updates during an operation are detected. Exercise install, repair, uninstall, and restore against complete Mac fixtures.

## 7 Validate unchanged Liquify and Windows behavior

Run automated selection and archive tests first, then use the full Mac development bundle for runtime tests. Compare both required selectors and actual rendered results. Keep Liquify's pinned file hashes unchanged throughout this pass.

On the Apple Silicon development host, the existing build and test entry points are:

```sh
dotnet build SpotiKit.csproj --configuration Debug --runtime osx-arm64 -p:PublishReadyToRun=false
dotnet test tests/SpotiKit.Tests --configuration Debug --runtime osx-arm64 -p:PublishReadyToRun=false
```

Use `osx-x64` on the Intel test host. Run the Windows suite on Windows so its platform-specific tests execute. Add focused runtime assertions to the new validation tool; build success does not replace the visual and native checks below.

| Validation area | Required result |
| --- | --- |
| Launch and signing | The modified complete bundle verifies and opens through normal macOS launch. |
| Theme installation | The pinned Liquify stylesheet and script load without theme errors. |
| Settings | The gear is visible, opens the panel, and its settings persist. |
| Layout | Navigation, main panel, sidebars, and player receive the intended styling. |
| Visual effects | Glass, transparency, backgrounds, artwork colors, and blur are inspected on representative pages. |
| Playback | Player controls, track changes, artwork updates, and queue-related features behave correctly. |
| Navigation and windows | Home, playlists, albums, artist pages, search, lyrics, resize, and fullscreen retain usable controls. |
| Lifecycle | Theme enable, disable, re-enable, and Spotify restart do not accumulate controls, observers, or stale styling. |
| Recovery | Install, repair, uninstall, and restore preserve a launchable app and correct installation state. |

After the first launch, recheck the on-disk bundle identity and the loaded framework. A pending Spotify update replaced the patched bundle during the earlier launch test; detect that state explicitly and direct the user to repair the newly installed build.

Use page-aware assertions and screenshots for visual checks. Test an ordinary theme lifecycle plus one track transition and queue update; do not change a user's playback or stored theme settings merely to collect a baseline.

Run on Apple Silicon, an Intel Mac, and Windows. A cross-built `osx-x64` binary is a build check, not an Intel runtime pass. Record tested Spotify bundle identities, architectures, and theme revision. If Intel hardware is unavailable, keep Intel runtime validation explicitly pending.

If a remaining failure comes from Liquify's renderer detection, a DOM relationship that cannot be provided safely by SpotiKit, or a platform-specific option, document the reproduction and make a small separate theme change. Preserve one shared theme source. Liquify already has a [plain-blur fallback](https://github.com/NMWplays/Liquify/blob/7548edd08447fbe84ec0fa19e9e1d206f01d366a/src/glassSurface.ts); validate that path before adding another rendering workaround.

## 8 Document support and deliver the changes

Update the README with the complete Mac development workflow, automatic local signing behavior, verified Spotify builds, and theme validation results. Explain how Spotify updates invalidate a mapping profile or replace a patch, and provide the supported repair path.

Build native development outputs for `osx-arm64` and `osx-x64`, retain the existing Windows build checks, and document the .NET 10 development dependency. Keep runtime signing based on macOS system tools; it must not require users to install Xcode merely to use an already built SpotiKit app.

Deliver the work as reviewable commits in this order: fixtures and identity; platform-aware catalog; Mac mapping generation and profile; runtime adapters; diagnostics and aliases; bundle recovery and signing; acceptance results and documentation. Complete bundle recovery before enabling automated mutations against the normal installed app.

## Definition of done

- The unchanged pinned Liquify release passes the Apple Silicon acceptance matrix.
- Mac targets select verified Mac mappings, and Windows targets retain their behavior.
- Theme controls survive navigation, rerenders, resizing, and restart.
- Mac resource changes are followed by signing and verification before success is recorded.
- Recovery handles the executable and signature metadata as well as the UI archive.
- Intel and Windows results are recorded separately, with any untested target clearly identified.
- Any remaining theme-specific limitation has a reproducible case and an explicit disposition; launch success alone is not reported as complete theme support.
