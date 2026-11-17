import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const { classes } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const infoPath = join(out, "info.json");
const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : {};

const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("xpui"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await evaluate(`(() => {
  const a = document.querySelector("main"); let f = a[Object.keys(a).find((k) => k.startsWith("__reactFiber"))]; while (f.return) f = f.return;
  const st = [f]; const seen = new Set();
  while (st.length) { const n = st.pop(); if (!n || seen.has(n)) continue; seen.add(n); if (n.memoizedProps && n.memoizedProps.history && n.memoizedProps.history.push) { window.__skHistory = n.memoizedProps.history; break; } if (n.child) st.push(n.child); if (n.sibling) st.push(n.sibling); }
  const map = window.__spotikitClassMap || {};
  window.__skDomName = (g) => map[g] || g;
  window.__skFind = (g) => {
    const name = window.__skDomName(g);
    const els = document.getElementsByClassName(name);
    for (const el of els) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width >= 3 && r.height >= 3 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05) return el; }
    return null;
  };
  window.__skPresent = (gs) => gs.filter((g) => document.getElementsByClassName(window.__skDomName(g)).length > 0);
  window.__skDescribe = (el) => {
    const anc = []; for (let p = el.parentElement, d = 0; p && d < 8; p = p.parentElement, d++) { const t = p.getAttribute("data-testid"); const c = [...p.classList].filter((x) => !/^encore-/.test(x)).slice(0, 2).join("."); if (t || c) anc.push((t ? "[" + t + "]" : "") + (c ? "." + c : "")); if (anc.length >= 4) break; }
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), testid: el.getAttribute("data-testid") || undefined, role: el.getAttribute("role") || undefined,
      aria: (el.getAttribute("aria-label") || "").slice(0, 50) || undefined, text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80) || undefined,
      w: Math.round(r.width), h: Math.round(r.height), kids: el.childElementCount, cls: [...el.classList].join(" ").slice(0, 160), anc };
  };
})()`);

const wantAll = Object.keys(classes).filter((c) => !/^e-\d+-/.test(c));
let saved = 0;
let frameNo = Object.values(info).reduce((m, v) => Math.max(m, v.frame ? +v.frame.slice(1) + 1 : 0), 0);
async function captureHere(label) {
  const missing = wantAll.filter((c) => !info[c]);
  let todo = (await evaluate(`window.__skPresent(${JSON.stringify(missing)})`)) || [];
  const presentCount = todo.length;
  for (let round = 0; round < 60 && todo.length; round++) {
    const r = await evaluate(`(async () => {
      const todo = ${JSON.stringify(todo)};
      const first = todo.map((g) => window.__skFind(g)).find(Boolean);
      if (!first) return null;
      first.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise((r) => setTimeout(r, 250));
      const hits = [];
      for (const g of todo) {
        const el = window.__skFind(g);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        if (b.bottom <= 0 || b.right <= 0 || b.top >= innerHeight || b.left >= innerWidth) continue;
        hits.push({ g, rect: { x: b.left, y: b.top, w: b.width, h: b.height }, d: window.__skDescribe(el) });
      }
      return { hits, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight };
    })()`);
    if (!r || !r.hits.length) break;
    const frame = "f" + String(frameNo++).padStart(4, "0");
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    if (!shot.result) break;
    writeFileSync(join(out, frame + ".jpg"), Buffer.from(shot.result.data, "base64"));
    for (const h of r.hits) info[h.g] = { where: label, frame, rect: h.rect, dpr: r.dpr, ...h.d };
    saved += r.hits.length;
    todo = todo.filter((g) => !info[g]);
  }
  const present = { length: presentCount };
  writeFileSync(infoPath, JSON.stringify(info));
  console.log(label, "present", present.length, "total captured", Object.keys(info).length);
}

const go = async (route, wait = 4000) => {
  await evaluate(`window.__skHistory.push(${JSON.stringify(route)})`);
  await sleep(wait);
};
const click = async (sel, button = "left") => {
  const p = await evaluate(
    `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!p) return false;
  await sleep(200);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button, clickCount: 1 });
  await sleep(1300);
  return true;
};
const hover = async (sel) => {
  const p = await evaluate(
    `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (p) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await sleep(900);
  }
  return !!p;
};
const escape = async () => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(600);
};
const typeText = async (text) => {
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "char", text: ch });
    await sleep(40);
  }
  await sleep(1500);
};
const hrefs = async (part) =>
  (await evaluate(
    `[...new Set([...document.querySelectorAll('a[href*="${part}"]')].map((a) => a.getAttribute("href")))].slice(0, 3)`
  )) || [];

const steps = [];
const step = (label, fn) => steps.push([label, fn]);
const page1 = async (route, label = route) =>
  step(label, async () => {
    await go(route);
    await captureHere(label);
  });

page1("/", "home");
step("home hover card", async () => {
  await hover('[data-encore-id="card"], [data-testid="home-section-item"]');
  await captureHere("home card hover");
});
step("home shortcut hover", async () => {
  await hover('[data-testid="home-shortcut"], [data-testid="shortcut"]');
  await captureHere("home shortcut hover");
});
step("home filters", async () => {
  for (const f of ["Musik", "Podcasts", "Hörbücher"]) {
    await evaluate(
      `[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(f)})?.click()`
    );
    await sleep(3000);
    await captureHere("home " + f);
  }
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Alle")?.click()`);
  await sleep(2000);
});
let picks = {};
step("collect links", async () => {
  for (const p of [
    "/album/",
    "/artist/",
    "/playlist/",
    "/show/",
    "/episode/",
    "/section/",
    "/genre/",
    "/user/",
    "/audiobook/",
    "/track/",
    "/concert/",
  ])
    picks[p] = await hrefs(p);
});
page1("/search", "search");
step("search typing", async () => {
  await click('[data-testid="search-input"]');
  await typeText("taylor");
  await captureHere("search dropdown");
  await escape();
});
page1("/search/taylor", "search results");
for (const t of ["tracks", "artists", "albums", "playlists", "podcastAndEpisodes", "users", "audiobooks", "genres"])
  page1("/search/taylor/" + t, "search " + t);
step("search more links", async () => {
  for (const p of ["/album/", "/artist/", "/show/", "/episode/", "/audiobook/", "/track/", "/user/", "/genre/"])
    if (!picks[p]?.length) picks[p] = await hrefs(p);
});
for (const r of [
  "/collection/tracks",
  "/collection/playlists",
  "/collection/albums",
  "/collection/artists",
  "/collection/podcasts",
  "/collection/episodes",
  "/collection/audiobooks",
  "/collection/local-files",
  "/collection/concerts",
  "/preferences",
  "/recents",
  "/content-feed",
  "/concerts",
  "/download",
  "/lyrics",
  "/queue",
  "/history",
])
  page1(r);
step("entity pages", async () => {
  for (const [p, list] of Object.entries(picks))
    for (const r of list.slice(0, 2)) {
      await go(r, 5000);
      await captureHere(p + " page");
      if (p === "/artist/")
        for (const sub of [
          "/discography/all",
          "/discography/album",
          "/about",
          "/related",
          "/appears-on",
          "/playlists",
        ]) {
          await go(r + sub, 4000);
          await captureHere("artist" + sub);
        }
      if (p === "/track/") {
        await go(r, 4000);
        await captureHere("track");
      }
    }
});
step("track context menu", async () => {
  await go("/collection/tracks");
  if (await click('[data-testid="tracklist-row"]', "right")) {
    await captureHere("track context menu");
    await hover('[role="menu"] [aria-haspopup="menu"], [role="menuitem"][aria-haspopup]');
    await captureHere("context submenu");
    await escape();
  }
});
step("track row hover", async () => {
  await hover('[data-testid="tracklist-row"]');
  await captureHere("track row hover");
});
step("library item menu", async () => {
  if (await click('[role="grid"] [role="row"]', "right")) {
    await captureHere("library context menu");
    await escape();
  }
});
step("library create menu", async () => {
  if (await click('[data-testid="create-button"], button[aria-label="Erstellen"]')) {
    await captureHere("create menu");
    await escape();
  }
});
step("library sort", async () => {
  if (await click('[data-testid="sort-button"], button[aria-label*="Sortier"]')) {
    await captureHere("library sort");
    await escape();
  }
});
step("library expand", async () => {
  if (await click('button[aria-label*="Bibliothek"]')) {
    await sleep(1500);
    await captureHere("library expanded");
    await click('button[aria-label*="Bibliothek"]');
  }
});
step("user menu", async () => {
  if (await click('[data-testid="user-widget-link"]')) {
    await captureHere("user menu");
    await escape();
  }
});
step("whats new", async () => {
  if (await click('[data-testid="whats-new-feed-button"]')) {
    await captureHere("whats new");
  }
});
step("friend activity", async () => {
  if (await click('[data-testid="friend-activity-button"]')) {
    await captureHere("friend activity");
    await click('[data-testid="friend-activity-button"]');
  }
});
step("now playing view", async () => {
  await go("/");
  if (await click('[data-testid="cover-art-button"]')) {
    await sleep(2000);
    await captureHere("now playing view");
  }
});
step("queue panel", async () => {
  if (await click('[data-testid="control-button-queue"]')) {
    await captureHere("queue");
    await click('[data-testid="control-button-queue"]');
  }
});
step("devices", async () => {
  if (await click('[aria-label="Mit einem Gerät verbinden"], [data-testid="control-button-connect"]')) {
    await captureHere("devices");
    await escape();
  }
});
step("volume hover", async () => {
  await hover('[data-testid="volume-bar"]');
  await captureHere("volume hover");
});
step("player hover", async () => {
  await hover('[data-testid="playback-progressbar"]');
  await captureHere("progress hover");
  await hover('[data-testid="now-playing-widget"]');
  await captureHere("widget hover");
});
step("tooltips", async () => {
  for (const s of [
    '[data-testid="control-button-shuffle"]',
    '[data-testid="home-button"]',
    '[data-testid="lyrics-button"]',
  ]) {
    await hover(s);
    await sleep(800);
    await captureHere("tooltip");
  }
});
step("album card menu", async () => {
  await go("/collection/albums");
  if (await click('[data-encore-id="card"], [role="gridcell"]', "right")) {
    await captureHere("card context menu");
    await escape();
  }
});
step("playlist page more", async () => {
  if (picks["/playlist/"]?.[0]) {
    await go(picks["/playlist/"][0]);
    if (await click('[data-testid="more-button"]')) {
      await captureHere("playlist more menu");
      await escape();
    }
  }
});
step("keyboard shortcuts", async () => {
  await go("/");
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", {
      type,
      key: "?",
      code: "Slash",
      modifiers: 2 | 8,
      windowsVirtualKeyCode: 191,
    });
  await sleep(1500);
  await captureHere("shortcuts dialog");
  await escape();
});
step("settings sections", async () => {
  await go("/preferences");
  for (let i = 1; i <= 8; i++) {
    await evaluate(
      `(() => { const s = document.querySelector('.main-view-container__scroll-node [data-overlayscrollbars-viewport]'); if (s) s.scrollTop = s.scrollHeight * ${i} / 8; })()`
    );
    await sleep(500);
    await captureHere("settings scroll " + i);
  }
});
step("home scroll", async () => {
  await go("/");
  for (let i = 1; i <= 8; i++) {
    await evaluate(
      `(() => { const s = document.querySelector('.main-view-container__scroll-node [data-overlayscrollbars-viewport]'); if (s) s.scrollTop = s.scrollHeight * ${i} / 8; })()`
    );
    await sleep(900);
    await captureHere("home scroll " + i);
  }
});

const only = process.argv[3];
for (const [label, fn] of steps) {
  if (only && !label.includes(only)) continue;
  try {
    await fn();
  } catch (e) {
    console.log("step failed", label, e.message);
  }
}
await go("/", 1000);
console.log("saved images", saved, "captured classes", Object.keys(info).length);
ws.close();
