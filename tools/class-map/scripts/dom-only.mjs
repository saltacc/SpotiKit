import { readFileSync, readdirSync } from "node:fs";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const { classes } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const out = new Map();
for (const f of readdirSync(root).filter((n) => /^dom\d*\.json$/.test(n))) {
  const j = JSON.parse(readFileSync(root + f, "utf8"));
  for (const [c, d] of Object.entries(j.data)) if (!classes[c]) out.set(c, d);
}
console.log("dom-only generated classes:", out.size);
for (const [c, d] of [...out].slice(0, 30))
  console.log(c, d.n, d.routes.slice(0, 2).join(","), JSON.stringify(d.samples[0]).slice(0, 160));
