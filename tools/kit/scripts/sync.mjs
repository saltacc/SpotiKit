import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kit = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(kit, "..", "..");
rmSync(join(kit, "templates"), { recursive: true, force: true });
cpSync(join(repo, "Framework", "templates"), join(kit, "templates"), { recursive: true });
mkdirSync(join(kit, "data"), { recursive: true });
cpSync(join(repo, "compatibility", "spotify-versions.json"), join(kit, "data", "spotify-versions.json"));
cpSync(join(repo, "LICENSE"), join(kit, "LICENSE"));
console.log("Templates, Spotify versions and the license copied.");
