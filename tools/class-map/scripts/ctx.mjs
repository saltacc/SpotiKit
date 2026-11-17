import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const ids = JSON.parse(readFileSync(root + "review/ids.json", "utf8"));
const [key, radius = "700"] = process.argv.slice(2);
const hash = key.startsWith("#") ? ids[key] : key;
const mods = JSON.parse(readFileSync(root + "modules.json", "utf8"));
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === "spotikit" ? [] : walk(p)) : [p];
  });
const sources = Object.entries(mods).map(([k, v]) => ["m" + k, v]);
for (const f of walk(join(root, "spa")).filter((f) => f.endsWith(".js"))) sources.push([f, readFileSync(f, "utf8")]);
const names = JSON.parse(readFileSync(root + "names2.json", "utf8")).names;
const rename = (s) =>
  s
    .replace(/"([A-Za-z0-9_-]{20,21})"/g, (m, c) => (names[c] ? `"${c === hash ? "<<HERE>>" : names[c].stable}"` : m))
    .replace(/\b([A-Za-z0-9_-]{20,21})(?=:)/g, (m, c) => (names[c] ? (c === hash ? "<<HERE>>" : names[c].stable) : m));
for (const [name, src] of sources) {
  const i = src.indexOf(hash);
  if (i < 0) continue;
  console.log("== " + name);
  console.log(rename(src.slice(Math.max(0, i - +radius), i + +radius)));
  break;
}
