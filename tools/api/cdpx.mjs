import { readFileSync, writeFileSync } from "node:fs";

const [cmd, ...args] = process.argv.slice(2);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (cmd === "eval") {
  const res = await send("Runtime.evaluate", {
    expression: readFileSync(args[0], "utf8"),
    awaitPromise: true,
    returnByValue: true,
    timeout: 600000,
  });
  if (res.error || res.result.exceptionDetails) {
    console.error(JSON.stringify(res.error || res.result.exceptionDetails, null, 1).slice(0, 3000));
    ws.close();
    process.exit(1);
  }
  const value = res.result.result.value;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  if (args[1]) {
    writeFileSync(args[1], text);
    console.log(`wrote ${text.length} chars to ${args[1]}`);
  } else console.log((text ?? "undefined").slice(0, 20000));
} else if (cmd === "shot") {
  const res = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(args[0], Buffer.from(res.result.data, "base64"));
  console.log("saved " + args[0]);
} else if (cmd === "click") {
  const x = Number(args[0]),
    y = Number(args[1]);
  const button = args[2] === "right" ? "right" : "left";
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(60);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    buttons: button === "right" ? 2 : 1,
    clickCount: 1,
  });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
  console.log("clicked " + button + " at " + x + "," + y);
} else if (cmd === "move") {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Number(args[0]), y: Number(args[1]) });
} else if (cmd === "key") {
  const key = args[0];
  const codes = { Escape: 27, Enter: 13 };
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
    windowsVirtualKeyCode: codes[key] || key.toUpperCase().charCodeAt(0),
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode: codes[key] || key.toUpperCase().charCodeAt(0),
  });
  console.log("key " + key);
} else if (cmd === "reload") {
  await send("Page.reload", {});
  console.log("reloaded");
}
ws.close();
