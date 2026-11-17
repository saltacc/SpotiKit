import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HASH, fingerprint, indexRules, readCssRules } from "./fingerprint.mjs";

const GENERIC_EXPORT = new Set(["container", "wrapper", "root", "content", "title", "button", "icon", "text", "image", "header", "footer", "row", "item", "list"]);
const GENERIC_PROP = new Set(["children", "className", "style", "ref", "id", "onClick", "disabled"]);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sorted = (values) => [...new Set(values)].sort();
const intersection = (left, right) => [...left].filter((value) => right.has(value));

export function normalizeCssRule(rule, stableNames) {
  return rule
    .replace(/\.@[a-z][a-z0-9_-]*/g, ".#")
    .replace(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g, (match, name) => stableNames.has(name) ? ".#" : match)
    .replace(/(animation(?:-name)?:)([^;}]+)/g, (_, property, value) => property +
      value.replace(/(?<![A-Za-z0-9_-])[A-Za-z_][A-Za-z0-9_-]{19,20}(?![A-Za-z0-9_-])/g, "$keyframe"));
}

const cssSet = (fp, stableNames) => new Set((fp.css || []).map((rule) => normalizeCssRule(rule, stableNames)));
const signature = (rules) => sorted(rules).join("\n");

function semanticEvidence(value, current) {
  const els = current ? value.el || [] : value.jsx || [];
  const related = (kind) => new Set(els.flatMap((el) => kind === "parents" ? (el.parents || []).flatMap((parent) => parent.cls || []) :
    kind === "siblings" ? (el.siblings || []).flatMap((sibling) => typeof sibling === "string" ? [sibling] : sibling.cls || []) : el.sub?.cls || [])
    .filter((name) => current || name.startsWith("@")).map((name) => current ? name : name.slice(1)));
  return {
    parents: related("parents"), siblings: related("siblings"), descendants: related("descendants"),
    tags: new Set([
      ...els.map((el) => el.as || el.tag),
      ...(!current ? value.dom?.samples?.map((sample) => sample.tag) || [] : []),
    ].filter((tag) => tag && /^[a-z][a-z0-9-]*$/.test(tag))),
    tests: new Set([
      ...els.flatMap((el) => [el.testid, el["data-testid"], ...(el.sub?.testids || [])]),
      ...(!current ? value.dom?.samples?.map((sample) => sample.testid) || [] : []),
    ].filter(Boolean)),
    keys: new Set(els.flatMap((el) => el.keys || [])),
    props: new Set(els.flatMap((el) => current ? el.fnProps || [] : el.props || []).filter((key) => !GENERIC_PROP.has(key))),
    exports: new Set((value.exports || []).filter((key) => !GENERIC_EXPORT.has(key))),
  };
}

function semanticSupport(old, next, resolve = (value) => value) {
  const shared = Object.fromEntries(["tests", "keys", "props", "exports"].map((kind) => [kind, intersection(old[kind], next[kind])]));
  for (const kind of ["parents", "siblings", "descendants"]) shared[kind] = intersection(old[kind], new Set([...next[kind]].map(resolve).filter(Boolean)));
  return { ...shared, score: shared.tests.length * 10 + shared.keys.length * 5 + shared.exports.length * 7 + shared.props.length * 1.5 +
    shared.parents.length * 6 + shared.siblings.length * 3 + shared.descendants.length * 2 };
}

const semanticWeight = (entry) => entry.semantic.tests.size * 10 + entry.semantic.keys.size * 5 +
  entry.semantic.exports.size * 7 + entry.semantic.props.size * 1.5 + entry.semantic.tags.size;

function groupBySignature(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = signature(entry.rules);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  return grouped;
}

// The port report is an input containing proposals, not a source of accepted names.
export function readPortReport(text) {
  const result = new Map();
  for (const match of text.matchAll(/^\| ([^|]+?) \| ([A-Za-z0-9_-]+) → ([A-Za-z0-9_-]+) \| ([\d.]+) \| ([\d.]+) \|$/gm)) {
    result.set(match[1].trim(), { old: match[2], generated: match[3], score: Number(match[4]), margin: Number(match[5]) });
  }
  return result;
}

export function deriveMappings({ snapshot, evidence, rules, proposals = new Map(), observations = [] }) {
  const stableNames = new Set(Object.values(snapshot.classes).map((value) => value.stable));
  const ruleIndex = indexRules(rules);
  const old = Object.entries(snapshot.classes).map(([generated, value]) => ({
    generated, stable: value.stable, value, rules: cssSet(value, stableNames), semantic: semanticEvidence(value, false),
  }));
  const current = Object.entries(evidence.classes).map(([generated, value]) => ({
    generated, value, rules: cssSet(fingerprint(generated, value, rules, ruleIndex, () => null), stableNames),
    semantic: semanticEvidence(value, true),
  }));
  const byOld = new Map(old.map((entry) => [entry.stable, entry]));
  const byCurrent = new Map(current.map((entry) => [entry.generated, entry]));
  const oldGroups = groupBySignature(old);
  const currentGroups = groupBySignature(current);
  const accepted = new Map();
  const names = new Map();
  const stableFor = (generated) => accepted.get(generated)?.stable || (stableNames.has(generated) ? generated : null);
  const rejected = [];
  const pending = [];

  function accept(stable, generated, detail) {
    if (!byOld.has(stable) || !byCurrent.has(generated)) {
      rejected.push({ stable, generated, reason: "name or class is absent from input evidence", evidence: detail });
      return false;
    }
    const nameCollision = names.get(stable);
    const hashCollision = accepted.get(generated);
    if ((nameCollision && nameCollision !== generated) || (hashCollision && hashCollision.stable !== stable)) {
      rejected.push({ stable, generated, reason: "conflicts with stronger accepted evidence", evidence: detail });
      return false;
    }
    if (hashCollision) {
      hashCollision.evidence.push(detail);
      return false;
    }
    names.set(stable, generated);
    accepted.set(generated, { generated, stable, evidence: [detail] });
    return true;
  }

  for (const observation of observations) {
    if (!observation.evidence?.description) throw new Error("Runtime observations require an evidence description.");
    accept(observation.stable, observation.generated, { type: "runtime-observation", ...observation.evidence });
  }

  for (const [key, previous] of oldGroups) {
    const candidates = currentGroups.get(key) || [];
    if (previous.length === 1 && candidates.length === 1) {
      accept(previous[0].stable, candidates[0].generated, {
        type: "unique-exact-css-fingerprint", rulesCompared: previous[0].rules.size,
        comparedAtMost: 40, previousClass: previous[0].generated,
      });
    }
  }

  for (const previous of old) {
    const same = byCurrent.get(previous.generated);
    if (!same || !HASH.test(previous.generated)) continue;
    const common = intersection(previous.rules, same.rules);
    const support = semanticSupport(previous.semantic, same.semantic);
    if (common.length > 0 || support.tests.length || support.keys.length || support.exports.length) {
      accept(previous.stable, same.generated, { type: "same-generated-class", sharedCssRules: common.length, semantic: support });
    }
  }

  // A near-exact stylesheet still needs independent semantic evidence. This
  // admits small platform differences without accepting generic utility rules.
  const inverseRules = new Map();
  for (const entry of current) for (const rule of entry.rules) {
    if (!inverseRules.has(rule)) inverseRules.set(rule, []);
    inverseRules.get(rule).push(entry);
  }
  for (const previous of [...old].sort((a, b) => semanticWeight(b) - semanticWeight(a) || compare(a.stable, b.stable))) {
    if (names.has(previous.stable) || previous.rules.size === 0) continue;
    const shared = new Map();
    for (const rule of previous.rules) for (const entry of inverseRules.get(rule) || []) {
      shared.set(entry.generated, (shared.get(entry.generated) || 0) + 1);
    }
    const candidates = [...shared].map(([generated, count]) => {
      const entry = byCurrent.get(generated);
      const support = semanticSupport(previous.semantic, entry.semantic, stableFor);
      return { generated, sharedRules: count, cssSimilarity: count / (previous.rules.size + entry.rules.size - count), semantic: support };
    }).sort((a, b) => b.cssSimilarity - a.cssSimilarity || b.semantic.score - a.semantic.score || compare(a.generated, b.generated));
    const best = candidates[0];
    const second = candidates[1];
    if (!best) continue;
    const margin = best.cssSimilarity - (second?.cssSimilarity || 0);
    const independent = best.semantic.tests.length > 0 || best.semantic.keys.length > 0 || best.semantic.exports.length > 0 || best.semantic.props.length >= 3;
    if (best.sharedRules >= 3 && best.cssSimilarity >= 0.85 && margin >= 0.15 && independent) {
      accept(previous.stable, best.generated, { type: "near-exact-css-and-semantics", ...best, margin });
      continue;
    }
    // Distinguish identical stylesheet variants through actual exported keys,
    // test attributes, or translation keys rather than CSS appearance alone.
    const equals = candidates.filter((candidate) => candidate.cssSimilarity === 1)
      .sort((a, b) => b.semantic.score - a.semantic.score || compare(a.generated, b.generated));
    if (equals.length > 0) {
      const first = equals[0];
      const delta = first.semantic.score - (equals[1]?.semantic.score || 0);
      const contextual = first.semantic.parents.length > 0 && (first.semantic.props.length > 0 || first.semantic.siblings.length > 0 || first.semantic.descendants.length > 0);
      if (first.semantic.score >= 7 && delta >= 5 && (first.semantic.tests.length || first.semantic.keys.length || first.semantic.exports.length || contextual)) {
        accept(previous.stable, first.generated, { type: "exact-css-distinguished-by-semantics", ...first, semanticMargin: delta });
        continue;
      }
      const tags = previous.semantic.tags;
      const sameTag = equals.filter((candidate) => intersection(tags, byCurrent.get(candidate.generated).semantic.tags).length > 0);
      if (tags.size === 1 && sameTag.length === 1 && equals.every((candidate) => byCurrent.get(candidate.generated).semantic.tags.size > 0)) {
        accept(previous.stable, sameTag[0].generated, { type: "exact-css-distinguished-by-element-tag", tag: [...tags][0] });
        continue;
      }
      const referenced = equals.filter((candidate) => {
        const value = byCurrent.get(candidate.generated).value;
        return value.el?.length || value.lits || value.vars || value.exports?.length;
      });
      if (referenced.length === 1 && previous.rules.size >= 2 && previous.semantic.tags.size > 0 &&
          intersection(previous.semantic.tags, byCurrent.get(referenced[0].generated).semantic.tags).length > 0) {
        accept(previous.stable, referenced[0].generated, { type: "exact-css-with-unique-module-reference", rulesCompared: previous.rules.size,
          sourceFiles: sorted(byCurrent.get(referenced[0].generated).value.src || []) });
        continue;
      }
    }
    pending.push({ stable: previous.stable, candidates: candidates.slice(0, 3) });
  }

  // High port scores incorporate CSS, JSX and surrounding semantic names. Keep
  // them explicitly classified as proposals unless independent evidence above
  // accepted the same correspondence.
  for (const previous of old) {
    if (names.has(previous.stable)) continue;
    const proposal = proposals.get(previous.stable);
    if (proposal) {
      const target = byCurrent.get(proposal.generated);
      const semantic = target && semanticSupport(previous.semantic, target.semantic, stableFor);
      if (proposal.score >= 0.7 && proposal.margin >= 0.06 && semantic &&
          (semantic.tests.length || semantic.keys.length || semantic.exports.length || semantic.props.length >= 3)) {
        accept(previous.stable, proposal.generated, { type: "strong-port-and-semantics", ...proposal, semantic });
      }
    }
  }

  const mappings = [...accepted.values()].sort((a, b) => compare(a.stable, b.stable)).map(({ generated, stable, evidence: proof }) => ({
    generated, stable, description: proof.map((entry) => entry.type).join("; "),
    ...(evidence.classes[generated].runtimeOnly ? { runtimeOnly: true } : {}),
  }));
  const unresolved = old.filter((entry) => !names.has(entry.stable)).map((entry) => {
    const candidate = pending.find((item) => item.stable === entry.stable);
    return { stable: entry.stable, previousClass: entry.generated, portProposal: proposals.get(entry.stable), candidates: candidate?.candidates || [] };
  });
  return { mappings, accepted: [...accepted.values()].sort((a, b) => compare(a.stable, b.stable)), unresolved, rejected };
}

function main(args) {
  const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
  const work = resolve(option("--work", process.env.CLASSMAP_WORK || "tools/class-map/work"));
  const base = option("--base");
  if (!base) throw new Error("Usage: node derive-platform.mjs --work <capture> --base <snapshot.json> [--out <prefix>] [--observations <json>] [--theme <directory>]");
  const out = resolve(option("--out", resolve(work, "derived-platform")));
  const observationsFile = option("--observations");
  const themeRoot = option("--theme");
  const snapshot = JSON.parse(readFileSync(base, "utf8"));
  const evidence = JSON.parse(readFileSync(resolve(work, "evidence2.json"), "utf8"));
  const result = deriveMappings({ snapshot, evidence, rules: readCssRules(resolve(work, "spa")),
    proposals: readPortReport(readFileSync(resolve(work, "port-report.md"), "utf8")),
    observations: observationsFile ? JSON.parse(readFileSync(observationsFile, "utf8")) : [],
  });
  const nativeStable = new Set(evidence.existing || []);
  const counts = {};
  for (const entry of result.accepted) for (const proof of entry.evidence) counts[proof.type] = (counts[proof.type] || 0) + 1;
  const summary = { sourceVersion: snapshot.spotify, capturedClasses: Object.keys(evidence.classes).length, acceptedMappings: result.mappings.length,
    evidenceCounts: counts, unresolvedNames: result.unresolved.length, conflicts: result.rejected.length };
  if (themeRoot) {
    const theme = readFileSync(resolve(themeRoot, "theme.css"), "utf8");
    const needed = new Set([...theme.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((match) => match[1]));
    const known = new Set(Object.values(snapshot.classes).map((entry) => entry.stable));
    const mapped = new Set(result.mappings.map((entry) => entry.stable));
    summary.theme = { requiredStableNames: [...needed].filter((name) => known.has(name)).length,
      unresolved: sorted([...needed].filter((name) => known.has(name) && !mapped.has(name) && !nativeStable.has(name))) };
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out + ".mappings.json", JSON.stringify(result.mappings, null, 2) + "\n");
  writeFileSync(out + ".evidence.json", JSON.stringify({ summary, ...result, mappings: undefined }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
