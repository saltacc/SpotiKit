import { readFileSync, writeFileSync } from "node:fs";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const { classes, existing } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
};
const overrides = {
  ...readJson(root + "ported-names.json"),
  ...readJson(decodeURIComponent(new URL("../curated-names.json", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")),
};

const isEncore = (c) => /^e-\d+-/.test(c);
const isVite = (c) => /^_[A-Za-z0-9-]+_[a-z0-9]{5}_\d+$/.test(c);
const kebab = (s) =>
  (s || "")
    .replace(/ClassNames?$|Class$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
const clean = (n) =>
  n
    .split("-")
    .filter((p, i, a) => p && p !== a[i - 1])
    .join("-")
    .replace(/^(\d)/, "n$1")
    .slice(0, 64)
    .replace(/-+$/, "");

const GENERIC = new Set(
  (
    "container wrapper title image content button icon text header row item list root inner label link section body main box wrap outer grid " +
    "column left right top bottom footer subtitle description info details img avatar name heading overlay background placeholder skeleton active selected " +
    "hidden visible disabled small large medium compact loading separator divider spacer cell actions action menu badge media card cards tag chip input " +
    "form logo cover artwork thumbnail metadata meta progress bar track dot bullet contents panel pill tooltip close subtext primary secondary child children " +
    "flex full first last mobile desktop show open closed expanded collapsed focus focused hover page view layout area region shelf carousel modal dialog " +
    "popover elevated animated animation fade transparent highlight highlighted playing paused clickable interactive wide narrow truncate truncated " +
    "ellipsis grow shrink centered center stack stacked horizontal vertical inline block error empty state on off default base new old hero banner " +
    "aside nav navigation search wrapper-inner outer-wrapper image-container icon-container title-container text-container button-container " +
    "content-container header-container title-wrapper image-wrapper content-wrapper text-wrapper button-wrapper inner-container main-container " +
    "container-inner hidden-visually sr-only visually-hidden svg path circle rect icon-path icon-group list-item list-row grid-item scroll scroller " +
    "scroll-container trigger anchor target dropdown option options tabs tab switch toggle checkbox radio slider link-wrapper subtitle-wrapper " +
    "title-row header-row footer-row row-container two three four one container-wrapper wrapper-container mask clip portal frame video canvas picture " +
    "figure table term value strong time code textarea select article group status alert toolbar listbox tree tree-item menu-item column-header " +
    "search-input radio-group tab-panel heading-wrapper text-content inner-wrapper"
  ).split(/\s+/)
);

const ROLE = {
  row: "row",
  gridcell: "cell",
  columnheader: "column-header",
  button: "button",
  combobox: "dropdown",
  progressbar: "progress",
  slider: "slider",
  list: "list",
  listitem: "item",
  menu: "menu",
  menuitem: "menu-item",
  menuitemradio: "menu-item",
  menuitemcheckbox: "menu-item",
  tab: "tab",
  tablist: "tabs",
  tabpanel: "tab-panel",
  dialog: "dialog",
  alertdialog: "dialog",
  grid: "grid",
  heading: "heading",
  img: "image",
  link: "link",
  switch: "switch",
  checkbox: "checkbox",
  radio: "radio",
  radiogroup: "radio-group",
  search: "search",
  searchbox: "search-input",
  toolbar: "toolbar",
  tooltip: "tooltip",
  group: "group",
  region: "region",
  navigation: "nav",
  banner: "banner",
  status: "status",
  alert: "alert",
  textbox: "input",
  option: "option",
  listbox: "listbox",
  article: "article",
  separator: "separator",
  treegrid: "grid",
  tree: "tree",
  treeitem: "tree-item",
};
const TAG = {
  button: "button",
  a: "link",
  img: "image",
  h1: "title",
  h2: "title",
  h3: "title",
  h4: "title",
  h5: "title",
  h6: "title",
  p: "text",
  span: "text",
  ul: "list",
  ol: "list",
  li: "item",
  nav: "nav",
  header: "header",
  footer: "footer",
  section: "section",
  aside: "aside",
  main: "main",
  input: "input",
  label: "label",
  svg: "icon",
  path: "icon-path",
  form: "form",
  dialog: "dialog",
  video: "video",
  canvas: "canvas",
  picture: "picture",
  figure: "figure",
  table: "table",
  tr: "row",
  td: "cell",
  th: "column-header",
  hr: "divider",
  textarea: "textarea",
  select: "select",
  iframe: "frame",
  article: "article",
  time: "time",
  strong: "strong",
  em: "text",
  code: "code",
  pre: "code",
  dl: "list",
  dt: "term",
  dd: "value",
  g: "icon-group",
  circle: "circle",
  rect: "rect",
  thead: "table-head",
  tbody: "table-body",
  small: "text",
  b: "strong",
  i: "text",
  source: "source",
  polyline: "icon-path",
  line: "line",
  label_: "label",
};

const most = (arr) => {
  const m = new Map();
  for (const a of arr) if (a) m.set(a, (m.get(a) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((x) => x[0]);
};
const testidName = (t) =>
  t && !t.includes("*") && /^[a-zA-Z][\w-]*$/.test(t) ? clean(kebab(t).replace(/-\d+$/, "")) : null;
const keyName = (k) => {
  if (!k) return null;
  const parts = k.split(".").map(kebab).filter(Boolean);
  let n = parts[parts.length - 1];
  if (!n) return null;
  if (
    (GENERIC.has(n) ||
      n.length < 5 ||
      /^(a11y|aria|label|title|text|description|subtitle|tooltip|button|cta|heading|header)$/.test(n)) &&
    parts.length > 1
  )
    n = parts[parts.length - 2] + "-" + n;
  return clean(n.replace(/-(a11y|aria-label|label)$/, ""));
};
const wordOf = (el) => {
  if (el.role && ROLE[el.role]) return ROLE[el.role];
  if (!el.tag.startsWith("C:")) return TAG[el.tag] ?? null;
  if (el.as && TAG[el.as]) return TAG[el.as];
  if (el.variant)
    return /^(title|headline)/.test(el.variant)
      ? "title"
      : /^(body|marginal|small|text)/.test(el.variant)
        ? "text"
        : null;
  if (el["data-encore-id"]) return kebab(el["data-encore-id"]);
  return null;
};
const fileScope = (files) => {
  const scopes = new Set();
  for (const f of new Set(files)) {
    const m = f.replace(/\.(css|js)$/, "").match(/^(?:xpui-routes-|xpui-|dwp-|pip-)?(.+)$/);
    if (!m || /^\d+$/.test(m[1])) continue;
    if (
      /^(snapshot|root-dialogs|desktop-modals|routes|vendor~.*|debug-window-contents|mini-player(-snapshot)?|pip-mini-player|panel-section|home-chips-row|home-v2(-section)?|prompted-playlists)$/.test(
        m[1]
      )
    )
      return null;
    scopes.add(
      clean(
        kebab(m[1])
          .replace(/-snapshot$/, "")
          .replace(/^collection-/, "")
      )
    );
  }
  return scopes.size === 1 ? [...scopes][0] : null;
};

const list = Object.entries(classes).filter(([c]) => !isEncore(c));
const R = new Map();
for (const [c, e] of list) {
  const used = true;
  const dead = !(e.el.length || e.props.length || e.exports.length || e.vars || e.lits || e.dom || e.runtimeOnly);
  const r = { c, e, used, dead };
  r.isModifier = e.el.length > 0 && e.el.every((x) => x.mod);
  r.exportName = most(e.exports.map(kebab))[0] || null;
  if (isVite(c)) r.exportName = kebab(c.replace(/^_/, "").replace(/_[a-z0-9]{5}_\d+$/, ""));
  const tids = most(
    [...e.el.map((x) => x["data-testid"]), ...(e.dom ? e.dom.samples.map((s) => s.testid) : [])].map(testidName)
  );
  r.testid = tids.length && tids.length <= 2 ? tids[0] : null;
  r.key = most(e.el.flatMap((x) => (x.keys || []).slice(0, 1)).map(keyName))[0] || null;
  r.prop = most(e.props.map((p) => kebab(p.split("@")[0])).filter((p) => p && !/^(class|classes)$/.test(p)))[0] || null;
  r.word =
    most([...e.el.map(wordOf), ...(e.dom ? e.dom.samples.map((s) => ROLE[s.role] || TAG[s.tag]) : [])])[0] || null;
  r.childHint =
    most(e.el.flatMap((x) => [...(x.sub?.testids || []).map(testidName), ...(x.sub?.keys || []).map(keyName)]))[0] ||
    null;
  r.guard =
    most(
      e.el
        .map((x) => x.guard && kebab(String(x.guard).replace(/^(is|has|should|show|can|with)(?=[A-Z])/, "")))
        .filter((g) => g && g.length > 2 && g.length < 25)
    )[0] || null;
  r.modHint =
    most(
      e.el
        .map(
          (x) =>
            x.mod && x.mod.hint && kebab(String(x.mod.hint).replace(/^(is|has|should|show|can|with|use)(?=[A-Z])/, ""))
        )
        .filter((g) => g && g.length > 1 && g.length < 25)
    )[0] || null;
  r.files = [...e.css, ...e.src.filter((s) => !s.startsWith("m"))];
  R.set(c, r);
}

const own = (r) => r.exportName || r.testid || r.prop || r.key || null;
const ownSpecific = (c) => {
  const r = R.get(c);
  const n = r && own(r);
  return n && !GENERIC.has(n) ? n : null;
};

for (const r of R.values()) {
  const s1 = [],
    s2 = [];
  for (const el of r.e.el) {
    let found = 0;
    for (const p of el.parents || []) {
      const t = testidName(p.testid);
      const n =
        t && !GENERIC.has(t)
          ? t
          : (p.cls || []).map(ownSpecific).find(Boolean) ||
            (p.keys || []).map(keyName).find((k) => k && !GENERIC.has(k));
      if (n && n !== own(r)) {
        (found ? s2 : s1).push(n);
        if (++found === 2) break;
      }
    }
  }
  const d1 = [],
    d2 = [];
  if (r.e.dom)
    for (const s of r.e.dom.samples) {
      let found = 0;
      for (const a of s.anc) {
        const t = testidName(a.t);
        if (
          t &&
          !GENERIC.has(t) &&
          !/^(root|main|main-view|top-bar|panel-section|infinite-scroll-list|grid-container|carousel-scroller|component-shelf)$/.test(
            t
          ) &&
          t !== own(r)
        ) {
          (found ? d2 : d1).push(t);
          if (++found === 2) break;
        }
      }
    }
  const agree = (arr) => {
    const m = most(arr);
    return m.length === 1 ? m[0] : null;
  };
  r.scope = most(s1)[0] || agree(d1) || null;
  r.scope2 = most(s2)[0] || agree(d2) || null;
  r.fileScope = fileScope(r.files);
  if (!r.scope) {
    r.scope = r.fileScope;
    r.fileScope = null;
  }
}

const taken = new Set(existing);
const names = new Map();
const claim = (c, n, why) => {
  names.set(c, { stable: n, why });
  taken.add(n);
};
for (const [c, n] of Object.entries(overrides)) if (R.has(c)) claim(c, n, "curated");

const join = (...p) => clean(p.filter(Boolean).join("-"));
const withScope = (scope, n) =>
  !scope ? n : n === scope || n.startsWith(scope + "-") ? n : scope.endsWith("-" + n) ? scope : join(scope, n);

function candidates(r) {
  const base = own(r);
  const word = r.word || (r.childHint ? null : null);
  const local =
    base ||
    (r.guard && word ? join(r.guard, word) : r.guard) ||
    (r.childHint ? join(r.childHint, word || "wrapper") : null) ||
    word ||
    "box";
  const out = [];
  if (base && !GENERIC.has(base)) out.push(base);
  out.push(withScope(r.scope, local));
  if (word && !local.endsWith(word)) out.push(withScope(r.scope, join(local, word)));
  if (r.childHint && !local.includes(r.childHint)) out.push(withScope(r.scope, join(local, r.childHint)));
  if (r.scope2) out.push(withScope(r.scope2, withScope(r.scope, local)));
  if (r.fileScope) out.push(withScope(r.fileScope, withScope(r.scope, local)));
  return [...new Set(out.map(clean))];
}

const pending = list.map(([c]) => R.get(c)).filter((r) => r.used && !names.has(r.c) && !r.isModifier);
for (const r of pending) {
  r.cands = candidates(r);
  r.ci = 0;
}
let open = pending;
for (let round = 0; round < 8 && open.length; round++) {
  const want = new Map();
  for (const r of open) {
    while (r.ci < r.cands.length && taken.has(r.cands[r.ci])) r.ci++;
    if (r.ci < r.cands.length) (want.get(r.cands[r.ci]) ?? want.set(r.cands[r.ci], []).get(r.cands[r.ci])).push(r);
  }
  for (const [n, rs] of want) {
    if (rs.length === 1) claim(rs[0].c, n, (rs[0].why = describe(rs[0])));
    else for (const r of rs) r.ci++;
  }
  open = open.filter((r) => !names.has(r.c) && r.ci < r.cands.length);
}
const leftovers = pending.filter((r) => !names.has(r.c));
const counters = new Map();
for (const r of leftovers) {
  const stem = r.cands[Math.min(1, r.cands.length - 1)];
  let i = counters.get(stem) || 1,
    n;
  do {
    n = stem + "-" + ++i;
  } while (taken.has(n));
  counters.set(stem, i);
  claim(r.c, n, describe(r) + " (numbered)");
}
for (const [c] of list) {
  const r = R.get(c);
  if (!r.used || names.has(c) || !r.isModifier) continue;
  const bases = most(
    r.e.el
      .flatMap((x) => x.siblings || [])
      .map((b) => names.get(b)?.stable)
      .filter(Boolean)
  );
  const base = bases[0] || withScope(r.scope, "state");
  const hint = r.exportName || r.prop || r.modHint || "on";
  const h = hint.startsWith(base + "-") ? hint.slice(base.length + 1) : hint;
  const stem = base + "--" + clean(h);
  let n = stem,
    i = 1;
  while (taken.has(n)) n = stem + "-" + ++i;
  claim(c, n, "modifier of " + base);
}
function describe(r) {
  const how = r.exportName
    ? "module name"
    : r.testid
      ? "test id"
      : r.prop
        ? "prop"
        : r.key
          ? "label"
          : r.guard
            ? "condition"
            : r.childHint
              ? "child"
              : r.word
                ? "element"
                : "box";
  return how + (r.scope ? " in " + r.scope : "");
}
for (const c of Object.keys(classes).filter(isEncore)) {
  const rest = c.replace(/^e-\d+-/, "");
  const n = "e-" + (/^[a-z0-9_-]+$/.test(rest) ? rest : kebab(rest));
  if (!taken.has(n)) claim(c, n, "encore");
}

const unused = list.filter(([c]) => !R.get(c).used).map(([c]) => c);
writeFileSync(root + "names2.json", JSON.stringify({ names: Object.fromEntries(names), unused }));
const vals = [...names.values()];
console.log(
  "named",
  vals.length,
  "unused",
  unused.length,
  "numbered",
  vals.filter((v) => v.why.includes("numbered")).length,
  "box",
  vals.filter((v) => /(^|-)box(-|$)/.test(v.stable)).length,
  "avg len",
  (vals.reduce((a, v) => a + v.stable.length, 0) / vals.length).toFixed(1),
  "max len",
  Math.max(...vals.map((v) => v.stable.length))
);
console.log(
  most(vals.map((v) => v.why.split(" in ")[0].split(" of ")[0]))
    .map((k) => k + ":" + vals.filter((v) => v.why.split(" in ")[0].split(" of ")[0] === k).length)
    .join("  ")
);
