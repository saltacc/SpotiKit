import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./capture-input.mjs";

const NAME = /^[a-z][a-z0-9]*(?:(?:-|--|__)[a-z0-9]+)*$/;
const GENERATED = /^[A-Za-z_][A-Za-z0-9_-]{2,}$/;

export function validateMappings(mappings) {
  const names = new Set(), hashes = new Set();
  for (const entry of mappings) {
    if (!NAME.test(entry.stable) || !GENERATED.test(entry.generated)) throw new Error("Invalid class mapping: " + JSON.stringify(entry));
    if (names.has(entry.stable) || hashes.has(entry.generated)) throw new Error("Repeated mapping: " + entry.stable);
    names.add(entry.stable); hashes.add(entry.generated);
  }
}

export function emitCatalog(existing, version, mappings, build) {
  validateMappings(mappings);
  const result = { ...existing, spotify: { ...(existing.spotify || {}) }, profiles: [...(existing.profiles || [])] };
  if (!build || build.platform === "windows") result.spotify[version] = mappings;
  if (build) {
    if (build.spotifyVersion !== version || !["macos", "windows", "linux"].includes(build.platform) ||
        !build.architecture || !/^[A-Fa-f0-9]{64}$/.test(build.resourceFingerprint || "") ||
        (build.snapshotSha256 !== null && build.snapshotSha256 !== undefined && !/^[A-Fa-f0-9]{64}$/.test(build.snapshotSha256))) {
      throw new Error("Capture build metadata is missing a valid identity for Spotify " + version + ".");
    }
    const sameBuild = result.profiles.find((profile) => profile.spotifyVersion === version && profile.platform === build.platform &&
      profile.architecture === build.architecture && profile.resourceFingerprint.toUpperCase() === build.resourceFingerprint.toUpperCase() &&
      (profile.snapshotSha256 || "").toUpperCase() === (build.snapshotSha256 || "").toUpperCase());
    let id = sameBuild?.id || build.profileId || build.platform + "-" + build.architecture + "-" + version;
    if (!sameBuild && result.profiles.some((profile) => profile.id === id))
      id += "-" + sha256(Buffer.from(build.resourceFingerprint.toUpperCase() + "\0" + (build.snapshotSha256 || "").toUpperCase())).slice(0, 12).toLowerCase();
    const profile = { ...sameBuild, id, spotifyVersion: version, platform: build.platform, architecture: build.architecture,
      resourceFingerprint: build.resourceFingerprint.toUpperCase(), snapshotSha256: build.snapshotSha256?.toUpperCase() || null, mappings };
    result.profiles = result.profiles.filter((entry) => entry.id !== id);
    result.profiles.push(profile);
    build.profileId = id;
    result.schemaVersion = 2;
  } else result.schemaVersion = result.schemaVersion || 1;
  result.comment ||= "Stable theme class mappings for verified Spotify platform builds. Legacy version-only records were captured from Windows clients.";
  if (result.schemaVersion === 1 && result.profiles.length === 0) delete result.profiles;
  return result;
}

export function formatCatalog(catalog) {
  const mappingList = (list, indent) => list.map((entry) => indent + JSON.stringify(entry)).join(",\n");
  const headers = Object.entries(catalog).filter(([key]) => key !== "spotify" && key !== "profiles")
    .map(([key, value]) => "  " + JSON.stringify(key) + ": " + JSON.stringify(value));
  const versions = Object.entries(catalog.spotify || {}).map(([version, list]) =>
    "    " + JSON.stringify(version) + ": [\n" + mappingList(list, "      ") + "\n    ]");
  const blocks = [...headers, '  "spotify": {\n' + versions.join(",\n") + "\n  }"];
  if (catalog.profiles) blocks.push('  "profiles": [\n' + catalog.profiles.map((profile) => {
    const fields = Object.entries(profile).filter(([key]) => key !== "mappings").map(([key, value]) =>
      "      " + JSON.stringify(key) + ": " + JSON.stringify(value));
    fields.push('      "mappings": [\n' + mappingList(profile.mappings, "        ") + "\n      ]");
    return "    {\n" + fields.join(",\n") + "\n    }";
  }).join(",\n") + "\n  ]");
  return "{\n" + blocks.join(",\n") + "\n}\n";
}

function main(args) {
  const [out, version] = args;
  if (!out || !version) throw new Error("Usage: node emit.mjs <class-map.json> <spotify version>");
  const root = resolve(process.env.CLASSMAP_WORK || fileURLToPath(new URL("../work/", import.meta.url)));
  const buildPath = resolve(root, "build.json");
  const build = existsSync(buildPath) ? JSON.parse(readFileSync(buildPath, "utf8")) : null;
  let mappings;
  if (build && build.platform !== "windows") mappings = JSON.parse(readFileSync(resolve(root, "derived-platform.mappings.json"), "utf8"));
  else {
    const { names } = JSON.parse(readFileSync(resolve(root, "names2.json"), "utf8"));
    const { classes } = JSON.parse(readFileSync(resolve(root, "evidence2.json"), "utf8"));
    mappings = Object.keys(classes).filter((generated) => names[generated]).map((generated) => ({ generated,
      stable: names[generated].stable, description: names[generated].why === "curated" ? "named by hand" : names[generated].why.replace(/ \(numbered\)$/, ""),
      ...(classes[generated].runtimeOnly ? { runtimeOnly: true } : {}),
    }));
  }
  const previous = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
  const catalog = emitCatalog(previous, version, mappings, build);
  writeFileSync(out, formatCatalog(catalog));
  if (build) writeFileSync(buildPath, JSON.stringify(build, null, 2) + "\n");
  console.log(`Wrote ${mappings.length} mappings for ${build?.profileId || version}; retained ${Object.keys(catalog.spotify).length} legacy version record(s) and ${catalog.profiles?.length || 0} platform profile(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
