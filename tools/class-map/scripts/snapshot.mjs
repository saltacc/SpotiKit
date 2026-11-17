import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readCssRules, indexRules, fingerprint } from "./fingerprint.mjs";

const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const [version, out] = process.argv.slice(2);
if (!version || !out) {
  console.error("usage: node snapshot.mjs <spotify version> <out file>");
  process.exit(2);
}

const map = JSON.parse(readFileSync(new URL("../../../Framework/class-map.json", import.meta.url), "utf8")).spotify[
  version
];
if (!map) throw new Error(`Framework/class-map.json has no classes for Spotify ${version}.`);
const { classes } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const stable = new Map(map.map((m) => [m.generated, m.stable]));
const nameOf = (c) => stable.get(c);

const rules = readCssRules(root + "spa");
const index = indexRules(rules);

const entries = map.map((m) => [
  m.generated,
  {
    stable: m.stable,
    ...(m.runtimeOnly ? { runtimeOnly: true } : {}),
    ...fingerprint(m.generated, classes[m.generated], rules, index, nameOf),
  },
]);
const missing = map.filter((m) => !classes[m.generated]).length;

const header = {
  schemaVersion: 1,
  spotify: version,
  created: new Date().toISOString().slice(0, 10),
  comment:
    "What each class of this Spotify version looks like apart from its generated name: its CSS rules, " +
    "the JSX around it and where it appears in the DOM, with other classes written as their stable names (@name). " +
    "tools/class-map/scripts/port.mjs uses it to carry the names over to a newer Spotify version.",
};
const body = entries.map(([g, fp]) => "    " + JSON.stringify(g) + ": " + JSON.stringify(fp)).join(",\n");
const text =
  "{\n" +
  Object.entries(header)
    .map(([k, v]) => "  " + JSON.stringify(k) + ": " + JSON.stringify(v) + ",\n")
    .join("") +
  '  "classes": {\n' +
  body +
  "\n  }\n}\n";
JSON.parse(text);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(
  `wrote ${entries.length} classes (${missing} without evidence), ${rules.length} css rules read, ${(text.length / 1024 / 1024).toFixed(1)} MB`
);
