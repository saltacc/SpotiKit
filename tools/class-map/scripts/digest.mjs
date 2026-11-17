import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const [mode = "dom", fromArg = "0", countArg = "120"] = process.argv.slice(2);
const names = JSON.parse(readFileSync(root + "names2.json", "utf8")).names;
const ev = JSON.parse(readFileSync(root + "evidence2.json", "utf8")).classes;
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
const nameOf = (c) => overrides[c] || names[c]?.stable;
const isWeak = (c) =>
  !overrides[c] &&
  names[c] &&
  !c.startsWith("e-") &&
  (/numbered|^box|^element/.test(names[c].why) || /(^|-)box(-|$)/.test(names[c].stable));
let weak = Object.keys(names).filter(isWeak);
if (mode === "dom") weak = weak.filter((c) => ev[c].dom);
const weakSet = new Set(weak);
const ids = existsSync(root + "digest-ids.json") ? JSON.parse(readFileSync(root + "digest-ids.json", "utf8")) : {};
const idOf = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
let next = Object.keys(ids).length;
const shortId = (c) => {
  if (!idOf.has(c)) {
    const k = "#" + next++;
    idOf.set(c, k);
    ids[k] = c;
  }
  return idOf.get(c);
};

const spa = join(root, "spa");
const walkDir = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === "spotikit" ? [] : walkDir(p)) : [p];
  });
const mods = JSON.parse(readFileSync(join(root, "modules.json"), "utf8"));
const sources = [];
for (const [id, src] of Object.entries(mods)) sources.push({ name: "m" + id, code: src, wrap: true });
for (const f of walkDir(spa).filter((f) => f.endsWith(".js")))
  sources.push({ name: f.slice(spa.length + 1), code: readFileSync(f, "utf8"), wrap: false });

const lit = (n) =>
  n && n.type === "Literal" && typeof n.value === "string"
    ? n.value
    : n && n.type === "TemplateLiteral" && n.expressions.length === 0
      ? n.quasis[0].value.cooked
      : null;
const keyName = (p) =>
  p.computed
    ? lit(p.key)
    : p.key.type === "Identifier"
      ? p.key.name
      : typeof p.key.value === "string"
        ? p.key.value
        : null;
const isJsxCall = (n) => {
  if (!n || n.type !== "CallExpression" || n.arguments.length < 2) return false;
  let c = n.callee;
  if (c.type === "SequenceExpression") c = c.expressions[c.expressions.length - 1];
  return (
    c.type === "MemberExpression" && !c.computed && ["jsx", "jsxs", "jsxDEV", "createElement"].includes(c.property.name)
  );
};
const i18n = (n) =>
  n.type === "CallExpression" &&
  n.callee.type === "MemberExpression" &&
  !n.callee.computed &&
  n.callee.property.name === "get" &&
  n.arguments.length &&
  lit(n.arguments[0]) &&
  /^[a-z0-9_]+\.[a-z0-9_.-]+$/i.test(lit(n.arguments[0]))
    ? lit(n.arguments[0])
    : null;

const order = Object.keys(ev);
const wanted = new Set(weak.slice(+fromArg, +fromArg + +countArg));
const done = new Set();
const blocks = [];
const seenRoots = new Set();

for (const s of sources) {
  if (done.size >= wanted.size) break;
  if (![...wanted].some((c) => !done.has(c) && s.code.includes(c))) continue;
  let ast = null,
    code = s.code;
  for (const [a, b] of s.wrap ? [["({", "})"]] : [["", ""]]) {
    try {
      ast = acorn.parse(a + s.code + b, {
        ecmaVersion: "latest",
        sourceType: "script",
        allowReturnOutsideFunction: true,
      });
      code = a + s.code + b;
    } catch {}
  }
  if (!ast) continue;
  const roots = [];
  walk.fullAncestor(ast, (n, _s, anc) => {
    if (!isJsxCall(n)) return;
    if (anc.slice(0, -1).some(isJsxCall)) return;
    const text = code.slice(n.start, n.end);
    if (
      [...wanted].some(
        (c) => (!done.has(c) && text.includes('"' + c)) || text.includes(c + '"') || text.includes(c + ":")
      )
    )
      roots.push(n);
  });
  for (const r of roots) {
    const text = code.slice(r.start, r.end);
    if (seenRoots.has(text)) continue;
    seenRoots.add(text);
    const lines = [];
    const render = (n, depth) => {
      if (lines.length > 80) return;
      const [tag, props] = n.arguments;
      let head = lit(tag) ?? "C";
      const bits = [],
        kids = [];
      if (props && props.type === "ObjectExpression") {
        const pk = [];
        for (const p of props.properties) {
          if (p.type !== "Property") {
            pk.push("...");
            continue;
          }
          const k = keyName(p);
          if (!k) continue;
          if (k === "className" || /ClassName$/.test(k)) {
            const cl = [];
            walk.full(p.value, (x) => {
              const v = lit(x);
              if (v) for (const t of v.split(/\s+/)) if (t) cl.push(t);
              if (x.type === "ObjectExpression")
                for (const q of x.properties)
                  if (q.type === "Property" && keyName(q))
                    cl.push(
                      "?" +
                        keyName(q) +
                        "[" +
                        code.slice(q.value.start, Math.min(q.value.end, q.value.start + 30)) +
                        "]"
                    );
            });
            const shown = cl.map((t) => {
              const m = t.startsWith("?");
              const c = m ? t.slice(1).replace(/\[.*$/, "") : t;
              const cond = m ? t.slice(t.indexOf("[")) : "";
              const nm = nameOf(c);
              if (!nm) return (m ? "?" : "") + t.slice(m ? 1 : 0);
              const mark = weakSet.has(c) ? shortId(c) + "=" : "";
              if (wanted.has(c)) done.add(c);
              return (m ? "?" : "") + mark + nm + cond;
            });
            bits.push((k === "className" ? "." : k + ":.") + shown.join(" ."));
          } else if (k === "children") {
            walk.full(p.value, () => {});
            const visit = (x) => {
              if (!x) return;
              if (isJsxCall(x)) {
                kids.push(x);
                return;
              }
              const key = i18n(x);
              if (key) {
                bits.push("«" + key + "»");
                return;
              }
              const v = lit(x);
              if (v && v.trim()) {
                bits.push('"' + v.slice(0, 30) + '"');
                return;
              }
              if (/Function/.test(x.type)) return;
              for (const kk of Object.keys(x)) {
                if (kk === "type" || kk === "start" || kk === "end") continue;
                const v2 = x[kk];
                if (Array.isArray(v2)) v2.forEach(visit);
                else if (v2 && typeof v2.type === "string") visit(v2);
              }
            };
            visit(p.value);
          } else {
            const v = lit(p.value);
            let key = null;
            walk.full(p.value, (x) => {
              key = key || i18n(x);
            });
            if (
              ["data-testid", "role", "as", "variant", "type", "id", "data-encore-id", "aria-hidden"].includes(k) &&
              v
            )
              bits.push(k.replace("data-", "") + "=" + v.slice(0, 40));
            else if (key) bits.push(k + "«" + key + "»");
            else if (!["style", "ref", "key", "onClick", "onKeyDown", "tabIndex"].includes(k)) pk.push(k);
          }
        }
        if (head === "C" && pk.length) head = "C{" + pk.slice(0, 7).join(",") + "}";
      }
      lines.push("  ".repeat(depth) + head + (bits.length ? " " + bits.join(" ") : ""));
      for (const k of kids) render(k, depth + 1);
    };
    render(r, 0);
    if (lines.some((l) => l.includes("#"))) blocks.push("## " + s.name + "\n" + lines.join("\n"));
  }
}
writeFileSync(root + "digest-ids.json", JSON.stringify(ids));
const cssText = walkDir(spa)
  .filter((f) => f.endsWith(".css") && !f.includes("pip-mini-player"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const renameCss = (s) =>
  s.replace(/\.([A-Za-z0-9_-]{20,21})(?![A-Za-z0-9_-])/g, (m, c) =>
    nameOf(c) ? "." + (idOf.has(c) && weakSet.has(c) ? idOf.get(c) : nameOf(c)) : m
  );
const cssLines = [];
for (const c of done) {
  const re = new RegExp("[^{}]*\\." + c.replace(/-/g, "\\-") + "(?![A-Za-z0-9_-])[^{}]*\\{[^{}]*\\}", "g");
  const rules = [
    ...new Set(
      (cssText.match(re) || []).map((r) =>
        renameCss(r.trim())
          .replace(/\/\*.*?\*\//g, "")
          .replace(/\s+/g, " ")
      )
    ),
  ];
  rules.sort((a, b) => a.length - b.length);
  cssLines.push(
    idOf.get(c) +
      " " +
      (rules
        .slice(0, 2)
        .map((r) => r.slice(0, 150))
        .join(" | ") || "(no rule)")
  );
}
blocks.push("## CSS\n" + cssLines.join("\n"));
const out = blocks.join("\n\n");
writeFileSync(root + `digest-${mode}-${fromArg}.txt`, out);
console.log(
  "weak",
  weak.length,
  "wanted",
  wanted.size,
  "covered",
  done.size,
  "blocks",
  blocks.length,
  "chars",
  out.length
);
const missing = [...wanted].filter((c) => !done.has(c));
if (missing.length)
  console.log(
    "not in trees:",
    missing
      .slice(0, 20)
      .map((c) => shortId(c) + "=" + c + ":" + nameOf(c))
      .join(" ")
  );
writeFileSync(root + "digest-ids.json", JSON.stringify(ids));
