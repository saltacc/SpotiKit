import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { DEFAULT_MAIN, KINDS, MANIFEST, entries, files, isRemote, localized, walk } from "./project.mjs";

const VERSION = /^\d+(\.\d+){0,3}$/;
const SCRIPT = new Set([".js", ".mjs", ".jsx", ".ts", ".tsx"]);
const LOADER = { ".js": "js", ".mjs": "js", ".jsx": "jsx", ".ts": "ts", ".tsx": "tsx", ".css": "css" };
const HASHED = /\.([A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])/g;

function looksHashed(token) {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[_-]/].filter((r) => r.test(token)).length;
  return kinds >= 3 && !/[a-z]{5}/.test(token);
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function checkRange(value) {
  if (value === undefined) return null;
  if (typeof value !== "string") return "has to be text like \"1.3.5 - 1.3.6\"";
  const parts = value.split(/\s+-\s+/).map((p) => p.trim());
  if (parts.length > 2 || !parts.every((p) => VERSION.test(p))) return `"${value}" isn't a version or a range like 1.3.5 - 1.3.6`;
  return null;
}

export async function check(root, options = {}) {
  const issues = [];
  const add = (level, file, message, line) => issues.push({ level, file, message, ...(line ? { line } : {}) });

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    add("error", MANIFEST, existsSync(join(root, MANIFEST)) ? `isn't valid JSON: ${e.message}` : "is missing");
    return issues;
  }

  const exists = (path) => isRemote(path) || existsSync(join(root, path));
  const listed = entries(manifest);
  listed.forEach((entry, index) => {
    const where = listed.length > 1 ? `${MANIFEST} (entry ${index + 1})` : MANIFEST;
    if (!entry || typeof entry !== "object") return add("error", where, "every entry has to be an object");
    if (!KINDS.includes(entry.type)) add("error", where, `"type" has to be one of ${KINDS.join(", ")}`);
    if (!localized(entry.name)) add("error", where, `"name" is missing; the Marketplace skips entries without one`);
    if (!localized(entry.description)) add("warning", where, `"description" is empty; the Marketplace skips entries without one`);
    if (entry.spotify === undefined) add("warning", where, `"spotify" is missing, so people see "compatibility not specified"`);
    const range = checkRange(entry.spotify);
    if (range) add("error", where, `"spotify" ${range}`);
    if (entry.version !== undefined && !VERSION.test(String(entry.version))) add("warning", where, `"version" should look like 1.2.0`);

    const deps = entry.dependencies;
    if (deps !== undefined) {
      const ids = Array.isArray(deps) ? deps : deps && typeof deps === "object" ? Object.keys(deps) : null;
      if (!ids) add("error", where, `"dependencies" has to be a list of ids or an object of id: range`);
      else {
        ids.forEach((id) => {
          if (!/^[a-z0-9._-]+(\/[a-z0-9._-]+){0,2}$/i.test(id)) add("error", where, `dependency "${id}" isn't an id like owner/repo or owner/repo/name`);
        });
        if (!Array.isArray(deps))
          Object.entries(deps).forEach(([id, value]) => {
            if (value === "*" || value === "") return;
            const problem = checkRange(value);
            if (problem) add("error", where, `dependency "${id}": ${problem.replace(/^has/, "range has")}`);
          });
      }
    }

    const styles = files(entry.style);
    const mains = files(entry.main);
    if (entry.type === "snippet") {
      if (!styles.length) add("error", where, `a CSS snippet needs "style"`);
      if (mains.length) add("error", where, `a CSS snippet can't have "main"; snippets are CSS only`);
    }
    if (entry.type === "theme" && !styles.length) add("error", where, `a theme needs "style" with at least one CSS file`);
    if (!mains.length && DEFAULT_MAIN[entry.type]) mains.push(DEFAULT_MAIN[entry.type]);

    styles.forEach((f) => exists(f) || add("error", where, `"style" names ${f}, which doesn't exist`));
    if (typeof entry.source === "string") {
      if (!exists(entry.source)) add("error", where, `"source" names ${entry.source}, which doesn't exist`);
      else if (!mains.length || !exists(mains[0])) add("error", where, `${mains[0] || "main"} isn't built yet. Run spotikit-kit build`);
      else if (!isRemote(mains[0])) {
        const built = statSync(join(root, mains[0])).mtimeMs;
        const sourceDir = dirname(join(root, entry.source));
        const newer = walk(root, sourceDir).some((f) => SCRIPT.has(extname(f)) && statSync(join(root, f)).mtimeMs > built + 1000);
        if (newer) add("warning", where, `${mains[0]} is older than the source. Run spotikit-kit build`);
      }
    } else mains.forEach((f) => exists(f) || add("error", where, `"main" names ${f}, which doesn't exist`));
    if (entry.preview && !exists(entry.preview)) add("warning", where, `"preview" names ${entry.preview}, which doesn't exist; the Marketplace card shows no picture`);
    if (!entry.preview) add("warning", where, `no "preview" image; the Marketplace card shows no picture`);
    if (entry.readme && !exists(entry.readme)) add("warning", where, `"readme" names ${entry.readme}, which doesn't exist`);
    if (typeof entry.schemes === "string" && !exists(entry.schemes)) add("error", where, `"schemes" names ${entry.schemes}, which doesn't exist`);
    if (entry.schemes && typeof entry.schemes === "object") {
      Object.entries(entry.schemes).forEach(([key, scheme]) => {
        if (!scheme || !scheme.colors || !scheme.colors.background) add("error", where, `scheme "${key}" needs at least colors.background`);
        Object.entries((scheme && scheme.colors) || {}).forEach(([role, value]) => {
          if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value))) add("error", where, `scheme "${key}": ${role} "${value}" isn't a hex color`);
        });
      });
    }
  });

  const esbuild = await import("esbuild");
  const built = new Set(listed.filter((e) => e && typeof e.source === "string").flatMap((e) => files(e.main)));
  for (const file of walk(root)) {
    const ext = extname(file).toLowerCase();
    if (!LOADER[ext]) continue;
    const full = join(root, file);
    if (statSync(full).size > 5 * 1024 * 1024) add("warning", file, "is over 5 MB");
    const text = readFileSync(full, "utf8");
    if (!built.has(file)) {
      try {
        const result = await esbuild.transform(text, { loader: LOADER[ext], sourcefile: file, logLevel: "silent", format: ext === ".css" ? undefined : "esm" });
        result.warnings.forEach((w) => add("warning", file, w.text, w.location && w.location.line));
      } catch (e) {
        (e.errors || [{ text: e.message }]).forEach((m) => add("error", file, m.text, m.location && m.location.line));
      }
    }
    if (ext === ".css" || SCRIPT.has(ext)) {
      for (const m of text.matchAll(HASHED)) {
        if (looksHashed(m[1]))
          add("warning", file, `".${m[1]}" looks like one of Spotify's generated class names, which change with every update. Use SpotiKit's names instead (spotikit.com/docs/class-names)`, lineOf(text, m.index));
      }
    }
    if (SCRIPT.has(ext) && !built.has(file) && /\bSpicetify\.[A-Za-z]/.test(text))
      add("error", file, "uses Spicetify's API, which SpotiKit doesn't have. Use SpotiKit's own API");
  }

  if (options.types !== false && existsSync(join(root, "tsconfig.json"))) issues.push(...typecheck(root));
  return issues;
}

function typecheck(root) {
  let tsc;
  try {
    const require = createRequire(join(root, "package.json"));
    const pkgPath = require.resolve("typescript/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin && pkg.bin.tsc;
    tsc = join(dirname(pkgPath), bin);
  } catch (e) {
    return [{ level: "warning", file: "tsconfig.json", message: "TypeScript isn't installed here, so types weren't checked. Run npm install" }];
  }
  const run = spawnSync(process.execPath, [tsc, "--noEmit", "--pretty", "false", "-p", root], { cwd: root, encoding: "utf8" });
  const out = (run.stdout || "") + (run.stderr || "");
  const issues = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line.trim());
    if (m) issues.push({ level: "error", file: relative(root, join(root, m[1])).split("\\").join("/"), line: +m[2], message: `${m[4]} (${m[3]})` });
  }
  if (run.status && !issues.length && out.trim()) issues.push({ level: "error", file: "tsconfig.json", message: out.trim().split("\n")[0] });
  return issues;
}
