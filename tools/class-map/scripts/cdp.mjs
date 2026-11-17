import { readFileSync, writeFileSync } from "node:fs";

const [scriptPath, outPath] = process.argv.slice(2);
const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("xpui"));
if (!page) throw new Error("xpui page not found");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const res = await send("Runtime.evaluate", {
  expression: readFileSync(scriptPath, "utf8"),
  awaitPromise: true,
  returnByValue: true,
  timeout: 600000,
});
ws.close();
if (res.error || res.result.exceptionDetails) {
  console.error(JSON.stringify(res.error || res.result.exceptionDetails, null, 1).slice(0, 3000));
  process.exit(1);
}
const value = res.result.result.value;
const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
if (outPath) {
  writeFileSync(outPath, text);
  console.log(`wrote ${text.length} chars to ${outPath}`);
} else console.log(text.slice(0, 20000));
