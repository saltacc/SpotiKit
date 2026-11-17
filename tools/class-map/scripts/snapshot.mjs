import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCssRules, indexRules, fingerprint } from "./fingerprint.mjs";

const root = resolve(process.env.CLASSMAP_WORK || fileURLToPath(new URL("../work/", import.meta.url)));
const [version, out, ...args] = process.argv.slice(2);
const catalogIndex = args.indexOf("--catalog");
const catalogPath = catalogIndex < 0 ? fileURLToPath(new URL("../../../Framework/class-map.json", import.meta.url)) : args[catalogIndex + 1];
if (!version || !out) throw new Error("Usage: node snapshot.mjs <spotify version> <out file> [--catalog <class-map.json>]");

const buildFile = resolve(root, "build.json");
const build = existsSync(buildFile) ? JSON.parse(readFileSync(buildFile, "utf8")) : null;
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const profile = build && (catalog.profiles || []).find((entry) => entry.id === build.profileId && entry.spotifyVersion === version);
const map = profile?.mappings || catalog.spotify?.[version];
if (!map || (build?.platform !== "windows" && build && !profile)) throw new Error("The requested platform profile was not found in the catalog.");
const { classes } = JSON.parse(readFileSync(resolve(root, "evidence2.json"), "utf8"));
const stable = new Map(map.map((entry) => [entry.generated, entry.stable]));
const rules = readCssRules(resolve(root, "spa"));
const index = indexRules(rules);
const entries = map.map((entry) => [entry.generated, { stable: entry.stable, ...(entry.runtimeOnly ? { runtimeOnly: true } : {}),
  ...fingerprint(entry.generated, classes[entry.generated], rules, index, (name) => stable.get(name)),
}]);
const header = { schemaVersion: profile ? 2 : 1, spotify: version, created: new Date().toISOString().slice(0, 10),
  ...(profile ? { profileId: profile.id, platform: profile.platform, architecture: profile.architecture,
    resourceFingerprint: profile.resourceFingerprint, snapshotSha256: profile.snapshotSha256 } : {}),
  comment: "Local class fingerprints contain normalized Spotify CSS and module or DOM evidence. Keep this capture outside version control.",
};
const text = "{\n" + Object.entries(header).map(([key, value]) => "  " + JSON.stringify(key) + ": " + JSON.stringify(value) + ",\n").join("") +
  '  "classes": {\n' + entries.map(([generated, value]) => "    " + JSON.stringify(generated) + ": " + JSON.stringify(value)).join(",\n") + "\n  }\n}\n";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`Wrote ${entries.length} class fingerprints for ${profile?.id || version}; ${map.filter((entry) => !classes[entry.generated]).length} mapping(s) lack capture evidence.`);
