/* SpotiKit themes */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  var roles = [
    "frame",
    "background",
    "elevated",
    "text",
    "subtext",
    "accent",
    "onAccent",
    "divider",
    "negative",
    "warning",
    "positive",
    "announcement",
  ];

  function parse(color) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) {
      throw new Error("Themes: colors are hex values like #1ed760, not " + color + ".");
    }
    var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return [0, 2, 4].map(function (i) {
      return parseInt(h.slice(i, i + 2), 16);
    });
  }
  function hex(rgb) {
    return (
      "#" +
      rgb
        .map(function (v) {
          return Math.round(Math.max(0, Math.min(255, v)))
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  }
  function mix(a, b, amount) {
    var x = parse(a);
    var y = parse(b);
    return hex(
      x.map(function (v, i) {
        return v + (y[i] - v) * amount;
      })
    );
  }
  function luminance(color) {
    var c = parse(color).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function complete(colors) {
    var c = Object.assign({}, colors);
    if (!c.background) {
      throw new Error("Themes: a scheme needs at least a background color.");
    }
    var dark = luminance(c.background) < 0.4;
    c.text = c.text || (dark ? "#ffffff" : "#000000");
    c.frame = c.frame || mix(c.background, dark ? "#000000" : "#ffffff", 0.6);
    c.elevated = c.elevated || mix(c.background, c.text, 0.07);
    c.subtext = c.subtext || mix(c.text, c.background, 0.32);
    c.accent = c.accent || "#1ed760";
    c.onAccent = c.onAccent || (luminance(c.accent) > 0.35 ? "#000000" : "#ffffff");
    c.divider = c.divider || mix(c.background, c.text, 0.12);
    c.negative = c.negative || "#ed2c3f";
    c.warning = c.warning || "#ffa42b";
    c.positive = c.positive || c.accent;
    c.announcement = c.announcement || "#3d91f4";
    return c;
  }

  function schemeCss(colors, variables) {
    var c = complete(colors);
    var toward = luminance(c.background) < 0.4 ? "#ffffff" : "#000000";
    var away = luminance(c.background) < 0.4 ? "#000000" : "#ffffff";
    var base = [
      ["--background-base", c.background],
      ["--background-highlight", mix(c.background, toward, 0.07)],
      ["--background-press", mix(c.background, away, 0.4)],
      ["--background-elevated-base", c.elevated],
      ["--background-elevated-highlight", mix(c.elevated, toward, 0.07)],
      ["--background-elevated-press", mix(c.elevated, away, 0.3)],
      ["--background-tinted-base", mix(c.background, c.text, 0.1)],
      ["--background-tinted-highlight", mix(c.background, c.text, 0.16)],
      ["--background-tinted-press", mix(c.background, c.text, 0.06)],
      ["--text-base", c.text],
      ["--text-subdued", c.subtext],
      ["--text-bright-accent", c.accent],
      ["--text-negative", c.negative],
      ["--text-warning", c.warning],
      ["--text-positive", c.positive],
      ["--text-announcement", c.announcement],
      ["--essential-base", c.text],
      ["--essential-subdued", mix(c.subtext, c.background, 0.35)],
      ["--essential-bright-accent", c.accent],
      ["--essential-negative", c.negative],
      ["--essential-warning", c.warning],
      ["--essential-positive", c.positive],
      ["--essential-announcement", c.announcement],
      ["--decorative-base", c.text],
      ["--decorative-subdued", c.divider],
    ];
    var accent = [
      ["--background-base", c.accent],
      ["--background-highlight", mix(c.accent, toward, 0.12)],
      ["--background-press", mix(c.accent, away, 0.18)],
      ["--text-base", c.onAccent],
      ["--essential-base", c.onAccent],
    ];
    var decl = function (list) {
      return list
        .map(function (p) {
          return p[0] + ":" + p[1] + ";";
        })
        .join("");
    };
    var extra = Object.keys(variables || {})
      .map(function (name) {
        return name + ":" + variables[name] + ";";
      })
      .join("");
    var theme = ".encore-dark-theme.encore-dark-theme";
    return (
      theme +
      "," +
      theme +
      " .encore-base-set{" +
      decl(base) +
      extra +
      "}" +
      theme +
      " .encore-bright-accent-set{" +
      decl(accent) +
      "}" +
      "html,.app-layout,.now-playing-bar-area{background-color:" +
      c.frame +
      "!important}" +
      ":root{--spotikit-frame:" +
      c.frame +
      ";--spotikit-background:" +
      c.background +
      ";--spotikit-elevated:" +
      c.elevated +
      ";--spotikit-text:" +
      c.text +
      ";--spotikit-subtext:" +
      c.subtext +
      ";--spotikit-accent:" +
      c.accent +
      ";--spotikit-on-accent:" +
      c.onAccent +
      ";--spotikit-divider:" +
      c.divider +
      "}"
    );
  }

  var GREEN = /rgba?\(\s*(30|29|31),\s*(215|185|223),\s*(96|84|100)\s*(?:,\s*([\d.]+)\s*)?\)/;
  var greenCache = { count: -1, rules: [] };

  function greenRules() {
    var all = document.styleSheets;
    if (greenCache.count === all.length) {
      return greenCache.rules;
    }
    var found = [];
    var walk = function (list, media) {
      for (var i = 0; i < list.length; i++) {
        var rule = list[i];
        if (rule.media && rule.cssRules) {
          walk(rule.cssRules, rule.media.mediaText);
        } else if (rule.style && rule.selectorText) {
          for (var p = 0; p < rule.style.length; p++) {
            var name = rule.style[p];
            var match = GREEN.exec(rule.style.getPropertyValue(name));
            if (match && !/^--/.test(name)) {
              found.push({
                selector: rule.selectorText,
                property: name,
                alpha: match[4] === undefined ? 1 : parseFloat(match[4]),
                media: media,
              });
            }
          }
        }
      }
    };
    for (var s = 0; s < all.length; s++) {
      var owner = all[s].ownerNode;
      if (owner && owner.id && owner.id.indexOf("spotikit") === 0) {
        continue;
      }
      try {
        walk(all[s].cssRules, null);
      } catch (e) {}
    }
    greenCache = { count: all.length, rules: found };
    return found;
  }

  function accentCss(accent) {
    return greenRules()
      .map(function (r) {
        var value =
          r.alpha >= 1 ? accent : "color-mix(in srgb," + accent + " " + Math.round(r.alpha * 100) + "%,transparent)";
        var css = r.selector + "{" + r.property + ":" + value + "!important}";
        return r.media ? "@media " + r.media + "{" + css + "}" : css;
      })
      .join("");
  }

  var manifests = null;
  var events = new internal.Emitter("Themes");
  var storage = SpotiKit.Storage.scope("themes");
  var current = null;
  var colorStyle = null;
  var sheets = [];

  function folder(id) {
    return internal.base + "themes/" + encodeURIComponent(id) + "/";
  }

  function readSchemes(schemes) {
    schemes = schemes && typeof schemes === "object" ? schemes : {};
    return Object.keys(schemes).map(function (key) {
      return {
        id: key,
        name: internal.localized(schemes[key].name) || key,
        colors: schemes[key].colors || {},
        variables: schemes[key].variables || {},
      };
    });
  }
  internal.readSchemes = readSchemes;

  function loadManifests() {
    if (!manifests) {
      manifests = Promise.all(
        (internal.config.themes || []).map(function (entry) {
          var json = function (file) {
            return internal.addonText("themes/" + entry.id + "/" + file).then(JSON.parse);
          };
          return json("spotikit.json")
            .then(function (manifest) {
              return (
                typeof manifest.schemes === "string" ? json(manifest.schemes) : Promise.resolve(manifest.schemes)
              ).then(function (schemes) {
                return {
                  id: entry.id,
                  name: internal.localized(manifest.name) || entry.name || entry.id,
                  description: internal.localized(manifest.description) || "",
                  author: (Array.isArray(manifest.authors) ? manifest.authors : [])
                    .map(function (a) {
                      return a && a.name;
                    })
                    .filter(Boolean)
                    .join(", "),
                  styles: internal.manifestFiles(manifest.style),
                  scripts: internal.manifestFiles(manifest.main),
                  customWindowControls: manifest.windowControls === "custom",
                  schemes: readSchemes(schemes),
                };
              });
            })
            .catch(function (e) {
              internal.log.error("The theme " + entry.id + " could not be read", e);
              return null;
            });
        })
      ).then(function (list) {
        return list.filter(Boolean);
      });
    }
    return manifests;
  }

  var shown = null;
  var paletteColors = null;

  function setColors(colors, variables) {
    shown = colors ? { colors: colors, variables: variables } : null;
    render();
  }

  function render() {
    var colors = paletteColors || (shown && shown.colors);
    var css = colors
      ? schemeCss(colors, shown && shown.variables) +
        accentCss(complete(colors).accent)
      : "";
    if (!colorStyle) {
      colorStyle = document.createElement("style");
      colorStyle.id = "spotikit-theme-colors";
    }
    colorStyle.textContent = css;
    document.head.appendChild(colorStyle);
  }

  function clear() {
    sheets.forEach(function (link) {
      link.remove();
    });
    sheets = [];
    if (colorStyle) {
      colorStyle.textContent = "";
    }
    shown = null;
    document.documentElement.removeAttribute("data-spotikit-theme");
    document.documentElement.removeAttribute("data-spotikit-scheme");
  }

  var scripts = { theme: null, owners: [], stuck: false };

  function isModule(code) {
    return /(^|[\n;])\s*(import\s*[\w{*"'(]|export\s)/.test(code);
  }

  var classicRan = {};

  function startScripts(theme, scheme) {
    var run = { theme: theme, owners: [], stuck: false };
    scripts = run;
    theme.scripts.forEach(function (file, index) {
      var path = "themes/" + theme.id + "/" + file;
      var owner = "theme:" + theme.id + (index ? "#" + index : "");
      internal
        .addonText(path)
        .then(function (code) {
          if (isModule(code)) {
            var url = internal.addonUrl(path);
            internal.addons.register(url, owner);
            internal.owners.add("spotikit-dev/" + path, owner);
            return import(url);
          }
          run.stuck = true;
          if (classicRan[path] === code) {
            if (internal.marketplace) internal.marketplace.clearReload("theme:" + theme.id);
            return null;
          }
          classicRan[path] = code;
          var script = document.createElement("script");
          script.src = URL.createObjectURL(
            new Blob([code + "\n//# sourceURL=spotikit-theme/" + path], { type: "text/javascript" })
          );
          script.setAttribute("data-theme", theme.id);
          document.head.appendChild(script);
          return null;
        })
        .then(function (module) {
          if (!module) return;
          if (typeof module.default !== "function") {
            run.stuck = true;
            return;
          }
          if (scripts !== run) return;
          run.owners.push(owner);
          return internal.addons.start(owner, module, {
            context: {
              theme: theme.id,
              scheme: scheme ? scheme.id : null,
              url: function (path) {
                return folder(theme.id) + path;
              },
            },
          });
        })
        .catch(function (e) {
          internal.log.error("The script " + file + " of the theme " + theme.id + " failed", e);
        });
    });
  }

  function stopScripts() {
    var run = scripts;
    scripts = { theme: null, owners: [], stuck: false };
    run.owners.forEach(internal.addons.stop);
    if (run.stuck && internal.marketplace)
      internal.marketplace.markReload("theme:" + run.theme.id, "disabled", run.theme.name);
  }

  function addStyles(theme) {
    theme.styles.forEach(function (file) {
      var path = "themes/" + theme.id + "/" + file;
      var style = document.createElement("style");
      style.className = "spotikit-theme-style";
      style.setAttribute("data-file", file);
      (document.body || document.head).appendChild(style);
      sheets.push(style);
      internal
        .addonText(path)
        .then(function (css) {
          style.textContent = internal.addonCss(css, path);
        })
        .catch(function (e) {
          internal.log.error("The theme " + theme.id + " is missing " + file, e);
        });
    });
  }

  function applyNow(theme, scheme, restart) {
    var sameTheme = scripts.theme && scripts.theme.id === theme.id;
    clear();
    if (!sameTheme || restart) {
      stopScripts();
      startScripts(theme, scheme);
      if (internal.windowControls) internal.windowControls("theme", theme.customWindowControls);
    }
    addStyles(theme);
    if (scheme) {
      setColors(scheme.colors, scheme.variables);
    }
    document.documentElement.setAttribute("data-spotikit-theme", theme.id);
    if (scheme) {
      document.documentElement.setAttribute("data-spotikit-scheme", scheme.id);
    }
  }

  function applyTheme(themeId, schemeId, restart) {
    return loadManifests().then(function (list) {
      var theme = list.find(function (t) {
        return t.id === themeId;
      });
      if (!theme) {
        throw new Error("There is no theme " + themeId + ".");
      }
      var scheme =
        theme.schemes.find(function (s) {
          return s.id === schemeId;
        }) ||
        theme.schemes[0] ||
        null;
      applyNow(theme, scheme, restart);
      current = { theme: theme, scheme: scheme };
      storage.set("selection", describe());
      events.emit("change", describe());
      return describe();
    });
  }

  internal.devTheme = function (id, changed) {
    manifests = null;
    var isCurrent = !!current && current.theme.id === id;
    var cssOnly =
      changed.length > 0 &&
      changed.every(function (file) {
        return /\.css$/i.test(file);
      });
    if (isCurrent && !cssOnly && scripts.stuck) {
      setTimeout(function () {
        location.reload();
      }, 150);
      return "reload";
    }
    if (!isCurrent && internal.marketplace && internal.marketplace.freeThemeSlot) internal.marketplace.freeThemeSlot();
    if (isCurrent && cssOnly) {
      return loadManifests().then(function (list) {
        var theme = list.find(function (t) {
          return t.id === id;
        });
        if (!theme) return "missing";
        current.theme = theme;
        sheets.forEach(function (style) {
          style.remove();
        });
        sheets = [];
        addStyles(theme);
        return "css";
      });
    }
    return applyTheme(id, isCurrent && current.scheme ? current.scheme.id : null, true).then(function () {
      return "applied";
    });
  };

  function describe() {
    return current ? { theme: current.theme.id, scheme: current.scheme ? current.scheme.id : null } : null;
  }

  var Themes = {
    list: function () {
      return loadManifests().then(function (list) {
        return list.map(function (t) {
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            author: t.author,
            schemes: t.schemes.map(function (s) {
              return { id: s.id, name: s.name };
            }),
          };
        });
      });
    },
    get current() {
      return describe();
    },
    apply: function (themeId, schemeId) {
      if (internal.marketplace && internal.marketplace.freeThemeSlot) internal.marketplace.freeThemeSlot();
      return applyTheme(themeId, schemeId, false);
    },
    reset: function () {
      clear();
      stopScripts();
      if (internal.windowControls) internal.windowControls("theme", false);
      current = null;
      storage.set("selection", null);
      events.emit("change", null);
    },
    preview: function (colors, variables) {
      setColors(colors, variables);
    },
    css: function (colors, variables) {
      return schemeCss(colors, variables);
    },
    roles: roles,
    on: function (type, listener) {
      return events.on(type, listener);
    },
  };
  SpotiKit.Themes = Themes;

  var saved = storage.get("selection", undefined);
  var startChoice =
    saved === undefined
      ? internal.config.defaultTheme
        ? { theme: internal.config.defaultTheme, scheme: null }
        : null
      : saved;
  if (startChoice && startChoice.theme && !internal.safeMode) {
    Themes.apply(startChoice.theme, startChoice.scheme).catch(function (e) {
      internal.log.warn("The saved theme could not be applied", e);
      storage.set("selection", null);
    });
  }

  new MutationObserver(function () {
    if ((shown || paletteColors) && document.styleSheets.length !== greenCache.count) {
      render();
    }
  }).observe(document.head, { childList: true });

  var SPOTIFY_COLORS = {
    frame: "#000000",
    background: "#121212",
    elevated: "#1f1f1f",
    text: "#ffffff",
    subtext: "#b3b3b3",
    accent: "#1ed760",
    onAccent: "#000000",
    divider: "#292929",
    negative: "#f3727f",
    warning: "#ffa42b",
    positive: "#1ed760",
    announcement: "#539df5",
  };
  var paletteStore = SpotiKit.Storage.scope("palettes");
  var paletteEvents = new internal.Emitter("Palettes");
  var draft = null;

  function paletteTarget() {
    var fromMarketplace = typeof internal.paletteTarget === "function" ? internal.paletteTarget() : null;
    if (fromMarketplace) return fromMarketplace;
    if (current) return { id: "local:" + current.theme.id, name: current.theme.name };
    return { id: "spotify", name: "Spotify" };
  }

  function colorsOnScreen() {
    var scope = document.querySelector(".encore-dark-theme") || document.body;
    if (!scope) return {};
    var style = getComputedStyle(scope);
    var probe = document.createElement("i");
    probe.style.display = "none";
    document.body.appendChild(probe);
    var read = function (value) {
      if (!value) return null;
      probe.style.color = "";
      probe.style.color = value.trim();
      var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(getComputedStyle(probe).color);
      if (!m || (m[4] !== undefined && parseFloat(m[4]) < 0.5)) return null;
      return hex([+m[1], +m[2], +m[3]]);
    };
    var found = {};
    [
      ["background", "--background-base"],
      ["elevated", "--background-elevated-base"],
      ["text", "--text-base"],
      ["subtext", "--text-subdued"],
      ["accent", "--essential-bright-accent"],
      ["divider", "--decorative-subdued"],
      ["negative", "--text-negative"],
      ["warning", "--text-warning"],
      ["positive", "--text-positive"],
      ["announcement", "--text-announcement"],
    ].forEach(function (pair) {
      var value = read(style.getPropertyValue(pair[1]));
      if (value) found[pair[0]] = value;
    });
    var frame = read(getComputedStyle(document.documentElement).backgroundColor);
    if (frame) found.frame = frame;
    probe.remove();
    return found;
  }

  function cleanColors(colors) {
    var out = {};
    roles.forEach(function (role) {
      if (colors && colors[role] !== undefined && colors[role] !== "") out[role] = hex(parse(colors[role]));
    });
    return complete(out);
  }

  function paletteList(target) {
    return (paletteStore.get("lists", {})[target] || []).slice();
  }

  function paletteById(target, id) {
    return (
      paletteList(target).find(function (p) {
        return p.id === id;
      }) || null
    );
  }

  function activePalette(target) {
    return paletteById(target, paletteStore.get("active", {})[target]);
  }

  function refreshPalette() {
    var target = paletteTarget();
    var picked = internal.safeMode ? null : activePalette(target.id);
    var next = draft || (picked ? picked.colors : null);
    if (JSON.stringify(next) !== JSON.stringify(paletteColors)) {
      paletteColors = next;
      render();
    }
    var state = { target: target.id, active: picked ? picked.id : null, list: paletteList(target.id) };
    var signature = JSON.stringify(state);
    if (signature !== lastPaletteState) {
      lastPaletteState = signature;
      paletteEvents.emit("change", state);
    }
  }
  var lastPaletteState = null;
  internal.palettes = { refresh: refreshPalette };
  events.on("change", refreshPalette);

  function base64Url(text) {
    return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(text) {
    var b = text.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return decodeURIComponent(escape(atob(b)));
  }

  SpotiKit.Palettes = {
    roles: roles.slice(),
    get target() {
      return paletteTarget();
    },
    base: function () {
      if (paletteColors) return complete(paletteColors);
      if (shown) return complete(shown.colors);
      return complete(Object.assign({}, SPOTIFY_COLORS, colorsOnScreen()));
    },
    list: function (target) {
      return paletteList(target || paletteTarget().id);
    },
    get active() {
      var picked = activePalette(paletteTarget().id);
      return picked ? picked.id : null;
    },
    use: function (id) {
      var target = paletteTarget().id;
      var active = Object.assign({}, paletteStore.get("active", {}));
      if (id) {
        if (!paletteById(target, id)) throw new Error("There is no palette " + id + ".");
        active[target] = id;
      } else {
        delete active[target];
      }
      paletteStore.set("active", active);
      refreshPalette();
    },
    save: function (palette) {
      var name = String((palette && palette.name) || "").trim();
      if (!name) throw new Error("Give the palette a name.");
      if (name.length > 40) throw new Error("Keep the name under 40 characters.");
      var target = paletteTarget().id;
      var saved = { id: palette.id || "p" + Date.now().toString(36), name: name, colors: cleanColors(palette.colors) };
      var lists = Object.assign({}, paletteStore.get("lists", {}));
      var old = lists[target] || [];
      var at = old.findIndex(function (p) {
        return p.id === saved.id;
      });
      var list = old.slice();
      if (at < 0) list.push(saved);
      else list[at] = saved;
      lists[target] = list;
      paletteStore.set("lists", lists);
      refreshPalette();
      return saved;
    },
    remove: function (id) {
      var target = paletteTarget().id;
      var lists = Object.assign({}, paletteStore.get("lists", {}));
      lists[target] = (lists[target] || []).filter(function (p) {
        return p.id !== id;
      });
      if (!lists[target].length) delete lists[target];
      paletteStore.set("lists", lists);
      var active = Object.assign({}, paletteStore.get("active", {}));
      if (active[target] === id) {
        delete active[target];
        paletteStore.set("active", active);
      }
      refreshPalette();
    },
    preview: function (colors) {
      draft = colors ? cleanColors(colors) : null;
      refreshPalette();
    },
    export: function (id) {
      var palette = paletteById(paletteTarget().id, id);
      if (!palette) throw new Error("There is no palette " + id + ".");
      return SpotiKit.Palettes.encode(palette);
    },
    encode: function (palette) {
      var colors = cleanColors(palette && palette.colors);
      var name = String((palette && palette.name) || "Palette").slice(0, 40);
      return "spotikit-palette:" + base64Url(JSON.stringify({ v: 1, name: name, colors: colors }));
    },
    import: function (code) {
      var text = String(code || "").trim();
      var data;
      try {
        data = /^spotikit-palette:/.test(text) ? JSON.parse(fromBase64Url(text.slice(17))) : JSON.parse(text);
      } catch (e) {
        throw new Error("That isn't a palette code.");
      }
      if (!data || typeof data !== "object" || !data.colors) throw new Error("That isn't a palette code.");
      return { name: String(data.name || "Imported").slice(0, 40), colors: cleanColors(data.colors) };
    },
    on: function (type, listener) {
      return paletteEvents.on(type, listener);
    },
  };

  refreshPalette();

})(window.SpotiKit);
