import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { extname, join, sep } from "node:path";
import { build, buildTargets } from "./build.mjs";
import { DEFAULT_MAIN, color, entries, fail, files, localized, projectId, readManifest, walk } from "./project.mjs";

const TEXT = new Set([".css", ".js", ".mjs", ".json", ".svg", ".txt"]);
const SOURCE = new Set([".ts", ".tsx", ".jsx", ".js", ".mjs"]);

export async function connect(port) {
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch (e) {
    return null;
  }
  const page = list.find((t) => t.type === "page" && String(t.url).includes("xpui"));
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = () => no(fail("Spotify's debug connection closed right away."));
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((done, reject) => {
      const n = ++id;
      const timer = setTimeout(() => {
        waiting.delete(n);
        reject(fail("Spotify didn't answer."));
      }, 15000);
      waiting.set(n, (msg) => {
        clearTimeout(timer);
        const r = msg.result || {};
        if (r.exceptionDetails) reject(fail(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
        else done(r.result ? r.result.value : undefined);
      });
      ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  return { evaluate, close: () => ws.close() };
}

export function launchSpotify(port) {
  const arg = `--remote-debugging-port=${port}`;
  if (process.platform === "win32") {
    const exe = join(process.env.APPDATA || "", "Spotify", "Spotify.exe");
    if (!existsSync(exe)) throw fail("Spotify isn't installed in the usual place. Start it yourself with " + arg);
    spawn(exe, [arg], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["-a", "Spotify", "--args", arg], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("spotify", [arg], { detached: true, stdio: "ignore" }).unref();
  }
}

export function update(root, entry, id, only) {
  const main = files(entry.main)[0] || DEFAULT_MAIN[entry.type];
  const all = walk(root).filter((f) => TEXT.has(extname(f).toLowerCase()) && !f.startsWith("src/") && f !== "package.json" && f !== "package-lock.json" && f !== "tsconfig.json");
  const pick = only ? all.filter((f) => only.has(f)) : all;
  const filesOut = {};
  pick.forEach((f) => (filesOut[f] = readFileSync(join(root, f), "utf8")));
  return {
    kind: entry.type,
    id,
    name: localized(entry.name) || id,
    folder: true,
    path: entry.type === "extension" ? `${id}/${main}` : null,
    files: filesOut,
    changed: only ? [...only] : [],
  };
}

const RESULT = { css: "updated in place", reload: "Spotify reloaded", restarted: "restarted", applied: "applied" };

export async function dev(root, options) {
  const listed = entries(readManifest(root));
  const entry = listed[0];
  if (listed.length > 1) console.log(color.yellow(`spotikit.json has ${listed.length} entries; live testing the first, ${localized(entry.name)}.`));
  const id = options.id || projectId(root, entry);
  const port = options.port || 9229;

  let spotify = await connect(port);
  if (!spotify && options.launch) {
    console.log("Starting Spotify with live testing…");
    launchSpotify(port);
    for (let i = 0; i < 40 && !spotify; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      spotify = await connect(port);
    }
  }
  if (!spotify)
    throw fail(
      `Spotify isn't listening on port ${port}. Turn on Live preview in the SpotiKit app (Developer), or run this again with --launch while Spotify is closed.`
    );
  const ready = await spotify.evaluate("!!(window.SpotiKit && SpotiKit._internal && SpotiKit._internal.dev)");
  if (!ready) throw fail("SpotiKit isn't running in this Spotify. Install it with the SpotiKit app first.");

  const push = async (only) => {
    const result = await spotify.evaluate(`SpotiKit._internal.dev.push(${JSON.stringify(update(root, entry, id, only))})`);
    return RESULT[result] || "shown";
  };

  const hasBuild = buildTargets(root).length > 0;
  if (hasBuild) await build(root);
  console.log(`${color.bold(localized(entry.name) || id)} ${color.dim(`(${entry.type} ${id})`)}: ${await push(null)}. Watching for changes, Ctrl+C to stop.`);

  let timer = null;
  const changed = new Set();
  const builtMain = hasBuild ? buildTargets(root).map((t) => t.main) : [];
  watch(root, { recursive: true }, (event, name) => {
    if (!name) return;
    const file = name.split(sep).join("/");
    if (/(^|\/)(node_modules|\.git)(\/|$)/.test(file) || builtMain.includes(file)) return;
    changed.add(file);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const batch = new Set(changed);
      changed.clear();
      try {
        if (hasBuild && [...batch].some((f) => SOURCE.has(extname(f)) && (f.startsWith("src/") || !TEXT.has(extname(f))))) {
          await build(root);
          builtMain.forEach((m) => batch.add(m));
        }
        const sendable = new Set([...batch].filter((f) => TEXT.has(extname(f).toLowerCase()) && existsSync(join(root, f)) && !f.startsWith("src/")));
        if (!sendable.size) return;
        const what = [...sendable].slice(0, 3).join(", ");
        console.log(`${color.dim(new Date().toLocaleTimeString())} ${what}: ${await push(sendable)}`);
      } catch (e) {
        console.log(color.red(e.message));
      }
    }, 250);
  });

  const stop = async () => {
    console.log("Stopping. Spotify goes back to what's installed.");
    try {
      await spotify.evaluate("SpotiKit._internal.dev.clear(), true");
    } catch (e) {}
    spotify.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return new Promise(() => {});
}
