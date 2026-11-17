import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const curatedPath = decodeURIComponent(new URL("../curated-names.json", import.meta.url).pathname).replace(
  /^\/(\w:)/,
  "$1"
);
const [mode = "visible", sizeArg = "20"] = process.argv.slice(2);
const size = +sizeArg;
const { classes } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const names = JSON.parse(readFileSync(root + "names2.json", "utf8")).names;
const curated = existsSync(curatedPath) ? JSON.parse(readFileSync(curatedPath, "utf8")) : {};
const cap = existsSync(root + "cap/info.json") ? JSON.parse(readFileSync(root + "cap/info.json", "utf8")) : {};
const dir = join(root, "review");
mkdirSync(dir, { recursive: true });
const idsPath = join(dir, "ids.json");
const ids = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, "utf8")) : {};
const idOf = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
const nextId = () => "#" + (Object.keys(ids).length + 1);
const nameOf = (c) => curated[c] || names[c]?.stable || c;

const spa = join(root, "spa");
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === "spotikit" ? [] : walk(p)) : [p];
  });
const css = walk(spa)
  .filter((f) => f.endsWith(".css") && !f.includes("pip-mini-player"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const ruleIndex = new Map();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const t of m[1].matchAll(/\.([A-Za-z0-9_-]{20,21}|_[A-Za-z0-9-]+_[a-z0-9]{5}_\d+)(?![A-Za-z0-9_-])/g)) {
    const list = ruleIndex.get(t[1]) ?? ruleIndex.set(t[1], []).get(t[1]);
    if (list.length < 3) list.push(m[0]);
  }
}
const rename = (s) =>
  s.replace(/\.([A-Za-z0-9_-]{20,21})(?![A-Za-z0-9_-])/g, (m, c) =>
    classes[c] ? "." + (idOf.has(c) ? idOf.get(c) : nameOf(c)) : m
  );

const mods = JSON.parse(readFileSync(root + "modules.json", "utf8"));
const jsSources = [
  ...Object.values(mods),
  ...walk(spa)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(f, "utf8")),
];
const sourceAround = (c, radius = 230) => {
  for (const src of jsSources) {
    const i = src.indexOf(c);
    if (i < 0) continue;
    return src
      .slice(Math.max(0, i - radius), i + radius)
      .replace(/[A-Za-z0-9_-]{20,21}/g, (m) => (m === c ? "<<HERE>>" : classes[m] ? nameOf(m) : m))
      .replace(/\s+/g, " ");
  }
  return null;
};

const todo = Object.keys(classes).filter(
  (c) => !/^e-\d+-/.test(c) && !curated[c] && (mode === "visible" ? cap[c] : !cap[c])
);
if (mode === "visible")
  todo.sort(
    (a, b) => cap[a].frame.localeCompare(cap[b].frame) || cap[a].rect.y - cap[b].rect.y || cap[a].rect.x - cap[b].rect.x
  );
for (const c of todo)
  if (!idOf.has(c)) {
    const k = nextId();
    ids[k] = c;
    idOf.set(c, k);
  }
writeFileSync(idsPath, JSON.stringify(ids));

const short = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s);
let batch = 0;
for (let i = 0; i < todo.length; i += size) {
  const part = todo.slice(i, i + size);
  const lines = [],
    text = [];
  for (const c of part) {
    const k = idOf.get(c),
      e = classes[c],
      d = cap[c];
    lines.push(k + " " + c);
    const el = e.el[0];
    const bits = [k, "now=" + nameOf(c)];
    if (d)
      bits.push(
        `[${d.where}] <${d.tag}${d.testid ? " testid=" + d.testid : ""}${d.role ? " role=" + d.role : ""}> ${d.w}x${d.h}` +
          (d.aria ? ` aria="${d.aria}"` : "") +
          (d.text ? ` text="${short(d.text, 60)}"` : "") +
          (d.anc?.length ? " in " + d.anc.slice(0, 3).join(" < ") : "")
      );
    if (e.exports.length) bits.push("module-name=" + e.exports.join("/"));
    if (el)
      bits.push(
        `jsx <${el.tag}${el["data-testid"] ? " testid=" + el["data-testid"] : ""}${el.role ? " role=" + el.role : ""}${el.as ? " as=" + el.as : ""}${el.variant ? " variant=" + el.variant : ""}>` +
          (el.keys?.length ? " keys=" + el.keys.slice(0, 2).join(",") : "") +
          (el.mod ? " modifier-if=" + short(el.mod.cond, 40) : "") +
          (el.siblings?.length
            ? " with=" +
              el.siblings
                .map((s) => (classes[s] ? nameOf(s) : s))
                .slice(0, 3)
                .join(",")
            : "") +
          (el.parents?.length
            ? " parent=" +
              el.parents
                .slice(0, 2)
                .map(
                  (p) =>
                    p.testid ||
                    (p.cls || [])
                      .map((s) => (classes[s] ? nameOf(s) : s))
                      .slice(0, 2)
                      .join(".") ||
                    p.tag
                )
                .join(" < ")
            : "") +
          (el.sub?.testids?.length || el.sub?.keys?.length
            ? " kids=" + [...(el.sub.testids || []), ...(el.sub.keys || [])].slice(0, 3).join(",")
            : "")
      );
    if (e.props.length) bits.push("prop=" + e.props.slice(0, 2).join(","));
    if (mode !== "visible") {
      const s = sourceAround(c);
      if (s) bits.push("src: " + s);
    } else if (!el && e.snips?.length) bits.push("code=" + short(e.snips[0].replace(/\s+/g, " "), 200));
    const rules = (ruleIndex.get(c) || []).map((r) => short(rename(r.replace(/\s+/g, " ").trim()), 170));
    if (rules.length) bits.push("css: " + rules.slice(0, 2).join(" | "));
    bits.push("files=" + e.css.slice(0, 2).join(","));
    text.push(bits.join("\n   "));
  }
  const b = String(batch++).padStart(3, "0");
  writeFileSync(join(dir, `${mode}-${b}.list`), lines.join("\n"));
  writeFileSync(join(dir, `${mode}-${b}.txt`), text.join("\n"));
}
console.log(mode, "classes", todo.length, "batches", batch);
