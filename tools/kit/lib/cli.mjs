import { createInterface } from "node:readline/promises";
import { relative } from "node:path";
import { build } from "./build.mjs";
import { check } from "./check.mjs";
import { create } from "./create.mjs";
import { dev } from "./dev.mjs";
import { pack } from "./pack.mjs";
import { KINDS, color, fail, findRoot } from "./project.mjs";

const HELP = `spotikit-kit: themes, extensions, custom apps and CSS snippets for SpotiKit

  spotikit-kit create [folder] [--type theme|extension|app|snippet] [--name "My thing"] [--ts] [--no-workflow]
  spotikit-kit build             build "source" into "main" (TypeScript, JSX, npm packages)
  spotikit-kit check [--json]    check spotikit.json, the files, the code and the types
  spotikit-kit dev [--launch]    show it live in Spotify and update it on every save
  spotikit-kit pack [--out dir]  zip it for a release, with its SHA-256

Docs: https://spotikit.com/docs/kit`;

export function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--no-")) args[a.slice(5)] = false;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && ["type", "name", "out", "port", "id", "spotify"].includes(key)) {
        args[key] = next;
        i++;
      } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function project() {
  const root = findRoot();
  if (!root) throw fail("There's no spotikit.json here or in a folder above. Run spotikit-kit create first.");
  return root;
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer || fallback;
}

export async function main(argv) {
  const args = parse(argv);
  const command = args._.shift();
  switch (command) {
    case "create": {
      let type = args.type;
      if (!type) type = await ask(`What is it? (${KINDS.join(", ")}) [extension] `, "extension");
      let name = args.name;
      if (!name && !args._[0]) name = await ask("Its name: ", "My SpotiKit project");
      const result = create(args._[0], { kind: type, name, typescript: !!args.ts, workflow: args.workflow !== false, spotify: args.spotify });
      const where = relative(process.cwd(), result.target) || ".";
      console.log(color.green(`Made ${where} (${type} ${result.id}):`));
      result.files.forEach((f) => console.log("  " + f));
      console.log(`\nNext:\n  cd ${where}` + (args.ts ? "\n  npm install" : "") + "\n  npx spotikit-kit dev --launch");
      return 0;
    }
    case "build": {
      const root = project();
      const built = await build(root);
      if (!built.length) console.log("Nothing to build: spotikit.json has no \"source\". Plain JavaScript and CSS load as they are.");
      built.forEach((t) => console.log(color.green(`Built ${t.main}`) + color.dim(` from ${t.source}`)));
      return 0;
    }
    case "check": {
      const root = project();
      const issues = await check(root, { types: args.types !== false });
      const errors = issues.filter((i) => i.level === "error").length;
      if (args.json) {
        console.log(JSON.stringify({ ok: errors === 0, errors, warnings: issues.length - errors, issues }));
        return errors ? 1 : 0;
      }
      for (const i of issues) {
        const tag = i.level === "error" ? color.red("error") : color.yellow("warning");
        console.log(`${tag} ${i.file}${i.line ? ":" + i.line : ""}: ${i.message}`);
      }
      console.log(errors ? color.red(`\n${errors} error(s), ${issues.length - errors} warning(s).`) : color.green(`\nNo errors${issues.length ? `, ${issues.length} warning(s)` : ""}.`));
      return errors ? 1 : 0;
    }
    case "dev":
      await dev(project(), { launch: !!args.launch, port: Number(args.port) || 9229, id: args.id });
      return 0;
    case "pack": {
      const result = pack(project(), { out: args.out });
      console.log(color.green(`Packed ${relative(process.cwd(), result.file)}`) + ` (${result.files} files, ${(result.bytes / 1024).toFixed(1)} KB)`);
      console.log(`SHA-256 ${result.sha256}`);
      return 0;
    }
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return 0;
    default:
      throw fail(`There's no command "${command}".\n\n${HELP}`);
  }
}

export function run(argv) {
  main(argv).then(
    (code) => process.exit(code),
    (e) => {
      console.error(color.red(e.expected ? e.message : e.stack || e.message));
      process.exit(1);
    }
  );
}
