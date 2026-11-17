import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("xpui"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method) events.push(m);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
await send("Runtime.enable");
await send("Log.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findHistory = `(() => { const a = document.querySelector("main"); let f = a[Object.keys(a).find((k) => k.startsWith("__reactFiber"))]; while (f.return) f = f.return; const st = [f]; const seen = new Set(); while (st.length) { const n = st.pop(); if (!n || seen.has(n)) continue; seen.add(n); if (n.memoizedProps && n.memoizedProps.history && n.memoizedProps.history.push) { window.__skHistory = n.memoizedProps.history; return true; } if (n.child) st.push(n.child); if (n.sibling) st.push(n.sibling); } return false; })()`;
console.log("history", await evaluate(findHistory));
const routes = [
  "/",
  "/search",
  "/collection/tracks",
  "/preferences",
  "/intl-de/album/191ZQhbSSEJCO52So5q5yJ",
  "/intl-de/artist/7l1LpKcZ4ifOZz65pl20Xz",
  "/show/033hGqcaxYFRFWjx8LJzKF",
  "/playlist/37i9dQZF1E4v45jZORzfDW",
  "/collection",
];
const report = [];
for (const [i, r] of routes.entries()) {
  await evaluate(`window.__skHistory.push(${JSON.stringify(r)})`);
  await sleep(4500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${i}.png`, Buffer.from(shot.result.data, "base64"));
  const dom = await evaluate(`(() => {
    const map = window.__spotikitClassMap || {}; const stable = new Set(Object.values(map));
    let leftover = 0, mapped = 0, elements = 0; const examples = [];
    for (const el of document.querySelectorAll("[class]")) { elements++; for (const c of el.classList) { if (Object.prototype.hasOwnProperty.call(map, c)) { leftover++; if (examples.length < 5) examples.push(c); } else if (stable.has(c)) mapped++; } }
    return { elements, mapped, leftover, examples };
  })()`);
  report.push({ route: r, ...dom });
  console.log(i, r, JSON.stringify(dom));
}
await evaluate(`window.__skHistory.push("/")`);
const errors = events
  .filter(
    (e) =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error") ||
      (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
  )
  .map((e) => JSON.stringify(e.params).slice(0, 300));
writeFileSync(`${out}/report.json`, JSON.stringify({ report, errors }, null, 1));
console.log("errors during run:", errors.length);
for (const e of errors.slice(0, 10)) console.log("  ", e);
ws.close();
