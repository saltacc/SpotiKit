import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/^\/(\w:)/, "$1");
const tools = join(here, "..");
const repo = join(tools, "..", "..");
const [phase, version, ...rest] = process.argv.slice(2);
const from = rest[rest.indexOf("--from") + 1] && rest.includes("--from") ? rest[rest.indexOf("--from") + 1] : null;
if (!["capture", "finish"].includes(phase) || !/^\d+(\.\d+){3}$/.test(version || "")) {
  console.error("usage: node new-version.mjs capture <spotify version> [--from <previous version>]\n       node new-version.mjs finish <spotify version>");
  process.exit(2);
}

const work = process.env.CLASSMAP_WORK || join(tools, "work", version);
const env = { ...process.env, CLASSMAP_WORK: work };
const run = (script, ...args) => {
  console.log(`\n> ${script} ${args.join(" ")}`);
  execFileSync(process.execPath, [join(here, script), ...args], { env, stdio: "inherit", cwd: here });
};

async function command(method, params = {}) {
  const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
  const page = list.find((t) => t.type === "page" && t.url.includes("xpui"));
  if (!page) throw new Error("Spotify's page wasn't found on port 9229.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const result = await new Promise((r) => {
    ws.onmessage = (ev) => r(JSON.parse(ev.data));
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return result.result;
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;

function latestSnapshot() {
  const dir = join(repo, "classmaps");
  const versions = readdirSync(dir)
    .filter((v) => v !== version && existsSync(join(dir, v, "snapshot.json")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error("There is no earlier snapshot in classmaps/.");
  return versions[versions.length - 1];
}

if (phase === "capture") {
  let agent;
  try {
    agent = await evaluate("navigator.userAgent");
  } catch {
    throw new Error("Start Spotify with --remote-debugging-port=9229 first.");
  }
  if (!agent.includes("Spotify/" + version)) throw new Error(`Spotify reports "${agent}", not ${version}.`);
  if (await evaluate("!!(window.SpotiKit && window.SpotiKit.version)"))
    throw new Error("SpotiKit is installed in this Spotify. Uninstall it first, so the capture sees Spotify's own class names.");

  mkdirSync(work, { recursive: true });
  const spa = join(work, "spa");
  rmSync(spa, { recursive: true, force: true });
  mkdirSync(spa);
  const xpui = join(process.env.APPDATA, "Spotify", "Apps", "xpui.spa");
  const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", xpui, "-C", spa]);
  if (existsSync(join(spa, "spotikit"))) throw new Error("xpui.spa contains SpotiKit. Use an unpatched one.");
  console.log(`unpacked ${xpui} to ${spa}`);

  run("cdp.mjs", join(here, "dump-modules.js"), join(work, "modules.json"));
  await command("Page.bringToFront");
  run("cdp.mjs", join(here, "crawl.js"), join(work, "dom.json"));
  run("extract2.mjs");
  const previous = from || latestSnapshot();
  run("port.mjs", join(repo, "classmaps", previous, "snapshot.json"));
  run("name2.mjs");
  console.log(`\nCaptured Spotify ${version} from ${previous}. Read ${join(work, "port-report.md")}, fix names in`);
  console.log(`tools/class-map/curated-names.json if needed, run name2.mjs again, then: node new-version.mjs finish ${version}`);
} else {
  if (!existsSync(join(work, "names2.json"))) throw new Error(`Run capture for ${version} first.`);
  run("emit.mjs", join(repo, "Framework", "class-map.json"), version);
  run("snapshot.mjs", version, join(repo, "classmaps", version, "snapshot.json"));
  console.log(`\nSpotify ${version} is in Framework/class-map.json and classmaps/${version}/. Test it in the client, then approve it.`);
}
