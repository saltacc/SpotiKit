import { readFileSync } from "node:fs";

const [file, hold = "20"] = process.argv.slice(2);
const source = readFileSync(file, "utf8");
const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("xpui"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const seen = new Set();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (/cannot be rendered outside a collection/.test(text)) return;
    if (/SpotiKit|spotikit/i.test(text) || msg.params.type === "error" || msg.params.type === "warning") {
      const line = `[console.${msg.params.type}] ${text.slice(0, 500)}`;
      if (!seen.has(line)) {
        seen.add(line);
        console.log(line);
      }
    }
  }
  if (msg.method === "Runtime.exceptionThrown")
    console.log("[exception] " + JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
};
const boot = `(() => {
  Object.defineProperty(window, "SpotiKit", { value: { devPlaceholder: true }, configurable: true, writable: true });
  document.addEventListener("DOMContentLoaded", () => {
    delete window.SpotiKit;
    try { (0, eval)(${JSON.stringify(source + "\n//# sourceURL=spotikit-dev-loader.js")}); }
    catch (e) { console.error("[SpotiKit dev] loader threw", e); }
  }, { once: true });
})();`;
await send("Runtime.enable");
await send("Page.enable");
const { result } = await send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
await send("Page.reload", { ignoreCache: false });
await new Promise((r) => setTimeout(r, Number(hold) * 1000));
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: result.identifier });
ws.close();
