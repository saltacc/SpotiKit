import assert from "node:assert/strict";
import test from "node:test";
import { deriveMappings, normalizeCssRule, readPortReport } from "../scripts/derive-platform.mjs";

const generated = "Abcdefghijklmnopqrst";
const next = "Bcdefghijklmnopqrstu";
const other = "Cdefghijklmnopqrstuv";
const snapshot = (css, extra = {}) => ({ classes: { [generated]: { stable: "main-panel", css, ...extra } } });
const evidence = (...names) => ({ classes: Object.fromEntries(names.map((name) => [name, { el: [], exports: [] }])) });
const rule = (name, decls) => ({ selector: "." + name, decls, media: "" });

test("an exact fingerprint translates generated references while retaining declarations", () => {
  const result = deriveMappings({ snapshot: snapshot([".&{height:100%;width:100%}"]), evidence: evidence(next),
    rules: [rule(next, ["height:100%", "width:100%"])] });
  assert.equal(result.mappings[0].generated, next);
  assert.equal(result.mappings[0].stable, "main-panel");
  assert.equal(result.accepted[0].evidence[0].type, "unique-exact-css-fingerprint");
});

test("identical CSS candidates remain unresolved without independent evidence", () => {
  const result = deriveMappings({ snapshot: snapshot([".&{color:red}"]), evidence: evidence(next, other),
    rules: [rule(next, ["color:red"]), rule(other, ["color:red"])] });
  assert.equal(result.mappings.length, 0);
  assert.equal(result.unresolved[0].candidates.length, 2);
});

test("an exported semantic name resolves otherwise identical stylesheet candidates", () => {
  const current = evidence(next, other);
  current.classes[next].exports = ["playlistHeaderArtwork"];
  const result = deriveMappings({ snapshot: snapshot([".&{color:red}"], { exports: ["playlistHeaderArtwork"] }), evidence: current,
    rules: [rule(next, ["color:red"]), rule(other, ["color:red"])] });
  assert.equal(result.mappings[0].generated, next);
  assert.equal(result.accepted[0].evidence[0].type, "exact-css-distinguished-by-semantics");
});

test("a high numeric port score alone cannot authorize a guessed class", () => {
  const result = deriveMappings({ snapshot: snapshot([".&{color:red}"]), evidence: evidence(next),
    rules: [rule(next, ["color:blue"])],
    proposals: new Map([["main-panel", { generated: next, score: 0.99, margin: 0.9 }]]) });
  assert.equal(result.mappings.length, 0);
});

test("observations require provenance and cannot introduce an absent class", () => {
  assert.throws(() => deriveMappings({ snapshot: snapshot([]), evidence: evidence(next), rules: [],
    observations: [{ generated: next, stable: "main-panel" }] }), /evidence description/);
  const result = deriveMappings({ snapshot: snapshot([]), evidence: evidence(next), rules: [],
    observations: [{ generated: other, stable: "main-panel", evidence: { description: "test attribute" } }] });
  assert.equal(result.mappings.length, 0);
  assert.equal(result.rejected.length, 1);
});

test("the normalizer preserves literal values and public classes", () => {
  assert.equal(normalizeCssRule('.& .@main-panel{color:#123456;content:"hello"}', new Set()), '.& .#{color:#123456;content:"hello"}');
  assert.equal(normalizeCssRule('.& .public{padding:.5px}', new Set()), '.& .public{padding:.5px}');
});

test("generated keyframe identities may differ while timing and declarations remain significant", () => {
  const names = new Set();
  assert.equal(normalizeCssRule(`.&{animation:.2s ease-in ${generated}}`, names), '.&{animation:.2s ease-in $keyframe}');
  assert.notEqual(normalizeCssRule(`.&{animation:.2s linear ${generated}}`, names), normalizeCssRule(`.&{animation:.3s linear ${next}}`, names));
});

test("a real element tag can distinguish structurally identical section and wrapper styles", () => {
  const current = evidence(next, other);
  current.classes[next].el = [{ tag: "section" }];
  current.classes[other].el = [{ tag: "div" }];
  const result = deriveMappings({ snapshot: snapshot([".&{color:red}"], { jsx: [{ tag: "section" }] }), evidence: current,
    rules: [rule(next, ["color:red"]), rule(other, ["color:red"])] });
  assert.equal(result.mappings[0].generated, next);
});

test("semantic correspondence wins over a stylesheet-only alias regardless of source ordering", () => {
  const previous = { classes: {
    [other]: { stable: "unused-style-alias", css: [".&{color:red}", ".&:hover{color:blue}"] },
    [generated]: { stable: "main-panel", css: [".&{color:red}", ".&:hover{color:blue}"], exports: ["homepageContent"] },
  } };
  const current = evidence(next);
  current.classes[next].exports = ["homepageContent"];
  const result = deriveMappings({ snapshot: previous, evidence: current,
    rules: [rule(next, ["color:red"]), { selector: "." + next + ":hover", decls: ["color:blue"], media: "" }] });
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].stable, "main-panel");
});

test("a matching component property and already mapped parent distinguish identical CSS", () => {
  const parentOld = "Ddefghijklmnopqrstuv";
  const parentNew = "Edefghijklmnopqrstuv";
  const previous = { classes: {
    [generated]: { stable: "main-panel", css: [".&{color:red}"], jsx: [{ props: ["columnCount"], parents: [{ cls: ["@sidebar"] }] }] },
    [parentOld]: { stable: "sidebar", css: [".&{display:grid}"] },
  } };
  const current = evidence(next, other, parentNew);
  current.classes[next].el = [{ fnProps: ["columnCount"], parents: [{ cls: [parentNew] }] }];
  current.classes[other].el = [{ fnProps: ["columnCount"] }];
  const result = deriveMappings({ snapshot: previous, evidence: current,
    rules: [rule(next, ["color:red"]), rule(other, ["color:red"]), rule(parentNew, ["display:grid"])] });
  assert.equal(result.mappings.find((mapping) => mapping.stable === "main-panel").generated, next);
});

test("the report parser keeps score and margin attached to the proposal", () => {
  const rows = readPortReport(`| main-panel | ${generated} → ${next} | 0.93 | 0.22 |`);
  assert.deepEqual(rows.get("main-panel"), { old: generated, generated: next, score: 0.93, margin: 0.22 });
});
