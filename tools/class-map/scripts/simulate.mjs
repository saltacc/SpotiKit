import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { HASH } from "./fingerprint.mjs";

const here = dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, "$1"));
const repo = join(here, "..", "..", "..");
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const version = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const share = Number(option("--share") ?? 1);
const from = option("--from") ?? version;
if (!version || !(share > 0 && share <= 1)) {
  console.error("usage: node simulate.mjs <spotify version> [--share 0.3] [--from <snapshot version>]");
  process.exit(2);
}

const work = join(here, "..", "work", version);
const snapshot = join(repo, "classmaps", from, "snapshot.json");
for (const file of [join(work, "evidence2.json"), join(work, "names2.json"), snapshot])
  if (!existsSync(file)) throw new Error(`Missing ${file}. Capture and finish ${version} first.`);

const evidence = JSON.parse(readFileSync(join(work, "evidence2.json"), "utf8"));
const renamed = new Map();
for (const c of Object.keys(evidence.classes))
  if (HASH.test(c) && !c.startsWith("e-") && Math.random() < share)
    renamed.set(c, randomBytes(15).toString("base64url"));
const swap = (text) =>
  text.replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,21}(?![A-Za-z0-9_-])/g, (m) => renamed.get(m) ?? m);

const sim = join(here, "..", "work", `${version}-simulated`);
rmSync(sim, { recursive: true, force: true });
mkdirSync(sim, { recursive: true });
writeFileSync(join(sim, "evidence2.json"), swap(JSON.stringify(evidence)));
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const file of walk(join(work, "spa")).filter((f) => f.endsWith(".css"))) {
  const out = join(sim, "spa", relative(join(work, "spa"), file));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, swap(readFileSync(file, "utf8")));
}

execFileSync(process.execPath, [join(here, "port.mjs"), snapshot], {
  env: { ...process.env, CLASSMAP_WORK: sim },
  stdio: ["ignore", "ignore", "inherit"],
});

const real = JSON.parse(readFileSync(join(work, "names2.json"), "utf8")).names;
const ported = JSON.parse(readFileSync(join(sim, "ported-names.json"), "utf8"));
const nameOf = (entry) => (typeof entry === "string" ? entry : entry?.stable);
let right = 0;
const wrong = [];
let missing = 0;
for (const [original, fresh] of renamed) {
  const want = real[original]?.stable;
  const got = nameOf(ported[fresh]);
  if (!got) missing++;
  else if (got === want) right++;
  else wrong.push(`${want} became ${got}`);
}
const pct = (n) => ((100 * n) / renamed.size).toFixed(1) + "%";
console.log(`Spotify ${version}, ported from ${from}, ${renamed.size} hashes renamed (${share * 100}%)`);
console.log(
  `right ${right} (${pct(right)}), wrong ${wrong.length} (${pct(wrong.length)}), no name ${missing} (${pct(missing)})`
);
if (wrong.length) console.log("\nWrong:\n" + wrong.join("\n"));
rmSync(sim, { recursive: true, force: true });
