import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const HASH = /^[A-Za-z0-9_-]{20,21}$/;

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "spotikit" ? [] : walk(p)) : [p];
  });

export function readCssRules(spaDir) {
  const rules = [];
  for (const file of walk(spaDir).filter((f) => f.endsWith(".css"))) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    parseBlock(css, 0, css.length, [], rules);
  }
  return rules;
}

function parseBlock(css, from, to, context, out) {
  let i = from;
  while (i < to) {
    const open = css.indexOf("{", i);
    if (open < 0 || open >= to) return;
    const prelude = css.slice(i, open).trim();
    let depth = 1,
      j = open + 1;
    while (j < to && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) {
      if (/^@(media|supports|container|layer)/.test(prelude))
        parseBlock(css, open + 1, j - 1, context.concat(prelude.replace(/\s+/g, " ")), out);
    } else if (prelude) {
      const decls = body
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d.includes(":"))
        .map((d) => {
          const k = d.indexOf(":");
          return (
            d.slice(0, k).trim().toLowerCase() +
            ":" +
            d
              .slice(k + 1)
              .trim()
              .replace(/\s+/g, " ")
          );
        })
        .sort();
      for (const selector of splitSelectors(prelude)) out.push({ media: context.join(" "), selector, decls });
    }
    i = j;
  }
}

function splitSelectors(list) {
  const parts = [""];
  let nested = 0;
  for (const ch of list) {
    if (ch === "," && !nested) {
      parts.push("");
      continue;
    }
    if ("([".includes(ch)) nested++;
    if (")]".includes(ch)) nested--;
    parts[parts.length - 1] += ch;
  }
  return parts.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

const CLASS_IN_SELECTOR = /\.((?:\\.|[A-Za-z0-9_-])+)/g;

export function indexRules(rules) {
  const index = new Map();
  rules.forEach((r, i) => {
    for (const m of r.selector.matchAll(CLASS_IN_SELECTOR)) {
      const c = m[1];
      if (!index.has(c)) index.set(c, []);
      const list = index.get(c);
      if (list[list.length - 1] !== i) list.push(i);
    }
  });
  return index;
}

export function namer(self, nameOf) {
  return (c) => (c === self ? "&" : nameOf(c) ? "@" + nameOf(c) : HASH.test(c) || /^e-\d+-/.test(c) ? "#" : c);
}

const mapClasses = (list, name) =>
  (Array.isArray(list) ? list : String(list || "").split(/\s+/)).filter(Boolean).map(name);

export function fingerprint(cls, evidence, rules, ruleIndex, nameOf) {
  const name = namer(cls, nameOf);
  const css = (ruleIndex.get(cls) || []).slice(0, 40).map((i) => {
    const r = rules[i];
    const selector = r.selector.replace(CLASS_IN_SELECTOR, (_, c) => "." + name(c));
    return (r.media ? r.media + " " : "") + selector + "{" + r.decls.join(";") + "}";
  });
  const ev = evidence || {};
  const jsx = (ev.el || []).slice(0, 8).map((e) => ({
    tag: e.tag,
    type: e.type,
    testid: e.testid,
    keys: e.keys && e.keys.length ? e.keys : undefined,
    props: e.fnProps && e.fnProps.length ? [...e.fnProps].sort() : undefined,
    parents: (e.parents || []).slice(0, 4).map((p) => ({ tag: p.tag, testid: p.testid, cls: mapClasses(p.cls, name) })),
    siblings: (e.siblings || [])
      .slice(0, 6)
      .map((s) => (typeof s === "string" ? name(s) : { tag: s.tag, cls: mapClasses(s.cls, name) })),
    sub:
      e.sub && (e.sub.testids?.length || e.sub.cls?.length)
        ? { testids: e.sub.testids, cls: mapClasses(e.sub.cls, name).slice(0, 8) }
        : undefined,
  }));
  const dom = ev.dom
    ? {
        n: ev.dom.n,
        routes: [...new Set((ev.dom.routes || []).map(route))],
        samples: (ev.dom.samples || []).slice(0, 4).map((s) => ({
          tag: s.tag,
          testid: s.testid,
          role: s.role,
          type: s.type,
          kids: s.kids,
          anc: (s.anc || []).map((a) => ({ d: a.d, t: a.t || undefined, tag: a.tag, cls: mapClasses(a.sc, name) })),
        })),
      }
    : undefined;
  return {
    css: css.length ? css : undefined,
    exports: ev.exports && ev.exports.length ? ev.exports : undefined,
    jsx: jsx.length ? jsx : undefined,
    dom,
  };
}

export function route(r) {
  return String(r)
    .split("?")[0]
    .replace(/^\/intl-[a-z-]+/, "")
    .replace(
      /\/(user|artist|album|playlist|track|show|episode|audiobook|genre|section|concert|search)\/[^/]+/g,
      "/$1/ID"
    );
}

export function tokens(fp) {
  const t = new Map();
  const add = (k, w) => t.set(k, Math.max(t.get(k) || 0, w));
  for (const rule of fp.css || []) {
    add("R:" + rule, 3);
    const brace = rule.indexOf("{");
    add("S:" + rule.slice(0, brace), 1.5);
    for (const d of rule.slice(brace + 1, -1).split(";")) if (d) add("D:" + d, 0.4);
  }
  for (const x of fp.exports || []) add("X:" + x, 4);
  for (const e of fp.jsx || []) {
    if (e.testid) add("T:" + e.testid, 3);
    add("G:" + e.tag + (e.type ? ":" + e.type : ""), 0.3);
    for (const p of e.props || []) add("P:" + p, 0.8);
    for (const k of e.keys || []) add("K:" + k, 1.5);
    for (const p of e.parents || []) {
      if (p.testid) add("PT:" + p.testid, 1.5);
      for (const c of p.cls || []) if (c !== "#") add("PC:" + c, 1.2);
    }
    for (const s of e.siblings || [])
      for (const c of typeof s === "string" ? [s] : s.cls || []) if (c !== "#") add("SC:" + c, 0.8);
    for (const id of e.sub?.testids || []) add("ST:" + id, 1);
  }
  for (const s of fp.dom?.samples || []) {
    if (s.testid) add("DT:" + s.testid, 2);
    add("DG:" + s.tag, 0.2);
    for (const a of s.anc || []) {
      if (a.t) add("DAT:" + a.t, 0.8);
      for (const c of a.cls || []) if (c !== "#") add("DAC:" + c, 0.5);
    }
  }
  return t;
}

export function similarity(a, b) {
  let inter = 0,
    union = 0;
  for (const [k, w] of a) {
    const v = b.get(k);
    if (v) inter += Math.min(w, v);
    union += Math.max(w, v || 0);
  }
  for (const [k, w] of b) if (!a.has(k)) union += w;
  return union ? inter / union : 0;
}
