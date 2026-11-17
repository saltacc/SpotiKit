(async () => {
  const back = {};
  for (const [g, s] of Object.entries(window.__spotikitClassMap || {})) back[s] = g;
  const sel = window.__treeRoot || "#main";
  const maxDepth = window.__treeDepth || 9;
  const lines = [];
  const walk = (el, depth) => {
    if (depth > maxDepth || lines.length > 700) return;
    const cls = [...el.classList].map((c) => back[c] || c);
    const t = el.getAttribute("data-testid");
    const shown = cls.length || t || el.id || el.getAttribute("role");
    if (shown) {
      lines.push(
        "  ".repeat(depth) +
          el.tagName.toLowerCase() +
          (el.id ? "#" + el.id : "") +
          (t ? " [" + t + "]" : "") +
          (el.getAttribute("role") ? " role=" + el.getAttribute("role") : "") +
          (cls.length ? " ." + cls.join(" .") : "") +
          (el.getAttribute("aria-label") ? ' "' + el.getAttribute("aria-label").slice(0, 30) + '"' : "")
      );
    }
    for (const k of el.children) walk(k, shown ? depth + 1 : depth);
  };
  walk(document.querySelector(sel), 0);
  return lines.join("\n");
})();
