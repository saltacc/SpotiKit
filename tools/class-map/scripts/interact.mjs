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
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Runtime.enable");
const center = async (sel) =>
  evaluate(
    `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
const click = async (sel, button = "left") => {
  const p = await center(sel);
  if (!p) return "missing " + sel;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button, clickCount: 1 });
  await sleep(1200);
  return "clicked " + sel;
};
const key = async (k) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k });
  await sleep(500);
};
const results = [];
await evaluate(`window.__skHistory.push("/collection/tracks")`);
await sleep(3500);
results.push(await click('[data-testid="tracklist-row"]', "right"));
results.push("menu open: " + (await evaluate(`!!document.querySelector('[role="menu"]')`)));
results.push("menu classes: " + (await evaluate(`(document.querySelector('[role="menu"]')||{}).className`)));
await key("Escape");
results.push("menu closed: " + (await evaluate(`!document.querySelector('[role="menu"]')`)));
results.push(await click('[data-testid="control-button-queue"]'));
results.push(
  "panel after queue click: " +
    (await evaluate(`(document.querySelector('.right-panel, #Desktop_PanelContainer_Id')||{}).innerText?.slice(0,60)`))
);
results.push(await click('[data-testid="control-button-queue"]'));
results.push(await click('[data-testid="lyrics-button"]'));
results.push("route after lyrics: " + (await evaluate(`window.__skHistory.location.pathname`)));
results.push("lyrics lines: " + (await evaluate(`document.querySelectorAll('[data-testid="lyrics-line"]').length`)));
results.push(await click('[data-testid="lyrics-button"]'));
await evaluate(`window.__skHistory.push("/")`);
await sleep(2500);
const p = await center(".main-view-container");
for (let i = 0; i < 6; i++) {
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: 0, deltaY: 600 });
  await sleep(300);
}
results.push(
  "scrolled: " +
    (await evaluate(
      `document.querySelector(".main-view-container__scroll-node [data-overlayscrollbars-viewport]")?.scrollTop`
    ))
);
const errors = events
  .filter(
    (e) =>
      e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
  )
  .map((e) =>
    JSON.stringify(
      e.params.exceptionDetails?.exception?.description || e.params.args?.map((a) => a.value || a.description)
    ).slice(0, 300)
  );
console.log(results.join("\n"));
console.log("errors:", errors.length);
errors.slice(0, 8).forEach((e) => console.log("  ", e));
ws.close();
