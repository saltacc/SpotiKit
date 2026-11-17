import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const cpuName = (cpu) => ({ 16777228: "arm64", 16777223: "x64", 12: "arm", 7: "x86" })[cpu] || "unknown";

export function executableArchitectures(bytes) {
  if (bytes.length < 8) return [];
  const magic = bytes.readUInt32BE(0);
  if (magic === 0xcffaedfe || magic === 0xcefaedfe) return [cpuName(bytes.readUInt32LE(4))];
  if (magic === 0xfeedfacf || magic === 0xfeedface) return [cpuName(bytes.readUInt32BE(4))];
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = bytes.readUInt32BE(4), size = magic === 0xcafebabf ? 32 : 20;
    if (count > 32 || 8 + count * size > bytes.length) return [];
    return [...new Set(Array.from({ length: count }, (_, index) => cpuName(bytes.readUInt32BE(8 + index * size))))].sort();
  }
  if (bytes.length >= 64 && bytes.toString("ascii", 0, 2) === "MZ") {
    const offset = bytes.readUInt32LE(60);
    if (offset + 6 <= bytes.length && bytes.readUInt32LE(offset) === 0x4550) {
      return [({ 34404: "x64", 43620: "arm64", 332: "x86" })[bytes.readUInt16LE(offset + 4)] || "unknown"];
    }
  }
  return [];
}

export function normalizePlatform(value = process.platform) {
  const platform = ({ darwin: "macos", win32: "windows", mac: "macos" })[String(value).toLowerCase()] || String(value).toLowerCase();
  if (!["windows", "macos", "linux"].includes(platform)) throw new Error("Unsupported capture platform: " + value);
  return platform;
}

export function spotifyPaths(platform, installationPath) {
  const source = resolve(installationPath);
  if (platform === "macos") {
    let bundle;
    if (source.toLowerCase().endsWith(".app")) bundle = source;
    else if (basename(source) === "Resources" && basename(dirname(source)) === "Contents") bundle = dirname(dirname(source));
    else throw new Error("On macOS, --spotify-path must identify a Spotify .app or its Contents/Resources directory.");
    return { bundle, resources: join(bundle, "Contents", "Resources"), archive: join(bundle, "Contents", "Resources", "Apps", "xpui.spa"),
      executable: join(bundle, "Contents", "MacOS", "Spotify"), plist: join(bundle, "Contents", "Info.plist") };
  }
  return { bundle: null, resources: source, archive: join(source, "Apps", "xpui.spa"), executable: join(source, platform === "windows" ? "Spotify.exe" : "spotify") };
}

export function canonicalFingerprint(root, paths) {
  const digest = createHash("sha256");
  for (const name of [...paths].sort()) {
    if (name.endsWith("/") || name.startsWith("spotikit/")) continue;
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("Invalid archive entry: " + name);
    digest.update(name + "\0" + sha256(readFileSync(join(root, name))) + "\n", "utf8");
  }
  return digest.digest("hex").toUpperCase();
}

export function filesUnder(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("A captured UI archive contains a symlink: " + path);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function macBundleVersion(plist) {
  let text = readFileSync(plist);
  if (text.subarray(0, 6).toString("ascii") === "bplist") {
    if (process.platform !== "darwin") throw new Error("Reading a binary Mac Info.plist requires plutil on a Mac.");
    text = execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", plist]);
  }
  const xml = text.toString("utf8");
  const value = (key) => new RegExp("<key>\\s*" + key + "\\s*</key>\\s*<string>([^<]+)</string>").exec(xml)?.[1]?.trim().match(/^\d+(?:\.\d+)+/)?.[0];
  const short = value("CFBundleShortVersionString"), full = value("CFBundleVersion");
  return full && short && full.startsWith(short + ".") ? full : short || full;
}

export function extractSnapshot(bundle, architecture) {
  const framework = join(bundle, "Contents", "Frameworks", "Chromium Embedded Framework.framework");
  const resourceRoot = [join(framework, "Resources"), join(framework, "Versions", "A", "Resources")].find(existsSync);
  if (!resourceRoot) throw new Error("The complete Spotify bundle's CEF resources were not found.");
  const candidates = readdirSync(resourceRoot).filter((name) => /^v8_context_snapshot.*\.bin$/.test(name)).sort();
  const names = architecture === "x64" ? ["x64", "x86_64"] : architecture === "arm64" ? ["arm64", "aarch64"] : [architecture];
  const selected = candidates.find((name) => names.some((alias) => name.includes(alias))) || (candidates.length === 1 ? candidates[0] : null);
  if (!selected) throw new Error("A unique CEF snapshot for " + architecture + " was not found.");
  const path = join(resourceRoot, selected), data = readFileSync(path);
  for (const encoding of ["utf16le", "utf8"]) {
    const start = Buffer.from("var __webpack_modules__={", encoding), end = Buffer.from("xpui-modules.js.map", encoding);
    const from = data.indexOf(start), to = from < 0 ? -1 : data.indexOf(end, from + start.length);
    if (from >= 0 && to > from) return { code: data.subarray(from, to + end.length).toString(encoding),
      sha256: sha256(data), file: relative(bundle, path).replaceAll("\\", "/"), encoding };
  }
  throw new Error("The selected CEF snapshot has no supported embedded module source. Capture modules from a clean running client instead.");
}
