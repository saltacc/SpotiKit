import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const mods = JSON.parse(readFileSync(root + "modules.json", "utf8"));
let n = 0,
  withNames = 0;
const sample = [];
for (const [id, s] of Object.entries(mods)) {
  const names = [...s.matchAll(/\.displayName\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  if (names.length) {
    withNames++;
    n += names.length;
    if (sample.length < 40) sample.push(id + ": " + names.slice(0, 5).join(", "));
  }
}
console.log("modules", Object.keys(mods).length, "with displayName", withNames, "names", n);
console.log(sample.join("\n"));
