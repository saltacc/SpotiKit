import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST = "spotikit.json";
export const KINDS = ["theme", "extension", "app", "snippet"];
export const DEFAULT_MAIN = { extension: "extension.js", app: "index.js" };

const here = dirname(fileURLToPath(import.meta.url));

export function idFor(name) {
  let id = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (id.length > 40) id = id.slice(0, 40).replace(/-+$/, "");
  return id && /^\d/.test(id) ? "x-" + id : id;
}

export function findRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, MANIFEST))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function readManifest(root) {
  const text = readFileSync(join(root, MANIFEST), "utf8").replace(/^﻿/, "");
  return JSON.parse(text);
}

export function entries(manifest) {
  return Array.isArray(manifest) ? manifest : [manifest];
}

export function files(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => typeof v === "string");
}

export function isRemote(path) {
  return /^https?:\/\//i.test(path);
}

export function localized(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.en || Object.values(value).find((v) => typeof v === "string") || "";
  return "";
}

const SKIP = new Set(["node_modules", ".git", ".github", ".vscode", ".idea"]);

export function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

export function templatesDir() {
  const packed = join(here, "..", "templates");
  if (existsSync(packed)) return packed;
  return join(here, "..", "..", "..", "Framework", "templates");
}

export function latestSpotify() {
  const candidates = [join(here, "..", "data", "spotify-versions.json"), join(here, "..", "..", "..", "compatibility", "spotify-versions.json")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const list = JSON.parse(readFileSync(file, "utf8")).versions || [];
    const approved = list.filter((v) => v.status === "approved").map((v) => v.version);
    approved.sort(compareVersions);
    const last = approved.pop();
    if (last) return last.split(".").slice(0, 3).join(".");
  }
  return "1.3";
}

export function compareVersions(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function projectId(root, entry) {
  return idFor(basename(root)) || idFor(localized(entry && entry.name)) || "project";
}

export const color = {
  red: (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  dim: (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

export function fail(message) {
  const error = new Error(message);
  error.expected = true;
  return error;
}
