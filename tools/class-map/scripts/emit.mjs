import { readFileSync, writeFileSync, existsSync } from "node:fs";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const out = process.argv[2];
const version = process.argv[3];
if (!out || !version) {
  console.error("usage: node emit.mjs <class-map.json> <spotify version>");
  process.exit(2);
}
const { names } = JSON.parse(readFileSync(root + "names2.json", "utf8"));
const { classes } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const NAME = /^[a-z][a-z0-9]*(?:(?:-|--|__)[a-z0-9]+)*$/;
const order = Object.keys(classes);
const seen = new Set();
const list = [];
for (const generated of order) {
  const n = names[generated];
  if (!n) continue;
  if (!NAME.test(n.stable)) throw new Error("bad name " + n.stable);
  if (seen.has(n.stable)) throw new Error("duplicate " + n.stable);
  seen.add(n.stable);
  const how = n.why === "curated" ? "named by hand" : n.why.replace(/ \(numbered\)$/, "");
  list.push({
    generated,
    stable: n.stable,
    description: how,
    ...(classes[generated].runtimeOnly ? { runtimeOnly: true } : {}),
  });
}
const comment =
  "Generated Spotify CSS classes and the stable names SpotiKit gives them, per exact Spotify version. " +
  "Built from Spotify's own code (CSS module names, test ids, labels, JSX structure) and its live DOM.";
const versions = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")).spotify || {} : {};
versions[version] = list;
const block = (v, l) => `    ${JSON.stringify(v)}: [\n${l.map((m) => "      " + JSON.stringify(m)).join(",\n")}\n    ]`;
const text =
  `{\n  "schemaVersion": 1,\n  "comment": ${JSON.stringify(comment)},\n  "spotify": {\n` +
  Object.entries(versions)
    .map(([v, l]) => block(v, l))
    .join(",\n") +
  `\n  }\n}\n`;
JSON.parse(text);
writeFileSync(out, text);
console.log(
  "wrote",
  list.length,
  "mappings for",
  version,
  "and kept",
  Object.keys(versions).length - 1,
  "other version(s),",
  text.length,
  "bytes"
);
