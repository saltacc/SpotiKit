import { readFileSync } from "node:fs";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const mods = JSON.parse(readFileSync(root + "modules.json", "utf8"));
const [needle, radius = 1500, max = 3] = process.argv.slice(2);
let hits = 0;
for (const [id, s] of Object.entries(mods)) {
  let i = s.indexOf(needle);
  while (i >= 0 && hits < +max) {
    hits++;
    console.log("=== m" + id + " @" + i);
    console.log(s.slice(Math.max(0, i - +radius), i + +radius));
    i = s.indexOf(needle, i + 1);
  }
}
