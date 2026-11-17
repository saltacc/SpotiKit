import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { KINDS, fail, idFor, latestSpotify, templatesDir } from "./project.mjs";

const SCRIPT_FILE = { extension: "extension.js", app: "index.js", theme: "theme.js" };
const TS_FILE = { extension: "extension.ts", app: "index.tsx", theme: "theme.ts" };

function readTree(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...readTree(full, prefix + name + "/"));
    else out.push({ path: prefix + name, text: readFileSync(full, "utf8") });
  }
  return out;
}

export function projectFiles({ kind, name, typescript = false, workflow = true, spotify }) {
  if (!KINDS.includes(kind)) throw fail(`The type has to be one of ${KINDS.join(", ")}.`);
  if (typescript && kind === "snippet") throw fail("CSS snippets are CSS only, so there's nothing to write in TypeScript.");
  const id = idFor(name);
  if (!id) throw fail("Give it a name with at least one letter or digit.");
  const root = templatesDir();
  const fill = (text) => text.replaceAll("{{ID}}", id).replaceAll("{{NAME}}", name).replaceAll("{{SPOTIFY}}", spotify || latestSpotify());

  let list = readTree(join(root, kind));
  if (kind !== "snippet") list.push(...readTree(join(root, "shared")));

  if (typescript) {
    const js = SCRIPT_FILE[kind];
    const ts = TS_FILE[kind];
    list = list.filter((f) => f.path !== js && f.path !== "jsconfig.json");
    const extra = readTree(join(root, "typescript"));
    list.push(...extra.filter((f) => f.path === "tsconfig.json" || f.path === "package.json"));
    list.push({ path: ".gitignore", text: extra.find((f) => f.path === "gitignore").text });
    list.push({ path: "src/" + ts, text: extra.find((f) => f.path === "src/" + ts).text });
    list = list.map((f) => {
      if (f.path !== "spotikit.json") return f;
      const manifest = JSON.parse(f.text);
      const out = {};
      for (const [key, value] of Object.entries(manifest)) {
        if (key === "main") {
          out.source = "src/" + ts;
          out.main = "dist/" + ts.replace(/\.tsx?$/, ".js");
        } else out[key] = value;
      }
      if (!out.source) {
        out.source = "src/" + ts;
        out.main = "dist/" + ts.replace(/\.tsx?$/, ".js");
      }
      return { path: f.path, text: JSON.stringify(out, null, 2) + "\n" };
    });
    list = list.map((f) =>
      f.path === "README.md"
        ? {
            path: f.path,
            text:
              f.text
                .replace(new RegExp("`" + js.replace(".", "\\.") + "`", "g"), "`src/" + ts + "`")
                .replace(/`jsconfig\.json`/g, "`tsconfig.json`") +
              "\n## TypeScript\n\nThe code is in `src/" + ts + "`; `spotikit-kit build` turns it into `dist/`, which is what Spotify and the Marketplace load. Keep `dist/` in Git.\n\n```\nnpm install\nnpm run dev     # live in Spotify while you edit\nnpm run check   # manifest, files, types\n```\n",
          }
        : f
    );
  }
  if (workflow) list.push({ path: ".github/workflows/spotikit.yml", text: readFileSync(join(root, "github", "spotikit.yml"), "utf8") });
  return { id, files: list.map((f) => ({ path: f.path, text: fill(f.text) })) };
}

export function create(dir, options) {
  const target = resolve(dir || idFor(options.name) || "spotikit-project");
  if (existsSync(target) && readdirSync(target).length) throw fail(`${target} isn't empty.`);
  const name = options.name || basename(target);
  const { id, files } = projectFiles({ ...options, name });
  for (const f of files) {
    const full = join(target, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.text);
  }
  return { id, target, files: files.map((f) => f.path) };
}
