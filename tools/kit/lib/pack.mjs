import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { buildTargets } from "./build.mjs";
import { entries, projectId, readManifest, walk } from "./project.mjs";

const TOOLING = new Set(["package.json", "package-lock.json", "tsconfig.json", "jsconfig.json", "spotikit.d.ts", ".gitignore"]);

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(items) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, modified } of items) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const crc = crc32(data);
    const { time, date } = dosTime(modified);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function packFiles(root) {
  const built = buildTargets(root).length > 0;
  return walk(root).filter((f) => {
    if (/\.zip$/i.test(f)) return false;
    if (built && (TOOLING.has(f) || f.startsWith("src/"))) return false;
    return true;
  });
}

export function pack(root, options = {}) {
  const manifest = readManifest(root);
  const entry = entries(manifest)[0] || {};
  const name = `${projectId(root, entry)}-${entry.version || "0.0.0"}.zip`;
  const outDir = resolve(options.out || root);
  mkdirSync(outDir, { recursive: true });
  const list = packFiles(root);
  const data = zip(list.map((f) => ({ name: f, data: readFileSync(join(root, f)), modified: statSync(join(root, f)).mtime })));
  const file = join(outDir, name);
  writeFileSync(file, data);
  return { file, files: list.length, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
