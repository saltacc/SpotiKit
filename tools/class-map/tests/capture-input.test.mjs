import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalFingerprint, executableArchitectures, macBundleVersion, normalizePlatform, spotifyPaths } from "../scripts/capture-input.mjs";
import { emitCatalog, formatCatalog } from "../scripts/emit.mjs";

const fixture = (run) => { const root = mkdtempSync(join(tmpdir(), "spotikit-capture-")); try { run(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const first = { generated: "Abcdefghijklmnopqrst", stable: "main-panel" };
const second = { generated: "Bcdefghijklmnopqrstu", stable: "sidebar" };
const build = (hash = "A".repeat(64)) => ({ spotifyVersion: "1.3.9.2055", platform: "macos", architecture: "arm64", resourceFingerprint: hash, snapshotSha256: "B".repeat(64) });

test("Mac installation roots and Resources paths resolve to the same archive", () => {
  const app = join(tmpdir(), "Spotify Test.app");
  assert.deepEqual(spotifyPaths("macos", app), spotifyPaths("macos", join(app, "Contents", "Resources")));
  assert.equal(normalizePlatform("darwin"), "macos");
  assert.equal(normalizePlatform("win32"), "windows");
  assert.throws(() => spotifyPaths("macos", tmpdir()), /\.app/);
});

test("target architecture comes from thin or universal Mach-O headers", () => {
  const thin = Buffer.alloc(32); thin.writeUInt32LE(0xfeedfacf); thin.writeUInt32LE(0x0100000c, 4);
  assert.deepEqual(executableArchitectures(thin), ["arm64"]);
  const universal = Buffer.alloc(48); universal.writeUInt32BE(0xcafebabe); universal.writeUInt32BE(2, 4);
  universal.writeUInt32BE(0x01000007, 8); universal.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(executableArchitectures(universal), ["arm64", "x64"]);
  assert.deepEqual(executableArchitectures(Buffer.alloc(3)), []);
});

test("a Windows PE header is identified without executing the application", () => {
  const pe = Buffer.alloc(128); pe.write("MZ"); pe.writeUInt32LE(80, 60); pe.writeUInt32LE(0x4550, 80); pe.writeUInt16LE(0x8664, 84);
  assert.deepEqual(executableArchitectures(pe), ["x64"]);
});

test("canonical resource fingerprints are order independent and detect changed content", () => fixture((root) => {
  mkdirSync(join(root, "images")); writeFileSync(join(root, "index.html"), "<body></body>"); writeFileSync(join(root, "images", "test.svg"), "<svg/>");
  const firstHash = canonicalFingerprint(root, ["images/test.svg", "index.html"]);
  assert.equal(firstHash, canonicalFingerprint(root, ["index.html", "images/test.svg"]));
  writeFileSync(join(root, "images", "test.svg"), "<svg changed/>");
  assert.notEqual(firstHash, canonicalFingerprint(root, ["index.html", "images/test.svg"]));
  assert.throws(() => canonicalFingerprint(root, ["../outside"]), /Invalid archive entry/);
}));

test("Mac plist versions retain a full build and ignore a hash suffix", () => fixture((root) => {
  const plist = join(root, "Info.plist");
  writeFileSync(plist, '<plist><dict><key>CFBundleShortVersionString</key><string>1.3.9</string><key>CFBundleVersion</key><string>1.3.9.2055.g123</string></dict></plist>');
  assert.equal(macBundleVersion(plist), "1.3.9.2055");
}));

test("a Mac profile emission retains legacy Windows maps and other metadata", () => {
  const previous = { schemaVersion: 1, comment: "original", spotify: { "1.3.9.2055": [first] }, custom: "retain" };
  const result = emitCatalog(previous, "1.3.9.2055", [second], build());
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.spotify, previous.spotify);
  assert.equal(result.custom, "retain");
  assert.equal(result.profiles[0].platform, "macos");
  assert.deepEqual(JSON.parse(formatCatalog(result)), result);
});

test("finish publishes class mappings and keeps captured CSS in the local snapshot", () => fixture((root) => {
  const scripts = join(root, "tools", "class-map", "scripts");
  mkdirSync(scripts, { recursive: true });
  for (const name of ["capture-input.mjs", "emit.mjs", "fingerprint.mjs", "new-version.mjs", "snapshot.mjs"]) {
    copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(scripts, name));
  }
  const work = join(root, "capture");
  const css = "border:1px solid red";
  const catalog = join(root, "catalog.json");
  mkdirSync(join(work, "spa"), { recursive: true });
  writeFileSync(join(work, "spa", "fixture.css"), `.${first.generated}{${css}}`);
  writeFileSync(join(work, "evidence2.json"), JSON.stringify({ classes: { [first.generated]: {} } }));
  writeFileSync(join(work, "build.json"), JSON.stringify(build()));
  writeFileSync(join(work, "derived-platform.mappings.json"), JSON.stringify([first]));

  execFileSync(process.execPath, [join(scripts, "new-version.mjs"), "finish", build().spotifyVersion,
    "--platform", "macos", "--work", work, "--catalog", catalog]);

  const published = readFileSync(catalog, "utf8");
  assert.deepEqual(JSON.parse(published).profiles[0].mappings, [first]);
  assert.ok(!published.includes(css));
  assert.ok(readFileSync(join(work, "snapshot.json"), "utf8").includes(css));
  assert.ok(!existsSync(join(root, "classmaps")));
}));

test("repeated captures update their profile while different resources retain both builds", () => {
  const firstBuild = build();
  const initial = emitCatalog({ schemaVersion: 1, spotify: {} }, "1.3.9.2055", [first], firstBuild);
  const again = emitCatalog(initial, "1.3.9.2055", [second], build());
  assert.equal(again.profiles.length, 1);
  assert.equal(again.profiles[0].id, initial.profiles[0].id);
  const changed = emitCatalog(again, "1.3.9.2055", [first], build("C".repeat(64)));
  assert.equal(changed.profiles.length, 2);
  assert.notEqual(changed.profiles[0].id, changed.profiles[1].id);
});

test("different CEF snapshots retain separate profiles even when xpui content is identical", () => {
  const firstBuild = build();
  const initial = emitCatalog({ spotify: {} }, "1.3.9.2055", [first], firstBuild);
  const secondBuild = { ...build(), snapshotSha256: "C".repeat(64) };
  const secondResult = emitCatalog(initial, "1.3.9.2055", [first], secondBuild);
  const thirdResult = emitCatalog(secondResult, "1.3.9.2055", [first], { ...build(), snapshotSha256: "D".repeat(64) });
  assert.equal(thirdResult.profiles.length, 3);
  assert.equal(new Set(thirdResult.profiles.map((profile) => profile.id)).size, 3);
});

test("Windows legacy emission preserves existing schema 2 platform profiles", () => {
  const existing = emitCatalog({ spotify: {} }, "1.3.9.2055", [first], build());
  const result = emitCatalog(existing, "1.3.10.1", [second], null);
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.profiles, existing.profiles);
  assert.deepEqual(result.spotify["1.3.10.1"], [second]);
  assert.throws(() => emitCatalog(existing, "1.3.9.2055", [first, first], build()), /Repeated mapping/);
});
