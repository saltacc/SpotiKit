import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../Framework", import.meta.url));
const parts = [readFileSync(join(root, "loader.js"), "utf8")];
for (const f of readdirSync(join(root, "api"))
  .filter((f) => f.endsWith(".js"))
  .sort())
  parts.push(readFileSync(join(root, "api", f), "utf8"));
const out = parts.join("\n").replaceAll("{{VERSION}}", "dev").replaceAll("{{CHANNEL}}", "dev");
writeFileSync("dev-loader.js", out);
console.log("dev-loader.js " + out.length + " chars, " + parts.length + " parts");
