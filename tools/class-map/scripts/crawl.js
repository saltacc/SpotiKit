(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const back = {};
  for (const [g, s] of Object.entries(window.__spotikitClassMap || {})) back[s] = g;
  const isHash = (c) =>
    (c.length === 20 || (c.length === 21 && c[0] === "_")) &&
    /[A-Z]/.test(c) &&
    /[a-z]/.test(c) &&
    /^[A-Za-z0-9_-]+$/.test(c);
  const isEncore = (c) => /^e-\d+-/.test(c);
  const isVite = (c) => /^_[A-Za-z0-9-]+_[a-z0-9]{5}_\d+$/.test(c);
  const interesting = (c) => isHash(c) || isEncore(c) || isVite(c);
  const semantic = (c) => !interesting(c) && !back[c];

  const anchor = document.querySelector("main") || document.body.firstElementChild;
  let fiber = anchor[Object.keys(anchor).find((k) => k.startsWith("__reactFiber"))];
  while (fiber.return) fiber = fiber.return;
  let history = null;
  {
    const stack = [fiber];
    const seen = new Set();
    while (stack.length && !history) {
      const n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      const p = n.memoizedProps;
      if (p && p.history && typeof p.history.push === "function") history = p.history;
      if (n.child) stack.push(n.child);
      if (n.sibling) stack.push(n.sibling);
    }
  }
  if (!history) return "no history";

  const data = {};
  const sem = new Set();
  const describe = (el) => {
    const cls = [...el.classList].map((c) => back[c] || c);
    const anc = [];
    for (let p = el.parentElement, d = 1; p && d <= 12 && anc.length < 4; p = p.parentElement, d++) {
      const t = p.getAttribute("data-testid");
      const sc = [...p.classList].filter(semantic);
      if (t || sc.length) anc.push({ d, t, sc: sc.slice(0, 3).join(" "), tag: p.tagName.toLowerCase() });
    }
    return {
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid") || undefined,
      role: el.getAttribute("role") || undefined,
      aria: (el.getAttribute("aria-label") || "").slice(0, 40) || undefined,
      id: el.id || undefined,
      href: el.getAttribute("href")
        ? el
            .getAttribute("href")
            .replace(/[A-Za-z0-9]{22}/, "ID")
            .slice(0, 40)
        : undefined,
      type: el.getAttribute("type") || undefined,
      sem: cls.filter(semantic).slice(0, 4).join(" ") || undefined,
      others: cls.filter(interesting).length,
      kids: el.childElementCount,
      text: el.childElementCount === 0 && el.textContent ? el.textContent.trim().length : undefined,
      anc,
    };
  };
  const collect = (route) => {
    for (const el of document.querySelectorAll("[class]")) {
      if (!el.classList) continue;
      for (const raw of el.classList) {
        const c = back[raw] || raw;
        if (!interesting(c)) {
          sem.add(c);
          continue;
        }
        const e = (data[c] ??= { n: 0, routes: [], samples: [], keys: new Set() });
        e.n++;
        if (!e.routes.includes(route)) e.routes.push(route);
        if (e.samples.length < 3) {
          const s = describe(el);
          const k = s.tag + "|" + s.testid + "|" + s.role + "|" + (s.anc[0] && (s.anc[0].t || s.anc[0].sc));
          if (!e.keys.has(k)) {
            e.keys.add(k);
            e.samples.push(s);
          }
        }
      }
    }
  };
  const scrollAll = async () => {
    for (const s of document.querySelectorAll(
      "[data-overlayscrollbars-viewport], .main-view-container__scroll-node, [data-overlayscrollbars-contents]"
    )) {
      for (let i = 1; i <= 4; i++) {
        s.scrollTop = (s.scrollHeight * i) / 4;
        await sleep(500);
        collect(current);
      }
      s.scrollTop = 0;
    }
  };
  let current = "/";
  const visit = async (route, wait = 3500) => {
    current = route;
    history.push(route);
    await sleep(wait);
    collect(route);
    await scrollAll();
  };
  const hrefs = (prefix) => [
    ...new Set([...document.querySelectorAll(`a[href*="${prefix}"]`)].map((a) => a.getAttribute("href"))),
  ];

  await visit("/", 4000);
  const pick = {};
  for (const p of ["/album/", "/artist/"]) pick[p] = hrefs(p).slice(0, 2);
  await visit("/playlist/37i9dQZF1E4v45jZORzfDW", 5000);
  for (const p of ["/track/", "/user/", "/genre/"]) pick[p] = hrefs(p).slice(0, 1);
  await visit("/collection/tracks", 4000);
  if (!pick["/user/"].length) pick["/user/"] = hrefs("/user/").slice(0, 1);
  for (const list of Object.values(pick)) for (const r of list) await visit(r, 4500);
  for (const a of pick["/artist/"].slice(0, 1)) {
    await visit(a + "/discography/all");
    await visit(a + "/about");
    await visit(a + "/related");
  }

  await visit("/lyrics");
  await visit(pick["/album/"][0] || "/collection/tracks", 4000);
  const row = document.querySelector('[data-testid="tracklist-row"]');
  if (row) {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 300, clientY: 300 }));
    await sleep(1200);
    collect("context-menu");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(500);
  }
  history.push("/");

  for (const e of Object.values(data)) delete e.keys;
  return JSON.stringify({ pick, data, semantic: [...sem] });
})();
