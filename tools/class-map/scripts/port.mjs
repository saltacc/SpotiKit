import { readFileSync, writeFileSync } from "node:fs";
import { HASH, readCssRules, indexRules, fingerprint, tokens, similarity } from "./fingerprint.mjs";

const root = (
  process.env.CLASSMAP_WORK ||
  decodeURIComponent(new URL("../work/", import.meta.url).pathname).replace(/^\/(\w:)/, "$1")
).replace(/[\\/]?$/, "/");
const args = process.argv.slice(2);
const snapshotPath = args.find((a) => !a.startsWith("--"));
const MIN = Number(args[args.indexOf("--min") + 1]) || 0.5;
const REVIEW = 0.32;
const MARGIN = 0.06;
if (!snapshotPath) {
  console.error("usage: node port.mjs <old snapshot.json> [--min 0.5]");
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const { classes: evidence } = JSON.parse(readFileSync(root + "evidence2.json", "utf8"));
const rules = readCssRules(root + "spa");
const ruleIndex = indexRules(rules);

const old = Object.entries(snapshot.classes).filter(([g]) => HASH.test(g));
const assigned = new Map();
const taken = new Set();
const assign = (hash, stable, how, extra = {}) => {
  assigned.set(hash, { stable, how, ...extra });
  taken.add(stable);
};

for (const [g, fp] of old) if (evidence[g]) assign(g, fp.stable, "same hash", { old: g });

const STRONG = /^(R|S|X|T|K|DT|PT|ST):/;
const oldTokens = new Map(old.filter(([g]) => !assigned.has(g)).map(([g, fp]) => [g, tokens(fp)]));

function round(threshold) {
  const nameOf = (c) => assigned.get(c)?.stable;
  const open = Object.keys(evidence).filter((c) => HASH.test(c) && !assigned.has(c));
  const newTokens = new Map(open.map((c) => [c, tokens(fingerprint(c, evidence[c], rules, ruleIndex, nameOf))]));
  const index = new Map();
  for (const [c, t] of newTokens)
    for (const k of t.keys())
      if (STRONG.test(k)) {
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(c);
      }

  const best = new Map();
  const bestForNew = new Map();
  for (const [g, t] of oldTokens) {
    if (taken.has(snapshot.classes[g].stable)) continue;
    const shared = new Map();
    for (const k of t.keys()) for (const c of index.get(k) || []) shared.set(c, (shared.get(c) || 0) + 1);
    const scored = [...shared.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([c]) => [c, similarity(t, newTokens.get(c))])
      .sort((a, b) => b[1] - a[1]);
    if (!scored.length) continue;
    const [to, score] = scored[0];
    best.set(g, { to, score, margin: score - (scored[1]?.[1] || 0) });
    for (const [c, s] of scored)
      if (!bestForNew.has(c) || bestForNew.get(c).score < s) bestForNew.set(c, { from: g, score: s });
  }

  let accepted = 0;
  for (const [g, b] of best) {
    if (b.score < threshold || b.margin < MARGIN || bestForNew.get(b.to)?.from !== g || assigned.has(b.to)) continue;
    assign(b.to, snapshot.classes[g].stable, threshold >= MIN ? "fingerprint" : "fingerprint, check", {
      score: b.score,
      margin: b.margin,
      old: g,
    });
    oldTokens.delete(g);
    accepted++;
  }
  return accepted;
}

let rounds = 0;
for (const threshold of [MIN, REVIEW]) {
  for (let pass = 0; pass < 20; pass++) {
    const n = round(threshold);
    console.log(`round ${++rounds} (min ${threshold}): ${n} matched`);
    if (!n) break;
  }
}

const ported = Object.fromEntries([...assigned].map(([h, a]) => [h, a.stable]));
writeFileSync(root + "ported-names.json", JSON.stringify(ported, null, 1));

const byHow = (how) => [...assigned].filter(([, a]) => a.how === how);
const lost = [...oldTokens.keys()].map((g) => snapshot.classes[g].stable).sort();
const unnamed = Object.keys(evidence).filter((c) => HASH.test(c) && !assigned.has(c));
const fmt = (n) => n.toFixed(2);
const rows = (list) =>
  list
    .sort((a, b) => a[1].score - b[1].score)
    .map(([h, a]) => `| ${a.stable} | ${a.old} → ${h} | ${fmt(a.score)} | ${fmt(a.margin)} |`)
    .join("\n");
const report = `# Class map port: Spotify ${snapshot.spotify} → ${root}

- Same hash, name kept: **${byHow("same hash").length}**
- Found by fingerprint: **${byHow("fingerprint").length}** (score ≥ ${MIN})
- Likely, please check: **${byHow("fingerprint, check").length}** (score ≥ ${REVIEW})
- Old names without a match: **${lost.length}** (the class is gone, or changed too much)
- New classes without a name: **${unnamed.length}** (name2.mjs names them; check with digest.mjs)

Score is how alike the fingerprints are (0 to 1); margin is the lead over the second-best candidate.

## Likely, please check

| name | old → new | score | margin |
|---|---|---|---|
${rows(byHow("fingerprint, check"))}

## Found by fingerprint

| name | old → new | score | margin |
|---|---|---|---|
${rows(byHow("fingerprint"))}

## Old names without a match

${lost.join(", ") || "none"}
`;
writeFileSync(root + "port-report.md", report);
console.log(
  `same hash ${byHow("same hash").length}, fingerprint ${byHow("fingerprint").length}, check ${byHow("fingerprint, check").length}, lost ${lost.length}, new unnamed ${unnamed.length}`
);
console.log("wrote", root + "ported-names.json", "and port-report.md");
