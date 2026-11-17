import { readFileSync, writeFileSync } from "node:fs";
const [out, size, list] = process.argv.slice(2);
const all = JSON.parse(readFileSync("icons.json", "utf8"));
const picks = list.includes("-")
  ? Array.from(
      { length: Number(list.split("-")[1]) - Number(list.split("-")[0]) },
      (_, i) => i + Number(list.split("-")[0])
    )
  : list.split(",").map(Number);
const px = Number(size);
const cells = picks
  .map(
    (i) =>
      `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:${px + 60}px;height:${px + 50}px;justify-content:center;border:1px solid #333"><svg width="${px}" height="${px}" viewBox="0 0 16 16" fill="#fff">${all[i].svg}</svg><span style="font:16px monospace;color:#1ed760">${i}</span></div>`
  )
  .join("");
writeFileSync(
  out,
  `(() => { document.getElementById("sk-icons")?.remove(); const d = document.createElement("div"); d.id = "sk-icons"; d.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-wrap:wrap;align-content:flex-start;padding:8px;gap:4px"; d.innerHTML = ${JSON.stringify(cells)}; document.body.append(d); return ${picks.length}; })()`
);
