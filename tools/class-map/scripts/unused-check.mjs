import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const spa = join(root, "spa");
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === "spotikit" ? [] : walk(p)) : [p];
  });
const { unused } = JSON.parse(readFileSync(root + "names2.json", "utf8"));
const mods = JSON.parse(readFileSync(root + "modules.json", "utf8"));
let js = Object.values(mods).join("\n");
for (const f of walk(spa).filter((f) => f.endsWith(".js"))) js += "\n" + readFileSync(f, "utf8");
const tokens = new Set(js.match(/[A-Za-z0-9_-]{20,21}/g));
const found = unused.filter((c) => tokens.has(c));
console.log("unused", unused.length, "found in JS", found.length);
for (const c of found.slice(0, 8)) {
  const i = js.indexOf(c);
  console.log(c, JSON.stringify(js.slice(i - 90, i + 40)));
}
