import { readFileSync, writeFileSync, existsSync } from "node:fs";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const { classes, existing } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const idFile = existsSync(root + "review/ids.json") ? root + "review/ids.json" : root + "digest-ids.json";
const ids = existsSync(idFile) ? JSON.parse(readFileSync(idFile, "utf8")) : {};
const overrides = existsSync(
  decodeURIComponent(new URL("../curated-names.json", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
)
  ? JSON.parse(
      readFileSync(
        decodeURIComponent(new URL("../curated-names.json", import.meta.url).pathname).replace(/^\/(\w:)/, "$1"),
        "utf8"
      )
    )
  : {};
const taken = new Set(existing);
const NAME = /^[a-z][a-z0-9]*(?:(?:-|--|__)[a-z0-9]+)*$/;
let added = 0,
  errors = 0;
for (const file of process.argv.slice(2)) {
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw
      .replace(/^\uFEFF/, "")
      .replace(/\s+\/\/.*$|^\s*\/\/.*$/, "")
      .trim();
    if (!line) continue;
    const [key, name] = line.split(/\s+/);
    const hash = key.startsWith("#") ? ids[key] : key;
    if (!hash || !classes[hash]) {
      console.log("unknown class", key);
      errors++;
      continue;
    }
    if (!NAME.test(name)) {
      console.log("bad name", name);
      errors++;
      continue;
    }
    if (taken.has(name)) {
      console.log("collides with a Spotify class", name);
      errors++;
      continue;
    }
    overrides[hash] = name;
    added++;
  }
}
const seen = new Map();
for (const [h, n] of Object.entries(overrides)) {
  if (seen.has(n)) {
    console.log("duplicate", n, seen.get(n), h);
    errors++;
  }
  seen.set(n, h);
}
writeFileSync(
  decodeURIComponent(new URL("../curated-names.json", import.meta.url).pathname).replace(/^\/(\w:)/, "$1"),
  JSON.stringify(overrides, null, 1)
);
console.log("added", added, "total", Object.keys(overrides).length, "errors", errors);
