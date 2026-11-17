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
const { classes } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const mods = JSON.parse(readFileSync(root + "modules.json", "utf8"));
let js = Object.values(mods).join("\n");
for (const f of walk(spa).filter((f) => f.endsWith(".js"))) js += "\n" + readFileSync(f, "utf8");
const isHash = (c) =>
  (c.length === 20 || (c.length === 21 && c[0] === "_")) && /[A-Z]/.test(c) && /[a-z]/.test(c) && /\d/.test(c);
const found = new Map();
for (const m of js.matchAll(
  /className\s*[:=]\s*"([^"]{20,200})"|[(,{]\s*"?([A-Za-z0-9_-]{20,21})"?\s*:\s*[^,}]{1,40}[,}]|\(\s*"([A-Za-z0-9_-]{20,21})"\s*[,)]/g
)) {
  for (const t of (m[1] || m[2] || m[3]).split(/\s+/))
    if (isHash(t) && !classes[t]) found.set(t, (found.get(t) || 0) + 1);
}
console.log("js-only candidates", found.size);
for (const [c] of [...found].slice(0, 25)) {
  const i = js.indexOf(c);
  console.log(c, JSON.stringify(js.slice(i - 80, i + 40)));
}
