import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalFingerprint, executableArchitectures, extractSnapshot, filesUnder, macBundleVersion, normalizePlatform, sha256, spotifyPaths } from "./capture-input.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const tools = resolve(here, ".."), repo = resolve(tools, "..", "..");
const [phase, version, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(name);
  if (index < 0) return fallback;
  const value = rest[index + 1];
  if (!value || value.startsWith("--")) throw new Error("Missing value for " + name + ".");
  return value;
};
if (!["capture", "finish"].includes(phase) || !/^\d+(\.\d+){3}$/.test(version || "")) {
  console.error("Usage: node new-version.mjs <capture|finish> <spotify version> [--spotify-path <installation>] [--platform windows|macos|linux] [--architecture arm64|x64] [--from <version|snapshot>] [--offline] [--work <directory>] [--observations <json>] [--catalog <output.json>] [--snapshot-out <local file>]");
  process.exit(2);
}

const platform = normalizePlatform(option("--platform"));
const requestedArchitecture = option("--architecture");
const architectureDefault = process.arch === "x64" ? "x64" : process.arch;
let work = resolve(option("--work", process.env.CLASSMAP_WORK || join(tools, "work", platform === "windows" ? "" : platform + "-" + (requestedArchitecture || architectureDefault), version)));
if (phase === "finish" && platform !== "windows" && !option("--work") && !process.env.CLASSMAP_WORK && !existsSync(join(work, "build.json"))) {
  const parent = join(tools, "work");
  const captures = existsSync(parent) ? readdirSync(parent).filter((name) => name.startsWith(platform + "-") && existsSync(join(parent, name, version, "build.json"))) : [];
  if (captures.length === 1) work = join(parent, captures[0], version);
  else if (captures.length > 1) throw new Error("Multiple platform captures exist. Select one with --work or --architecture.");
}
const env = { ...process.env, CLASSMAP_WORK: work };
const catalog = resolve(option("--catalog", join(repo, "Framework", "class-map.json")));
const run = (script, ...args) => {
  console.log(`\n> ${script} ${args.join(" ")}`);
  execFileSync(process.execPath, [join(here, script), ...args], { env, stdio: "inherit", cwd: repo });
};

async function command(method, params = {}) {
  const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
  const page = list.find((target) => target.type === "page" && target.url.includes("xpui"));
  if (!page) throw new Error("Spotify's page wasn't found on port 9229.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  try {
    return await new Promise((done, fail) => {
      const timeout = setTimeout(() => fail(new Error("Spotify debugging request timed out.")), 30000);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error) fail(new Error(message.error.message)); else done(message.result);
      };
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally { socket.close(); }
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;

function baseSnapshot(architecture) {
  const root = join(repo, "classmaps");
  const platformArchitecture = platform + "-" + architecture;
  const localRoot = join(tools, "work", platform === "windows" ? "" : platformArchitecture);
  const nativeRoot = join(root, platformArchitecture);
  const from = option("--from");
  if (from) {
    const reference = [resolve(from), ...[localRoot, nativeRoot, root].map((directory) => join(directory, from, "snapshot.json"))].find(existsSync);
    if (reference) return reference;
    throw new Error("The requested base snapshot was not found: " + from);
  }
  for (const directory of [localRoot, nativeRoot]) {
    if (!existsSync(directory)) continue;
    const previous = readdirSync(directory).filter((candidate) => candidate !== version && existsSync(join(directory, candidate, "snapshot.json")))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (previous.length) return join(directory, previous.at(-1), "snapshot.json");
  }
  const sameVersion = join(root, version, "snapshot.json");
  if (platform !== "windows" && existsSync(sameVersion)) return sameVersion;
  const versions = readdirSync(root).filter((candidate) => candidate !== version && existsSync(join(root, candidate, "snapshot.json")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error("No earlier mapping snapshot was found. Supply --from <snapshot.json>.");
  return join(root, versions.at(-1), "snapshot.json");
}

if (phase === "capture") {
  const offline = rest.includes("--offline");
  if (!offline) {
    let agent;
    try { agent = await evaluate("navigator.userAgent"); }
    catch { throw new Error("Start the clean Spotify client with --remote-debugging-port=9229, or use --offline for archive and snapshot capture."); }
    if (!agent?.includes("Spotify/" + version)) throw new Error(`Spotify reports "${agent}", not ${version}.`);
    if (await evaluate("!!(window.SpotiKit && window.SpotiKit.version)")) throw new Error("Capture requires a clean Spotify client with its original class names.");
  }
  const defaultPath = platform === "windows" && process.env.APPDATA ? join(process.env.APPDATA, "Spotify") : platform === "macos" ? "/Applications/Spotify.app" : "/usr/share/spotify";
  const input = spotifyPaths(platform, option("--spotify-path", defaultPath));
  if (!existsSync(input.archive) || !existsSync(input.executable)) throw new Error("Spotify's executable or xpui.spa was not found at the supplied installation.");
  if (platform === "macos" && macBundleVersion(input.plist) !== version) throw new Error("The supplied Mac bundle does not match Spotify " + version + ".");
  const architectures = executableArchitectures(readFileSync(input.executable));
  const architecture = requestedArchitecture || (architectures.length === 1 ? architectures[0] : architectureDefault);
  if (architectures.length && !architectures.includes(architecture)) throw new Error("The target executable does not contain the requested " + architecture + " architecture.");
  if (platform !== "windows" && architecture === "unknown") throw new Error("The target architecture could not be established.");
  if (!option("--work") && !process.env.CLASSMAP_WORK && platform !== "windows") {
    work = resolve(tools, "work", platform + "-" + architecture, version);
    env.CLASSMAP_WORK = work;
  }
  mkdirSync(work, { recursive: true });
  for (const name of readdirSync(work)) {
    if (/^(?:dom\d*|modules|evidence2|names2|ported-names)\.json$/.test(name)) rmSync(join(work, name));
  }
  const spa = join(work, "spa");
  rmSync(spa, { recursive: true, force: true });
  mkdirSync(spa);
  const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "/usr/bin/tar";
  const entries = execFileSync(tar, ["-tf", input.archive], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  // Spotify archives may contain a root directory entry named "/". Skip that
  // directory while refusing absolute or traversing file paths.
  const extractEntries = entries.filter((name) => name !== "/");
  if (extractEntries.some((name) => name.startsWith("/") || name.split("/").includes(".."))) throw new Error("The archive contains an unsafe entry path.");
  execFileSync(tar, ["-xf", input.archive, "-C", spa, "--", ...extractEntries]);
  if (existsSync(join(spa, "spotikit"))) throw new Error("xpui.spa already contains SpotiKit. Use a pristine bundle.");
  const pristineFiles = filesUnder(spa).map((file) => file.slice(spa.length + 1).replaceAll("\\", "/"));
  const metadata = { schemaVersion: 1, spotifyVersion: version, platform, architecture, executableArchitectures: architectures,
    resourceFingerprint: canonicalFingerprint(spa, pristineFiles), archiveSha256: sha256(readFileSync(input.archive)),
    profileId: platform + "-" + architecture + "-" + version,
    baseSnapshot: baseSnapshot(architecture), snapshotSha256: null };
  if (platform === "macos") {
    try {
      const snapshot = extractSnapshot(input.bundle, architecture);
      writeFileSync(join(spa, "xpui-modules.js"), snapshot.code);
      metadata.snapshotSha256 = snapshot.sha256;
      metadata.snapshotFile = snapshot.file;
      metadata.snapshotEncoding = snapshot.encoding;
    } catch (error) {
      if (offline) throw error;
      console.warn("Snapshot extraction: " + error.message + " Capturing the running module table instead.");
    }
  }
  if (offline) writeFileSync(join(work, "modules.json"), "{}\n");
  else {
    run("cdp.mjs", join(here, "dump-modules.js"), join(work, "modules.json"));
    if (!rest.includes("--no-crawl")) {
      await command("Page.bringToFront");
      run("cdp.mjs", join(here, "crawl.js"), join(work, "dom.json"));
    }
  }
  writeFileSync(join(work, "build.json"), JSON.stringify(metadata, null, 2) + "\n");
  run("extract2.mjs");
  run("port.mjs", metadata.baseSnapshot, ...(platform === "windows" ? [] : ["--min", "0.7"]));
  if (platform === "windows") run("name2.mjs");
  else run("derive-platform.mjs", "--base", metadata.baseSnapshot, ...(option("--observations") ? ["--observations", resolve(option("--observations"))] : []));
  console.log(`Captured Spotify ${version} (${platform}/${architecture}). Review the evidence in ${work}, then run finish with the same --work.`);
} else {
  const metadataFile = join(work, "build.json");
  const metadata = existsSync(metadataFile) ? JSON.parse(readFileSync(metadataFile, "utf8")) : { platform: "windows", architecture: "any" };
  if (!existsSync(join(work, metadata.platform === "windows" ? "names2.json" : "derived-platform.mappings.json"))) throw new Error("Run capture and review the mapping evidence first.");
  run("emit.mjs", catalog, version);
  // Fingerprint snapshots contain normalized Spotify CSS. Keep the default
  // output with the raw capture in the ignored work directory.
  const destination = option("--snapshot-out", join(work, "snapshot.json"));
  run("snapshot.mjs", version, resolve(destination), "--catalog", catalog);
  console.log(`Wrote mapping data and ${destination}. Validate it in the actual client before marking support verified.`);
}
