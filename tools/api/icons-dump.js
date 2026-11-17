(() => {
  let req = null;
  window.rspackChunk.push([
    [Symbol("sk")],
    {},
    (r) => {
      req = r;
    },
  ]);
  const icons = [];
  const seen = new Set();
  for (const id of Object.keys(req.m)) {
    const s = String(req.m[id]);
    if (!s.includes("svgContent:")) continue;
    for (const m of s.matchAll(/\{size:16,svgContent:"((?:[^"\\]|\\.)+)"\}/g)) {
      const svg = m[1].replace(/\\"/g, '"');
      if (seen.has(svg)) continue;
      seen.add(svg);
      icons.push({ id, svg });
    }
  }
  return icons;
})();
