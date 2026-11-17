import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const names = JSON.parse(readFileSync(root + "names2.json", "utf8")).names;
const byName = new Map(Object.entries(names).map(([h, v]) => [v.stable, h]));
const spa = join(root, "spa");
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const css = walk(spa)
  .filter((f) => f.endsWith(".css") && !f.includes("pip-mini-player"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const rename = (s) =>
  s.replace(/\.([A-Za-z0-9_-]{20,21})(?![A-Za-z0-9_-])/g, (m, c) => (names[c] ? "." + names[c].stable : m));
for (const arg of process.argv.slice(2)) {
  const h = byName.get(arg) || arg;
  const re = new RegExp("[^{}]*\\." + h.replace(/[-]/g, "\\-") + "(?![A-Za-z0-9_-])[^{}]*\\{[^{}]*\\}", "g");
  const rules = [...new Set((css.match(re) || []).map((r) => rename(r.trim())))].slice(0, 4);
  console.log("## " + arg + " (" + h + ")");
  for (const r of rules) console.log("   " + r.replace(/\s+/g, " ").slice(0, 260));
}
