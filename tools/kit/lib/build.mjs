import { join } from "node:path";
import { entries, fail, readManifest } from "./project.mjs";

export function buildTargets(root) {
  return entries(readManifest(root))
    .filter((entry) => entry && typeof entry.source === "string")
    .map((entry) => {
      if (typeof entry.main !== "string") throw fail(`"${entry.source}" needs a "main" in spotikit.json to build into.`);
      return { source: entry.source, main: entry.main };
    });
}

export function esbuildOptions(root, target) {
  return {
    absWorkingDir: root,
    entryPoints: [join(root, target.source)],
    outfile: join(root, target.main),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    legalComments: "inline",
    jsx: "transform",
    jsxFactory: "SpotiKit.React.createElement",
    jsxFragment: "SpotiKit.React.Fragment",
    banner: { js: "// Built by spotikit-kit from " + target.source + ". Edit that file, not this one." },
    logLevel: "silent",
  };
}

export async function build(root) {
  const targets = buildTargets(root);
  if (!targets.length) return [];
  const esbuild = await import("esbuild");
  const built = [];
  for (const target of targets) {
    try {
      await esbuild.build(esbuildOptions(root, target));
    } catch (e) {
      const messages = (e.errors || []).map(
        (m) => `${m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ` : ""}${m.text}`
      );
      throw fail(messages.join("\n") || e.message);
    }
    built.push(target);
  }
  return built;
}
