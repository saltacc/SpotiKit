import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const spa = join(root, "spa");
const walkDir = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === "spotikit" ? [] : walkDir(p)) : [p];
  });
const files = walkDir(spa);
const isHash = (c) =>
  (c.length === 20 || (c.length === 21 && c[0] === "_")) &&
  /[A-Z]/.test(c) &&
  /[a-z]/.test(c) &&
  /^[A-Za-z0-9_-]+$/.test(c);
const isEncore = (c) => /^e-\d+-/.test(c);
const isVite = (c) => /^_[A-Za-z0-9-]+_[a-z0-9]{5}_\d+$/.test(c);
const generated = (c) => isHash(c) || isEncore(c) || isVite(c);

const cssOrder = new Map();
const cssFiles = new Map();
let pos = 0;
for (const f of files
  .filter((f) => f.endsWith(".css"))
  .sort((a, b) => (a.includes("xpui-snapshot") ? -1 : b.includes("xpui-snapshot") ? 1 : a.localeCompare(b)))) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
    if (!cssOrder.has(m[1])) cssOrder.set(m[1], pos++);
    (cssFiles.get(m[1]) ?? cssFiles.set(m[1], new Set()).get(m[1])).add(f.slice(spa.length + 1));
  }
}
const targets = new Set([...cssOrder.keys()].filter(generated));
const domOnly = new Set();
for (const f of readdirSync(root).filter((n) => /^dom\d*\.json$/.test(n)))
  for (const c of Object.keys(JSON.parse(readFileSync(join(root, f), "utf8")).data))
    if (generated(c) && !targets.has(c)) domOnly.add(c);
for (const c of domOnly) {
  targets.add(c);
  cssOrder.set(c, pos++);
  cssFiles.set(c, new Set());
}

const mods = JSON.parse(readFileSync(join(root, "modules.json"), "utf8"));
const sources = [];
for (const [id, src] of Object.entries(mods)) sources.push({ name: "m" + id, code: src, wrap: true });
for (const f of files.filter((f) => f.endsWith(".js")))
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
const isFn = (n) => n && /Function|ArrowFunction/.test(n.type);
const i18nKey = (n) =>
  n.type === "CallExpression" &&
  n.callee.type === "MemberExpression" &&
  !n.callee.computed &&
  n.callee.property.name === "get" &&
  n.callee.object.type === "MemberExpression" &&
  n.arguments.length >= 1 &&
  lit(n.arguments[0]) &&
  /^[a-z0-9_]+[.][a-z0-9_.-]+$/i.test(lit(n.arguments[0]))
    ? lit(n.arguments[0])
    : null;

function shallow(node, visit) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (n !== node && (isJsxCall(n) || isFn(n))) continue;
    visit(n);
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) for (const x of v) stack.push(x);
      else if (v && typeof v.type === "string") stack.push(v);
    }
  }
}

const fnHints = new WeakMap();
function hintsFor(fn, code) {
  if (!fn) return new Map();
  let h = fnHints.get(fn);
  if (h) return h;
  h = new Map();
  const pattern = (p, name) => {
    if (!p) return;
    if (p.type === "Identifier") {
      if (name) h.set(p.name, name);
    } else if (p.type === "AssignmentPattern") pattern(p.left, name);
    else if (p.type === "ObjectPattern")
      for (const q of p.properties) {
        if (q.type === "Property") pattern(q.value, keyName(q));
      }
    else if (p.type === "ArrayPattern") p.elements.forEach((e, i) => pattern(e, name && i === 0 ? name : null));
  };
  for (const p of fn.params || []) pattern(p, null);
  walk.simple(fn.body, {
    VariableDeclarator(d) {
      if (d.id.type === "ObjectPattern") pattern(d.id, null);
      else if (d.id.type === "Identifier" && d.init) {
        let name = null;
        const init = d.init;
        walk.simple(init, {
          MemberExpression(m) {
            if (!m.computed && m.property.name.length > 2) name = m.property.name;
          },
        });
        const s = lit(init) ?? null;
        if (!name && init.type === "BinaryExpression") name = lit(init.right) || lit(init.left);
        if (name && !s) h.set(d.id.name, name);
      } else if (d.id.type === "ArrayPattern" && d.init && d.init.type === "CallExpression") {
        const setter = d.id.elements[1];
        if (d.id.elements[0] && d.id.elements[0].type === "Identifier" && setter && setter.type === "Identifier")
          h.set(d.id.elements[0].name, "state");
      }
    },
  });
  fnHints.set(fn, h);
  return h;
}
const condHint = (node, fn, code) => {
  if (!node) return null;
  const s = lit(node.type === "BinaryExpression" ? (lit(node.right) ? node.right : node.left) : node);
  if (s) return s;
  const h = hintsFor(fn, code);
  let found = null;
  walk.full(node, (n) => {
    if (found) return;
    if (n.type === "Literal" && typeof n.value === "string" && /^[a-zA-Z][\w-]{1,24}$/.test(n.value)) found = n.value;
    else if (
      n.type === "MemberExpression" &&
      !n.computed &&
      n.property.name.length > 2 &&
      !/^[A-Z_0-9]+$/.test(n.property.name) === true
    )
      found = n.property.name;
    else if (n.type === "MemberExpression" && !n.computed && /^[A-Z_]{3,}$/.test(n.property.name))
      found = n.property.name;
    else if (n.type === "Identifier" && h.has(n.name) && h.get(n.name) !== "state") found = h.get(n.name);
  });
  return found;
};

const ev = new Map();
const E = (c) =>
  ev.get(c) ?? ev.set(c, { el: [], exports: new Set(), props: new Set(), vars: 0, src: new Set() }).get(c);
const otherClassStrings = new Set();

const parse = (s) => {
  for (const [a, b] of s.wrap
    ? [
        ["({", "})"],
        ["(", ")"],
      ]
    : [["", ""]]) {
    try {
      return {
        ast: acorn.parse(a + s.code + b, {
          ecmaVersion: "latest",
          sourceType: "script",
          allowReturnOutsideFunction: true,
          allowHashBang: true,
        }),
        code: a + s.code + b,
      };
    } catch {}
  }
  try {
    return { ast: acorn.parse(s.code, { ecmaVersion: "latest", sourceType: "module" }), code: s.code };
  } catch {
    return null;
  }
};
const moduleOf = (anc) => {
  for (let i = anc.length - 1; i >= 0; i--) {
    const a = anc[i];
    if (
      a.type === "Property" &&
      isFn(a.value) &&
      ((a.key.type === "Literal" && /^\d+$/.test(String(a.key.value))) ||
        (a.key.type === "Identifier" && /^\d+$/.test(a.key.name)))
    )
      return String(a.key.value ?? a.key.name);
  }
  return null;
};

const cssModules = new Map();
const imports = new Map();
for (const s of sources) {
  const p = parse(s);
  if (!p) continue;
  walk.fullAncestor(p.ast, (n, _st, anc) => {
    if (n.type === "ObjectExpression") {
      const pairs = n.properties.filter((q) => q.type === "Property" && keyName(q) && targets.has(lit(q.value) || ""));
      if (!pairs.length) return;
      const mod = moduleOf(anc);
      if (!mod) return;
      const m = cssModules.get(mod) ?? cssModules.set(mod, new Map()).get(mod);
      for (const q of pairs) if (keyName(q) !== "className") m.set(keyName(q), lit(q.value));
    } else if (
      n.type === "VariableDeclarator" &&
      n.id.type === "Identifier" &&
      n.init &&
      n.init.type === "CallExpression" &&
      n.init.callee.type === "Identifier" &&
      n.init.arguments.length === 1 &&
      n.init.arguments[0].type === "Literal" &&
      typeof n.init.arguments[0].value === "number"
    ) {
      const mod = moduleOf(anc);
      if (mod) imports.set(mod + ":" + n.id.name, String(n.init.arguments[0].value));
    }
  });
}
console.log("css modules", cssModules.size, "imports", imports.size);
const memberClass = (n, mod) => {
  if (!mod || n.type !== "MemberExpression" || n.computed || n.property.type !== "Identifier") return null;
  let base = n.object;
  if (base.type === "MemberExpression" && !base.computed) base = base.object;
  if (base.type !== "Identifier") return null;
  const target = imports.get(mod + ":" + base.name);
  const local = cssModules.get(mod);
  const hit =
    (target && cssModules.get(target)?.get(n.property.name)) ||
    (base === n.object && local?.get(n.property.name)) ||
    null;
  return hit;
};

for (const s of sources) {
  const p = parse(s);
  if (!p) continue;
  const { ast, code } = p;

  const els = new Map();
  walk.fullAncestor(ast, (n, _st, anc) => {
    if (isJsxCall(n)) {
      let parent = null,
        fn = null;
      for (let i = anc.length - 2; i >= 0; i--) {
        if (!parent && isJsxCall(anc[i])) parent = anc[i];
        if (!fn && isFn(anc[i])) fn = anc[i];
        if (parent && fn) break;
      }
      const mod = moduleOf(anc);
      let guard = null;
      const up = anc[anc.length - 2];
      if (up && up.type === "LogicalExpression" && up.right === n) guard = up.left;
      if (up && up.type === "ConditionalExpression" && (up.consequent === n || up.alternate === n)) guard = up.test;
      els.set(n, { node: n, parent, fn, guard, mod });
      return;
    }
    if (n.type === "Property") {
      const k = keyName(n),
        v = lit(n.value);
      if (k && v && targets.has(v)) {
        const owner = anc[anc.length - 2],
          call = anc[anc.length - 3];
        if (!(call && isJsxCall(call) && call.arguments[1] === owner) && k !== "className") {
          E(v).exports.add(k);
          E(v).src.add(s.name);
        }
      }
    }
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
      const v = lit(n.init);
      if (v && targets.has(v)) {
        E(v).vars++;
        E(v).src.add(s.name);
      }
    }
    if (n.type === "Literal" && typeof n.value === "string" && n.value.length >= 8 && n.value.length < 300) {
      for (const t of n.value.split(/\s+/)) {
        if (!targets.has(t)) continue;
        const e = E(t);
        e.lits = (e.lits || 0) + 1;
        e.src.add(s.name);
        if ((e.snips ??= []).length < 2)
          e.snips.push(code.slice(Math.max(0, n.start - 160), Math.min(code.length, n.end + 80)));
      }
    }
  });

  const desc = new Map();
  for (const [call, rec] of els) {
    const [tagNode, props] = call.arguments;
    const d = {
      tag: lit(tagNode) ?? "C:" + code.slice(tagNode.start, Math.min(tagNode.end, tagNode.start + 24)),
      base: [],
      mods: [],
      propClasses: [],
      keys: [],
      attrs: {},
    };
    if (props && props.type === "ObjectExpression") {
      for (const p of props.properties) {
        if (p.type !== "Property") continue;
        const k = keyName(p);
        if (!k) continue;
        const v = lit(p.value);
        if (k === "className" || /ClassName$|Class$/.test(k)) {
          const tgt = k === "className" ? d : { base: [], mods: [] };
          const modKeys = new Set();
          walk.full(p.value, (n) => {
            if (n.type === "Property" && n.computed && n.key.type === "MemberExpression") {
              modKeys.add(n.key);
              if (n.key.object.type === "MemberExpression") modKeys.add(n.key.object);
            }
          });
          walk.full(p.value, (n) => {
            const sv = lit(n);
            if (sv !== null) for (const t of sv.split(/\s+/)) if (t) tgt.base.push(t);
            if (n.type === "TemplateLiteral")
              for (const q of n.quasis) for (const t of q.value.cooked.split(/\s+/)) if (t) tgt.base.push(t);
            if (n.type === "ObjectExpression")
              for (const q of n.properties) {
                if (q.type !== "Property") continue;
                const cls = keyName(q) || (q.computed ? memberClass(q.key, rec.mod) : null);
                if (q.computed && q.key.type === "MemberExpression") modKeys.add(q.key);
                if (cls)
                  tgt.mods.push({
                    cls,
                    hint: condHint(q.value, rec.fn, code),
                    cond: code.slice(q.value.start, Math.min(q.value.end, q.value.start + 60)),
                  });
              }
            if (n.type === "MemberExpression" && !modKeys.has(n)) {
              const h = memberClass(n, rec.mod);
              if (h) tgt.base.push(h);
            }
          });
          if (k !== "className") d.propClasses.push({ prop: k, classes: [...tgt.base, ...tgt.mods.map((m) => m.cls)] });
        } else if (
          k === "children" ||
          k === "aria-label" ||
          k === "title" ||
          k === "label" ||
          k === "placeholder" ||
          k === "alt" ||
          k === "text"
        ) {
          shallow(p.value, (n) => {
            const key = i18nKey(n);
            if (key) d.keys.push(key);
          });
        } else if (
          v !== null &&
          [
            "data-testid",
            "role",
            "as",
            "variant",
            "id",
            "type",
            "data-encore-id",
            "name",
            "menuAction",
            "semanticColor",
          ].includes(k)
        ) {
          d.attrs[k] = v.slice(0, 60);
        } else if (k === "data-testid" && p.value.type === "TemplateLiteral")
          d.attrs[k] = p.value.quasis.map((q) => q.value.cooked).join("*");
      }
    }
    if (rec.guard) d.guard = condHint(rec.guard, rec.fn, code);
    const fnp =
      rec.fn && rec.fn.params && rec.fn.params[0] && rec.fn.params[0].type === "ObjectPattern"
        ? rec.fn.params[0].properties
            .map((q) => (q.type === "Property" ? keyName(q) : null))
            .filter(Boolean)
            .slice(0, 8)
        : null;
    if (fnp && fnp.length) d.fnProps = fnp;
    desc.set(call, d);
  }
  const kids = new Map();
  for (const [call, rec] of els)
    if (rec.parent) (kids.get(rec.parent) ?? kids.set(rec.parent, []).get(rec.parent)).push(call);
  const brief = (call) => {
    const d = desc.get(call);
    return (
      d && {
        tag: d.tag,
        testid: d.attrs["data-testid"],
        role: d.attrs.role,
        cls: d.base.slice(0, 4),
        keys: d.keys.slice(0, 2),
      }
    );
  };
  const subtree = (call, depth) => {
    const out = { testids: [], keys: [], cls: [] };
    for (const k of kids.get(call) || []) {
      const d = desc.get(k);
      if (d.attrs["data-testid"]) out.testids.push(d.attrs["data-testid"]);
      out.keys.push(...d.keys);
      out.cls.push(...d.base.filter((c) => targets.has(c)));
      if (depth > 0) {
        const s2 = subtree(k, depth - 1);
        out.testids.push(...s2.testids);
        out.keys.push(...s2.keys);
      }
    }
    return { testids: out.testids.slice(0, 4), keys: out.keys.slice(0, 4), cls: out.cls.slice(0, 6) };
  };

  for (const [call, rec] of els) {
    const d = desc.get(call);
    const all = [...d.base.map((c) => [c, null]), ...d.mods.map((m) => [m.cls, m])];
    if (!all.some(([c]) => targets.has(c)) && !d.propClasses.some((p) => p.classes.some((c) => targets.has(c)))) {
      for (const [c] of all) if (/^[a-zA-Z_-][\w-]*$/.test(c) && !generated(c)) otherClassStrings.add(c);
      continue;
    }
    const sub = subtree(call, 2);
    const p1 = rec.parent ? brief(rec.parent) : null;
    const p2 = rec.parent && els.get(rec.parent).parent ? brief(els.get(rec.parent).parent) : null;
    const p3 =
      rec.parent && els.get(rec.parent).parent && els.get(els.get(rec.parent).parent).parent
        ? brief(els.get(els.get(rec.parent).parent).parent)
        : null;
    for (const [c, mod] of all) {
      if (!targets.has(c)) {
        if (/^[a-zA-Z_-][\w-]*$/.test(c)) otherClassStrings.add(c);
        continue;
      }
      const e = E(c);
      e.src.add(s.name);
      if (e.el.length >= 10) continue;
      e.el.push({
        tag: d.tag,
        ...d.attrs,
        keys: d.keys.slice(0, 3),
        guard: d.guard,
        fnProps: d.fnProps,
        mod: mod ? { hint: mod.hint, cond: mod.cond } : undefined,
        siblings: d.base.filter((x) => x !== c).slice(0, 5),
        sub,
        parents: [p1, p2, p3].filter(Boolean),
        src: s.name,
      });
    }
    for (const pc of d.propClasses)
      for (const c of pc.classes)
        if (targets.has(c)) {
          E(c).props.add(pc.prop + "@" + d.tag);
          E(c).src.add(s.name);
        }
  }
}

const dom = {};
for (const f of readdirSync(root).filter((n) => /^dom\d*\.json$/.test(n))) {
  const j = JSON.parse(readFileSync(join(root, f), "utf8"));
  for (const [c, d] of Object.entries(j.data)) {
    const e = (dom[c] ??= { n: 0, routes: new Set(), samples: [] });
    e.n += d.n;
    d.routes.forEach((r) => e.routes.add(r.replace(/[A-Za-z0-9]{22}/g, "ID")));
    for (const s of d.samples) if (e.samples.length < 4) e.samples.push(s);
  }
  for (const c of j.semantic) if (!generated(c)) otherClassStrings.add(c);
}

const out = {};
for (const c of [...targets].sort((a, b) => cssOrder.get(a) - cssOrder.get(b))) {
  const e = ev.get(c);
  const d = dom[c];
  out[c] = {
    css: [...cssFiles.get(c)],
    el: e ? e.el : [],
    exports: e ? [...e.exports] : [],
    props: e ? [...e.props] : [],
    vars: e ? e.vars : 0,
    lits: e ? e.lits || 0 : 0,
    snips: e ? e.snips || [] : [],
    runtimeOnly: domOnly.has(c) || undefined,
    src: e ? [...e.src].slice(0, 8) : [],
    dom: d ? { n: d.n, routes: [...d.routes].slice(0, 6), samples: d.samples } : null,
  };
}
const existing = new Set([...cssOrder.keys()].filter((c) => !generated(c)));
for (const c of otherClassStrings) existing.add(c);
writeFileSync(join(root, "evidence2.json"), JSON.stringify({ classes: out, existing: [...existing] }));
console.log(
  "targets",
  targets.size,
  "with el",
  Object.values(out).filter((x) => x.el.length).length,
  "existing",
  existing.size
);
