(() => {
  let req = null;
  window.rspackChunk.push([
    [Symbol("sk")],
    {},
    (r) => {
      req = r;
    },
  ]);
  const out = {};
  for (const k of Object.keys(req.m)) out[k] = req.m[k].toString();
  return JSON.stringify(out);
})();
