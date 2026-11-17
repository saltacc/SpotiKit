import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { build } from "../lib/build.mjs";
import { check } from "../lib/check.mjs";
import { create, projectFiles } from "../lib/create.mjs";
import { pack } from "../lib/pack.mjs";
import { idFor } from "../lib/project.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "spotikit-kit-"));
const errors = (issues) => issues.filter((i) => i.level === "error");

test("ids follow the SpotiKit app", () => {
  assert.equal(idFor("Ocean Glass!"), "ocean-glass");
  assert.equal(idFor("1 Thing"), "x-1-thing");
  assert.equal(idFor("a".repeat(50)).length, 40);
});

test("every kind is created and passes its own check", async () => {
  for (const kind of ["theme", "extension", "app", "snippet"]) {
    const dir = join(temp(), "proj");
    create(dir, { kind, name: "Test " + kind, spotify: "1.3.8" });
    const issues = await check(dir, { types: false });
    assert.deepEqual(errors(issues), [], kind + ": " + JSON.stringify(errors(issues)));
    const manifest = JSON.parse(readFileSync(join(dir, "spotikit.json"), "utf8"));
    assert.equal(manifest.type, kind);
    assert.equal(manifest.spotify, "1.3.8");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a TypeScript project builds into dist and checks clean", async () => {
  const dir = join(temp(), "ts");
  create(dir, { kind: "app", name: "Typed App", typescript: true, spotify: "1.3.8" });
  const manifest = JSON.parse(readFileSync(join(dir, "spotikit.json"), "utf8"));
  assert.equal(manifest.source, "src/index.tsx");
  assert.equal(manifest.main, "dist/index.js");
  assert.ok(errors(await check(dir, { types: false })).some((i) => /isn't built yet/.test(i.message)));
  await build(dir);
  const out = readFileSync(join(dir, "dist", "index.js"), "utf8");
  assert.match(out, /SpotiKit\.React\.createElement/);
  assert.match(out, /export \{|export default/);
  assert.deepEqual(errors(await check(dir, { types: false })), []);
});

test("snippets can't be TypeScript", () => {
  assert.throws(() => projectFiles({ kind: "snippet", name: "X", typescript: true }), /CSS only/);
});

test("check finds broken manifests, code and Spotify's generated class names", async () => {
  const dir = temp();
  writeFileSync(join(dir, "spotikit.json"), JSON.stringify({ type: "snippet", name: "Bad", spotify: "next week", style: "a.css", main: "x.js" }));
  writeFileSync(join(dir, "a.css"), ".Ix6_BK8pqqB_TtYr8HgO { color: red }\n.main-view { color: blue }\n");
  writeFileSync(join(dir, "broken.js"), "const = 1;");
  writeFileSync(join(dir, "fine.js"), "this._isDraggingSelection = gl.framebufferTexture2D;\n");
  const issues = await check(dir, { types: false });
  const text = issues.map((i) => `${i.level} ${i.file} ${i.message}`).join("\n");
  assert.match(text, /error spotikit\.json "spotify" "next week"/);
  assert.match(text, /can't have "main"/);
  assert.match(text, /error broken\.js/);
  assert.match(text, /warning a\.css "\.Ix6_BK8pqqB_TtYr8HgO" looks like/);
  assert.doesNotMatch(text, /main-view|isDraggingSelection|framebufferTexture2D/);
});

test("pack zips what Spotify needs and leaves the TypeScript tooling out", async () => {
  const dir = join(temp(), "packme");
  create(dir, { kind: "extension", name: "Packed", typescript: true, spotify: "1.3.8" });
  await build(dir);
  const out = temp();
  const result = pack(dir, { out });
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  const zip = readFileSync(result.file);
  const names = [];
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50; ) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.toString("utf8", at + 30, at + 30 + nameLength);
    const body = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    if (name === "spotikit.json") assert.equal(JSON.parse(zip.readUInt16LE(at + 8) === 8 ? inflateRawSync(body) : body).main, "dist/extension.js");
    names.push(name);
    at += 30 + nameLength + size;
  }
  assert.ok(names.includes("dist/extension.js"));
  assert.ok(names.includes("spotikit.json"));
  assert.ok(!names.some((n) => n.startsWith("src/") || n === "package.json" || n === "tsconfig.json"));
});
