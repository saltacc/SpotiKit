/* SpotiKit marketplace UI */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal || !SpotiKit.Marketplace) {
    return;
  }
  var M = SpotiKit.Marketplace;
  var PATH = "/marketplace";

  var TABS = [
    { id: "theme", label: "Themes", short: "Themes", icon: "edit-image" },
    { id: "extension", label: "Extensions", short: "Extensions", icon: "experiment" },
    { id: "app", label: "Custom Apps", short: "Apps", icon: "apps" },
    { id: "snippets", label: "CSS Snippets", short: "Snippets", icon: "embed" },
    { id: "shared", label: "Shared Profiles", short: "Profiles", icon: "group", account: true },
    { id: "installed", label: "Installed", short: "Installed", icon: "downloaded" },
  ];

  var SHOP_ICON =
    '<svg role="img" aria-hidden="true" class="e-icon mp-shop-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
    '<path fill-rule="evenodd" d="M7.7 8.4h8.6a1.7 1.7 0 0 1 1.68 1.44l1.5 9.2A1.7 1.7 0 0 1 17.8 21H6.2a1.7 1.7 0 0 1-1.68-1.96l1.5-9.2A1.7 1.7 0 0 1 7.7 8.4z' +
    'M8.6 10.75a.9.9 0 1 0 0 1.8.9.9 0 1 0 0-1.8zM15.4 10.75a.9.9 0 1 0 0 1.8.9.9 0 1 0 0-1.8z"/>' +
    '<path d="M8.6 8.4V6.3a3.4 3.4 0 0 1 6.8 0v2.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var SHOP_ICON_ACTIVE = SHOP_ICON;

  function h() {
    return SpotiKit.React.createElement.apply(null, arguments);
  }

  function Ic(props) {
    var markup = SpotiKit.Icons.has(props.name) ? SpotiKit.Icons.markup(props.name) : "";
    return h("svg", {
      className: "mp-ic" + (props.className ? " " + props.className : ""),
      viewBox: "0 0 16 16",
      width: props.size || 16,
      height: props.size || 16,
      fill: "currentColor",
      "aria-hidden": "true",
      dangerouslySetInnerHTML: { __html: markup },
    });
  }

  var tipCount = 0;
  function glassTip(element, options) {
    options = Object.assign({ placement: "top", delay: 320 }, options);
    var text = function () {
      return typeof options.content === "function" ? options.content(element) : options.content;
    };
    var bubble = null;
    var timer = 0;
    var gone = 0;
    var shown = false;
    var make = function () {
      bubble = document.createElement("div");
      bubble.id = "spotikit-mp-tip-" + ++tipCount;
      bubble.className = "mp-tooltip";
      bubble.setAttribute("role", "tooltip");
    };
    var place = function () {
      var r = element.getBoundingClientRect();
      var b = bubble.getBoundingClientRect();
      var below = options.placement === "bottom" || r.top - b.height - 10 < 6;
      if (below && r.bottom + b.height + 10 > window.innerHeight - 6 && options.placement !== "bottom") below = false;
      var x = Math.max(6, Math.min(r.left + r.width / 2 - b.width / 2, window.innerWidth - b.width - 6));
      var y = below ? r.bottom + 10 : r.top - b.height - 10;
      bubble.style.left = Math.round(x) + "px";
      bubble.style.top = Math.round(y) + "px";
      bubble.setAttribute("data-placement", below ? "bottom" : "top");
    };
    var show = function () {
      var content = element.isConnected ? text() : "";
      if (!content) return;
      clearTimeout(gone);
      if (!bubble) make();
      bubble.textContent = content;
      if (!bubble.isConnected) document.body.appendChild(bubble);
      place();
      shown = true;
      requestAnimationFrame(function () {
        if (shown && bubble) bubble.classList.add("is-shown");
      });
      document.addEventListener("scroll", hide, true);
    };
    var hide = function () {
      clearTimeout(timer);
      document.removeEventListener("scroll", hide, true);
      if (!bubble || !shown) return;
      shown = false;
      bubble.classList.remove("is-shown");
      var leaving = bubble;
      gone = setTimeout(function () {
        if (!shown) leaving.remove();
      }, 260);
    };
    var enter = function () {
      clearTimeout(timer);
      timer = setTimeout(show, options.delay);
    };
    var listeners = [
      ["mouseenter", enter],
      ["mouseleave", hide],
      ["mousedown", hide],
    ];
    listeners.forEach(function (pair) {
      element.addEventListener(pair[0], pair[1]);
    });
    return {
      setContent: function (content) {
        options.content = content;
        if (bubble && shown) {
          bubble.textContent = text() || "";
          place();
        }
      },
      hide: hide,
      remove: function () {
        hide();
        clearTimeout(gone);
        if (bubble) bubble.remove();
        listeners.forEach(function (pair) {
          element.removeEventListener(pair[0], pair[1]);
        });
      },
    };
  }

  function Tip(props) {
    var R = SpotiKit.React;
    var node = R.useRef(null);
    var tip = R.useRef(null);
    R.useEffect(function () {
      if (!node.current) return undefined;
      tip.current = glassTip(node.current, { content: props.label, placement: props.placement || "top" });
      return function () {
        tip.current.remove();
        tip.current = null;
      };
    }, []);
    R.useEffect(
      function () {
        if (tip.current) tip.current.setContent(props.label);
      },
      [props.label]
    );
    return R.cloneElement(R.Children.only(props.children), { ref: node });
  }

  function useStacked(rowRef) {
    var R = SpotiKit.React;
    var stacked = R.useState(false);
    R.useEffect(function () {
      var row = rowRef.current;
      if (!row || typeof ResizeObserver !== "function") return undefined;
      var measure = function () {
        var tabs = row.querySelector(".mp-tabs");
        var tools = row.querySelector(".mp-sticky-tools");
        if (!tabs || !tools) return;
        var gap = parseFloat(getComputedStyle(row).columnGap) || 0;
        var toolGap = parseFloat(getComputedStyle(tools).columnGap) || 0;
        var parts = Array.prototype.slice.call(tools.children);
        var tabStyle = getComputedStyle(tabs);
        var tabList = tabs.querySelectorAll(".mp-tab");
        var tabsWidth = (parseFloat(tabStyle.paddingLeft) || 0) + (parseFloat(tabStyle.paddingRight) || 0) +
          (parseFloat(tabStyle.columnGap) || 0) * Math.max(0, tabList.length - 1);
        Array.prototype.forEach.call(tabList, function (tab) {
          tabsWidth += tab.getBoundingClientRect().width;
        });
        var needed = tabsWidth + gap + toolGap * Math.max(0, parts.length - 1);
        parts.forEach(function (part) {
          needed += part.classList.contains("mp-search") ? 320 : part.getBoundingClientRect().width;
        });
        stacked[1](needed > row.clientWidth);
      };
      var observer = new ResizeObserver(measure);
      observer.observe(row);
      measure();
      return function () {
        observer.disconnect();
      };
    }, []);
    return stacked[0];
  }

  function useEntered() {
    var R = SpotiKit.React;
    var entered = R.useState(false);
    R.useEffect(function () {
      var done = false;
      var go = function () {
        if (done) return;
        done = true;
        entered[1](true);
      };
      var frame = requestAnimationFrame(function () {
        frame = requestAnimationFrame(go);
      });
      var fallback = setTimeout(go, 400);
      return function () {
        done = true;
        cancelAnimationFrame(frame);
        clearTimeout(fallback);
      };
    }, []);
    return entered[0];
  }

  function PopIn(props) {
    var entered = useEntered();
    return h(
      "div",
      Object.assign({}, props.attrs, { className: props.className + (entered ? "" : " is-pre") }),
      props.children
    );
  }

  function Scroll(props) {
    var Container = SpotiKit.Components.ScrollContainer;
    return Container
      ? h(Container, { className: props.className }, props.children)
      : h("div", { className: props.className + " mp-scroll-native" }, props.children);
  }

  var toastHost = null;
  function notify(message, options) {
    options = options || {};
    if (!document.querySelector(".mp-sheet-backdrop, .mp-confirm-backdrop")) return SpotiKit.notify(message, options);
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement("div");
      toastHost.className = "mp-toasts";
      document.body.appendChild(toastHost);
    }
    var toast = document.createElement("div");
    toast.className = "mp-toast" + (options.type === "error" ? " is-error" : "");
    toast.setAttribute("role", options.type === "error" ? "alert" : "status");
    toast.textContent = message;
    toastHost.appendChild(toast);
    var gone = false;
    var close = function () {
      if (gone) return;
      gone = true;
      toast.classList.add("is-leaving");
      setTimeout(function () {
        toast.remove();
      }, 260);
    };
    if (options.duration !== Infinity) setTimeout(close, options.duration || 4000);
    return { close: close };
  }

  function overBody(element) {
    var dom = internal.nativeReactDOM;
    return dom && dom.createPortal ? dom.createPortal(element, document.body) : element;
  }

  function matches(query, fields) {
    return !query || fields.join(" ").toLowerCase().indexOf(query) >= 0;
  }

  function formatBytes(n) {
    return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }

  function when(at) {
    try {
      return SpotiKit.Locale.formatRelative(at);
    } catch (e) {
      return new Date(at).toLocaleDateString();
    }
  }

  var KIND_LABEL = { theme: "Theme", extension: "Extension", app: "Custom app", snippet: "CSS snippet" };
  var GROUPS = [
    { kind: "theme", label: "Themes", icon: "edit-image" },
    { kind: "extension", label: "Extensions", icon: "experiment" },
    { kind: "app", label: "Custom Apps", icon: "apps" },
    { kind: "snippet", label: "CSS Snippets", icon: "embed" },
    { kind: "other", label: "Other", icon: "downloaded" },
  ];

  function useMarketplace() {
    var R = SpotiKit.React;
    var tick = R.useReducer(function (x) {
      return x + 1;
    }, 0)[1];
    R.useEffect(function () {
      var offs = [
        "catalog",
        "installed",
        "busy",
        "reload",
        "snippets",
        "rating",
        "skipped",
        "settings",
        "profiles",
      ].map(function (type) {
        return M.on(type, tick);
      });
      return function () {
        offs.forEach(function (off) {
          off();
        });
      };
    }, []);
  }

  var STAR = "M8 1.2l2.03 4.12 4.55.66-3.29 3.2.78 4.53L8 11.57l-4.07 2.14.78-4.53-3.29-3.2 4.55-.66L8 1.2Z";

  function formatStars(n) {
    if (n >= 10000) return Math.round(n / 1000) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }

  function StarIcon(props) {
    return h(
      "svg",
      {
        viewBox: "0 0 16 16",
        width: props.size || 14,
        height: props.size || 14,
        "aria-hidden": "true",
        className: props.className,
      },
      h("path", { d: STAR, className: props.on === false ? "mp-star-empty" : "mp-star-full" })
    );
  }

  function StarRow(props) {
    var value = Math.round((props.value || 0) * 4) / 4;
    var size = props.size || 13;
    return h(
      "span",
      { className: "mp-starrow", "aria-label": (props.value || 0) + " of 5 stars" },
      [1, 2, 3, 4, 5].map(function (n) {
        var part = Math.max(0, Math.min(1, value - n + 1));
        return h(
          "span",
          { key: n, className: "mp-star-cell" },
          h(StarIcon, { size: size, on: false }),
          part > 0
            ? h(
                "svg",
                {
                  viewBox: "0 0 16 16",
                  width: size,
                  height: size,
                  "aria-hidden": "true",
                  style: { clipPath: "inset(0 " + (1 - part) * 100 + "% 0 0)" },
                },
                h("path", { d: STAR, className: "mp-star-full" })
              )
            : null
        );
      })
    );
  }

  function formatAverage(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function RatingSummary(props) {
    var s = M.ratings.summary(props.id);
    if (s.source === "spotikit" && props.source !== "github") {
      if (!s.count) return null;
      return h(
        Tip,
        { label: formatAverage(s.average) + " from " + s.count + (s.count === 1 ? " review" : " reviews") },
        h(
          "span",
          { className: "mp-rating" },
          h(StarIcon, {}),
          h("span", { className: "mp-rating-count" }, formatAverage(s.average)),
          h("span", { className: "mp-rating-of" }, "(" + formatStars(s.count) + ")")
        )
      );
    }
    if (s.stars === null || s.stars === undefined) return null;
    return h(
      Tip,
      { label: s.stars + (s.stars === 1 ? " star" : " stars") + " on GitHub" },
      h(
        "span",
        { className: "mp-rating" },
        h(StarIcon, {}),
        h("span", { className: "mp-rating-count" }, formatStars(s.stars))
      )
    );
  }

  function RatingPanel(props) {
    var s = M.ratings.summary(props.id);
    if (s.source === "spotikit") {
      return h(
        "div",
        { className: "mp-rate" },
        s.count
          ? h(
              "div",
              { className: "mp-rate-big" },
              h(StarIcon, { size: 26 }),
              h("b", null, formatAverage(s.average)),
              h("span", null, "from " + s.count + (s.count === 1 ? " review" : " reviews"))
            )
          : h("p", { className: "mp-muted" }, "No reviews yet."),
        s.stars !== null && s.stars !== undefined
          ? h(
              "p",
              { className: "mp-muted" },
              s.stars.toLocaleString() + (s.stars === 1 ? " star" : " stars") + " on GitHub"
            )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "mp-btn mp-btn--small",
            onClick: function () {
              writeReview(props.item);
            },
          },
          h(Ic, { name: "edit", size: 14 }),
          "Write a review"
        )
      );
    }
    if (s.stars === null || s.stars === undefined) {
      return h(
        "p",
        { className: "mp-muted" },
        "Snippets come from one shared list on GitHub, so they have no stars of their own."
      );
    }
    return h(
      "div",
      { className: "mp-rate" },
      h(
        "div",
        { className: "mp-rate-big" },
        h(StarIcon, { size: 26 }),
        h("b", null, s.stars.toLocaleString()),
        h("span", null, s.stars === 1 ? "star on GitHub" : "stars on GitHub")
      ),
      s.url
        ? h(
            "a",
            { className: "mp-btn mp-btn--small mp-btn--ghost", href: s.url, target: "_blank", rel: "noreferrer" },
            h(Ic, { name: "external-link", size: 14 }),
            "Star it on GitHub"
          )
        : null
    );
  }

  function hexToHsv(hex) {
    var n = parseInt(String(hex || "#000000").slice(1), 16) || 0;
    var r = ((n >> 16) & 255) / 255;
    var g = ((n >> 8) & 255) / 255;
    var b = (n & 255) / 255;
    var max = Math.max(r, g, b);
    var d = max - Math.min(r, g, b);
    var hue = 0;
    if (d) {
      hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { h: hue, s: max ? d / max : 0, v: max };
  }
  function hsvToHex(c) {
    var part = function (n) {
      var k = (n + c.h / 60) % 6;
      var x = c.v - c.v * c.s * Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(x * 255)
        .toString(16)
        .padStart(2, "0");
    };
    return "#" + part(5) + part(3) + part(1);
  }

  function ColorPicker(props) {
    var R = SpotiKit.React;
    var hsv = R.useState(function () {
      return hexToHsv(props.value);
    });
    var text = R.useState(props.value || "");
    var latest = R.useRef(hsv[0]);
    latest.current = hsv[0];
    R.useEffect(
      function () {
        if (String(props.value || "").toLowerCase() !== hsvToHex(latest.current)) hsv[1](hexToHsv(props.value));
        text[1](props.value || "");
      },
      [props.value]
    );
    var apply = function (next) {
      hsv[1](next);
      props.onChange(hsvToHex(next));
    };
    var drag = function (kind) {
      return function (e) {
        var el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {}
        var move = function (ev) {
          var box = el.getBoundingClientRect();
          var x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
          var y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
          var now = latest.current;
          apply(kind === "sv" ? { h: now.h, s: x, v: 1 - y } : { h: Math.min(359.9, x * 360), s: now.s, v: now.v });
        };
        move(e);
        el.onpointermove = move;
        el.onpointerup = el.onpointercancel = function () {
          el.onpointermove = null;
        };
      };
    };
    var c = hsv[0];
    return h(
      "div",
      { className: "mp-picker" },
      h(
        "div",
        {
          className: "mp-picker-sv",
          style: { backgroundColor: hsvToHex({ h: c.h, s: 1, v: 1 }) },
          onPointerDown: drag("sv"),
        },
        h("span", {
          className: "mp-picker-dot",
          style: { left: c.s * 100 + "%", top: (1 - c.v) * 100 + "%", backgroundColor: hsvToHex(c) },
        })
      ),
      h(
        "div",
        { className: "mp-picker-hue", onPointerDown: drag("hue") },
        h("span", {
          className: "mp-picker-dot",
          style: { left: (c.h / 360) * 100 + "%", top: "50%", backgroundColor: hsvToHex({ h: c.h, s: 1, v: 1 }) },
        })
      ),
      h("input", {
        className: "mp-input mp-picker-hex",
        value: text[0],
        maxLength: 7,
        spellCheck: false,
        "aria-label": props.label + " as a hex color",
        onChange: function (e) {
          var typed = e.target.value;
          text[1](typed);
          if (/^#?[0-9a-f]{6}$/i.test(typed)) {
            var clean = (typed.charAt(0) === "#" ? typed : "#" + typed).toLowerCase();
            hsv[1](hexToHsv(clean));
            props.onChange(clean);
          }
        },
        onKeyDown: function (e) {
          e.stopPropagation();
        },
      })
    );
  }

  function ColorsField(props) {
    var R = SpotiKit.React;
    var open = R.useState(null);
    var value = props.value || {};
    var openRole = props.roles.find(function (r) {
      return r.id === open[0];
    });
    return h(
      "div",
      { className: "mp-colors" },
      h(
        "div",
        { className: "mp-colors-grid" },
        props.roles.map(function (role) {
          var on = open[0] === role.id;
          return h(
            "button",
            {
              key: role.id,
              type: "button",
              className: "mp-color-row" + (on ? " is-open" : ""),
              "aria-expanded": on,
              title: role.hint,
              onClick: function () {
                open[1](on ? null : role.id);
              },
            },
            h("span", { className: "mp-color-swatch", style: { backgroundColor: value[role.id] } }),
            h("span", { className: "mp-color-name" }, role.label),
            h("span", { className: "mp-color-hex" }, String(value[role.id] || "").toUpperCase())
          );
        })
      ),
      openRole
        ? h(ColorPicker, {
            key: openRole.id,
            label: openRole.label,
            value: value[openRole.id],
            onChange: function (hex) {
              var next = Object.assign({}, value);
              next[openRole.id] = hex;
              props.onChange(next);
            },
          })
        : null
    );
  }

  function CodeField(props) {
    var R = SpotiKit.React;
    var open = R.useState(false);
    var message = R.useState(null);
    if (!open[0])
      return h(
        "button",
        {
          type: "button",
          className: "mp-form-link",
          onClick: function () {
            open[1](true);
          },
        },
        props.label
      );
    return h(
      "div",
      { className: "mp-form-field" },
      h("input", {
        className: "mp-input",
        autoFocus: true,
        placeholder: props.placeholder,
        spellCheck: false,
        onChange: function (e) {
          var code = e.target.value.trim();
          if (!code) return message[1](null);
          try {
            props.onCode(code);
            message[1]({ ok: true, text: "Loaded. Look it over, then save." });
          } catch (err) {
            message[1]({ ok: false, text: err.message });
          }
        },
        onKeyDown: function (e) {
          e.stopPropagation();
        },
      }),
      message[0] ? h("span", { className: "mp-form-hint" + (message[0].ok ? "" : " is-error") }, message[0].text) : null
    );
  }

  var PALETTE_ROLES = [
    { id: "background", label: "Background", hint: "Main view, sidebars, menus" },
    { id: "frame", label: "Frame", hint: "Around the panels" },
    { id: "elevated", label: "Raised", hint: "Menus, popovers, hover" },
    { id: "divider", label: "Lines", hint: "Lines between rows" },
    { id: "text", label: "Text", hint: "Text" },
    { id: "subtext", label: "Soft text", hint: "Secondary text" },
    { id: "accent", label: "Accent", hint: "Play button, highlights" },
    { id: "onAccent", label: "On accent", hint: "Icons and text on the accent" },
    { id: "positive", label: "Positive", hint: "Success" },
    { id: "negative", label: "Negative", hint: "Errors" },
    { id: "warning", label: "Warning", hint: "Warnings" },
    { id: "announcement", label: "Info", hint: "Announcements" },
  ];

  function openPaletteEditor(id) {
    var P = SpotiKit.Palettes;
    var existing = id
      ? P.list().find(function (p) {
          return p.id === id;
        })
      : null;
    var target = P.target;
    return form({
      title: existing ? "Edit " + existing.name : "New palette",
      icon: "edit-image",
      message:
        "For " +
        (target.id === "spotify" ? "Spotify without a theme" : target.name) +
        ". Spotify shows your changes right away; nothing is kept until you save.",
      fields: [
        { id: "name", type: "text", label: "Name", value: existing ? existing.name : "", placeholder: "My palette", required: true, maxLength: 40 },
        { id: "colors", type: "colors", roles: PALETTE_ROLES, value: existing ? existing.colors : P.base() },
        {
          id: "code",
          type: "code",
          label: "Paste a palette code",
          placeholder: "spotikit-palette:…",
          onCode: function (code) {
            var imported = P.import(code);
            return { name: imported.name, colors: imported.colors };
          },
        },
      ],
      onValues: function (values) {
        try {
          P.preview(values.colors);
        } catch (e) {}
      },
      tools: [
        {
          label: "Copy code",
          icon: "link",
          onClick: function (values) {
            return copyText(P.encode({ name: values.name || "Palette", colors: values.colors })).then(function () {
              notify("Palette code copied. Anyone with SpotiKit can paste it here.");
            });
          },
        },
      ].concat(
        existing
          ? [
              {
                label: "Delete",
                icon: "trash",
                danger: true,
                onClick: function (values, api) {
                  P.remove(existing.id);
                  api.close("deleted");
                },
              },
            ]
          : []
      ),
      confirmLabel: "Save",
      confirmIcon: "check",
      onSubmit: function (values) {
        var saved = P.save({ id: existing ? existing.id : null, name: values.name, colors: values.colors });
        P.use(saved.id);
        return saved;
      },
    }).then(function (result) {
      P.preview(null);
      if (result === "deleted") notify("Palette deleted");
      else if (result && result.name) notify((existing ? "Saved " : "Using ") + result.name);
      return result;
    });
  }
  internal.openPaletteEditor = openPaletteEditor;
  if (internal.rebuildSchemeMenu) internal.rebuildSchemeMenu();

  function FormCard(props) {
    var R = SpotiKit.React;
    var values = R.useState(function () {
      var start = {};
      props.fields.forEach(function (f) {
        start[f.id] = f.value !== undefined ? f.value : f.type === "check" ? false : f.type === "stars" ? 0 : "";
      });
      return start;
    });
    var phase = R.useState("open");
    var error = R.useState(null);
    var hover = R.useState(0);
    var entered = useEntered();
    var v = values[0];
    R.useEffect(
      function () {
        if (props.onValues) props.onValues(v);
      },
      [v]
    );
    var set = function (id, value) {
      values[1](function (old) {
        var next = Object.assign({}, old);
        next[id] = value;
        return next;
      });
    };
    var close = function (result) {
      if (phase[0] === "closing") return;
      phase[1]("closing");
      props.onDone(result);
    };
    R.useEffect(
      function () {
        var onKey = function (e) {
          if (e.key !== "Escape" || phase[0] === "busy") return;
          e.preventDefault();
          e.stopPropagation();
          close(null);
        };
        window.addEventListener("keydown", onKey, true);
        return function () {
          window.removeEventListener("keydown", onKey, true);
        };
      },
      [phase[0]]
    );
    var ready = props.fields.every(function (f) {
      if (!f.required) return true;
      var value = v[f.id];
      if (f.type === "check") return value === true;
      if (f.type === "stars") return value > 0;
      return String(value || "").trim().length >= (f.minLength || 1);
    });
    var run = function (action) {
      if (phase[0] !== "open") return;
      phase[1]("busy");
      error[1](null);
      Promise.resolve()
        .then(function () {
          return action(v);
        })
        .then(
          function (result) {
            phase[1]("open");
            close(result === undefined ? true : result);
          },
          function (e) {
            phase[1]("open");
            error[1](e.message);
          }
        );
    };
    var tone = props.tone === "danger" ? "danger" : "accent";
    var field = function (f) {
      var label = f.label ? h("span", { className: "mp-form-label" }, f.label) : null;
      if (f.type === "stars") {
        var shown = hover[0] || v[f.id];
        return h(
          "div",
          { key: f.id, className: "mp-form-field mp-form-field--center" },
          h(
            "div",
            {
              className: "mp-star-picker",
              role: "radiogroup",
              "aria-label": f.label || "Stars",
              onMouseLeave: function () {
                hover[1](0);
              },
            },
            [1, 2, 3, 4, 5].map(function (n) {
              return h(
                "button",
                {
                  key: n,
                  type: "button",
                  role: "radio",
                  "aria-checked": v[f.id] === n,
                  "aria-label": n + (n === 1 ? " star" : " stars"),
                  className: "mp-star-pick" + (n <= shown ? " is-on" : ""),
                  style: { "--i": n },
                  onMouseEnter: function () {
                    hover[1](n);
                  },
                  onClick: function () {
                    set(f.id, n);
                  },
                },
                h(StarIcon, { size: 30, on: n <= shown })
              );
            })
          ),
          h("span", { className: "mp-form-hint" }, STAR_WORDS[shown] || "Tap a star")
        );
      }
      if (f.type === "select") {
        return h(
          "div",
          { key: f.id, className: "mp-form-field" },
          label,
          h(Dropdown, {
            float: true,
            className: "mp-dd--block",
            value: v[f.id],
            placeholder: f.placeholder,
            options: f.options,
            onChange: function (value) {
              set(f.id, value);
            },
          })
        );
      }
      if (f.type === "colors") {
        return h(ColorsField, {
          key: f.id,
          value: v[f.id],
          roles: f.roles,
          onChange: function (next) {
            set(f.id, next);
          },
        });
      }
      if (f.type === "code") {
        return h(CodeField, {
          key: f.id,
          label: f.label,
          placeholder: f.placeholder,
          onCode: function (text) {
            var result = f.onCode(text);
            Object.keys(result).forEach(function (k) {
              set(k, result[k]);
            });
          },
        });
      }
      if (f.type === "check") {
        return h(
          "button",
          {
            key: f.id,
            type: "button",
            role: "checkbox",
            "aria-checked": !!v[f.id],
            className: "mp-form-check" + (v[f.id] ? " is-on" : ""),
            onClick: function (e) {
              if (e.target.closest("a")) return;
              set(f.id, !v[f.id]);
            },
          },
          h("span", { className: "mp-form-box" }, h(Ic, { name: "check", size: 12 })),
          h("span", null, f.label)
        );
      }
      var attrs = {
        className: "mp-input" + (f.type === "textarea" ? " mp-textarea" : ""),
        value: v[f.id],
        maxLength: f.maxLength || 200,
        placeholder: f.placeholder || "",
        autoFocus: !!f.autoFocus,
        spellCheck: f.type === "textarea",
        onChange: function (e) {
          set(f.id, e.target.value);
        },
        onKeyDown: function (e) {
          e.stopPropagation();
        },
      };
      return h(
        "div",
        { key: f.id, className: "mp-form-field" },
        label,
        h(f.type === "textarea" ? "textarea" : "input", attrs),
        f.hint || f.type === "textarea"
          ? h(
              "span",
              { className: "mp-form-hint" },
              f.hint || "",
              f.type === "textarea" && f.maxLength
                ? h("i", null, String(v[f.id] || "").length + " / " + f.maxLength)
                : null
            )
          : null
      );
    };
    return h(
      "div",
      {
        className: "mp-confirm-backdrop" + (phase[0] === "closing" ? " is-closing" : ""),
        onMouseDown: function () {
          if (phase[0] === "open") close(null);
        },
      },
      h(
        "div",
        {
          className: "mp-confirm mp-form" + (entered ? "" : " is-pre"),
          role: "dialog",
          "aria-label": props.title,
          onMouseDown: function (e) {
            e.stopPropagation();
          },
        },
        h(
          "span",
          { className: "mp-confirm-icon mp-confirm-icon--" + tone },
          h(Ic, { name: props.icon || "info", size: 22 })
        ),
        h("b", null, props.title),
        props.message ? h("p", null, props.message) : null,
        h("div", { className: "mp-form-fields" }, props.fields.map(field)),
        props.footnote ? h("p", { className: "mp-form-foot" }, props.footnote) : null,
        props.tools
          ? h(
              "div",
              { className: "mp-form-tools" },
              props.tools.map(function (tool) {
                return h(
                  "button",
                  {
                    key: tool.label,
                    type: "button",
                    className: "mp-btn mp-btn--ghost mp-btn--small" + (tool.danger ? " mp-btn--danger-text" : ""),
                    disabled: phase[0] !== "open",
                    onClick: function () {
                      Promise.resolve()
                        .then(function () {
                          return tool.onClick(v, { close: close });
                        })
                        .catch(function (e) {
                          error[1](e.message);
                        });
                    },
                  },
                  tool.icon ? h(Ic, { name: tool.icon }) : null,
                  tool.label
                );
              })
            )
          : null,
        error[0] ? h("p", { className: "mp-form-error" }, error[0]) : null,
        h(
          "div",
          { className: "mp-confirm-actions" },
          props.secondary
            ? h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--ghost mp-btn--danger-text",
                  disabled: phase[0] !== "open",
                  onClick: function () {
                    run(props.secondary.onClick);
                  },
                },
                props.secondary.icon ? h(Ic, { name: props.secondary.icon }) : null,
                props.secondary.label
              )
            : h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--ghost",
                  disabled: phase[0] === "busy",
                  onClick: function () {
                    close(null);
                  },
                },
                props.cancelLabel || "Cancel"
              ),
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--" + tone + (phase[0] === "busy" ? " mp-btn--busy" : ""),
              disabled: !ready || phase[0] !== "open",
              onClick: function () {
                run(props.onSubmit);
              },
            },
            phase[0] === "busy"
              ? h("i", { className: "mp-spinner" })
              : props.confirmIcon
                ? h(Ic, { name: props.confirmIcon })
                : null,
            props.confirmLabel || "OK"
          )
        )
      )
    );
  }

  var STAR_WORDS = ["", "Not good", "Could be better", "Okay", "Good", "Great"];

  function form(options) {
    return new Promise(function (resolve) {
      var host = document.createElement("div");
      host.id = "spotikit-mp-form-" + Date.now();
      document.body.appendChild(host);
      var cleanup = null;
      cleanup = internal.renderInto(
        host,
        h(
          FormCard,
          Object.assign({}, options, {
            onDone: function (result) {
              resolve(result);
              setTimeout(function () {
                if (cleanup) cleanup();
                host.remove();
              }, 300);
            },
          })
        )
      );
    });
  }

  function fail(e) {
    notify(e.message, { type: "error", duration: 7000 });
  }

  function legalLink(label, page) {
    return h(
      "a",
      {
        href: "#",
        onClick: function (e) {
          e.preventDefault();
          e.stopPropagation();
          M.account.siteLink(page).then(M.account.openOutside, fail);
        },
      },
      label
    );
  }

  function whenVisible(run) {
    if (document.visibilityState === "visible") return run();
    var onChange = function () {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      run();
    };
    document.addEventListener("visibilitychange", onChange);
  }

  function signIn(reason) {
    var A = M.account;
    if (A.user) return Promise.resolve(A.user);
    if (!A.available) {
      fail(new Error("SpotiKit accounts aren't available yet."));
      return Promise.resolve(null);
    }
    return A.config()
      .then(function (config) {
        return form({
          title: "Sign in with Discord",
          icon: "user",
          message:
            (reason ? reason + " " : "") +
            "Your browser opens Discord. SpotiKit only gets your Discord ID, name and picture. Your Discord account has to be at least " +
            config.minAccountAgeDays +
            " days old to post.",
          fields: [
            {
              id: "terms",
              type: "check",
              required: true,
              label: h(
                SpotiKit.React.Fragment,
                null,
                "I accept the ",
                legalLink("terms of use", "/terms"),
                " and have read the ",
                legalLink("privacy policy", "/privacy"),
                "."
              ),
            },
          ],
          confirmLabel: "Continue in the browser",
          confirmIcon: "external-link",
          onSubmit: function () {
            return true;
          },
        });
      })
      .then(function (go) {
        if (!go) return null;
        return new Promise(function (resolve) {
          setTimeout(resolve, 340);
        }).then(function () {
          return true;
        });
      })
      .then(function (go) {
        if (!go) return null;
        var waiting = notify("Finish signing in in your browser. Spotify notices on its own.", { duration: Infinity });
        return A.signIn().then(
          function (user) {
            waiting.close();
            whenVisible(function () {
              notify("Signed in as " + user.name);
            });
            return user;
          },
          function (e) {
            waiting.close();
            throw e;
          }
        );
      })
      .catch(function (e) {
        if (!/cancelled|started again/.test(e.message)) fail(e);
        return null;
      });
  }

  function writeReview(item) {
    return signIn("Reviews are tied to an account so people know they're real.").then(function (user) {
      if (!user) return null;
      return M.ratings.reviews(item.id).then(function (list) {
        var mine = list.mine;
        if (mine && mine.hidden) {
          return form({
            title: "Your review was removed",
            icon: "warning",
            tone: "danger",
            message:
              "Moderation removed your review of " +
              item.name +
              ". Your messages in the account menu say why. Delete it to write a new one.",
            fields: [],
            confirmLabel: "Delete it",
            onSubmit: function () {
              return M.ratings.remove(item.id).then(function () {
                notify("Review deleted");
              });
            },
          });
        }
        return form({
          title: (mine ? "Your review of " : "Review ") + item.name,
          icon: "star",
          fields: [
            { id: "stars", type: "stars", required: true, value: mine ? mine.stars : 0 },
            {
              id: "text",
              type: "textarea",
              value: mine ? mine.text : "",
              maxLength: 1500,
              placeholder: "What's good, what's missing? (optional)",
            },
          ],
          footnote:
            "Shown with your Discord name and picture. Keep it about this " +
            (KIND_LABEL[item.kind] || "item").toLowerCase() +
            ".",
          confirmLabel: mine ? "Update" : "Post",
          secondary: mine
            ? {
                label: "Delete",
                icon: "trash",
                onClick: function () {
                  return M.ratings.remove(item.id).then(function () {
                    notify("Review deleted");
                    return "deleted";
                  });
                },
              }
            : null,
          onSubmit: function (v) {
            return M.ratings.rate(item.id, v.stars, v.text).then(function () {
              notify(mine ? "Review updated" : "Thanks for your review");
            });
          },
        });
      });
    }, fail);
  }

  var REASONS = [
    { value: "illegal", label: "It's illegal" },
    { value: "harmful", label: "Harmful code" },
    { value: "abuse", label: "Insults, hate or harassment" },
    { value: "spam", label: "Spam or fake ratings" },
    { value: "personal-data", label: "Personal data" },
    { value: "explicit", label: "Sexual or violent content" },
    { value: "child-safety", label: "Child sexual abuse" },
    { value: "misleading", label: "Misleading profile" },
    { value: "other", label: "Something else" },
  ];

  function reportContent(type, id, what, item) {
    var A = M.account;
    if (!A.user) {
      A.report(type, id, null, null, item);
      notify("The report form opened in your browser.");
      return Promise.resolve(null);
    }
    return form({
      title: "Report " + what,
      icon: "flag",
      tone: "danger",
      message: "Tell us why it breaks the law or the terms of use. The author won't see who reported it.",
      fields: [
        {
          id: "reason",
          type: "select",
          required: true,
          placeholder: "What's wrong with it?",
          options: REASONS.filter(function (r) {
            return (type === "profile" || r.value !== "misleading") && (type === "item" || r.value !== "harmful");
          }),
        },
        {
          id: "text",
          type: "textarea",
          required: true,
          minLength: 10,
          maxLength: 2000,
          placeholder: "Why isn't it allowed?",
        },
        {
          id: "faith",
          type: "check",
          required: true,
          label: "I'm sure, in good faith, that what I wrote is accurate and complete.",
        },
      ],
      confirmLabel: "Send report",
      confirmIcon: "flag",
      onSubmit: function (v) {
        return A.report(type, id, v.reason, v.text, item).then(function (r) {
          notify("Thanks. Report " + r.reference + " arrived; you'll find the outcome in your messages.");
        });
      },
    });
  }

  function Avatar(props) {
    var R = SpotiKit.React;
    var broken = R.useState(false);
    var name = (props.name || "?").trim();
    return h(
      "span",
      { className: "mp-avatar" + (props.large ? " mp-avatar--large" : ""), "aria-hidden": "true" },
      props.src && !broken[0]
        ? h("img", {
            src: props.src,
            alt: "",
            onError: function () {
              broken[1](true);
            },
          })
        : (name[0] || "?").toUpperCase()
    );
  }

  function olderVersion(item, version) {
    if (!version) return false;
    var now = M.ratings.versionOf(item.id);
    return !!now && now !== version;
  }

  function answerReview(item, review) {
    var reply = review.reply;
    return form({
      title: reply ? "Your answer" : "Answer " + review.author.name,
      icon: "edit",
      message: review.text
        ? "“" + (review.text.length > 160 ? review.text.slice(0, 160) + "…" : review.text) + "”"
        : null,
      fields: [
        {
          id: "text",
          type: "textarea",
          required: true,
          minLength: 2,
          maxLength: 1000,
          value: reply ? reply.text : "",
          placeholder: "Thank them, explain a fix, or say what's planned",
        },
      ],
      footnote: "Shown under the review as the author of " + item.name + ", with your Discord name and picture.",
      confirmLabel: reply ? "Update" : "Post answer",
      secondary: reply
        ? {
            label: "Delete",
            icon: "trash",
            onClick: function () {
              return M.ratings.removeReply(review.id, item.id).then(function () {
                notify("Answer deleted");
                return "deleted";
              });
            },
          }
        : null,
      onSubmit: function (v) {
        return M.ratings.reply(review.id, v.text).then(function () {
          notify(reply ? "Answer updated" : "Answer posted");
        });
      },
    });
  }

  function ReviewCard(props) {
    var R = SpotiKit.React;
    var r = props.review;
    var item = props.item;
    var vote = R.useState({ helpful: r.helpful || 0, voted: !!r.voted, busy: false });
    var v = vote[0];
    var me = M.account.user;
    var reply = r.reply;
    var myReply = !!(reply && me && reply.author.id === me.id);
    var toggleVote = function () {
      if (v.busy) return;
      var go = function () {
        var next = !v.voted;
        vote[1]({ helpful: v.helpful + (next ? 1 : -1), voted: next, busy: true });
        M.ratings.helpful(r.id, next).then(
          function (result) {
            vote[1]({ helpful: result.helpful, voted: result.voted, busy: false });
          },
          function (e) {
            vote[1](Object.assign({}, v, { busy: false }));
            fail(e);
          }
        );
      };
      if (me) go();
      else
        signIn("Votes are tied to an account, so nobody can push a review up alone.").then(function (user) {
          if (user) go();
        });
    };
    return h(
      "article",
      { className: "mp-review" + (r.mine ? " is-mine" : ""), style: { "--i": Math.min(props.index, 12) } },
      h(Avatar, { name: r.author.name, src: r.author.avatar }),
      h(
        "div",
        { className: "mp-review-main" },
        h(
          "div",
          { className: "mp-review-top" },
          h("b", null, r.author.name),
          r.mine ? h("span", { className: "mp-pill mp-pill--accent" }, "You") : null,
          h(StarRow, { value: r.stars, size: 12 }),
          h("span", { className: "mp-muted" }, when(r.updatedAt))
        ),
        r.version
          ? h(
              "span",
              { className: "mp-review-version" + (olderVersion(item, r.version) ? " is-old" : "") },
              olderVersion(item, r.version)
                ? "Written for an earlier version" + (r.version.charAt(0) === "#" ? "" : " (" + r.version + ")")
                : r.version.charAt(0) === "#"
                  ? "Written for the current version"
                  : "Written for " + r.version
            )
          : null,
        r.text ? h("p", { className: "mp-review-text" }, r.text) : null,
        reply
          ? h(
              "div",
              { className: "mp-review-reply" + (reply.hidden ? " is-hidden" : "") },
              h(
                "div",
                { className: "mp-review-top" },
                h(Avatar, { name: reply.author.name, src: reply.author.avatar }),
                h("b", null, reply.author.name),
                h("span", { className: "mp-pill mp-pill--accent" }, "Author"),
                h("span", { className: "mp-muted" }, when(reply.at)),
                reply.hidden ? h("span", { className: "mp-pill" }, "Removed by moderation") : null
              ),
              h("p", { className: "mp-review-text" }, reply.text),
              myReply || reply.hidden
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      className: "mp-review-action mp-review-action--quiet",
                      onClick: function () {
                        reportContent("reply", r.id, reply.author.name + "'s answer");
                      },
                    },
                    h(Ic, { name: "flag", size: 12 }),
                    "Report answer"
                  )
            )
          : null,
        h(
          "div",
          { className: "mp-review-actions" },
          r.mine
            ? v.helpful
              ? h(
                  "span",
                  { className: "mp-muted" },
                  v.helpful === 1 ? "1 person found this helpful" : v.helpful + " people found this helpful"
                )
              : null
            : h(
                "button",
                {
                  type: "button",
                  className: "mp-review-action" + (v.voted ? " is-on" : ""),
                  "aria-pressed": v.voted,
                  onClick: toggleVote,
                },
                h(Ic, { name: v.voted ? "thumbs-up-active" : "thumbs-up", size: 13 }),
                "Helpful" + (v.helpful ? " · " + v.helpful : "")
              ),
          (props.canReply && !r.mine && !reply) || myReply
            ? h(
                "button",
                {
                  type: "button",
                  className: "mp-review-action",
                  onClick: function () {
                    answerReview(item, r);
                  },
                },
                h(Ic, { name: "edit", size: 13 }),
                myReply ? "Edit answer" : "Answer"
              )
            : null
        )
      ),
      r.mine
        ? null
        : h(
            Tip,
            { label: "Report" },
            h(
              "button",
              {
                type: "button",
                className: "mp-icon-btn mp-review-flag",
                "aria-label": "Report this review",
                onClick: function () {
                  reportContent("review", r.id, r.author.name + "'s review");
                },
              },
              h(Ic, { name: "flag", size: 13 })
            )
          )
    );
  }

  function ReviewsSection(props) {
    var R = SpotiKit.React;
    var item = props.item;
    var sort = R.useState(function () {
      return SpotiKit.Storage.scope("marketplace").get("reviewSort", "helpful");
    });
    var state = R.useState({ reviews: null, next: null, mine: null, canReply: false, error: null });
    var loadingMore = R.useState(false);
    var load = function (by) {
      M.ratings.reviews(item.id, by).then(
        function (r) {
          state[1]({ reviews: r.reviews, next: r.next, mine: r.mine, canReply: !!r.canReply, error: null });
        },
        function (e) {
          state[1]({ reviews: [], next: null, mine: null, canReply: false, error: e.message });
        }
      );
    };
    var sortRef = R.useRef(sort[0]);
    sortRef.current = sort[0];
    R.useEffect(function () {
      var reload = function () {
        load(sortRef.current);
      };
      reload();
      var off = M.on("rating", function (e) {
        if (!e || e.id === item.id) reload();
      });
      var offAccount = M.on("account", reload);
      return function () {
        off();
        offAccount();
      };
    }, []);
    var setSort = function (value) {
      sort[1](value);
      SpotiKit.Storage.scope("marketplace").set("reviewSort", value);
      load(value);
    };
    var s = state[0];
    var more = function () {
      loadingMore[1](true);
      M.ratings.reviews(item.id, sort[0], s.next).then(
        function (r) {
          loadingMore[1](false);
          var seen = {};
          s.reviews.forEach(function (x) {
            seen[x.id] = true;
          });
          state[1](
            Object.assign({}, s, {
              reviews: s.reviews.concat(
                r.reviews.filter(function (x) {
                  return !seen[x.id];
                })
              ),
              next: r.next,
            })
          );
        },
        function (e) {
          loadingMore[1](false);
          fail(e);
        }
      );
    };
    var summary = M.ratings.summary(item.id);
    return h(
      "section",
      { className: "mp-reviews" },
      h(
        "div",
        { className: "mp-reviews-head" },
        h("h3", null, "Reviews"),
        summary.count ? h(StarRow, { value: summary.average }) : null,
        summary.count
          ? h(
              "span",
              { className: "mp-muted" },
              formatAverage(summary.average) + " · " + summary.count + (summary.count === 1 ? " review" : " reviews")
            )
          : null,
        h(
          "div",
          { className: "mp-reviews-tools" },
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--small" + (s.mine ? " mp-btn--ghost" : " mp-btn--accent"),
              onClick: function () {
                writeReview(item);
              },
            },
            h(Ic, { name: s.mine ? "edit" : "star", size: 14 }),
            s.mine ? "Edit your review" : "Write a review"
          ),
          summary.count > 1
            ? h(Dropdown, {
                float: true,
                icon: "sort",
                label: "Sort",
                value: sort[0],
                onChange: setSort,
                options: [
                  { value: "helpful", label: "Most helpful" },
                  { value: "new", label: "Newest" },
                ],
              })
            : null
        )
      ),
      s.error
        ? h("p", { className: "mp-muted" }, s.error)
        : !s.reviews
          ? h("div", { className: "mp-reviews-loading" }, h("i", { className: "mp-spinner" }))
          : !s.reviews.length
            ? h("p", { className: "mp-muted" }, "No reviews yet. Be the first.")
            : h(
                "div",
                { className: "mp-review-list" },
                s.reviews.map(function (r, i) {
                  return h(ReviewCard, { key: r.id, review: r, item: item, index: i, canReply: s.canReply });
                })
              ),
      s.next
        ? h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--ghost mp-btn--small mp-reviews-more",
              onClick: more,
              disabled: loadingMore[0],
            },
            loadingMore[0] ? h("i", { className: "mp-spinner" }) : null,
            "Show more"
          )
        : null,
      h(
        "p",
        { className: "mp-muted mp-reviews-note" },
        "Reviews come from Discord accounts that are at least a week old, one per account and item. Nobody checks whether a reviewer used it. Answers marked Author come from the GitHub account that owns its repository."
      )
    );
  }

  var NOTICE_ICON = {
    removed: "eye-off",
    restored: "undo",
    banned: "block",
    unbanned: "check",
    "report-decision": "flag",
    "appeal-rejected": "warning",
  };

  function NoticeItem(props) {
    var R = SpotiKit.React;
    var n = props.notice;
    var open = R.useState(!n.read);
    var fold = R.useRef(null);
    var b = n.body;
    R.useEffect(
      function () {
        if (fold.current) fold.current.inert = !open[0];
      },
      [open[0]]
    );
    var line = function (label, text) {
      return text ? h(R.Fragment, null, h("dt", null, label), h("dd", null, text)) : null;
    };
    return h(
      "li",
      { className: "mp-notice" + (n.read ? "" : " is-new") + (open[0] ? " is-open" : "") },
      h(
        "button",
        {
          type: "button",
          className: "mp-notice-head",
          "aria-expanded": open[0],
          onClick: function () {
            open[1](!open[0]);
            if (!n.read) M.account.readNotice(n.id).catch(function () {});
          },
        },
        h(Ic, { name: NOTICE_ICON[n.kind] || "info", size: 14 }),
        h("b", null, n.title),
        h("span", { className: "mp-muted" }, when(n.createdAt)),
        h(Ic, { name: "chevron-right", size: 14, className: "mp-notice-chevron" })
      ),
      h(
        "div",
        { className: "mp-notice-fold", ref: fold },
        h(
            "div",
            { className: "mp-notice-body" },
            h(
              "dl",
              { className: "mp-facts" },
              line("What", b.content),
              line("Why", b.ground ? b.ground + (b.basis ? " (" + b.basis + ")" : "") : null),
              line("Facts", b.facts),
              line(
                "Based on",
                b.action === "removed" || b.action === "banned"
                  ? b.basedOnReport
                    ? "A report from someone else"
                    : "Our own check"
                  : null
              ),
              line("Where", b.scope),
              line("How long", b.duration),
              line("Automated", b.action === "removed" || b.action === "banned" ? "No, a person decided" : null)
            ),
            b.remedies ? h("p", { className: "mp-muted" }, b.remedies) : null,
            n.canAppeal
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "mp-btn mp-btn--small",
                    onClick: function () {
                      form({
                        title: "Ask for a review",
                        icon: "undo",
                        message: "Someone looks at the decision again. You can ask once.",
                        fields: [
                          {
                            id: "text",
                            type: "textarea",
                            required: true,
                            minLength: 10,
                            maxLength: 2000,
                            placeholder: "Why should it come back?",
                          },
                        ],
                        confirmLabel: "Send",
                        onSubmit: function (v) {
                          return M.account.appeal(n.id, v.text).then(function () {
                            notify("Sent. You'll get the answer here.");
                            props.onChange();
                          });
                        },
                      });
                    },
                  },
                  h(Ic, { name: "undo", size: 14 }),
                  "Ask for a review"
                )
              : n.appealed
                ? h("span", { className: "mp-pill" }, "Review requested")
                : null
          )
      )
    );
  }

  function AccountCard(props) {
    var R = SpotiKit.React;
    var me = R.useState(null);
    var error = R.useState(null);
    var closing = R.useState(false);
    var entered = useEntered();
    var config = R.useState(null);
    var linking = R.useState(false);
    var load = function () {
      M.account.me().then(me[1], function (e) {
        error[1](e.message);
      });
    };
    R.useEffect(function () {
      load();
      M.account.config().then(config[1], function () {});
      var onKey = function (e) {
        if (e.key === "Escape") close();
      };
      var onFocus = function () {
        load();
      };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("focus", onFocus);
      return function () {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("focus", onFocus);
      };
    }, []);
    var close = function () {
      closing[1](true);
      props.onDone();
    };
    var user = (me[0] && me[0].user) || M.account.user;
    var notices = me[0] ? me[0].notices : [];
    var after = function (run) {
      return function () {
        close();
        setTimeout(run, 320);
      };
    };
    return h(
      "div",
      { className: "mp-confirm-backdrop" + (closing[0] ? " is-closing" : ""), onMouseDown: close },
      h(
        "div",
        {
          className: "mp-confirm mp-account" + (entered ? "" : " is-pre"),
          role: "dialog",
          "aria-label": "Your SpotiKit account",
          onMouseDown: function (e) {
            e.stopPropagation();
          },
        },
        h(Avatar, { name: user ? user.name : "?", src: user && user.avatar, large: true }),
        h("b", null, user ? user.name : "Your account"),
        h("p", null, "Signed in with Discord" +
            (user ? " since " + new Date(user.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "")),
        user && user.banned
          ? h(
              "p",
              { className: "mp-form-error" },
              "You can't post right now" +
                (user.banned.until ? " (until " + new Date(user.banned.until).toLocaleString() + ")" : "") +
                ". The message below says why."
            )
          : null,
        user && !user.termsAccepted
          ? h(
              "div",
              { className: "mp-account-terms" },
              h(
                "span",
                null,
                "The terms of use changed. ",
                legalLink("Read them", "/terms"),
                ", then accept to keep posting."
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--small mp-btn--accent",
                  onClick: function () {
                    M.account.acceptTerms().then(load, fail);
                  },
                },
                "Accept"
              )
            )
          : null,
        error[0] ? h("p", { className: "mp-form-error" }, error[0]) : null,
        h(
          "div",
          { className: "mp-account-section" },
          h("h4", null, "Messages"),
          !me[0]
            ? h("i", { className: "mp-spinner" })
            : notices.length
              ? h(
                  "ul",
                  { className: "mp-notices" },
                  notices.map(function (n) {
                    return h(NoticeItem, { key: n.id, notice: n, onChange: load });
                  })
                )
              : h(
                  "p",
                  { className: "mp-muted" },
                  "Nothing here. Decisions about your reviews, profiles and reports show up here."
                )
        ),
        me[0] && config[0] && config[0].github
          ? h(
              "div",
              { className: "mp-account-section" },
              h("h4", null, "Creator"),
              user.github
                ? h(
                    "p",
                    { className: "mp-muted" },
                    "Linked to ",
                    h("b", null, user.github),
                    " on GitHub. You can answer reviews of everything from its repositories and from organizations it's a public member of."
                  )
                : h(
                    "p",
                    { className: "mp-muted" },
                    "Made a theme, extension or app? Link the GitHub account that owns its repository to answer its reviews. SpotiKit keeps only the account's name and ID."
                  ),
              h(
                "div",
                { className: "mp-account-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "mp-btn mp-btn--small" + (user.github ? " mp-btn--ghost" : ""),
                    disabled: linking[0],
                    onClick: function () {
                      linking[1](true);
                      (user.github
                        ? M.account.unlinkGithub().then(me[1])
                        : M.account.linkGithub().then(function () {
                            notify("Finish linking in your browser, then come back here.", { duration: 7000 });
                          })
                      )
                        .catch(fail)
                        .finally(function () {
                          linking[1](false);
                        });
                    },
                  },
                  linking[0]
                    ? h("i", { className: "mp-spinner" })
                    : h(Ic, { name: user.github ? "x" : "link", size: 14 }),
                  user.github ? "Unlink GitHub" : "Link GitHub"
                )
              )
            )
          : null,
        me[0]
          ? h(
              "div",
              { className: "mp-account-section" },
              h("h4", null, "Yours"),
              h(
                "p",
                { className: "mp-muted" },
                me[0].reviews.length +
                  (me[0].reviews.length === 1 ? " review" : " reviews") +
                  ", " +
                  me[0].profiles.length +
                  " shared " +
                  (me[0].profiles.length === 1 ? "profile" : "profiles")
              )
            )
          : null,
        h(
          "div",
          { className: "mp-account-actions" },
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--small mp-btn--ghost",
              onClick: function () {
                M.account.exportData().then(function () {
                  notify("Saved spotikit-account.json");
                }, fail);
              },
            },
            h(Ic, { name: "download", size: 14 }),
            "Download my data"
          ),
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--small mp-btn--ghost",
              onClick: after(function () {
                M.account.signOut().then(function () {
                  notify("Signed out");
                });
              }),
            },
            "Sign out"
          ),
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--small mp-btn--ghost mp-btn--danger-text",
              onClick: after(function () {
                ask({
                  title: "Delete your SpotiKit account?",
                  icon: "trash",
                  tone: "danger",
                  message:
                    "Your reviews, shared profiles and messages are deleted from SpotiKit's server right away. What you installed and your local setup profiles stay.",
                  confirmLabel: "Delete account",
                  confirmIcon: "trash",
                }).then(function (yes) {
                  if (!yes) return;
                  M.account.deleteAccount().then(function () {
                    notify("Your account is deleted");
                  }, fail);
                });
              }),
            },
            h(Ic, { name: "trash", size: 14 }),
            "Delete account"
          )
        ),
        h(
          "p",
          { className: "mp-account-legal" },
          legalLink("Terms of use", "/terms"),
          " · ",
          legalLink("Privacy", "/privacy"),
          " · ",
          legalLink("Imprint", "/imprint")
        )
      )
    );
  }

  function showAccount() {
    var host = document.createElement("div");
    host.id = "spotikit-mp-account";
    document.body.appendChild(host);
    var cleanup = null;
    cleanup = internal.renderInto(
      host,
      h(AccountCard, {
        onDone: function () {
          setTimeout(function () {
            if (cleanup) cleanup();
            host.remove();
          }, 300);
        },
      })
    );
  }

  function AccountButton() {
    var R = SpotiKit.React;
    var tick = R.useReducer(function (x) {
      return x + 1;
    }, 0)[1];
    var unread = R.useState(0);
    R.useEffect(function () {
      var offs = [
        M.on("account", tick),
        M.on("notices", function (list) {
          unread[1](
            (list || []).filter(function (n) {
              return !n.read;
            }).length
          );
        }),
      ];
      if (M.account.user) M.account.me().catch(function () {});
      return function () {
        offs.forEach(function (off) {
          off();
        });
      };
    }, []);
    if (!M.account.available) return null;
    var user = M.account.user;
    if (M.account.signingIn)
      return h(
        Tip,
        { label: "Finish in your browser, or click to cancel" },
        h(
          "button",
          {
            type: "button",
            className: "mp-account-btn",
            onClick: function () {
              M.account.cancelSignIn();
            },
          },
          h("i", { className: "mp-spinner" }),
          "Waiting for Discord"
        )
      );
    if (!user)
      return h(
        "button",
        {
          type: "button",
          className: "mp-account-btn",
          onClick: function () {
            signIn();
          },
        },
        h(Ic, { name: "user" }),
        "Sign in"
      );
    return h(
      Tip,
      { label: unread[0] ? unread[0] + (unread[0] === 1 ? " new message" : " new messages") : "Your account" },
      h(
        "button",
        { type: "button", className: "mp-account-btn is-in", onClick: showAccount },
        h(Avatar, { name: user.name, src: user.avatar }),
        h("span", null, user.name),
        unread[0] ? h("span", { className: "mp-count mp-count--alert" }, unread[0]) : null
      )
    );
  }

  function Spring(dampingRatio, stiffness) {
    this.dampingRatio = dampingRatio;
    this.stiffness = stiffness;
    this.value = 0;
    this.velocity = 0;
    this.target = 0;
  }
  Spring.prototype.settled = function () {
    return Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.005;
  };
  Spring.prototype.snap = function (value) {
    this.value = this.target = value;
    this.velocity = 0;
  };
  Spring.prototype.step = function (dt) {
    var damping = 2 * this.dampingRatio * Math.sqrt(this.stiffness);
    var h = dt / 4;
    for (var i = 0; i < 4; i++) {
      var acceleration = -this.stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
    }
  };

  var TOGGLE_WIDTH = 64;
  var TOGGLE_HEIGHT = 28;
  var TOGGLE_KNOB = 40;
  var TOGGLE_PRESSED = 1.5;

  function clampTo(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function toggleGeometry() {
    var dpr = window.devicePixelRatio || 1;
    var inset = Math.max(1, Math.round(2 * dpr)) / dpr;
    return { inset: inset, height: TOGGLE_HEIGHT - 2 * inset, travel: TOGGLE_WIDTH - 2 * inset - TOGGLE_KNOB };
  }

  function LiquidToggle(props) {
    var R = SpotiKit.React;
    var btn = R.useRef(null);
    var knob = R.useRef(null);
    var lens = R.useRef(null);
    var surface = R.useRef(null);
    var rim = R.useRef(null);
    var latest = R.useRef(props);
    latest.current = props;
    var ref = R.useRef(null);
    if (!ref.current) {
      ref.current = {
        value: new Spring(1, 1000),
        velocity: new Spring(0.5, 300),
        press: new Spring(1, 1000),
        scaleX: new Spring(0.6, 250),
        scaleY: new Spring(0.7, 250),
        frame: 0,
        lastFrame: 0,
        releasePending: false,
        dragging: false,
        dragged: false,
        dragFraction: 0,
        startX: 0,
        lastX: 0,
        pending: null,
      };
      ref.current.value.snap(props.checked ? 1 : 0);
      ref.current.scaleX.snap(1);
      ref.current.scaleY.snap(1);
    }
    var st = ref.current;

    var paint = function () {
      if (!btn.current || !knob.current || !lens.current || !surface.current || !rim.current) return;
      var fraction = clampTo(st.value.value, 0, 1);
      var pressed = clampTo(st.press.value, 0, 1);
      var speed = Math.abs(st.velocity.value) / 50;
      var sx = st.scaleX.value / (1 - clampTo(speed * 0.75, 0, 0.2));
      var sy = st.scaleY.value * (1 - clampTo(speed * 0.25, 0, 0.2));
      var g = toggleGeometry();
      var x = g.inset + fraction * g.travel;
      btn.current.style.setProperty("--f", String(fraction));
      knob.current.style.top = g.inset + "px";
      knob.current.style.height = g.height + "px";
      knob.current.style.transform = "translateX(" + x + "px) scale(" + sx + ", " + sy + ")";
      lens.current.style.left = -x + "px";
      lens.current.style.top = -g.inset + "px";
      lens.current.style.transformOrigin = x + TOGGLE_KNOB / 2 + "px " + (g.inset + g.height / 2) + "px";
      lens.current.style.transform = "scale(" + (1 - 0.25 * pressed) + ")";
      surface.current.style.opacity = String(1 - pressed);
      rim.current.style.opacity = String(pressed);
    };

    var commit = function () {
      var next = st.pending;
      st.pending = null;
      if (next === null || next === latest.current.checked) return;
      latest.current.onChange(next);
    };

    var rest = function () {
      [st.value, st.velocity, st.press, st.scaleX, st.scaleY].forEach(function (spring) {
        spring.snap(spring.target);
      });
      paint();
      if (knob.current) knob.current.style.willChange = "";
    };

    var onFrame = function (time) {
      var dt = st.lastFrame ? clampTo((time - st.lastFrame) / 1000, 0, 0.05) : 1 / 60;
      st.lastFrame = time;
      st.value.step(dt);
      st.velocity.target = st.value.velocity;
      st.velocity.step(dt);
      st.press.step(dt);
      st.scaleX.step(dt);
      st.scaleY.step(dt);
      if (st.releasePending && !st.dragging && Math.abs(st.value.value - st.value.target) < 0.025) {
        st.releasePending = false;
        st.press.target = 0;
        st.scaleX.target = 1;
        st.scaleY.target = 1;
      }
      paint();
      if (
        st.pending !== null &&
        !st.dragging &&
        !st.releasePending &&
        Math.abs(st.value.value - st.value.target) < 0.005 &&
        st.press.value < 0.01 &&
        Math.abs(st.scaleX.value - 1) < 0.01 &&
        Math.abs(st.scaleY.value - 1) < 0.01
      ) {
        commit();
      }
      var settled =
        st.value.settled() &&
        st.velocity.settled() &&
        st.press.settled() &&
        st.scaleX.settled() &&
        st.scaleY.settled() &&
        !st.releasePending;
      st.frame = settled || !btn.current ? 0 : requestAnimationFrame(onFrame);
      if (!st.frame) {
        rest();
        commit();
      }
    };

    var animate = function () {
      if (st.frame) return;
      if (knob.current) knob.current.style.willChange = "transform";
      st.lastFrame = 0;
      st.frame = requestAnimationFrame(onFrame);
    };
    var press = function () {
      st.releasePending = false;
      st.press.target = 1;
      st.scaleX.target = TOGGLE_PRESSED;
      st.scaleY.target = TOGGLE_PRESSED;
      animate();
    };
    var release = function () {
      st.releasePending = true;
      animate();
    };
    var animateTo = function (checked) {
      press();
      st.value.target = checked ? 1 : 0;
      release();
    };

    R.useLayoutEffect(function () {
      paint();
      return function () {
        cancelAnimationFrame(st.frame);
        st.frame = 0;
        commit();
      };
    }, []);

    R.useEffect(
      function () {
        if (st.pending !== null || st.value.target >= 0.5 === !!props.checked) return;
        animateTo(!!props.checked);
      },
      [props.checked]
    );

    var endDrag = function () {
      if (!st.dragging) return;
      st.dragging = false;
      var current = st.pending !== null ? st.pending : !!latest.current.checked;
      var next = st.dragged ? st.value.target >= 0.5 : !current;
      st.value.target = next ? 1 : 0;
      st.pending = next;
      release();
    };

    return h(
      "button",
      {
        ref: btn,
        type: "button",
        role: "switch",
        "aria-checked": !!props.checked,
        "aria-label": props.label,
        className: "mp-toggle",
        onPointerDown: function (e) {
          if (e.button !== 0) return;
          e.stopPropagation();
          try {
            btn.current.setPointerCapture(e.pointerId);
          } catch (err) {}
          st.dragging = true;
          st.dragged = false;
          st.dragFraction = st.value.target;
          st.startX = st.lastX = e.clientX;
          press();
        },
        onPointerMove: function (e) {
          if (!st.dragging) return;
          if (!st.dragged && Math.abs(e.clientX - st.startX) < 3) return;
          var dx = e.clientX - st.lastX;
          st.lastX = e.clientX;
          if (!dx) return;
          st.dragged = true;
          st.dragFraction = clampTo(st.dragFraction + dx / toggleGeometry().travel, 0, 1);
          st.value.target = st.dragFraction;
          animate();
        },
        onPointerUp: function (e) {
          endDrag();
          try {
            btn.current.releasePointerCapture(e.pointerId);
          } catch (err) {}
        },
        onPointerCancel: endDrag,
        onLostPointerCapture: endDrag,
        onClick: function (e) {
          e.stopPropagation();
          if (e.detail !== 0) return;
          var next = !(st.pending !== null ? st.pending : !!props.checked);
          st.pending = next;
          animateTo(next);
        },
      },
      h("span", { className: "mp-toggle-track", "aria-hidden": "true" }),
      h(
        "span",
        { ref: knob, className: "mp-toggle-knob", "aria-hidden": "true" },
        h("span", { className: "mp-toggle-lens" }, h("span", { ref: lens })),
        h("span", { ref: surface, className: "mp-toggle-surface" }),
        h("span", { ref: rim, className: "mp-toggle-rim" })
      )
    );
  }

  function shareProfile(local) {
    var items = M.shared.itemsOf(local.id);
    if (!items.length) {
      fail(
        new Error(
          "Turn on at least one Marketplace item in " +
            local.name +
            " to share it. Own snippets and local themes stay private."
        )
      );
      return Promise.resolve(null);
    }
    return signIn("Shared profiles are tied to an account.").then(function (user) {
      if (!user) return null;
      var existing = M.shared.sharedIdOf(local.id);
      return form({
        title: existing ? "Update the shared " + local.name : "Share " + local.name,
        icon: "share",
        message: items
          .map(function (i) {
            return i.name;
          })
          .join(", "),
        fields: [
          { id: "name", label: "Name", value: local.name, required: true, minLength: 3, maxLength: 60 },
          {
            id: "description",
            type: "textarea",
            label: "Description",
            maxLength: 500,
            placeholder: "What's it for? (optional)",
          },
        ],
        footnote:
          "Everyone can see it with your Discord name and picture. Only Marketplace items are shared, never your own snippets or local themes.",
        confirmLabel: existing ? "Update" : "Share",
        confirmIcon: "share",
        onSubmit: function (v) {
          return M.shared.share(local.id, v.name, v.description, existing).catch(function (e) {
            if (existing && e.status === 404) return M.shared.share(local.id, v.name, v.description, null);
            throw e;
          });
        },
      }).then(function (shared) {
        if (!shared || shared === true) return;
        var link = M.shared.link(shared.id);
        navigator.clipboard.writeText(link).then(
          function () {
            notify("Shared. The link is copied: " + link, { duration: 7000 });
          },
          function () {
            notify("Shared: " + link, { duration: 9000 });
          }
        );
      });
    });
  }

  function useShared(shared) {
    var installedMap = M.installed();
    var code = shared.items.filter(function (i) {
      var item =
        M.catalog &&
        M.catalog.items.find(function (x) {
          return x.id === i.id;
        });
      return !installedMap[i.id] && item && runsCode(item);
    });
    var missing = shared.items.filter(function (i) {
      return !installedMap[i.id];
    });
    var points = shared.items.map(function (i) {
      return {
        icon: installedMap[i.id] ? "check" : "download",
        text: i.name + (installedMap[i.id] ? " (installed)" : ""),
      };
    });
    if (code.length)
      points.unshift({
        icon: "warning",
        tone: "warn",
        text:
          code
            .map(function (i) {
              return i.name;
            })
            .join(", ") + " run code inside Spotify, signed in as you. Only go on if you trust their authors.",
      });
    return ask({
      title: "Use " + shared.name + "?",
      icon: "equalizer",
      message:
        (missing.length ? missing.length + " item" + (missing.length === 1 ? " gets" : "s get") + " installed. " : "") +
        "It's saved as a setup profile; switching to it turns off what isn't in it.",
      points: points,
      confirmLabel: missing.length ? "Install and save" : "Save",
      confirmIcon: "download",
    })
      .then(function (yes) {
        if (!yes) return null;
        notify(
          missing.length
            ? "Installing " + missing.length + " item" + (missing.length === 1 ? "" : "s") + "…"
            : "Saving…"
        );
        return M.shared.use(shared).then(function (result) {
          if (result.failed.length)
            notify("Not installed: " + result.failed.join(" · "), { type: "error", duration: 9000 });
          return ask({
            title: result.profile.name + " is saved",
            icon: "check",
            message: "Switch to it now? You can always switch back from the menu under your profile picture.",
            confirmLabel: "Switch now",
            cancelLabel: "Later",
          }).then(function (now) {
            if (!now) return;
            return M.profiles.apply(result.profile.id).then(function () {
              notify(result.profile.name + " is on");
            });
          });
        });
      })
      .catch(fail);
  }

  function openShared(id) {
    return M.shared.get(id).then(function (profile) {
      if (pageApi.openShared) pageApi.openShared(profile);
      else useShared(profile);
    }, fail);
  }

  var SHARED_GROUPS = [
    { kind: "theme", label: "Theme" },
    { kind: "extension", label: "Extensions" },
    { kind: "app", label: "Custom apps" },
    { kind: "snippet", label: "Snippets" },
    { kind: "other", label: "Other" },
  ];

  function SharedSheet(props) {
    var R = SpotiKit.React;
    var p = props.profile;
    var closing = R.useState(false);
    var entered = useEntered();
    var close = function () {
      closing[1](true);
      setTimeout(props.onClose, 320);
    };
    R.useEffect(function () {
      var onKey = function (e) {
        if (e.key !== "Escape") return;
        if (document.querySelectorAll(".mp-sheet-backdrop, .mp-confirm-backdrop").length > 1) return;
        close();
      };
      window.addEventListener("keydown", onKey);
      return function () {
        window.removeEventListener("keydown", onKey);
      };
    }, []);
    var installedMap = M.installed();
    var catalogItems = M.catalog ? M.catalog.items : [];
    var rows = p.items.map(function (ref) {
      var item = catalogItems.find(function (x) {
        return x.id === ref.id;
      });
      return { ref: ref, item: item || null, kind: item ? item.kind : "other", installed: !!installedMap[ref.id] };
    });
    var withPreview =
      rows.find(function (r) {
        return r.kind === "theme" && r.item && r.item.preview;
      }) ||
      rows.find(function (r) {
        return r.item && r.item.preview;
      });
    var installedCount = rows.filter(function (r) {
      return r.installed;
    }).length;
    var code = rows.filter(function (r) {
      return !r.installed && r.item && runsCode(r.item);
    });
    var detail = function (label, value) {
      return h("div", { className: "mp-shared-fact" }, h("span", null, label), h("b", null, value));
    };
    return h(
      "div",
      { className: "mp-sheet-backdrop" + (closing[0] ? " is-closing" : ""), onMouseDown: close },
      h(
        "div",
        { className: "mp-sheet-row" },
        h(
          "div",
          {
            className: "mp-sheet-frame" + (entered ? "" : " is-pre"),
            onMouseDown: function (e) {
              e.stopPropagation();
            },
          },
          h(
            "section",
            { className: "mp-sheet" + (entered ? "" : " is-pre"), role: "dialog", "aria-label": p.name },
            h(
              Scroll,
              { className: "mp-sheet-scroll" },
              h(
                "div",
                { className: "mp-sheet-hero" },
                h(Preview, { src: withPreview ? withPreview.item.preview : null, name: p.name }),
                h(
                  "div",
                  { className: "mp-sheet-title" },
                  h("span", { className: "mp-kind" }, "Setup profile · Shared"),
                  h("h2", null, p.name),
                  h(
                    "span",
                    { className: "mp-authors" },
                    h(Avatar, { name: p.author.name, src: p.author.avatar }),
                    p.author.name,
                    h(
                      Tip,
                      { label: "Copy a link to share" },
                      h(
                        "button",
                        {
                          type: "button",
                          className: "mp-share-btn",
                          "aria-label": "Copy a link to share",
                          onClick: function () {
                            copyText(M.shared.link(p.id)).then(function () {
                              notify("Link copied. It opens " + p.name + " in the SpotiKit Marketplace.");
                            }, fail);
                          },
                        },
                        h(Ic, { name: "share", size: 13 })
                      )
                    ),
                    !props.own && M.account.available
                      ? h(
                          Tip,
                          { label: "Report" },
                          h(
                            "button",
                            {
                              type: "button",
                              className: "mp-share-btn",
                              "aria-label": "Report this profile",
                              onClick: function () {
                                reportContent("profile", p.id, "“" + p.name + "”");
                              },
                            },
                            h(Ic, { name: "flag", size: 12 })
                          )
                        )
                      : null
                  ),
                  h(
                    "p",
                    null,
                    rows.length + (rows.length === 1 ? " item" : " items") + " · used " + p.imports + "×"
                  ),
                  p.hidden
                    ? h("span", { className: "mp-pill mp-pill--danger" }, "Removed")
                    : h(
                        "div",
                        { className: "mp-sheet-actions" },
                        h(
                          "button",
                          {
                            type: "button",
                            className: "mp-btn mp-btn--accent",
                            onClick: function () {
                              useShared(p);
                            },
                          },
                          h(Ic, { name: "download" }),
                          "Use"
                        )
                      )
                )
              ),
              h(
                "div",
                { className: "mp-sheet-grid" },
                h(
                  "div",
                  { className: "mp-sheet-main" },
                  code.length
                    ? h(
                        "div",
                        { className: "mp-note mp-note--warn" },
                        h(Ic, { name: "warning" }),
                        h(
                          "div",
                          null,
                          h("b", null, "Some of it runs code"),
                          h(
                            "span",
                            null,
                            code
                              .map(function (r) {
                                return r.ref.name;
                              })
                              .join(", ") + " run code inside Spotify, signed in as you. Only use this profile if you trust their authors."
                          )
                        )
                      )
                    : null,
                  h("h4", null, "About"),
                  p.description
                    ? h("p", { className: "mp-shared-about" }, p.description)
                    : h("p", { className: "mp-shared-about mp-muted" }, p.author.name + " didn't write a description."),
                  h("h4", null, "What's in it"),
                  SHARED_GROUPS.map(function (group) {
                    var list = rows.filter(function (r) {
                      return r.kind === group.kind;
                    });
                    if (!list.length) return null;
                    return h(
                      "div",
                      { key: group.kind, className: "mp-shared-group" },
                      h("span", { className: "mp-shared-group-label" }, group.label),
                      h(
                        "ul",
                        { className: "mp-shared-list" },
                        list.map(function (r, i) {
                          var body = [
                            r.item && r.item.preview
                              ? h("img", { key: "img", src: r.item.preview, alt: "", loading: "lazy" })
                              : h("span", { key: "img", className: "mp-shared-thumb" }, r.ref.name.slice(0, 1)),
                            h(
                              "span",
                              { key: "text", className: "mp-shared-name" },
                              h("b", null, r.ref.name),
                              r.ref.scheme ? h("span", null, "Scheme: " + r.ref.scheme) : null
                            ),
                            r.installed
                              ? h(
                                  "span",
                                  { key: "state", className: "mp-tag is-installed" },
                                  h(Ic, { name: "check", size: 10 }),
                                  "Installed"
                                )
                              : null,
                          ];
                          return h(
                            "li",
                            { key: r.ref.id, style: { "--i": Math.min(i, 10) } },
                            r.item && props.onOpenItem
                              ? h(
                                  "button",
                                  {
                                    type: "button",
                                    onClick: function () {
                                      props.onOpenItem(r.item);
                                    },
                                  },
                                  body
                                )
                              : h("div", null, body)
                          );
                        })
                      )
                    );
                  })
                ),
                h(
                  "aside",
                  { className: "mp-sheet-side" },
                  h(
                    "div",
                    { className: "mp-panel" },
                    h("h4", null, "Details"),
                    detail("Items", String(rows.length)),
                    detail("Installed", installedCount + " of " + rows.length),
                    detail("Used", p.imports + "×"),
                    p.createdAt ? detail("Shared", when(p.createdAt)) : null,
                    p.updatedAt ? detail("Updated", when(p.updatedAt)) : null
                  )
                )
              )
            )
          )
        )
      )
    );
  }

  function SharedTab(props) {
    var R = SpotiKit.React;
    var sort = R.useState("popular");
    var state = R.useState({ list: null, total: 0, error: null });
    var page = R.useState(0);
    var mine = R.useState([]);
    var q = props.query;
    var load = function () {
      M.shared.list(sort[0], q, 0).then(
        function (r) {
          page[1](0);
          state[1]({ list: r.profiles, total: r.total, error: null });
        },
        function (e) {
          state[1]({ list: [], total: 0, error: e.message });
        }
      );
      if (M.account.user) M.shared.mine().then(mine[1], function () {});
      else mine[1]([]);
    };
    R.useEffect(
      function () {
        var t = setTimeout(load, q ? 300 : 0);
        return function () {
          clearTimeout(t);
        };
      },
      [sort[0], q]
    );
    R.useEffect(function () {
      var offs = [M.on("shared", load), M.on("account", load)];
      return function () {
        offs.forEach(function (off) {
          off();
        });
      };
    }, []);
    var more = function () {
      M.shared.list(sort[0], q, page[0] + 1).then(function (r) {
        page[1](page[0] + 1);
        state[1](Object.assign({}, state[0], { list: state[0].list.concat(r.profiles) }));
      }, fail);
    };
    var s = state[0];
    var card = function (p, i, own) {
      return h(
        "article",
        {
          key: p.id,
          className: "mp-shared" + (p.hidden ? " is-hidden" : ""),
          style: { "--i": Math.min(i, 12) },
          onClick: function (e) {
            if (e.target.closest("button, a")) return;
            if (props.onOpen) props.onOpen(p, own);
          },
        },
        h(
          "div",
          { className: "mp-shared-top" },
          h(Avatar, { name: p.author.name, src: p.author.avatar }),
          h(
            "div",
            { className: "mp-shared-title" },
            h("b", null, p.name),
            h("span", { className: "mp-muted" }, "by " + p.author.name + " · " + when(p.updatedAt))
          )
        ),
        p.description ? h("p", { className: "mp-shared-desc" }, p.description) : null,
        h(
          "div",
          { className: "mp-shared-items" },
          p.items.slice(0, 6).map(function (it) {
            return h(
              "span",
              { key: it.id, className: "mp-tag" + (M.installed()[it.id] ? " is-installed" : "") },
              M.installed()[it.id] ? h(Ic, { name: "check", size: 10 }) : null,
              it.name
            );
          }),
          p.items.length > 6 ? h("span", { className: "mp-tag" }, "+" + (p.items.length - 6)) : null
        ),
        h(
          "div",
          { className: "mp-shared-foot" },
          h(
            "span",
            { className: "mp-muted" },
            p.items.length + (p.items.length === 1 ? " item" : " items") + " · used " + p.imports + "×"
          ),
          p.hidden ? h("span", { className: "mp-pill mp-pill--danger" }, "Removed") : null,
          h(
            "div",
            { className: "mp-row-actions" },
            own
              ? h(
                  R.Fragment,
                  null,
                  h(
                    Tip,
                    { label: "Copy link" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "mp-icon-btn",
                        "aria-label": "Copy link",
                        onClick: function () {
                          navigator.clipboard.writeText(M.shared.link(p.id)).then(function () {
                            notify("Link copied");
                          }, fail);
                        },
                      },
                      h(Ic, { name: "link", size: 14 })
                    )
                  ),
                  h(
                    Tip,
                    { label: "Stop sharing" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "mp-icon-btn",
                        "aria-label": "Stop sharing",
                        onClick: function () {
                          confirmAndRun(
                            "Stop sharing " + p.name + "?",
                            "It's deleted from SpotiKit's server. Your local profile stays.",
                            "Remove",
                            function () {
                              return M.shared.remove(p.id);
                            }
                          );
                        },
                      },
                      h(Ic, { name: "trash", size: 14 })
                    )
                  )
                )
              : h(
                  Tip,
                  { label: "Report" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "mp-icon-btn",
                      "aria-label": "Report this profile",
                      onClick: function () {
                        reportContent("profile", p.id, "“" + p.name + "”");
                      },
                    },
                    h(Ic, { name: "flag", size: 13 })
                  )
                ),
            p.hidden
              ? null
              : h(
                  "button",
                  {
                    type: "button",
                    className: "mp-btn mp-btn--small mp-btn--accent",
                    onClick: function () {
                      useShared(p);
                    },
                  },
                  "Use"
                )
          )
        )
      );
    };
    return h(
      R.Fragment,
      null,
      h(
        "div",
        { className: "mp-shared-head" },
        h(
          "p",
          { className: "mp-muted" },
          "Setup profiles other people shared: which themes, extensions and snippets they use together. Share your own from Installed, next to each profile."
        ),
        h(Dropdown, {
          icon: "sort",
          label: "Sort",
          value: sort[0],
          onChange: sort[1],
          options: [
            { value: "popular", label: "Most used" },
            { value: "new", label: "Newest" },
          ],
        })
      ),
      mine[0].length
        ? h(
            R.Fragment,
            null,
            h("h3", { className: "mp-section-title" }, "Shared by you"),
            h(
              "div",
              { className: "mp-shared-grid" },
              mine[0].map(function (p, i) {
                return card(p, i, true);
              })
            ),
            h("h3", { className: "mp-section-title" }, "Everyone")
          )
        : null,
      s.error
        ? h(Empty, { icon: "warning", title: "Couldn't load shared profiles", text: s.error })
        : !s.list
          ? h(SkeletonGrid)
          : !s.list.length
            ? h(Empty, {
                icon: "equalizer",
                title: q ? "Nothing matches “" + q + "”" : "Nothing shared yet",
                text: q ? "Try another word." : "Be the first: share a setup profile from the Installed tab.",
              })
            : h(
                "div",
                { className: "mp-shared-grid" },
                s.list.map(function (p, i) {
                  return card(p, i, p.mine);
                })
              ),
      s.list && s.list.length < s.total
        ? h("button", { type: "button", className: "mp-btn mp-btn--ghost mp-reviews-more", onClick: more }, "Show more")
        : null
    );
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var HTML_TAG = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g;
  var BLOCK_TAGS =
    /^(address|article|aside|blockquote|center|details|dialog|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|picture|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/i;

  function inlineMarkdown(text) {
    var keep = [];
    var stash = function (html) {
      keep.push(html);
      return "\u0000" + (keep.length - 1) + "\u0000";
    };
    var out = String(text)
      .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) {
        return stash("<code>" + escapeHtml(code.trim()) + "</code>");
      })
      .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, function (m, url) {
        return stash('<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a>");
      })
      .replace(HTML_TAG, stash);
    out = escapeHtml(out)
      .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+&quot;([^)]*)&quot;)?\s*\)/g, function (m, alt, src, title) {
        return '<img src="' + src + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : "") + ">";
      })
      .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+&quot;[^)]*&quot;)?\s*\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g, '$1<a href="$2">$2</a>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
      .replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
      .replace(/(?: {2,}|\\)\n/g, "<br>");
    return out.replace(/\u0000(\d+)\u0000/g, function (m, n) {
      return keep[+n];
    });
  }

  function indentOf(line) {
    return /^\s*/.exec(line)[0].length;
  }

  var LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  var TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function startsBlock(line) {
    return (
      /^\s{0,3}(#{1,6}\s|```|~~~|>|<!--)/.test(line) ||
      /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) ||
      /^\s*([-*+]|1[.)])\s+/.test(line) ||
      isHtmlBlock(line)
    );
  }

  function isHtmlBlock(line) {
    var tag = /^\s{0,3}<\/?([a-zA-Z][\w-]*)/.exec(line);
    return !!tag && (BLOCK_TAGS.test(tag[1]) || !line.replace(HTML_TAG, "").trim());
  }

  function tableCells(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map(function (cell) {
        return cell.trim().replace(/\\\|/g, "|");
      });
  }

  function markdownBlocks(lines, tight) {
    var html = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }

      var fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        var code = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence[1]) !== 0) code.push(lines[i++]);
        i++;
        html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        continue;
      }
      if (/^\s{0,3}<!--/.test(line)) {
        while (i < lines.length && lines[i].indexOf("-->") < 0) i++;
        i++;
        continue;
      }
      if (isHtmlBlock(line)) {
        var raw = [];
        while (i < lines.length && lines[i].trim()) raw.push(lines[i++]);
        html.push(raw.join("\n"));
        continue;
      }
      var heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        html.push("<h" + heading[1].length + ">" + inlineMarkdown(heading[2]) + "</h" + heading[1].length + ">");
        i++;
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        html.push("<hr>");
        i++;
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        var quote = [];
        while (i < lines.length && lines[i].trim() && (/^\s{0,3}>/.test(lines[i]) || !startsBlock(lines[i]))) {
          quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
        }
        var alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(quote[0] || "");
        if (alert) {
          var kind = alert[1].toLowerCase();
          html.push(
            '<blockquote data-alert="' +
              kind +
              '"><p data-alert-title="">' +
              kind.charAt(0).toUpperCase() +
              kind.slice(1) +
              "</p>" +
              markdownBlocks(quote.slice(1)) +
              "</blockquote>"
          );
        } else {
          html.push("<blockquote>" + markdownBlocks(quote) + "</blockquote>");
        }
        continue;
      }
      if (line.indexOf("|") >= 0 && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        var head = tableCells(line);
        var aligns = tableCells(lines[i + 1]).map(function (rule) {
          return /^:-+:$/.test(rule) ? "center" : /-:$/.test(rule) ? "right" : /^:-/.test(rule) ? "left" : "";
        });
        var cell = function (tag, text, n) {
          return (
            "<" + tag + (aligns[n] ? ' align="' + aligns[n] + '"' : "") + ">" + inlineMarkdown(text) + "</" + tag + ">"
          );
        };
        var rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") >= 0) {
          rows.push(
            "<tr>" +
              tableCells(lines[i++])
                .map(function (text, n) {
                  return cell("td", text, n);
                })
                .join("") +
              "</tr>"
          );
        }
        html.push(
          "<table><thead><tr>" +
            head
              .map(function (text, n) {
                return cell("th", text, n);
              })
              .join("") +
            "</tr></thead><tbody>" +
            rows.join("") +
            "</tbody></table>"
        );
        continue;
      }
      var item = LIST_ITEM.exec(line);
      if (item) {
        var base = item[1].length;
        var ordered = /\d/.test(item[2]);
        var start = ordered ? parseInt(item[2], 10) : 1;
        var items = [];
        var loose = false;
        while (i < lines.length) {
          var m = LIST_ITEM.exec(lines[i]);
          if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
          var contentIndent = m[1].length + m[2].length + 1;
          var content = [m[3]];
          i++;
          while (i < lines.length) {
            var next = lines[i];
            if (!next.trim()) {
              if (i + 1 < lines.length && lines[i + 1].trim() && indentOf(lines[i + 1]) > base) {
                content.push("");
                loose = true;
                i++;
                continue;
              }
              break;
            }
            var sub = LIST_ITEM.exec(next);
            if (sub && sub[1].length <= base) break;
            if (indentOf(next) > base) {
              content.push(next.slice(Math.min(contentIndent, indentOf(next))));
              i++;
              continue;
            }
            if (!startsBlock(next)) {
              content.push(next.trim());
              i++;
              continue;
            }
            break;
          }
          items.push(content);
          if (
            i < lines.length &&
            !lines[i].trim() &&
            i + 1 < lines.length &&
            LIST_ITEM.test(lines[i + 1]) &&
            LIST_ITEM.exec(lines[i + 1])[1].length === base
          ) {
            loose = true;
            i++;
          }
        }
        var tag = ordered ? "ol" : "ul";
        html.push(
          "<" +
            tag +
            (ordered && start !== 1 ? ' start="' + start + '"' : "") +
            ">" +
            items
              .map(function (content) {
                var task = /^\[([ xX])\]\s+/.exec(content[0]);
                if (task) content[0] = content[0].slice(task[0].length);
                return (
                  "<li>" + (task ? (task[1] === " " ? "☐ " : "☑ ") : "") + markdownBlocks(content, !loose) + "</li>"
                );
              })
              .join("") +
            "</" +
            tag +
            ">"
        );
        continue;
      }

      var para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
        if (/^\s{0,3}(=+|-+)\s*$/.test(lines[i])) break;
        para.push(lines[i++]);
      }
      if (i < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[i]) && lines[i].trim()) {
        var level = lines[i].trim().charAt(0) === "=" ? 1 : 2;
        html.push("<h" + level + ">" + inlineMarkdown(para.join(" ")) + "</h" + level + ">");
        i++;
        continue;
      }
      var text = inlineMarkdown(
        para
          .map(function (l) {
            return l.replace(/^\s+/, "");
          })
          .join("\n")
      );
      html.push(tight ? text : "<p>" + text + "</p>");
    }
    return html.join("\n");
  }

  var ALLOWED =
    /^(a|abbr|b|blockquote|br|caption|center|code|dd|del|details|div|dl|dt|em|figcaption|figure|h[1-6]|hr|i|img|ins|kbd|li|mark|ol|p|picture|pre|q|s|samp|small|source|span|strike|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|tr|u|ul)$/;
  var DROPPED =
    /^(script|style|iframe|object|embed|form|input|button|textarea|select|option|svg|math|template|noscript|link|meta|base|frame|frameset|applet|canvas|audio|video|track|dialog|slot)$/;
  var VOID = /^(br|hr|img|source)$/;
  var NO_TEXT = /^(table|thead|tbody|tfoot|tr|ul|ol|picture|dl)$/;

  function slugger() {
    var seen = {};
    return function (text) {
      var base = String(text)
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
      var n = seen[base] || 0;
      seen[base] = n + 1;
      return n ? base + "-" + n : base;
    };
  }

  function safeUrl(value, base, kind) {
    if (!value) return null;
    var url;
    try {
      url = new URL(value.trim(), base);
    } catch (e) {
      return null;
    }
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    return kind === "link" && url.protocol === "mailto:" ? url.toString() : null;
  }

  function sizeStyle(el, style) {
    var w = el.getAttribute("width");
    var hgt = el.getAttribute("height");
    var px = function (v) {
      return /^\d+(\.\d+)?$/.test(v || "") ? v + "px" : /^\d+(\.\d+)?%$/.test(v || "") ? v : null;
    };
    if (px(w)) style.width = px(w);
    if (px(hgt) && !px(w)) style.height = px(hgt);
    if (/^\d+$/.test(w || "") && /^\d+$/.test(hgt || "")) style.aspectRatio = w + " / " + hgt;
  }

  function toReact(node, ctx, key) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (DROPPED.test(tag)) return null;
    var children = function () {
      var list = [];
      Array.prototype.forEach.call(node.childNodes, function (child, n) {
        if (NO_TEXT.test(tag) && child.nodeType === 3 && !child.nodeValue.trim()) return;
        list.push(toReact(child, ctx, n));
      });
      return list;
    };
    if (!ALLOWED.test(tag)) return h(SpotiKit.React.Fragment, { key: key }, children());

    var props = { key: key };
    var style = {};
    var align = (node.getAttribute("align") || "").toLowerCase();
    if (/^(left|right|center|justify)$/.test(align)) {
      if (tag === "img") style.float = align === "center" ? "none" : align;
      else style.textAlign = align;
    }
    var id = node.getAttribute("id") || node.getAttribute("name");
    if (id) props["data-anchor"] = id.toLowerCase();

    if (tag === "details") {
      var summary = null;
      var body = [];
      Array.prototype.forEach.call(node.childNodes, function (child, n) {
        if (!summary && child.nodeType === 1 && child.tagName.toLowerCase() === "summary")
          summary = Array.prototype.map.call(child.childNodes, function (c, m) {
            return toReact(c, ctx, m);
          });
        else body.push(toReact(child, ctx, n));
      });
      return h(Fold, { key: key, open: node.hasAttribute("open"), summary: summary || "Details" }, body);
    }
    if (/^h[1-6]$/.test(tag)) {
      props["data-anchor"] = ctx.slug(node.textContent);
    } else if (tag === "a") {
      var href = node.getAttribute("href") || "";
      if (href.charAt(0) === "#") {
        props.href = href;
      } else {
        var link = safeUrl(href, ctx.linkBase, "link");
        if (link) {
          props.href = link;
          props.target = "_blank";
          props.rel = "noreferrer noopener";
        }
      }
    } else if (tag === "img") {
      var src = safeUrl(node.getAttribute("src"), ctx.imageBase, "image");
      if (!src) return null;
      sizeStyle(node, style);
      return h(ReadmeImage, { key: key, src: src, alt: node.getAttribute("alt") || "", style: style });
    } else if (tag === "source") {
      var set = (node.getAttribute("srcset") || "")
        .split(",")
        .map(function (part) {
          var bits = part.trim().split(/\s+/);
          var url = safeUrl(bits[0], ctx.imageBase, "image");
          return url ? [url].concat(bits.slice(1)).join(" ") : null;
        })
        .filter(Boolean)
        .join(", ");
      if (!set) return null;
      props.srcSet = set;
      if (node.getAttribute("media")) props.media = node.getAttribute("media");
      if (node.getAttribute("type")) props.type = node.getAttribute("type");
    } else if (tag === "td" || tag === "th") {
      if (/^\d+$/.test(node.getAttribute("colspan") || "")) props.colSpan = +node.getAttribute("colspan");
      if (/^\d+$/.test(node.getAttribute("rowspan") || "")) props.rowSpan = +node.getAttribute("rowspan");
    } else if (tag === "ol" && /^\d+$/.test(node.getAttribute("start") || "")) {
      props.start = +node.getAttribute("start");
    } else if (tag === "blockquote" && node.getAttribute("data-alert")) {
      props["data-alert"] = node.getAttribute("data-alert");
    } else if (tag === "p" && node.hasAttribute("data-alert-title")) {
      props["data-alert-title"] = "";
    }
    if (tag === "center") {
      tag = "div";
      style.textAlign = "center";
    }
    if (tag === "strike") tag = "s";
    if (Object.keys(style).length) props.style = style;
    var element = h(tag, props, VOID.test(tag) ? undefined : children());
    if (tag === "pre") return h(CodeBlock, { key: key }, element);
    return tag === "table" ? h(Scroll, { key: key, className: "mp-readme-scroll" }, element) : element;
  }

  function renderReadme(text, url) {
    var raw = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(url);
    var dir = url.slice(0, url.lastIndexOf("/") + 1);
    var ctx = {
      imageBase: dir,
      linkBase: raw
        ? "https://github.com/" + raw[1] + "/" + raw[2] + "/blob/" + raw[3] + "/" + raw[4].replace(/[^/]*$/, "")
        : dir,
      slug: slugger(),
    };
    var html = markdownBlocks(
      String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "    ")
        .split("\n")
    );
    var doc = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
    return Array.prototype.map.call(doc.body.childNodes, function (node, n) {
      return toReact(node, ctx, n);
    });
  }

  function Changes(props) {
    var R = SpotiKit.React;
    var state = R.useState(null);
    R.useEffect(
      function () {
        var live = true;
        M.changes(props.id).then(
          function (result) {
            if (live) state[1](result || { failed: true });
          },
          function () {
            if (live) state[1]({ failed: true });
          }
        );
        return function () {
          live = false;
        };
      },
      [props.id, props.version]
    );
    var s = state[0];
    var more =
      s && s.url
        ? h(
            "a",
            { className: "mp-btn mp-btn--small mp-btn--ghost", href: s.url, target: "_blank", rel: "noreferrer" },
            h(Ic, { name: "external-link", size: 14 }),
            "All changes on GitHub"
          )
        : null;
    var body;
    if (!s) body = h("p", { className: "mp-muted" }, "Loading the changes from GitHub");
    else if (s.failed) body = h("p", { className: "mp-muted" }, "GitHub didn't answer, so the changes can't be shown.");
    else if (!s.known)
      body = h("p", { className: "mp-muted" }, "It was installed before SpotiKit kept track of versions.");
    else if (!s.commits.length)
      body = h("p", { className: "mp-muted" }, "Only its files changed, without new commits.");
    else
      body = h(
        "ul",
        { className: "mp-changes" },
        s.commits.map(function (c, i) {
          return h(
            "li",
            { key: i },
            h("a", { href: c.url, target: "_blank", rel: "noreferrer" }, c.message || "(no message)"),
            c.date ? h("span", { className: "mp-muted" }, when(Date.parse(c.date))) : null
          );
        }),
        s.total > s.commits.length ? h("li", { className: "mp-muted" }, s.total - s.commits.length + " more") : null
      );
    return h("div", { className: "mp-panel" }, h("h4", null, "What's new"), body, more);
  }

  function Fold(props) {
    var R = SpotiKit.React;
    var open = R.useState(!!props.open);
    return h(
      "div",
      { className: "mp-fold" + (open[0] ? " is-open" : "") },
      h(
        "button",
        {
          type: "button",
          className: "mp-fold-summary",
          "aria-expanded": open[0],
          onClick: function () {
            open[1](!open[0]);
          },
        },
        h(Ic, { name: "chevron-right", className: "mp-fold-chevron" }),
        h("span", null, props.summary)
      ),
      h("div", { className: "mp-fold-body" }, h("div", { className: "mp-fold-inner" }, props.children))
    );
  }

  function ReadmeImage(props) {
    var R = SpotiKit.React;
    var loaded = R.useState(false);
    var failed = R.useState(false);
    var framed = R.useState(false);
    if (failed[0]) return null;
    return h(
      "span",
      { className: "mp-readme-media" + (framed[0] ? " is-framed" : "") + (loaded[0] ? " is-loaded" : "") },
      h("img", {
        src: props.src,
        alt: props.alt,
        style: props.style,
        loading: "lazy",
        decoding: "async",
        className: "mp-readme-img" + (loaded[0] ? " is-loaded" : ""),
        onLoad: function (e) {
          var img = e.currentTarget;
          framed[1](img.naturalHeight >= 72 && img.naturalWidth >= 120);
          loaded[1](true);
        },
        onError: function () {
          failed[1](true);
        },
      })
    );
  }

  function Readme(props) {
    var R = SpotiKit.React;
    var state = R.useState({ loading: true, text: null, error: null });
    R.useEffect(
      function () {
        var alive = true;
        if (!props.url) {
          state[1]({ loading: false, text: null, error: null });
          return;
        }
        fetch(props.url)
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
          })
          .then(
            function (text) {
              if (alive) state[1]({ loading: false, text: text, error: null });
            },
            function (e) {
              if (alive) state[1]({ loading: false, text: null, error: String(e.message || e) });
            }
          );
        return function () {
          alive = false;
        };
      },
      [props.url]
    );
    var s = state[0];
    if (!props.url) return h("p", { className: "mp-muted" }, "This entry has no README.");
    if (s.loading) return h("div", { className: "mp-readme-loading" }, h("i"), h("i"), h("i"));
    if (s.error) return h("p", { className: "mp-muted" }, "The README couldn't be loaded (" + s.error + ").");
    var jump = function (event) {
      var link = event.target.closest && event.target.closest('a[href^="#"]');
      if (!link) return;
      event.preventDefault();
      var id = decodeURIComponent(link.getAttribute("href").slice(1)).toLowerCase();
      var target = event.currentTarget.querySelector('[data-anchor="' + CSS.escape(id) + '"]');
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    return h("div", { className: "mp-readme", onClick: jump }, renderReadme(s.text, props.url));
  }

  function shareLink(item) {
    var parts = item.id.split("/");
    if (M.account.available) return M.account.server + "/a/" + item.id + "?n=" + encodeURIComponent(item.name);
    return "spotify:app:marketplace:install:" + parts.join(":");
  }

  function copyText(text) {
    var api = SpotiKit.Platform.ClipboardAPI;
    if (api && typeof api.copy === "function") return Promise.resolve(api.copy(text));
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error("There is no clipboard to copy to."));
  }

  function CodeBlock(props) {
    var R = SpotiKit.React;
    var box = R.useRef(null);
    var copied = R.useState(false);
    R.useEffect(
      function () {
        if (!copied[0]) return undefined;
        var t = setTimeout(function () {
          copied[1](false);
        }, 1600);
        return function () {
          clearTimeout(t);
        };
      },
      [copied[0]]
    );
    var copy = function () {
      var pre = box.current && box.current.querySelector("pre");
      copyText(pre ? pre.textContent : "").then(
        function () {
          copied[1](true);
        },
        function (e) {
          notify("Couldn't copy: " + e.message, { type: "error" });
        }
      );
    };
    return h(
      "div",
      { className: "mp-code-block", ref: box },
      h(Scroll, { className: "mp-readme-scroll" }, props.children),
      h(
        Tip,
        { label: copied[0] ? "Copied" : "Copy" },
        h(
          "button",
          {
            type: "button",
            className: "mp-code-copy" + (copied[0] ? " is-copied" : ""),
            "aria-label": "Copy code",
            onClick: copy,
          },
          h(Ic, { name: copied[0] ? "check" : "copy", size: 14 })
        )
      )
    );
  }

  function SnippetCode(props) {
    var R = SpotiKit.React;
    var item = props.item;
    var fetched = R.useState(null);
    var file = !item.code && item.files && item.files[0];
    R.useEffect(
      function () {
        if (!file || !file.url) return;
        var alive = true;
        fetch(file.url)
          .then(function (r) {
            return r.ok ? r.text() : "";
          })
          .then(function (text) {
            if (alive) fetched[1](text);
          })
          .catch(function () {});
        return function () {
          alive = false;
        };
      },
      [file && file.url]
    );
    return h(
      "div",
      { className: "mp-readme" },
      item.description ? h("p", null, item.description) : null,
      h(CodeBlock, null, h("pre", null, h("code", null, item.code || fetched[0] || "")))
    );
  }

  function runsCode(item) {
    return item.files.some(function (f) {
      return f.role === "main" || f.role === "include";
    });
  }

  function ConfirmCard(props) {
    var R = SpotiKit.React;
    var answer = R.useState(null);
    var text = R.useRef(props.input ? props.input.value || "" : "");
    var done = function (yes) {
      if (answer[0] !== null) return;
      if (yes && props.input && !text.current.trim()) return;
      answer[1](yes);
      props.onDone(yes && props.input ? text.current.trim() : yes);
    };
    R.useEffect(
      function () {
        var onKey = function (e) {
          if (e.key !== "Escape" && e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          done(e.key === "Enter");
        };
        window.addEventListener("keydown", onKey, true);
        return function () {
          window.removeEventListener("keydown", onKey, true);
        };
      },
      [answer[0]]
    );
    var tone = props.tone === "danger" ? "danger" : "accent";
    var entered = useEntered();
    return h(
      "div",
      {
        className: "mp-confirm-backdrop" + (answer[0] !== null ? " is-closing" : ""),
        onMouseDown: function () {
          done(false);
        },
      },
      h(
        "div",
        {
          className: "mp-confirm" + (entered ? "" : " is-pre"),
          role: "alertdialog",
          "aria-label": props.title,
          onMouseDown: function (e) {
            e.stopPropagation();
          },
        },
        h(
          "span",
          { className: "mp-confirm-icon mp-confirm-icon--" + tone },
          h(Ic, { name: props.icon || "info", size: 22 })
        ),
        h("b", null, props.title),
        props.message ? h("p", null, props.message) : null,
        props.input
          ? h("input", {
              className: "mp-input",
              autoFocus: true,
              maxLength: props.input.maxLength || 40,
              placeholder: props.input.placeholder || "",
              defaultValue: props.input.value || "",
              onChange: function (e) {
                text.current = e.target.value;
              },
            })
          : null,
        props.choices
          ? h(
              "div",
              { className: "mp-confirm-choices" },
              props.choices.map(function (choice) {
                return h(
                  "button",
                  {
                    key: choice.value,
                    type: "button",
                    className: "mp-btn mp-btn--block",
                    onClick: function () {
                      if (answer[0] !== null) return;
                      answer[1](true);
                      props.onDone(choice.value);
                    },
                  },
                  choice.label
                );
              })
            )
          : null,
        props.points && props.points.length
          ? h(
              "ul",
              { className: "mp-confirm-points" },
              props.points.map(function (point, i) {
                return h(
                  "li",
                  { key: i, className: "is-" + (point.tone || "info"), style: { "--i": Math.min(i, 10) } },
                  h(Ic, { name: point.icon || "info", size: 14 }),
                  h("span", null, point.text)
                );
              })
            )
          : null,
        props.options && props.options.length
          ? h(
              "div",
              { className: "mp-confirm-options" },
              props.options.map(function (option, i) {
                return h(ConfirmOption, { key: i, option: option });
              })
            )
          : null,
        props.note
          ? h(
              "span",
              { className: "mp-compat is-" + (props.noteStatus || "unspecified") },
              h(Ic, { name: "info", size: 12 }),
              props.note
            )
          : null,
        h(
          "div",
          { className: "mp-confirm-actions" },
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--ghost",
              onClick: function () {
                done(false);
              },
            },
            props.cancelLabel || "Cancel"
          ),
          props.choices
            ? null
            : h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--" + tone,
                  onClick: function () {
                    done(true);
                  },
                },
                props.confirmIcon ? h(Ic, { name: props.confirmIcon }) : null,
                props.confirmLabel || "OK"
              )
        )
      )
    );
  }

  function ConfirmOption(props) {
    var R = SpotiKit.React;
    var on = R.useState(!!props.option.checked);
    var set = function (value) {
      on[1](value);
      props.option.onChange(value);
    };
    return h(
      "div",
      { className: "mp-confirm-option" },
      h("span", null, props.option.label),
      h(LiquidToggle, { checked: on[0], label: props.option.label, onChange: set })
    );
  }

  function ask(options) {
    return new Promise(function (resolve) {
      var host = document.createElement("div");
      host.id = "spotikit-mp-confirm-" + Date.now();
      document.body.appendChild(host);
      var cleanup = null;
      var finish = function (yes) {
        resolve(yes);
        setTimeout(function () {
          if (cleanup) cleanup();
          host.remove();
        }, 300);
      };
      cleanup = internal.renderInto(host, h(ConfirmCard, Object.assign({}, options, { onDone: finish })));
    });
  }

  function openLink(text, name) {
    return M.load(text).then(function (items) {
      var wanted = name ? String(name).toLowerCase() : null;
      var pick =
        (wanted &&
          items.find(function (item) {
            return item.id.split("/").pop() === wanted || item.name.toLowerCase() === wanted;
          })) ||
        (items.length === 1 ? items[0] : null);
      if (pick) return pick;
      return ask({
        title: items[0].source.repo + " has " + items.length + " items",
        icon: "link",
        message: "Which one do you want to look at?",
        choices: items.map(function (item) {
          return { value: item.id, label: item.name };
        }),
        confirmLabel: null,
      }).then(function (id) {
        return (
          items.find(function (item) {
            return item.id === id;
          }) || null
        );
      });
    });
  }

  function updatePoints(ids) {
    var map = M.installed();
    return Promise.all(
      ids.map(function (id, i) {
        return i < 6 ? M.changes(id).catch(function () {}) : null;
      })
    ).then(function (changes) {
      if (ids.length === 1) {
        var c = changes[0];
        if (!c) return [{ icon: "info", text: "GitHub didn't answer, so the changes can't be shown." }];
        if (!c.known) return [{ icon: "info", text: "It was installed before SpotiKit kept track of versions." }];
        if (!c.commits.length) return [{ icon: "info", text: "Only its files changed, without new commits." }];
        var list = c.commits.slice(0, 5).map(function (commit) {
          return { icon: "refresh", text: commit.message || "(no message)" };
        });
        if (c.total > list.length) list.push({ icon: "info", text: c.total - list.length + " more on GitHub" });
        return list;
      }
      return ids.map(function (id, i) {
        var c = changes[i];
        var first = c && c.commits && c.commits[0];
        var more = c && c.total > 1 ? " (+" + (c.total - 1) + " more)" : "";
        return { icon: "refresh", text: map[id].item.name + (first ? ": " + first.message + more : "") };
      });
    });
  }

  function confirmUpdates(ids, options) {
    var map = M.installed();
    var name = ids.length === 1 && map[ids[0]] ? map[ids[0]].item.name : null;
    return updatePoints(ids).then(function (points) {
      return ask({
        title: name ? (options && options.offered ? name + " has an update" : "Update " + name + "?") : ids.length + " items have updates",
        icon: "refresh",
        message: options && options.offered ? "Update now, or later from the Marketplace." : "This changed since your version:",
        points: points,
        confirmLabel: ids.length === 1 ? "Update" : "Update all",
        confirmIcon: "download",
        cancelLabel: options && options.offered ? "Later" : "Cancel",
        options: options && options.options,
      });
    });
  }

  function installQuietly(ids, done) {
    var map = M.installed();
    var nameOf = function (id) {
      return map[id].item.name;
    };
    var failed = [];
    return ids
      .reduce(function (chain, id) {
        return chain.then(function () {
          return M.install(id).catch(function (error) {
            failed.push(nameOf(id) + ": " + error.message);
          });
        });
      }, Promise.resolve())
      .then(function () {
        if (failed.length) notify(failed.join(" · "), { type: "error", duration: 9000 });
        else notify(ids.length === 1 ? nameOf(ids[0]) + " " + done : ids.length + " items " + done);
      });
  }

  function offerUpdates() {
    return M.pendingUpdates().then(function (ids) {
      if (!ids.length) return null;
      var map = M.installed();
      var trusted = ids.filter(function (id) {
        return map[id].autoUpdate;
      });
      var rest = ids.filter(function (id) {
        return !map[id].autoUpdate;
      });
      return (trusted.length ? installQuietly(trusted, "updated by itself") : Promise.resolve()).then(function () {
        if (!rest.length || !M.updatePrompt) return null;
        var trustAll = false;
        return confirmUpdates(rest, {
          offered: true,
          options: [
            {
              label: rest.length === 1 ? "Update it by itself from now on" : "Update these by themselves from now on",
              onChange: function (on) {
                trustAll = on;
              },
            },
            {
              label: "Don't ask when Spotify starts",
              onChange: function (on) {
                M.setUpdatePrompt(!on);
              },
            },
          ],
        })
          .then(function (yes) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(yes);
              }, 360);
            });
          })
          .then(function (yes) {
            if (!yes) {
              M.putOffUpdates(rest);
              return null;
            }
            if (trustAll)
              rest.forEach(function (id) {
                M.setAutoUpdate(id, true);
              });
            return installQuietly(rest, "updated");
          });
      });
    });
  }

  function askForLink() {
    return ask({
      title: "Install from GitHub",
      icon: "link",
      message: "Paste the address of a repository with a spotikit.json.",
      input: { placeholder: "https://github.com/owner/repo", maxLength: 300 },
      confirmLabel: "Open",
    }).then(function (text) {
      return typeof text === "string" ? openLink(text) : null;
    });
  }

  var pickedScheme = {};

  var pageApi = { showSchemes: null, openShared: null };

  function offerSchemes(item) {
    M.schemes(item.id)
      .then(function (list) {
        if (list.length < 2) return null;
        return ask({
          title: item.name + " has " + list.length + " color schemes",
          icon: "edit-image",
          message:
            "A color scheme recolors Spotify and the theme together, without changing its layout. You switch between them on the theme's page, next to its README, whenever you like.",
          points: [
            {
              icon: "check",
              text: "It starts with " + ((M.installed()[item.id] && M.installed()[item.id].scheme) || list[0]) + ".",
            },
          ],
          confirmLabel: "Show me",
          confirmIcon: "edit-image",
          cancelLabel: "Later",
        }).then(function (yes) {
          if (yes && pageApi.showSchemes) pageApi.showSchemes(item);
        });
      })
      .catch(function () {});
  }

  function install(item) {
    var installedBefore = !!M.installed()[item.id];
    var points = [];
    if (runsCode(item))
      points.push({
        icon: "warning",
        tone: "warn",
        text:
          item.name +
          " runs code inside Spotify, signed in as you. Only install it if you trust " +
          (item.authors[0] ? item.authors[0].name : "its author") +
          ".",
      });
    if (item.compatibility.status === "other-spotify") {
      points.push({ icon: "warning", tone: "warn", text: item.compatibility.detail });
    }
    var anyway = item.compatibility.status === "other-spotify";
    var record = M.installed()[item.id];
    var asked =
      installedBefore && record && record.updateAvailable
        ? confirmUpdates([item.id])
        : installedBefore || item.kind === "snippet"
        ? Promise.resolve(true)
        : ask({
            title: (anyway ? "Install anyway? " : "Install ") + item.name + (anyway ? "" : "?"),
            icon: anyway ? "warning" : "download",
            points: points,
            note: item.compatibility.label,
            noteStatus: item.compatibility.status,
            confirmLabel: anyway ? "Install anyway" : "Install",
            confirmIcon: "download",
          });
    return asked.then(function (yes) {
      if (!yes) return null;
      return M.install(item.id, { scheme: pickedScheme[item.id], anyway: anyway }).then(
        function (result) {
          if (result.unchanged) notify(item.name + " is already up to date");
          else notify(result.updated ? item.name + " updated" : item.name + " installed");
          if (!result.unchanged && !result.updated && item.kind === "theme") offerSchemes(item);
          return result;
        },
        function (error) {
          notify("Couldn't install " + item.name + ": " + error.message, { type: "error", duration: 7000 });
        }
      );
    });
  }

  function confirmRollback(item) {
    return M.rollbackTarget(item.id)
      .then(function (target) {
        var detail = target && target.at ? "The version you installed " + when(target.at) : "The version you had before";
        if (target && target.message) detail += ": " + target.message;
        if (target && target.commit) detail += " (" + target.commit.slice(0, 7) + ")";
        return ask({
          title: "Go back to an earlier version of " + item.name + "?",
          icon: "undo",
          message: "You can update to the newest version again anytime.",
          points: [{ icon: "undo", text: detail }],
          confirmLabel: "Roll back",
          confirmIcon: "undo",
        }).then(function (yes) {
          if (!yes) return null;
          return M.rollback(item.id).then(function (record) {
            notify(
              item.name +
                " is back on " +
                (target && target.at ? "the version you installed " + when(target.at) : "the earlier version") +
                ". Update gets you the newest one again."
            );
            return record;
          });
        });
      })
      .catch(function (error) {
        notify(error.message, { type: "error", duration: 7000 });
      });
  }

  function confirmAndRun(title, message, label, run) {
    var removing = label === "Remove";
    return ask({
      title: title,
      message: message,
      confirmLabel: label,
      tone: removing ? "danger" : "accent",
      icon: removing ? "trash" : "refresh",
      confirmIcon: removing ? "trash" : null,
    })
      .then(function (yes) {
        return yes ? run() : null;
      })
      .catch(function (error) {
        notify(error.message, { type: "error", duration: 7000 });
      });
  }

  function InstallButton(props) {
    var item = props.item;
    var record = M.installed()[item.id];
    var busy = internal.marketplace.busy()[item.id];
    var stop = function (event) {
      event.stopPropagation();
    };
    var cls = function (kind) {
      return "mp-btn mp-btn--" + kind + (props.block ? " mp-btn--block" : "");
    };
    if (busy) {
      return h(
        "button",
        { type: "button", className: cls("busy"), disabled: true, onClick: stop },
        h("i", { className: "mp-spinner" }),
        "Working"
      );
    }
    if (record) {
      if (record.updateAvailable) {
        return h(
          "button",
          {
            type: "button",
            className: cls("accent"),
            onClick: function (e) {
              stop(e);
              install(item);
            },
          },
          h(Ic, { name: "download" }),
          "Update"
        );
      }
      return h(
        "button",
        {
          type: "button",
          className: cls("done"),
          onClick: function (e) {
            stop(e);
            props.onManage && props.onManage();
          },
        },
        h(Ic, { name: internal.marketplace.isPaused(item.id) ? "pause" : "check" }),
        internal.marketplace.isPaused(item.id) ? "Paused" : record.enabled ? "Installed" : "Disabled"
      );
    }
    var anyway = item.compatibility.status === "other-spotify";
    return h(
      "button",
      {
        type: "button",
        className: cls(anyway ? "ghost" : "accent"),
        onClick: function (e) {
          stop(e);
          install(item);
        },
      },
      h(Ic, { name: anyway ? "warning" : "download" }),
      anyway ? "Install anyway" : "Install"
    );
  }

  function Preview(props) {
    var R = SpotiKit.React;
    var failed = R.useState(false);
    var loaded = R.useState(false);
    if (!props.src || failed[0]) {
      return h("div", { className: "mp-preview mp-preview--none" }, h("span", null, props.name.slice(0, 1)));
    }
    return h(
      "div",
      { className: "mp-preview" + (loaded[0] ? "" : " is-loading") },
      h("img", {
        src: props.src,
        alt: "",
        loading: "lazy",
        className: loaded[0] ? "is-loaded" : "",
        onLoad: function () {
          loaded[1](true);
        },
        onError: function () {
          failed[1](true);
        },
      })
    );
  }

  function hasScripts(item) {
    return (
      item.kind === "theme" &&
      item.files.some(function (f) {
        return f.role === "include";
      })
    );
  }
  function hasSchemes(item) {
    return (
      item.kind === "theme" &&
      item.files.some(function (f) {
        return f.role === "schemes";
      })
    );
  }
  function useSchemeCount(item) {
    var R = SpotiKit.React;
    var count = R.useState(0);
    R.useEffect(
      function () {
        var alive = true;
        if (hasSchemes(item)) {
          M.schemes(item.id).then(
            function (list) {
              if (alive) count[1](list.length);
            },
            function () {}
          );
        }
        return function () {
          alive = false;
        };
      },
      [item.id]
    );
    return count[0];
  }

  function ThemePills(props) {
    var item = props.item;
    var schemes = useSchemeCount(item);
    if (!hasScripts(item) && schemes < 2) return null;
    return h(
      "div",
      { className: "mp-pills" },
      hasScripts(item)
        ? h(
            Tip,
            {
              label:
                "This theme also runs JavaScript of its own, loaded from " +
                item.files
                  .filter(function (f) {
                    return f.role === "include";
                  })
                  .map(function (f) {
                    return new URL(f.url).hostname;
                  })
                  .join(", ") +
                ".",
            },
            h("span", { className: "mp-pill mp-pill--danger" }, h(Ic, { name: "warning", size: 12 }), "External JS")
          )
        : null,
      schemes > 1
        ? h(
            Tip,
            { label: schemes + " color schemes to switch between" },
            h(
              "span",
              { className: "mp-pill mp-pill--accent" },
              h(Ic, { name: "edit-image", size: 12 }),
              schemes + " color schemes"
            )
          )
        : null
    );
  }

  function CardScheme(props) {
    var R = SpotiKit.React;
    var record = props.record;
    var list = R.useState([]);
    R.useEffect(
      function () {
        M.schemes(props.item.id).then(list[1], function () {
          list[1]([]);
        });
      },
      [record.version]
    );
    if (list[0].length < 2) return null;
    return h(
      "div",
      {
        className: "mp-card-scheme",
        onClick: function (e) {
          e.stopPropagation();
        },
      },
      h(Dropdown, {
        float: true,
        icon: "edit-image",
        label: "Scheme",
        value: record.scheme || list[0][0],
        options: list[0].map(function (name) {
          return { value: name, label: name };
        }),
        onChange: function (name) {
          M.setScheme(props.item.id, name);
        },
      })
    );
  }

  function Card(props) {
    var item = props.item;
    var record = M.installed()[item.id];
    var authors = item.authors
      .map(function (a) {
        return a.name;
      })
      .join(", ");
    return h(
      "article",
      {
        className: "mp-card" + (record ? " is-installed" : ""),
        style: { "--i": props.index },
        tabIndex: 0,
        role: "button",
        onClick: props.onOpen,
        onKeyDown: function (e) {
          if (e.key === "Enter") props.onOpen();
        },
      },
      h(
        "div",
        { className: "mp-card-media" },
        h(Preview, { src: item.preview, name: item.name }),
        record
          ? h(
              "span",
              { className: "mp-badge" + (record.error ? " mp-badge--error" : "") },
              h(Ic, { name: record.error ? "warning" : "check", size: 12 }),
              record.error ? "Failed" : record.enabled ? "Installed" : "Turned off"
            )
          : null
      ),
      h(
        "div",
        { className: "mp-card-body" },
        h("h3", null, item.name),
        h("span", { className: "mp-authors" }, authors ? "by " + authors : item.source.repo),
        h("p", { className: "mp-desc" }, item.description),
        h(ThemePills, { item: item }),
        h(
          "div",
          { className: "mp-tags" },
          item.tags.slice(0, 3).map(function (t) {
            return h("span", { key: t, className: "mp-tag" }, t);
          })
        ),
        record && item.kind === "theme" ? h(CardScheme, { item: item, record: record }) : null,
        h(
          "div",
          { className: "mp-card-meta" },
          h(RatingSummary, { id: item.id, source: props.ratingSource }),
          item.updated
            ? h(
                "span",
                { className: "mp-updated" },
                h(Ic, { name: "clock", size: 12 }),
                "Updated " + when(item.updated)
              )
            : null,
          h(
            Tip,
            { label: item.compatibility.detail },
            h(
              "span",
              { className: "mp-compat is-" + item.compatibility.status },
              h(Ic, { name: "info", size: 12 }),
              item.compatibility.label
            )
          )
        ),
        h(InstallButton, { item: item, block: true, onManage: props.onOpen })
      )
    );
  }

  function SkeletonGrid() {
    return h(
      "div",
      { className: "mp-grid" },
      [0, 1, 2, 3].map(function (i) {
        return h(
          "div",
          { key: i, className: "mp-card mp-card--skeleton", style: { "--i": i } },
          h("div", { className: "mp-card-media" }, h("div", { className: "mp-preview" })),
          h("div", { className: "mp-card-body" }, h("i"), h("i"), h("i"))
        );
      })
    );
  }

  function Empty(props) {
    return h(
      "div",
      { className: "mp-empty" },
      h("span", { className: "mp-empty-icon" }, h(Ic, { name: props.icon || "search", size: 22 })),
      h("b", null, props.title),
      props.text ? h("p", null, props.text) : null,
      props.children
    );
  }

  function Detail(props) {
    var R = SpotiKit.React;
    var item = props.item;
    var record = M.installed()[item.id];
    var schemes = R.useState([]);
    var closing = R.useState(false);
    var entered = useEntered();
    var close = function () {
      closing[1](true);
      setTimeout(props.onClose, 320);
    };
    R.useEffect(function () {
      var onKey = function (e) {
        if (e.key === "Escape") close();
      };
      window.addEventListener("keydown", onKey);
      return function () {
        window.removeEventListener("keydown", onKey);
      };
    }, []);
    var tick = R.useReducer(function (x) {
      return x + 1;
    }, 0)[1];
    R.useEffect(
      function () {
        if (item.kind === "theme")
          M.schemes(item.id).then(schemes[1], function () {
            schemes[1]([]);
          });
      },
      [record && record.version]
    );
    var panelState = R.useState(null);
    var schemePanel = panelState[1];
    var handled = R.useRef(null);
    R.useEffect(
      function () {
        var panel = panelState[0];
        if (!props.focus || !panel || handled.current === props.focus) return undefined;
        var start = setTimeout(function () {
          handled.current = props.focus;
          panel.scrollIntoView({ behavior: "smooth", block: "center" });
          panel.classList.remove("is-highlight");
          void panel.offsetWidth;
          panel.classList.add("is-highlight");
          setTimeout(function () {
            panel.classList.remove("is-highlight");
          }, 2800);
        }, 450);
        return function () {
          clearTimeout(start);
        };
      },
      [props.focus, panelState[0]]
    );
    var currentScheme = record ? record.scheme || schemes[0][0] : pickedScheme[item.id] || schemes[0][0];
    var P = SpotiKit.Palettes;
    var paletteTick = R.useState(0);
    R.useEffect(function () {
      return P
        ? P.on("change", function () {
            paletteTick[1](function (n) {
              return n + 1;
            });
          })
        : undefined;
    }, []);
    var ownPalettes = P && record && record.enabled && P.target.id === "market:" + item.id ? P.list() : null;
    var activePalette = ownPalettes ? P.active : null;
    var pickScheme = function (name) {
      if (record) {
        if (activePalette) P.use(null);
        M.setScheme(item.id, name);
      } else {
        pickedScheme[item.id] = name;
        tick();
      }
    };

    var act = function (run) {
      return function () {
        run().catch(function (e) {
          notify(e.message, { type: "error", duration: 7000 });
        });
      };
    };

    var reviewsOpen = R.useState(function () {
      return M.account.available && SpotiKit.Storage.scope("marketplace").get("reviewsOpen", false);
    });
    var toggleReviews = function () {
      var next = !reviewsOpen[0];
      reviewsOpen[1](next);
      SpotiKit.Storage.scope("marketplace").set("reviewsOpen", next);
    };
    var rating = M.account.available ? M.ratings.summary(item.id) : null;

    return h(
      "div",
      { className: "mp-sheet-backdrop" + (closing[0] ? " is-closing" : ""), onMouseDown: close },
      h(
        "div",
        { className: "mp-sheet-row" + (reviewsOpen[0] ? " has-island" : "") },
        h(
          "div",
          {
            className: "mp-sheet-frame" + (entered ? "" : " is-pre"),
            onMouseDown: function (e) {
              e.stopPropagation();
            },
          },
          h(
            "section",
            {
              className: "mp-sheet" + (entered ? "" : " is-pre"),
              role: "dialog",
              "aria-label": item.name,
            },
            h(
              Scroll,
              { className: "mp-sheet-scroll" },
              h(
                "div",
                { className: "mp-sheet-hero" },
                h(Preview, { src: item.preview, name: item.name }),
                h(
                  "div",
                  { className: "mp-sheet-title" },
                  h("span", { className: "mp-kind" }, KIND_LABEL[item.kind] || "Item"),
                  h("h2", null, item.name),
                  h(
                    "span",
                    { className: "mp-authors" },
                    item.authors.map(function (a, i) {
                      return h(
                        R.Fragment,
                        { key: a.name },
                        i ? ", " : "",
                        a.url ? h("a", { href: a.url, target: "_blank", rel: "noreferrer" }, a.name) : a.name
                      );
                    }),
                    h(
                      Tip,
                      { label: "Copy a link to share" },
                      h(
                        "button",
                        {
                          type: "button",
                          className: "mp-share-btn",
                          "aria-label": "Copy a link to share",
                          onClick: function () {
                            copyText(shareLink(item)).then(function () {
                              notify("Link copied. It opens " + item.name + " in the SpotiKit Marketplace.");
                            }, fail);
                          },
                        },
                        h(Ic, { name: "share", size: 13 })
                      )
                    ),
                    M.account.available
                      ? h(
                          Tip,
                          { label: "Report" },
                          h(
                            "button",
                            {
                              type: "button",
                              className: "mp-share-btn",
                              "aria-label": "Report " + item.name,
                              onClick: function () {
                                reportContent("item", item.id, item.name, { name: item.name, kind: item.kind });
                              },
                            },
                            h(Ic, { name: "flag", size: 12 })
                          )
                        )
                      : null
                  ),
                  h("p", null, item.description),
                  h(
                    "div",
                    { className: "mp-sheet-actions" },
                    h(InstallButton, { item: item }),
                    record
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "mp-btn",
                            onClick: act(function () {
                              return M.setEnabled(item.id, !record.enabled);
                            }),
                          },
                          record.enabled ? "Turn off" : "Turn on"
                        )
                      : null,
                    record
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "mp-btn mp-btn--ghost",
                            onClick: function () {
                              confirmAndRun(
                                "Remove " + item.name + "?",
                                "Its files are deleted from this device.",
                                "Remove",
                                function () {
                                  return M.uninstall(item.id).then(close);
                                }
                              );
                            },
                          },
                          h(Ic, { name: "trash" }),
                          "Remove"
                        )
                      : null,
                    rating
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "mp-btn mp-btn--ghost mp-reviews-toggle" + (reviewsOpen[0] ? " is-on" : ""),
                            "aria-pressed": reviewsOpen[0],
                            onClick: toggleReviews,
                          },
                          h(StarIcon, { size: 14 }),
                          rating.count ? formatAverage(rating.average) + " · " + rating.count : "Reviews"
                        )
                      : null
                  )
                )
              ),

              h(
                "div",
                { className: "mp-sheet-grid" },
                h(
                  "div",
                  { className: "mp-sheet-main" },
                  record && record.error
                    ? h(
                        "div",
                        { className: "mp-note mp-note--error" },
                        h(Ic, { name: "warning" }),
                        h("div", null, h("b", null, "It failed when it started"), h("span", null, record.error))
                      )
                    : null,
                  internal.marketplace.isPaused(item.id)
                    ? h(
                        "div",
                        { className: "mp-note mp-note--warn" },
                        h(Ic, { name: "pause" }),
                        h(
                          "div",
                          null,
                          h("b", null, "Paused"),
                          h(
                            "span",
                            null,
                            item.compatibility.detail + " It starts again once its author covers your version."
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "mp-btn mp-btn--small",
                              style: { marginTop: 8, alignSelf: "flex-start" },
                              onClick: function () {
                                M.runAnyway(item.id).catch(function (e) {
                                  notify(e.message, { type: "error", duration: 7000 });
                                });
                              },
                            },
                            h(Ic, { name: "play" }),
                            "Run anyway"
                          )
                        )
                      )
                    : null,
                  h("h4", null, "About"),
                  item.kind === "snippet" && !item.readme ? h(SnippetCode, { item: item }) : h(Readme, { url: item.readme })
                ),
                h(
                  "aside",
                  { className: "mp-sheet-side" },
                  item.kind === "theme" && (schemes[0].length > 1 || ownPalettes)
                    ? h(
                        "div",
                        { className: "mp-panel mp-panel--schemes", ref: schemePanel },
                        h("h4", null, "Color scheme"),
                        h(
                          "div",
                          { className: "mp-chips mp-chips--wrap" },
                          (schemes[0].length > 1 ? schemes[0] : []).map(function (name) {
                            return h(
                              "button",
                              {
                                key: name,
                                type: "button",
                                className: "mp-chip" + (currentScheme === name && !activePalette ? " is-on" : ""),
                                onClick: function () {
                                  pickScheme(name);
                                },
                              },
                              name
                            );
                          }),
                          (ownPalettes || []).map(function (p) {
                            return h(
                              "button",
                              {
                                key: "palette-" + p.id,
                                type: "button",
                                className: "mp-chip" + (activePalette === p.id ? " is-on" : ""),
                                title: activePalette === p.id ? "Click again to edit it" : undefined,
                                onClick: function () {
                                  if (activePalette === p.id) internal.openPaletteEditor(p.id);
                                  else P.use(p.id);
                                },
                              },
                              h("span", { className: "mp-chip-swatch", style: { backgroundColor: p.colors.accent } }),
                              p.name
                            );
                          }),
                          ownPalettes
                            ? h(
                                "button",
                                {
                                  key: "new-palette",
                                  type: "button",
                                  className: "mp-chip",
                                  onClick: function () {
                                    internal.openPaletteEditor(null);
                                  },
                                },
                                h(Ic, { name: "plus", size: 12 }),
                                "New palette"
                              )
                            : null
                        ),
                        h(
                          "p",
                          { className: "mp-muted" },
                          record
                            ? record.enabled
                              ? "Switches right away."
                              : "Applies when you turn it on."
                            : schemes[0].length + " schemes. It starts with the one you pick."
                        )
                      )
                    : null,
                  h(
                    "div",
                    { className: "mp-panel" },
                    h("h4", null, M.ratings.provider.source === "spotikit" ? "Rating" : "GitHub stars"),
                    h(RatingPanel, { id: item.id, item: item })
                  ),
                  h(
                    "div",
                    { className: "mp-panel" },
                    h("h4", null, "Compatibility"),
                    h(
                      "span",
                      { className: "mp-compat mp-compat--big is-" + item.compatibility.status },
                      h(Ic, { name: "info", size: 13 }),
                      item.compatibility.label
                    ),
                    h("p", { className: "mp-muted" }, item.compatibility.detail)
                  ),
                  item.dependencies
                    ? h(
                        "div",
                        { className: "mp-panel" },
                        h("h4", null, "Needs"),
                        h(
                          "ul",
                          { className: "mp-needs" },
                          Object.keys(item.dependencies).map(function (ref) {
                            return h("li", { key: ref }, h("code", null, ref), " ", item.dependencies[ref]);
                          })
                        ),
                        h("p", { className: "mp-muted" }, "Installing it installs these too.")
                      )
                    : null,
                  record && record.updateAvailable ? h(Changes, { id: item.id, version: record.version }) : null,
                  record
                    ? h(
                        "div",
                        { className: "mp-panel" },
                        h("h4", null, "Installed"),
                        h(
                          "dl",
                          { className: "mp-facts" },
                          h("dt", null, "Version"),
                          h("dd", null, h("code", null, record.item.version || record.version.slice(0, 12))),
                          h("dt", null, "Size"),
                          h("dd", null, formatBytes(record.size)),
                          h("dt", null, "Installed"),
                          h("dd", null, when(record.installedAt)),
                          record.updatedAt !== record.installedAt
                            ? h(R.Fragment, null, h("dt", null, "Updated"), h("dd", null, when(record.updatedAt)))
                            : null
                        ),
                        h(
                          "div",
                          { className: "mp-auto-row" },
                          h(
                            "span",
                            null,
                            h("b", null, "Update automatically"),
                            h("span", null, "New versions install by themselves when Spotify starts.")
                          ),
                          h(LiquidToggle, {
                            checked: !!record.autoUpdate,
                            label: "Update automatically",
                            onChange: function (on) {
                              M.setAutoUpdate(item.id, on);
                            },
                          })
                        ),
                        h(
                          "div",
                          { className: "mp-row-actions" },
                          h(
                            "button",
                            {
                              type: "button",
                              className: "mp-btn mp-btn--small",
                              onClick: act(function () {
                                return M.checkUpdate(item.id).then(function (available) {
                                  notify(available ? "An update is available" : item.name + " is up to date");
                                });
                              }),
                            },
                            h(Ic, { name: "refresh" }),
                            "Check for update"
                          ),
                          record.hasBackup && !record.rolledBack
                            ? h(
                                "button",
                                {
                                  type: "button",
                                  className: "mp-btn mp-btn--small",
                                  onClick: function () {
                                    confirmRollback(item);
                                  },
                                },
                                h(Ic, { name: "chevron-left" }),
                                "Roll back"
                              )
                            : null
                        )
                      )
                    : null,
                  h(
                    "div",
                    { className: "mp-panel" },
                    h("h4", null, "Files"),
                    item.files.length
                      ? h(
                          "ul",
                          { className: "mp-files" },
                          item.files.map(function (f) {
                            return h(
                              "li",
                              { key: f.url },
                              h("span", null, f.role),
                              h(
                                Tip,
                                { label: f.url },
                                h(
                                  "a",
                                  { href: f.url, target: "_blank", rel: "noreferrer" },
                                  f.url.replace(/^https?:\/\//, "")
                                )
                              )
                            );
                          })
                        )
                      : h("p", { className: "mp-muted" }, "Nothing to download; it is installed from its repository."),
                    h(
                      "p",
                      { className: "mp-muted" },
                      "From ",
                      h(
                        "a",
                        {
                          href: item.repoUrl || "https://github.com/" + item.source.repo,
                          target: "_blank",
                          rel: "noreferrer",
                        },
                        item.source.repo
                      ),
                      " · " + item.source.formatLabel
                    )
                  ),
                  item.tags.length
                    ? h(
                        "div",
                        { className: "mp-panel" },
                        h("h4", null, "Tags"),
                        h(
                          "div",
                          { className: "mp-tags" },
                          item.tags.map(function (t) {
                            return h("span", { key: t, className: "mp-tag" }, t);
                          })
                        )
                      )
                    : null
                )
              )
            )
          ),
          h(
            "button",
            { type: "button", className: "mp-sheet-close", onClick: close, "aria-label": "Close" },
            h(Ic, { name: "x" })
          )
        ),
        M.account.available
          ? h(ReviewsIsland, {
              item: item,
              open: reviewsOpen[0],
              entered: entered,
              onClose: toggleReviews,
            })
          : null
      )
    );
  }

  function ReviewsIsland(props) {
    var R = SpotiKit.React;
    var phase = R.useState(props.open ? "mount" : "closed");
    var first = R.useRef(true);
    R.useEffect(
      function () {
        if (first.current) {
          first.current = false;
          return undefined;
        }
        if (props.open) {
          phase[1]("in");
          return undefined;
        }
        phase[1]("out");
        var t = setTimeout(function () {
          phase[1]("closed");
        }, 240);
        return function () {
          clearTimeout(t);
        };
      },
      [props.open]
    );
    var p = phase[0];
    return h(
      "div",
      {
        className: "mp-island-wrap is-" + p + (props.entered ? "" : " is-pre"),
        "aria-hidden": !props.open,
        onMouseDown: function (e) {
          e.stopPropagation();
        },
      },
      h(
        "aside",
        { className: "mp-island", "aria-label": "Reviews of " + props.item.name },
        h(Scroll, { className: "mp-island-scroll" }, h(ReviewsSection, { item: props.item }))
      ),
      h(
        "button",
        {
          type: "button",
          className: "mp-sheet-close mp-island-close",
          onClick: props.onClose,
          "aria-label": "Hide reviews",
          tabIndex: props.open ? 0 : -1,
        },
        h(Ic, { name: "x" })
      )
    );
  }

  function profileSummary(p) {
    var names = Object.keys(p.items)
      .filter(function (id) {
        return p.items[id].enabled;
      })
      .map(function (id) {
        return p.items[id].name || id;
      });
    if (p.theme) names.push(p.theme.theme);
    var own = Object.keys(p.snippets).filter(function (id) {
      return p.snippets[id];
    }).length;
    if (own) names.push(own === 1 ? "1 snippet" : own + " snippets");
    if (!names.length) return "Everything off";
    return names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "");
  }

  function ProfilesSection() {
    var R = SpotiKit.React;
    var switching = R.useState(null);
    var list = M.profiles.list();
    var fail = function (e) {
      notify(e.message, { type: "error", duration: 7000 });
    };
    var named = function (title, value, run) {
      return ask({
        title: title,
        icon: "equalizer",
        input: { placeholder: "Minimal, Gaming, Lyrics", value: value },
        confirmLabel: "Save",
      }).then(function (name) {
        if (!name) return;
        try {
          run(name);
        } catch (e) {
          fail(e);
        }
      });
    };
    var apply = function (p) {
      if (switching[0]) return;
      switching[1](p.id);
      M.profiles
        .apply(p.id)
        .then(function (result) {
          notify(
            result.missing.length
              ? p.name + " is on. Not installed anymore: " + result.missing.join(", ")
              : p.name + " is on"
          );
        }, fail)
        .finally(function () {
          switching[1](null);
        });
    };
    var iconButton = function (label, icon, onClick) {
      return h(
        Tip,
        { label: label },
        h(
          "button",
          {
            type: "button",
            className: "mp-icon-btn",
            "aria-label": label,
            onClick: function (e) {
              e.stopPropagation();
              onClick();
            },
          },
          h(Ic, { name: icon, size: 14 })
        )
      );
    };
    return h(
      "div",
      { className: "mp-profiles-section" },
      h("h3", { className: "mp-section-title" }, "Setup profiles"),
      h(
        "p",
        { className: "mp-muted mp-gap-small" },
        "Save which themes, extensions and snippets are on, then switch with one click. Also in the menu under your profile picture."
      ),
      h(
        "div",
        { className: "mp-profiles" },
        list.map(function (p) {
          return h(
            "div",
            { key: p.id, className: "mp-profile" + (p.active ? " is-active" : "") },
            h(
              "button",
              {
                type: "button",
                className: "mp-profile-main",
                disabled: !!switching[0],
                onClick: function () {
                  apply(p);
                },
              },
              switching[0] === p.id
                ? h("i", { className: "mp-spinner" })
                : h(Ic, { name: p.active ? "check" : "equalizer", size: 14 }),
              h("span", { className: "mp-profile-text" }, h("b", null, p.name), h("span", null, profileSummary(p)))
            ),
            p.active
              ? null
              : iconButton("Replace with what's on now", "refresh", function () {
                  confirmAndRun(
                    "Replace " + p.name + " with what's on now?",
                    "It forgets its current combination.",
                    "Replace",
                    function () {
                      return Promise.resolve(M.profiles.save(p.name, p.id));
                    }
                  );
                }),
            M.account.available
              ? iconButton(M.shared.sharedIdOf(p.id) ? "Update the shared copy" : "Share", "share", function () {
                  shareProfile(p);
                })
              : null,
            iconButton("Rename", "edit", function () {
              named("Rename " + p.name, p.name, function (name) {
                M.profiles.rename(p.id, name);
              });
            }),
            iconButton("Delete", "trash", function () {
              confirmAndRun(
                "Delete " + p.name + "?",
                "Your themes, extensions and snippets stay as they are.",
                "Remove",
                function () {
                  return Promise.resolve(M.profiles.remove(p.id));
                }
              );
            })
          );
        }),
        h(
          "button",
          {
            type: "button",
            className: "mp-btn mp-btn--ghost mp-profile-new",
            onClick: function () {
              named("Save what's on now", "", function (name) {
                var saved = M.profiles.save(name);
                notify(saved.name + " saved");
              });
            },
          },
          h(Ic, { name: "plus" }),
          "Save current setup"
        )
      )
    );
  }

  var startedApps = {};

  function UpdatesBar() {
    var R = SpotiKit.React;
    var state = R.useState(null);
    var count = M.updates().length;
    var busy = state[0];
    var run = function (kind, work) {
      state[1](kind);
      work()
        .then(function (message) {
          if (message) notify(message.text, message.error ? { type: "error", duration: 9000 } : undefined);
        })
        .catch(function (e) {
          notify(e.message, { type: "error", duration: 7000 });
        })
        .finally(function () {
          state[1](null);
        });
    };
    return h(
      "div",
      { className: "mp-updates" },
      count ? h("span", { className: "mp-updates-text" }, count === 1 ? "1 update" : count + " updates") : null,
      h(
        Tip,
        { label: "When Spotify starts, SpotiKit asks whether to install new versions." },
        h(
          "span",
          { className: "mp-updates-ask" },
          h("span", null, "Notify me about updates"),
          h(LiquidToggle, {
            checked: M.updatePrompt,
            label: "Notify me about updates",
            onChange: M.setUpdatePrompt,
          })
        )
      ),
      h(
        "button",
        {
          type: "button",
          className: "mp-btn mp-btn--small mp-btn--ghost",
          disabled: !!busy,
          onClick: function () {
            run("check", function () {
              return M.checkUpdates().then(function (ids) {
                return ids.length ? null : { text: "Everything is up to date" };
              });
            });
          },
        },
        busy === "check" ? h("i", { className: "mp-spinner" }) : h(Ic, { name: "refresh" }),
        "Check"
      ),
      count
        ? h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--small mp-btn--accent",
              disabled: !!busy,
              onClick: function () {
                run("update", function () {
                  var ids = M.updates();
                  return confirmUpdates(ids).then(function (yes) {
                    if (!yes) return null;
                    return M.updateAll(ids);
                  }).then(function (result) {
                    if (!result) return null;
                    return result.failed.length
                      ? { text: result.failed.join(" · "), error: true }
                      : { text: result.updated === 1 ? "1 item updated" : result.updated + " items updated" };
                  });
                });
              },
            },
            busy === "update" ? h("i", { className: "mp-spinner" }) : h(Ic, { name: "download" }),
            count === 1 ? "Update" : "Update all"
          )
        : null
    );
  }

  function InstalledTab(props) {
    var map = M.installed();
    var q = props.query;
    var ids = Object.keys(map)
      .filter(function (id) {
        return matches(q, [map[id].item.name, map[id].item.description]);
      })
      .sort(function (a, b) {
        return map[b].installedAt - map[a].installedAt;
      });
    var R = SpotiKit.React;
    var tick = R.useReducer(function (x) {
      return x + 1;
    }, 0)[1];
    R.useEffect(function () {
      return SpotiKit.Themes.on("change", tick);
    }, []);
    var localSchemes = R.useState({});
    R.useEffect(function () {
      SpotiKit.Themes.list()
        .then(function (list) {
          var byId = {};
          list.forEach(function (t) {
            byId[t.id] = t.schemes;
          });
          localSchemes[1](byId);
        })
        .catch(function () {});
    }, []);
    var now = SpotiKit.Themes.current;
    var fail = function (e) {
      notify(e.message, { type: "error", duration: 7000 });
    };
    var currentTheme = SpotiKit.Themes.current && SpotiKit.Themes.current.theme;
    var saved = SpotiKit.Storage.scope("themes").get("selection", null);
    var savedTheme = saved && saved.theme;
    var packagedRows = []
      .concat(
        SpotiKit.Config.themes.map(function (t) {
          return {
            key: "theme:" + t.id,
            kind: "Theme",
            group: "theme",
            icon: "edit-image",
            name: t.name,
            note: "Themes folder",
            schemes: localSchemes[0][t.id] || [],
            scheme: now && now.theme === t.id ? now.scheme : savedTheme === t.id ? saved.scheme : null,
            pickScheme: function (id) {
              SpotiKit.Themes.apply(t.id, id).catch(fail);
            },
            on: currentTheme === t.id || (!currentTheme && M.safeMode && savedTheme === t.id),
            idle: !currentTheme && M.safeMode && savedTheme === t.id,
            start: function () {
              SpotiKit.Themes.apply(t.id, saved.scheme).catch(fail);
            },
            toggle: function (on) {
              if (on) SpotiKit.Themes.apply(t.id).catch(fail);
              else SpotiKit.Themes.reset();
            },
          };
        }),
        internal.local.extensions().map(function (e) {
          return {
            key: "extension:" + e.path,
            kind: "Extension",
            group: "extension",
            icon: "experiment",
            name: e.name,
            note: "Extensions folder",
            on: e.on,
            idle: e.on && !e.loaded,
            start: function () {
              internal.local.setExtension(e.path, true);
              tick();
            },
            toggle: function (on) {
              if (internal.local.setExtension(e.path, on))
                internal.marketplace.markReload("local:" + e.path, "turned off", e.name);
              else internal.marketplace.clearReload("local:" + e.path);
              tick();
            },
          };
        }),
        internal.local.apps().map(function (a) {
          return {
            key: "app:" + a.id,
            kind: "Custom app",
            group: "app",
            icon: "apps",
            name: a.name,
            note: "Custom Apps folder",
            on: a.on,
            idle: a.on && M.safeMode && !startedApps[a.id],
            start: function () {
              startedApps[a.id] = true;
              internal.local.setApp(a.id, true).then(tick, fail);
              tick();
            },
            toggle: function (on) {
              startedApps[a.id] = on;
              internal.local.setApp(a.id, on).then(tick, fail);
              tick();
            },
          };
        }),
        internal.local.snippets().map(function (s) {
          return {
            key: "snippet:" + s.id,
            kind: "CSS snippet",
            group: "snippet",
            icon: "embed",
            name: s.name,
            note: "Snippets folder",
            on: s.on,
            idle: s.on && M.safeMode && !s.loaded,
            start: function () {
              internal.local.setSnippet(s.id, true).then(tick, fail);
            },
            toggle: function (on) {
              internal.local.setSnippet(s.id, on).then(tick, fail);
              tick();
            },
          };
        })
      )
      .filter(function (row) {
        return matches(q, [row.name, row.kind]);
      });
    var act = function (run) {
      return function (e) {
        e.stopPropagation();
        run().catch(function (err) {
          notify(err.message, { type: "error", duration: 7000 });
        });
      };
    };
    var marketRow = function (id, index) {
      var r = map[id];
      var item = r.item;
      var busy = internal.marketplace.busy()[id];
      var status = r.blocked
        ? { cls: "error", text: "Removed by SpotiKit: " + r.blocked }
        : r.error
        ? { cls: "error", text: "Failed: " + r.error }
        : r.updateAvailable && !r.rolledBack
          ? { cls: "update", text: "Update available" }
          : !r.enabled
            ? { cls: "off", text: "Turned off" }
            : M.safeMode && !internal.marketplace.isRunning(id)
              ? { cls: "warn", text: "Not started: safe mode" }
              : internal.marketplace.isPaused(id)
                ? { cls: "warn", text: "Paused: " + item.compatibility.detail }
                : internal.marketplace.isRunning(id)
                  ? { cls: "on", text: "Loaded" }
                  : { cls: "off", text: "Starts with Spotify" };
      return h(
        "div",
        {
          key: id,
          className: "mp-list-row",
          style: { "--i": index },
          onClick: function () {
            props.onOpen(item);
          },
        },
        h(Preview, { src: item.preview, name: item.name }),
        h(
          "div",
          { className: "mp-list-main" },
          h("b", null, item.name),
          h(
            "span",
            { className: "mp-list-meta" },
            (KIND_LABEL[r.kind] || "Item") +
              " · " +
              formatBytes(r.size) +
              " · installed " +
              when(r.installedAt) +
              (r.hasBackup && !r.rolledBack ? " · earlier version kept" : "") +
              (r.autoUpdate ? " · updates by itself" : "")
          ),
          h("span", { className: "mp-status mp-status--" + status.cls }, h("i"), status.text),
          r.rolledBack
            ? h(
                "span",
                { className: "mp-status mp-status--warn" },
                h("i"),
                "Rolled back to the version you installed " + when(r.rolledBack.to || r.updatedAt) + ". Update gets you the newest one."
              )
            : null
        ),
        h(
          "div",
          { className: "mp-list-actions" },
          busy ? h("i", { className: "mp-spinner" }) : null,
          r.updateAvailable && !busy
            ? h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--small mp-btn--accent",
                  onClick: act(function () {
                    return confirmUpdates([id]).then(function (yes) {
                      return yes ? M.install(id) : null;
                    });
                  }),
                },
                "Update"
              )
            : null,
          internal.marketplace.isPaused(id)
            ? h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--small",
                  onClick: act(function () {
                    return M.runAnyway(id);
                  }),
                },
                "Run anyway"
              )
            : M.safeMode && r.enabled && !internal.marketplace.isRunning(id)
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "mp-btn mp-btn--small",
                    onClick: act(function () {
                      return M.startNow(id);
                    }),
                  },
                  "Start"
                )
              : null,
          h(LiquidToggle, {
            checked: r.enabled,
            label: r.enabled ? "Turn off" : "Turn on",
            onChange: function (on) {
              M.setEnabled(id, on).catch(function (e) {
                notify(e.message, { type: "error", duration: 7000 });
              });
            },
          }),
          r.hasBackup && !r.rolledBack
            ? h(
                Tip,
                { label: "Roll back" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "mp-icon-btn",
                    "aria-label": "Roll back",
                    onClick: function (e) {
                      e.stopPropagation();
                      confirmRollback(item);
                    },
                  },
                  h(Ic, { name: "chevron-left" })
                )
              )
            : null,
          h(
            Tip,
            { label: "Remove" },
            h(
              "button",
              {
                type: "button",
                className: "mp-icon-btn",
                "aria-label": "Remove",
                onClick: function (e) {
                  e.stopPropagation();
                  confirmAndRun(
                    "Remove " + item.name + "?",
                    "Its files are deleted from this device.",
                    "Remove",
                    function () {
                      return M.uninstall(id);
                    }
                  );
                },
              },
              h(Ic, { name: "trash" })
            )
          )
        )
      );
    };
    var localRow = function (row, index) {
      return h(
        "div",
        { key: row.key, className: "mp-list-row is-static", style: { "--i": index } },
        h("span", { className: "mp-list-tile" }, h(Ic, { name: row.icon })),
        h(
          "div",
          { className: "mp-list-main" },
          h("b", null, row.name),
          h("span", { className: "mp-list-meta" }, row.kind + " · " + row.note),
          h(
            "span",
            { className: "mp-status mp-status--" + (row.on ? (row.idle ? "warn" : "on") : "off") },
            h("i"),
            row.on ? (row.idle && M.safeMode ? "Not started: safe mode" : "On") : "Turned off"
          )
        ),
        h(
          "div",
          { className: "mp-list-actions" },
          row.schemes && row.schemes.length > 1
            ? h(Dropdown, {
                float: true,
                label: "Scheme",
                value: row.scheme || row.schemes[0].id,
                options: row.schemes.map(function (s) {
                  return { value: s.id, label: s.name };
                }),
                onChange: row.pickScheme,
              })
            : null,
          row.idle && M.safeMode
            ? h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--small",
                  onClick: row.start,
                },
                "Start"
              )
            : null,
          h(LiquidToggle, {
            checked: row.on,
            label: row.on ? "Turn off" : "Turn on",
            onChange: function (on) {
              row.toggle(on);
            },
          })
        )
      );
    };
    var index = 0;
    var kindOf = function (id) {
      return KIND_LABEL[map[id].kind] ? map[id].kind : "other";
    };
    var grouped = function (entries, kind, render) {
      return GROUPS.map(function (g) {
        var rows = entries.filter(function (entry) {
          return kind(entry) === g.kind;
        });
        if (!rows.length) return null;
        return h(
          "section",
          { key: g.kind, className: "mp-group" },
          h(
            "div",
            { className: "mp-group-head" },
            h(Ic, { name: g.icon, className: "mp-group-icon" }),
            h("h4", { className: "mp-section-title" }, g.label),
            h("span", { className: "mp-count" }, rows.length)
          ),
          h(
            "div",
            { className: "mp-list" },
            rows.map(function (entry) {
              return render(entry, index++);
            })
          )
        );
      }).filter(Boolean);
    };
    return h(
      "div",
      { className: "mp-installed" },
      q ? null : h(ProfilesSection),
      h(
        "div",
        { className: "mp-section-head" },
        h("h3", { className: "mp-source-title" }, "From the marketplace"),
        ids.length ? h(UpdatesBar) : null
      ),
      ids.length
        ? grouped(ids, kindOf, marketRow)
        : q
          ? h("p", { className: "mp-muted mp-gap" }, "Nothing installed matches “" + q + "”.")
          : h(Empty, {
              icon: "download",
              title: "Nothing installed from the marketplace yet",
              text: "Themes, extensions, apps and snippets you install show up here, sorted by kind.",
            }),
      packagedRows.length ? h("h3", { className: "mp-source-title" }, "From the SpotiKit app") : null,
      packagedRows.length
        ? grouped(
            packagedRows,
            function (row) {
              return row.group;
            },
            localRow
          )
        : null,
      packagedRows.length
        ? h(
            "p",
            { className: "mp-muted mp-hint" },
            "Add or remove these in the SpotiKit app on your computer, on the Developer page. Turning one on or off here takes effect right away; extensions you turn off stop at the next reload."
          )
        : null
    );
  }

  function SnippetsTab(props) {
    var R = SpotiKit.React;
    var draft = R.useState(null);
    var list = M.snippets.list().filter(function (s) {
      return matches(props.query, [s.name, s.css]);
    });
    var d = draft[0];
    var save = function () {
      if (!d.name.trim() || !d.css.trim()) {
        notify("A snippet needs a name and some CSS", { type: "error" });
        return;
      }
      M.snippets.save({ id: d.id, name: d.name.trim(), css: d.css });
      draft[1](null);
    };
    return h(
      "div",
      { className: "mp-snippets" },
      h("h3", { className: "mp-section-title" }, "Your own snippets"),
      h(
        "p",
        { className: "mp-muted mp-gap-small" },
        M.safeMode
          ? "Safe mode: only snippets you turn on or save now apply. The others come back when you leave safe mode."
          : "Kept on this device and switched on and off right away."
      ),
      d
        ? h(
            "div",
            { className: "mp-editor" },
            h("input", {
              className: "mp-input",
              placeholder: "Name",
              value: d.name,
              autoFocus: true,
              onChange: function (e) {
                draft[1](Object.assign({}, d, { name: e.target.value }));
              },
            }),
            h("textarea", {
              className: "mp-input mp-code",
              placeholder: ".main-view-panel { border-radius: 20px; }",
              spellCheck: false,
              value: d.css,
              rows: 8,
              onChange: function (e) {
                draft[1](Object.assign({}, d, { css: e.target.value }));
              },
            }),
            h(
              "div",
              { className: "mp-row-actions" },
              h(
                "button",
                { type: "button", className: "mp-btn mp-btn--accent", onClick: save },
                h(Ic, { name: "check" }),
                "Save snippet"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "mp-btn mp-btn--ghost",
                  onClick: function () {
                    draft[1](null);
                  },
                },
                "Cancel"
              )
            )
          )
        : h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--accent mp-new",
              onClick: function () {
                draft[1]({ name: "", css: "" });
              },
            },
            h(Ic, { name: "plus" }),
            "New snippet"
          ),
      list.length
        ? h(
            "div",
            { className: "mp-list" },
            list.map(function (s, i) {
              return h(
                "div",
                { key: s.id, className: "mp-list-row", style: { "--i": i } },
                h(
                  "div",
                  { className: "mp-list-main" },
                  h("b", null, s.name),
                  h("code", { className: "mp-snippet-code" }, s.css.slice(0, 140))
                ),
                h(
                  "div",
                  { className: "mp-list-actions" },
                  h(LiquidToggle, {
                    checked: s.enabled,
                    label: s.enabled ? "Turn off" : "Turn on",
                    onChange: function (on) {
                      M.snippets.toggle(s.id, on);
                    },
                  }),
                  h(
                    Tip,
                    { label: "Edit" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "mp-icon-btn",
                        "aria-label": "Edit",
                        onClick: function () {
                          draft[1]({ id: s.id, name: s.name, css: s.css });
                        },
                      },
                      h(Ic, { name: "edit" })
                    )
                  ),
                  h(
                    Tip,
                    { label: "Delete" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "mp-icon-btn",
                        "aria-label": "Delete",
                        onClick: function () {
                          M.snippets.remove(s.id);
                        },
                      },
                      h(Ic, { name: "trash" })
                    )
                  )
                )
              );
            })
          )
        : null
    );
  }

  function useAnchorRect(anchor, active) {
    var R = SpotiKit.React;
    var rect = R.useState(null);
    R.useLayoutEffect(
      function () {
        if (!active || !anchor.current) return undefined;
        var frame = 0;
        var read = function () {
          frame = 0;
          var el = anchor.current;
          if (!el) return;
          var b = el.getBoundingClientRect();
          rect[1](function (old) {
            return old && old.top === b.top && old.left === b.left && old.width === b.width && old.height === b.height
              ? old
              : { top: b.top, left: b.left, width: b.width, height: b.height };
          });
        };
        var schedule = function () {
          if (!frame) frame = requestAnimationFrame(read);
        };
        read();
        var observer = new ResizeObserver(schedule);
        observer.observe(anchor.current);
        document.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        return function () {
          cancelAnimationFrame(frame);
          observer.disconnect();
          document.removeEventListener("scroll", schedule, true);
          window.removeEventListener("resize", schedule);
        };
      },
      [active]
    );
    return active ? rect[0] : null;
  }

  function Floating(props) {
    var stop = function (e) {
      e.stopPropagation();
    };
    var r = props.rect;
    if (!r) return null;
    return overBody(
      h(
        "div",
        {
          className: "mp-floating" + (props.className ? " " + props.className : ""),
          style: { top: r.top, left: r.left, width: r.width, height: r.height },
          onClick: stop,
          onMouseDown: stop,
          onKeyDown: props.onKeyDown,
        },
        props.children
      )
    );
  }

  function Dropdown(props) {
    var R = SpotiKit.React;
    var state = R.useState("closed");
    var active = R.useState(0);
    var root = R.useRef(null);
    var menuRef = R.useRef(null);
    var phase = state[0];
    var rect = useAnchorRect(root, !!props.float && phase !== "closed");
    var selected = props.options.findIndex(function (o) {
      return o.value === props.value;
    });

    var open = function () {
      active[1](Math.max(0, selected));
      state[1]("open");
    };
    var close = function () {
      state[1](function (s) {
        return s === "open" ? "closing" : s;
      });
    };
    var choose = function (option) {
      if (option.value !== props.value) props.onChange(option.value);
      close();
    };

    R.useEffect(
      function () {
        if (phase === "closing") {
          var t = setTimeout(function () {
            state[1]("closed");
          }, 180);
          return function () {
            clearTimeout(t);
          };
        }
        if (phase !== "open") return;
        var outside = function (e) {
          if (
            root.current &&
            !root.current.contains(e.target) &&
            !(menuRef.current && menuRef.current.contains(e.target))
          )
            close();
        };
        document.addEventListener("mousedown", outside, true);
        return function () {
          document.removeEventListener("mousedown", outside, true);
        };
      },
      [phase]
    );

    var onKey = function (e) {
      if (phase !== "open") {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
        return;
      }
      var n = props.options.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active[1]((active[0] + 1) % n);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active[1]((active[0] - 1 + n) % n);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(props.options[active[0]]);
      } else if (e.key === "Escape" || e.key === "Tab") {
        close();
      }
    };

    var current = props.options[selected] || (props.placeholder ? null : props.options[0]);
    var menu =
      phase !== "closed"
        ? h(
            "div",
            { className: "mp-dd-menu" + (phase === "closing" ? " is-closing" : ""), role: "listbox", ref: menuRef },
            props.options.map(function (option, i) {
              var isSelected = option.value === props.value;
              return h(
                "button",
                {
                  key: option.value,
                  type: "button",
                  role: "option",
                  "aria-selected": isSelected,
                  style: { "--i": Math.min(i, 12) },
                  className: "mp-dd-item" + (i === active[0] ? " is-active" : "") + (isSelected ? " is-selected" : ""),
                  onMouseEnter: function () {
                    active[1](i);
                  },
                  onClick: function () {
                    choose(option);
                  },
                },
                h("span", null, option.label),
                isSelected ? h(Ic, { name: "check", size: 14 }) : null
              );
            })
          )
        : null;
    return h(
      "div",
      {
        className: "mp-dd" + (phase === "open" ? " is-open" : "") + (props.className ? " " + props.className : ""),
        ref: root,
        onKeyDown: onKey,
      },
      h(
        "button",
        {
          type: "button",
          className: "mp-dd-trigger",
          "aria-haspopup": "listbox",
          "aria-expanded": phase === "open",
          onClick: function (e) {
            if (props.float) e.stopPropagation();
            phase === "open" ? close() : open();
          },
        },
        props.icon ? h(Ic, { name: props.icon }) : null,
        props.label ? h("span", { className: "mp-dd-label" }, props.label) : null,
        h("b", { className: current ? "" : "is-placeholder" }, current ? current.label : props.placeholder),
        h(Ic, { name: "chevron-down", className: "mp-dd-chevron", size: 14 })
      ),
      props.float
        ? menu
          ? h(
              Floating,
              {
                rect: rect,
                className:
                  "mp-floating--menu" + (/mp-dd--block/.test(props.className || "") ? " mp-floating--block" : ""),
                onKeyDown: onKey,
              },
              menu
            )
          : null
        : menu
    );
  }

  function ChipRow(props) {
    var R = SpotiKit.React;
    var row = R.useRef(null);
    var ends = R.useState({ start: true, end: true });
    var update = R.useCallback(function () {
      var el = row.current;
      if (!el) return;
      var next = { start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 };
      ends[1](function (old) {
        return old.start === next.start && old.end === next.end ? old : next;
      });
    }, []);
    R.useEffect(
      function () {
        update();
        var observer = new ResizeObserver(update);
        observer.observe(row.current);
        Array.prototype.forEach.call(row.current.children, function (child) {
          observer.observe(child);
        });
        return function () {
          observer.disconnect();
        };
      },
      [props.count]
    );
    var by = function (direction) {
      var el = row.current;
      el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
    };
    var arrow = function (direction) {
      var hidden = direction < 0 ? ends[0].start : ends[0].end;
      return h(
        "button",
        {
          type: "button",
          className: "mp-chip-arrow" + (direction < 0 ? " is-start" : " is-end") + (hidden ? " is-hidden" : ""),
          "aria-label": direction < 0 ? "Scroll left" : "Scroll right",
          tabIndex: hidden ? -1 : 0,
          onClick: function () {
            by(direction);
          },
        },
        h(Ic, { name: direction < 0 ? "chevron-left" : "chevron-right" })
      );
    };
    return h(
      "div",
      { className: "mp-chips-wrap" + (ends[0].start ? "" : " has-start") + (ends[0].end ? "" : " has-end") },
      h("div", { className: "mp-chips", ref: row, onScroll: update }, props.children),
      arrow(-1),
      arrow(1)
    );
  }

  function Tabs(props) {
    var R = SpotiKit.React;
    var row = R.useRef(null);
    var pill = R.useState(null);
    R.useLayoutEffect(
      function () {
        var el = row.current && row.current.querySelector('[aria-selected="true"]');
        if (!el) return undefined;
        var measure = function () {
          pill[1](function (old) {
            return old && old.left === el.offsetLeft && old.width === el.offsetWidth
              ? old
              : { left: el.offsetLeft, width: el.offsetWidth };
          });
        };
        measure();
        var observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(row.current);
        return function () {
          observer.disconnect();
        };
      },
      [props.active]
    );

    return h(
      "div",
      { className: "mp-tabs", role: "tablist", ref: row },
      pill[0]
        ? h("span", {
            className: "mp-tab-pill",
            style: { transform: "translateX(" + pill[0].left + "px)", width: pill[0].width },
          })
        : null,
      TABS.filter(function (tab) {
        return !tab.account || M.account.available;
      }).map(function (tab) {
        var count = props.counts[tab.id];
        var active = props.active === tab.id;
        var nameIfHidden = function (button) {
          var names = button.querySelectorAll(".mp-tab-long,.mp-tab-short");
          return Array.prototype.every.call(names, function (n) {
            return n.offsetParent === null;
          })
            ? tab.label
            : "";
        };
        return h(
          Tip,
          { key: tab.id, label: nameIfHidden, placement: "bottom" },
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": active,
              "aria-label": tab.label,
              className: "mp-tab" + (active ? " is-active" : ""),
              onClick: function () {
                props.onChange(tab.id);
              },
            },
            h(Ic, { name: tab.icon, className: "mp-tab-icon" }),
            h("span", { className: "mp-tab-long" }, tab.label),
            h("span", { className: "mp-tab-short" }, tab.short),
            count
              ? h(
                  "span",
                  {
                    className: "mp-count" + (tab.id === "installed" && props.updates ? " has-update" : ""),
                    title:
                      tab.id === "installed" && props.updates
                        ? props.updates === 1
                          ? "1 update available"
                          : props.updates + " updates available"
                        : undefined,
                  },
                  count
                )
              : null
          )
        );
      })
    );
  }

  var BATCH = 48;
  function CardGrid(props) {
    var R = SpotiKit.React;
    var limit = R.useState(BATCH);
    var end = R.useRef(null);
    var more = props.items.length > limit[0];
    R.useEffect(
      function () {
        if (!more || !end.current) return undefined;
        var observer = new IntersectionObserver(
          function (entries) {
            if (
              entries.some(function (e) {
                return e.isIntersecting;
              })
            )
              limit[1](function (n) {
                return n + BATCH;
              });
          },
          { rootMargin: "800px 0px" }
        );
        observer.observe(end.current);
        return function () {
          observer.disconnect();
        };
      },
      [more, limit[0]]
    );
    return h(
      R.Fragment,
      null,
      h(
        "div",
        { className: "mp-grid" },
        props.items.slice(0, limit[0]).map(function (item, index) {
          return h(Card, {
            key: item.id,
            item: item,
            index: index % BATCH,
            ratingSource: props.ratingSource,
            onOpen: function () {
              props.onOpen(item);
            },
          });
        })
      ),
      more ? h("div", { className: "mp-more", ref: end }, h("i", { className: "mp-spinner" })) : null
    );
  }

  var REASON_TEXT = {
    installed: "installed",
    "turned on": "turned on",
    updated: "updated",
    disabled: "turned off",
    removed: "removed",
    "rolled back": "rolled back",
    "switched on": "turned on",
    "switched off": "turned off",
  };
  var RECOMMENDED_ONLY = { installed: true, "turned on": true };

  function ReloadPrompt(props) {
    var R = SpotiKit.React;
    var phase = R.useState(props.open ? "open" : "closed");
    var shown = R.useRef(props.pending);
    if (props.open) shown.current = props.pending;
    R.useEffect(
      function () {
        if (props.open) {
          phase[1]("open");
          return undefined;
        }
        if (phase[0] !== "open") return undefined;
        phase[1]("closing");
        var t = setTimeout(function () {
          phase[1]("closed");
        }, 280);
        return function () {
          clearTimeout(t);
        };
      },
      [props.open]
    );
    if (phase[0] === "closed") return null;

    var pending = shown.current;
    var ids = Object.keys(pending);
    var needed = ids.some(function (id) {
      return !RECOMMENDED_ONLY[pending[id].reason];
    });
    return h(
      "div",
      { id: "spotikit-reload-prompt" },
      h(
        PopIn,
        {
          className: "mp-prompt" + (phase[0] === "closing" ? " is-closing" : ""),
          attrs: { role: "dialog", "aria-label": "Reload Spotify" },
        },
        h(
          "div",
          { className: "mp-prompt-head" },
          h("span", { className: "mp-prompt-icon" }, h(Ic, { name: "refresh", size: 18 })),
          h(
            "div",
            null,
            h("b", null, needed ? "Reload to finish" : "Reload for a clean start"),
            h(
              "p",
              null,
              needed
                ? "Scripts you turned off, removed or updated keep running until Spotify reloads, and settings apply at the next start. Make more changes first if you like, then reload once."
                : "It's on already. Some extensions and apps only set themselves up when Spotify starts, so a reload makes sure they run completely. Install more first if you like, then reload once."
            )
          )
        ),
        h(
          "div",
          { className: "mp-prompt-list" },
          ids.map(function (id) {
            return h(
              "span",
              { key: id, className: "mp-tag" },
              pending[id].name + " · " + (REASON_TEXT[pending[id].reason] || pending[id].reason)
            );
          })
        ),
        h(
          "div",
          { className: "mp-prompt-actions" },
          h("button", { type: "button", className: "mp-btn mp-btn--ghost", onClick: props.onLater }, "Later"),
          h(
            "button",
            {
              type: "button",
              className: "mp-btn mp-btn--accent",
              onClick: function () {
                location.reload();
              },
            },
            h(Ic, { name: "refresh" }),
            "Reload now"
          )
        )
      )
    );
  }

  var promptDismissed = "";
  var promptEvents = new internal.Emitter("ReloadPrompt");

  function reloadSignature(pending) {
    return Object.keys(pending)
      .map(function (id) {
        return id + ":" + pending[id].reason;
      })
      .sort()
      .join("|");
  }

  function showReloadPrompt() {
    promptDismissed = "";
    promptEvents.emit("change");
  }

  function ReloadHost() {
    var R = SpotiKit.React;
    useMarketplace();
    var tick = R.useReducer(function (x) {
      return x + 1;
    }, 0)[1];
    R.useEffect(function () {
      return promptEvents.on("change", tick);
    }, []);
    var pending = M.pendingReload;
    var signature = reloadSignature(pending);
    return h(ReloadPrompt, {
      open: !!signature && signature !== promptDismissed,
      pending: pending,
      onLater: function () {
        promptDismissed = signature;
        promptEvents.emit("change");
      },
    });
  }

  function Page() {
    var R = SpotiKit.React;
    useMarketplace();
    var tab = R.useState(SpotiKit.Storage.scope("marketplace").get("tab", "theme"));
    var query = R.useState("");
    var tag = R.useState(null);
    var sort = R.useState(function () {
      var saved = SpotiKit.Storage.scope("marketplace").get("sort", null);
      if (saved === "rated" && !M.account.available) return "popular";
      return saved || (M.account.available ? "rated" : "popular");
    });
    var open = R.useState(null);
    var focus = R.useState(null);
    var sharedOpen = R.useState(null);
    R.useEffect(function () {
      pageApi.showSchemes = function (item) {
        open[1](item);
        focus[1]("schemes:" + Date.now());
      };
      pageApi.openShared = function (profile) {
        sharedOpen[1]({ profile: profile, own: !!profile.mine });
      };
      return function () {
        pageApi.showSchemes = null;
        pageApi.openShared = null;
      };
    }, []);
    var loading = R.useState(!M.catalog);
    var refreshing = R.useState(false);
    var stuck = R.useState(false);
    var sentinel = R.useRef(null);
    var stickyRow = R.useRef(null);
    var stackedRow = useStacked(stickyRow);

    var load = function (force) {
      refreshing[1](true);
      return M.refresh(force).then(
        function () {
          loading[1](false);
          refreshing[1](false);
          Object.keys(M.installed()).forEach(function (id) {
            M.checkUpdate(id).catch(function () {});
          });
        },
        function () {
          loading[1](false);
          refreshing[1](false);
        }
      );
    };
    R.useEffect(function () {
      load(false);
    }, []);
    var showLinked = function (promise) {
      return promise.then(
        function (item) {
          if (!item) return;
          focus[1](null);
          open[1](item);
        },
        function (error) {
          notify(error.message, { type: "error", duration: 7000 });
        }
      );
    };
    R.useEffect(function () {
      var follow = function (path) {
        var parts = path
          .slice(PATH.length + 1)
          .split("/")
          .map(decodeURIComponent);
        if (parts[0] === "signin" && parts[1]) {
          SpotiKit.Navigation.replace(PATH);
          M.account.finish(parts[1]).catch(fail);
          return;
        }
        if (parts[0] === "profile" && parts[1]) {
          SpotiKit.Navigation.replace(PATH);
          if (M.account.available) openShared(parts[1]);
          return;
        }
        if (parts[0] !== "install" || !parts[1] || !parts[2]) return;
        SpotiKit.Navigation.replace(PATH);
        showLinked(openLink(parts[1] + "/" + parts[2], parts[3]));
      };
      follow(SpotiKit.Navigation.path);
      return SpotiKit.Navigation.on("change", follow);
    }, []);

    var setTab = function (id) {
      tab[1](id);
      tag[1](null);
      SpotiKit.Storage.scope("marketplace").set("tab", id);
      var mark = sentinel.current;
      var scroller =
        mark &&
        (mark.closest("[data-overlayscrollbars-viewport]") ||
          mark.closest(".main-view-container__scroll-node") ||
          document.scrollingElement);
      if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
    };

    var setSort = function (value) {
      sort[1](value);
      SpotiKit.Storage.scope("marketplace").set("sort", value);
    };

    var catalog = M.catalog;
    var items = catalog ? catalog.items : [];
    var installedMap = M.installed();
    var kindOfTab = tab[0] === "snippets" ? "snippet" : tab[0];
    var counts = {
      theme: items.filter(function (i) {
        return i.kind === "theme";
      }).length,
      extension: items.filter(function (i) {
        return i.kind === "extension";
      }).length,
      app: items.filter(function (i) {
        return i.kind === "app";
      }).length,
      snippets:
        items.filter(function (i) {
          return i.kind === "snippet";
        }).length + M.snippets.list().length,
      installed: Object.keys(installedMap).length,
    };
    var q = query[0].trim().toLowerCase();
    var inTab = items.filter(function (i) {
      return i.kind === kindOfTab;
    });
    var tagCount = {};
    inTab.forEach(function (i) {
      i.tags.forEach(function (t) {
        tagCount[t] = (tagCount[t] || 0) + 1;
      });
    });
    var tags = Object.keys(tagCount).sort(function (a, b) {
      return tagCount[b] - tagCount[a] || a.localeCompare(b);
    });
    var shown = inTab
      .filter(function (i) {
        if (tag[0] && i.tags.indexOf(tag[0]) < 0) return false;
        if (!q) return true;
        return (
          [
            i.name,
            i.description,
            i.tags.join(" "),
            i.authors
              .map(function (a) {
                return a.name;
              })
              .join(" "),
            i.source.repo,
          ]
            .join(" ")
            .toLowerCase()
            .indexOf(q) >= 0
        );
      })
      .sort(function (a, b) {
        if (sort[0] === "installed")
          return (installedMap[b.id] ? 1 : 0) - (installedMap[a.id] ? 1 : 0) || a.name.localeCompare(b.name);
        if (sort[0] === "popular") return (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name);
        if (sort[0] === "rated")
          return (
            M.ratings.score(b.id) - M.ratings.score(a.id) ||
            (b.stars || 0) - (a.stars || 0) ||
            a.name.localeCompare(b.name)
          );
        if (sort[0] === "updated")
          return String(b.updated || "").localeCompare(String(a.updated || "")) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
    var progress = catalog && catalog.progress && catalog.progress[kindOfTab];
    var stillLoading = !!(catalog && catalog.loading);
    var reload = M.pendingReload;
    var reloadIds = Object.keys(reload);

    R.useEffect(function () {
      var frame = 0;
      var check = function () {
        frame = 0;
        var mark = sentinel.current;
        if (!mark) return;
        var scroller =
          mark.closest("[data-overlayscrollbars-viewport]") ||
          mark.closest(".main-view-container__scroll-node") ||
          document.documentElement;
        stuck[1](mark.getBoundingClientRect().top < scroller.getBoundingClientRect().top + 11);
      };
      var onScroll = function () {
        if (!frame) frame = requestAnimationFrame(check);
      };
      document.addEventListener("scroll", onScroll, true);
      check();
      return function () {
        document.removeEventListener("scroll", onScroll, true);
        cancelAnimationFrame(frame);
      };
    }, []);
    var isCatalogTab = tab[0] === "theme" || tab[0] === "extension" || tab[0] === "app" || tab[0] === "snippets";
    var waiting = !catalog || (stillLoading && !inTab.length) || (loading[0] && !inTab.length);
    var onOpen = function (item) {
      focus[1](null);
      open[1](item);
    };

    var grid;
    if (waiting) {
      grid = h(SkeletonGrid);
    } else if (!inTab.length && !q && !tag[0]) {
      grid = h(Empty, {
        icon: "info",
        title: "Nothing here yet",
        text: "Themes, extensions, apps and snippets made for SpotiKit show up here as soon as their makers publish them.",
      });
    } else if (!shown.length) {
      grid = h(Empty, {
        title:
          q || tag[0] ? "Nothing matches" + (q ? " “" + query[0] + "”" : " this filter") : "Nothing here yet",
        text: q || tag[0] ? "Try another word, or clear the filter." : null,
      });
    } else {
      grid = h(CardGrid, {
        key: tab[0] + "|" + tag[0] + "|" + sort[0] + "|" + q,
        items: shown,
        onOpen: onOpen,
        ratingSource: sort[0] === "popular" ? "github" : "reviews",
      });
    }

    var body;
    if (tab[0] === "installed") body = h(InstalledTab, { query: q, onOpen: onOpen });
    else if (tab[0] === "shared") body = M.account.available
          ? h(SharedTab, {
              query: q,
              onOpen: function (profile, own) {
                sharedOpen[1]({ profile: profile, own: own });
              },
            })
          : grid;
    else if (tab[0] === "snippets")
      body = h(
        SpotiKit.React.Fragment,
        null,
        h(SnippetsTab, { query: q }),
        h("div", { className: "mp-gap" }),
        inTab.length ? h("h3", { className: "mp-section-title" }, "From the Marketplace") : null,
        grid
      );
    else body = grid;

    return h(
      "div",
      { className: "mp-page" },
      h(
        "header",
        { className: "mp-header" },
        h(
          "div",
          { className: "mp-title" },
          h("span", { className: "mp-title-icon", dangerouslySetInnerHTML: { __html: SHOP_ICON_ACTIVE } }),
          h("div", null, h("h1", null, "Marketplace"), h("span", null, "Themes, extensions and apps for Spotify"))
        ),
        h("div", { className: "mp-header-tools" }, h(AccountButton))
      ),

      M.safeMode
        ? h(
            "div",
            { className: "mp-banner" },
            h(Ic, { name: "info" }),
            h(
              "span",
              null,
              "Safe mode: nothing was started. Start them one at a time under Installed to find the one causing trouble."
            ),
            h(
              "button",
              { type: "button", className: "mp-btn mp-btn--small", onClick: M.leaveSafeMode },
              "Leave safe mode"
            )
          )
        : null,
      M.skipped
        ? h(
            "div",
            { className: "mp-banner mp-banner--warn" },
            h(Ic, { name: "warning" }),
            h(
              "span",
              null,
              "Marketplace content was skipped at this start, because Spotify didn't finish starting twice in a row. Check your installed items, then reload."
            )
          )
        : null,
      catalog && catalog.errors.length && isCatalogTab
        ? h(
            "div",
            { className: "mp-banner mp-banner--warn" },
            h(Ic, { name: "warning" }),
            h(
              "span",
              null,
              catalog.errors
                .map(function (e) {
                  return e.repo + ": " + e.message;
                })
                .join(" · ")
            )
          )
        : null,

      h("div", { className: "mp-sentinel", ref: sentinel }),
      h(
        "div",
        { className: "mp-sticky" + (stuck[0] ? " is-stuck" : "") },
        h(
          "div",
          { className: "mp-sticky-row" + (stackedRow ? " is-stacked" : ""), ref: stickyRow },
          h(Tabs, { active: tab[0], counts: counts, updates: M.updates().length, onChange: setTab }),
          h(
            "div",
            { className: "mp-sticky-tools" },
            h(
              "div",
              { className: "mp-search" },
              h(Ic, { name: "search" }),
              h("input", {
                value: query[0],
                placeholder:
                  "Search " +
                  (
                    TABS.find(function (t) {
                      return t.id === tab[0];
                    }) || TABS[0]
                  ).label.toLowerCase(),
                onChange: function (e) {
                  query[1](e.target.value);
                },
                spellCheck: false,
              }),
              query[0]
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "mp-search-clear",
                      "aria-label": "Clear",
                      onClick: function () {
                        query[1]("");
                      },
                    },
                    h(Ic, { name: "x", size: 12 })
                  )
                : null
            ),
            reloadIds.length
              ? h(
                  Tip,
                  { label: "Changes wait for a reload" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "mp-reload-pill",
                      onClick: showReloadPrompt,
                    },
                    h(Ic, { name: "refresh" }),
                    "Reload",
                    h("span", { className: "mp-count" }, reloadIds.length)
                  )
                )
              : null,
            h(
              Tip,
              { label: "Install from a GitHub link" },
              h(
                "button",
                {
                  type: "button",
                  className: "mp-icon-btn mp-refresh",
                  "aria-label": "Install from a GitHub link",
                  onClick: function () {
                    showLinked(askForLink());
                  },
                },
                h(Ic, { name: "link" })
              )
            ),
            h(
              Tip,
              { label: "Reload the catalog" },
              h(
                "button",
                {
                  type: "button",
                  className: "mp-icon-btn mp-refresh" + (refreshing[0] ? " is-spinning" : ""),
                  "aria-label": "Reload the catalog",
                  onClick: function () {
                    load(true);
                  },
                },
                h(Ic, { name: "refresh" })
              )
            )
          )
        ),
        isCatalogTab && inTab.length
          ? h(
              "div",
              { className: "mp-toolbar" },
              h(
                ChipRow,
                { count: tab[0] + tags.length },
                h(
                  "button",
                  {
                    type: "button",
                    className: "mp-chip" + (!tag[0] ? " is-on" : ""),
                    onClick: function () {
                      tag[1](null);
                    },
                  },
                  "All"
                ),
                tags.map(function (t) {
                  return h(
                    "button",
                    {
                      key: t,
                      type: "button",
                      className: "mp-chip" + (tag[0] === t ? " is-on" : ""),
                      onClick: function () {
                        tag[1](tag[0] === t ? null : t);
                      },
                    },
                    t
                  );
                })
              ),
              stillLoading && progress && !progress.done
                ? h(
                    Tip,
                    { label: "The catalog loads from GitHub, a hundred repositories at a time" },
                    h(
                      "span",
                      { className: "mp-loading" },
                      h("i", { className: "mp-spinner" }),
                      progress.total ? Math.min(progress.loaded, progress.total) + " of " + progress.total : "Loading"
                    )
                  )
                : null,
              h(Dropdown, {
                icon: "sort",
                label: "Sort",
                value: sort[0],
                onChange: setSort,
                options: (M.account.available ? [{ value: "rated", label: "Best rated" }] : [])
                  .concat([{ value: "popular", label: "Most GitHub stars" }])
                  .concat([
                    { value: "updated", label: "Recently updated" },
                    { value: "name", label: "Name" },
                    { value: "installed", label: "Installed first" },
                  ]),
              })
            )
          : null
      ),

      h("div", { className: "mp-body", key: tab[0] }, body),
      sharedOpen[0]
        ? overBody(
            h(SharedSheet, {
              key: sharedOpen[0].profile.id,
              profile: sharedOpen[0].profile,
              own: sharedOpen[0].own,
              onOpenItem: onOpen,
              onClose: function () {
                sharedOpen[1](null);
              },
            })
          )
        : null,
      open[0]
        ? overBody(
            h(Detail, {
              key: open[0].id,
              item: open[0],
              focus: focus[0],
              onClose: function () {
                open[1](null);
                focus[1](null);
              },
            })
          )
        : null
    );
  }

  var CSS = `
    .mp-page,
    .mp-sheet-backdrop,
    #spotikit-reload-prompt,
    .mp-confirm-backdrop,
    .mp-floating {
      --mp-glass: color-mix(in srgb, var(--text-base, #fff) 6%, transparent);
      --mp-glass-2: color-mix(in srgb, var(--text-base, #fff) 10%, transparent);
      --mp-line: color-mix(in srgb, var(--text-base, #fff) 9%, transparent);
      --mp-edge: inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent), inset 0 0 0 1px var(--mp-line);
      --mp-accent: var(--text-bright-accent, #1ed760);
      --mp-on-accent: var(--mp-on-accent-auto, #000);
      --mp-on-text: var(--mp-on-text-auto, #000);
      --mp-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
      --mp-spring-soft: cubic-bezier(0.3, 1.16, 0.5, 1);
      --mp-out: cubic-bezier(0.22, 1, 0.36, 1);
    }
    .mp-sheet.is-pre,
    .mp-prompt.is-pre,
    .mp-confirm.is-pre {
      opacity: 0;
      animation: none !important;
    }
    @keyframes mp-pop-in {
      0% {
        opacity: 0;
        transform: translateY(36px) scale(0.94);
        animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      }
      62% {
        opacity: 1;
        transform: translateY(-5px) scale(1.01);
        animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
      }
      82% {
        transform: translateY(2px) scale(0.998);
        animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
      }
      100% {
        opacity: 1;
        transform: none;
      }
    }
    @keyframes mp-pop-out {
      to {
        opacity: 0;
        transform: translateY(24px) scale(0.96);
      }
    }
    .mp-prompt.is-closing,
    .mp-confirm-backdrop.is-closing .mp-confirm {
      animation: mp-pop-out 0.26s cubic-bezier(0.5, 0, 0.75, 0.2) both;
      pointer-events: none;
    }
    .mp-page {
      --mp-pad: clamp(16px, 3vw, 40px);
      padding: 32px var(--mp-pad) 64px;
      color: var(--text-base);
      animation: mp-rise 0.5s var(--mp-out) backwards;
    }
    .mp-page :focus,
    .mp-page :focus-visible,
    .mp-sheet-backdrop :focus,
    .mp-sheet-backdrop :focus-visible,
    #spotikit-reload-prompt :focus,
    #spotikit-reload-prompt :focus-visible,
    .mp-confirm-backdrop :focus,
    .mp-confirm-backdrop :focus-visible,
    .mp-floating :focus,
    .mp-floating :focus-visible,
    button[data-mp-button]:focus-visible {
      outline: none !important;
    }
    .mp-sentinel {
      height: 0;
    }
    .main-view-panel:has(.mp-page) .top-bar-background {
      opacity: 0 !important;
    }
    .mp-sticky {
      position: sticky;
      top: 10px;
      z-index: 30;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0 calc(var(--mp-pad) * -1);
      padding: 12px max(var(--mp-pad), 26px);
    }
    .mp-sticky::before {
      content: "";
      position: absolute;
      inset: 0 10px;
      z-index: -1;
      pointer-events: none;
      opacity: 0;
      border-radius: 20px;
      background: transparent;
      backdrop-filter: blur(24px) saturate(1.6) brightness(0.7);
      box-shadow:
        var(--mp-edge),
        0 18px 34px -22px rgba(0, 0, 0, 0.85);
      transition: opacity 0.3s ease;
    }
    .mp-sticky.is-stuck::before {
      opacity: 1;
    }
    .mp-sticky-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .mp-sticky-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
    }
    .mp-sticky-row.is-stacked .mp-tabs {
      width: 100%;
      box-sizing: border-box;
      justify-content: space-between;
    }
    .mp-sticky-row.is-stacked .mp-sticky-tools {
      width: 100%;
      margin-left: 0;
    }
    .mp-sticky-row.is-stacked .mp-search {
      flex: 1;
      width: auto;
    }
    .mp-reload-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 40px;
      padding: 0 8px 0 14px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 13.5px;
      font-weight: 700;
      color: var(--mp-on-accent);
      background: var(--mp-accent);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.45s var(--mp-spring) backwards;
      transition: transform 0.35s var(--mp-spring);
    }
    .mp-reload-pill:hover {
      transform: scale(1.05);
    }
    .mp-reload-pill:active {
      transform: scale(0.95);
    }
    .mp-reload-pill .mp-count {
      color: inherit;
      background: rgba(0, 0, 0, 0.18);
    }
    #spotikit-reload-prompt {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 112px;
      z-index: 1001;
      display: flex;
      justify-content: center;
      padding: 0 16px;
      pointer-events: none;
    }
    .mp-prompt {
      pointer-events: auto;
      width: min(480px, 100%);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px 18px 16px;
      border-radius: 20px;
      color: var(--text-base, #fff);
      background: transparent;
      backdrop-filter: blur(28px) saturate(1.6) brightness(0.75);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 26%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 10%, transparent),
        0 30px 70px -20px rgba(0, 0, 0, 0.85);
      animation: mp-pop-in 0.62s both;
    }
    .mp-prompt {
      align-items: center;
      text-align: center;
    }
    .mp-prompt-head {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .mp-prompt-icon {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--mp-on-accent);
      background: var(--mp-accent);
      box-shadow: var(--mp-edge);
    }
    .mp-prompt b {
      display: block;
      margin-top: 2px;
      font-size: 16px;
      font-weight: 800;
    }
    .mp-prompt p {
      margin: 4px 0 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--text-subdued);
    }
    .mp-prompt-list {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
    }
    .mp-prompt-actions {
      display: flex;
      justify-content: center;
      gap: 10px;
      width: 100%;
      margin-top: 4px;
    }
    .mp-prompt-actions .mp-btn {
      flex: 1;
      height: 42px;
    }
    .mp-prompt-actions .mp-btn--accent:hover .mp-ic {
      transform: rotate(180deg);
    }
    .mp-prompt-actions .mp-ic {
      transition: transform 0.5s var(--mp-spring);
    }
    .mp-confirm-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      animation: mp-backdrop-in 0.25s ease both;
    }
    .mp-confirm-backdrop.is-closing {
      animation: mp-backdrop-out 0.28s ease both;
      pointer-events: none;
    }
    .mp-confirm {
      width: min(440px, 100%);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 26px 22px 20px;
      border-radius: 20px;
      text-align: center;
      color: var(--text-base, #fff);
      background: transparent;
      backdrop-filter: blur(30px) saturate(1.6) brightness(0.8);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 26%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 10%, transparent),
        0 40px 90px -24px rgba(0, 0, 0, 0.85);
      animation: mp-pop-in 0.6s both;
    }
    .mp-confirm {
      max-height: calc(100vh - 32px);
    }
    .mp-confirm > * {
      flex-shrink: 0;
    }
    .mp-confirm > .mp-confirm-points,
    .mp-confirm > .mp-confirm-choices {
      flex-shrink: 1;
      min-height: 72px;
      overflow-y: auto;
      overscroll-behavior: contain;
      box-sizing: border-box;
      margin-left: -4px;
      margin-right: -4px;
      width: calc(100% + 8px);
      padding: 2px 4px;
    }
    .mp-confirm > .mp-confirm-points::-webkit-scrollbar,
    .mp-confirm > .mp-confirm-choices::-webkit-scrollbar {
      width: 8px;
    }
    .mp-confirm > .mp-confirm-points::-webkit-scrollbar-button,
    .mp-confirm > .mp-confirm-choices::-webkit-scrollbar-button {
      display: none;
    }
    .mp-confirm > .mp-confirm-points::-webkit-scrollbar-track,
    .mp-confirm > .mp-confirm-choices::-webkit-scrollbar-track {
      background: transparent;
    }
    .mp-confirm > .mp-confirm-points::-webkit-scrollbar-thumb,
    .mp-confirm > .mp-confirm-choices::-webkit-scrollbar-thumb {
      border: 2px solid transparent;
      border-radius: 8px;
      background: color-mix(in srgb, var(--text-base, #fff) 22%, transparent) padding-box;
    }
    .mp-confirm-icon {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      box-shadow: var(--mp-edge);
      animation: mp-pop 0.55s var(--mp-spring) 0.1s backwards;
    }
    @keyframes mp-pop {
      from {
        opacity: 0;
        transform: scale(0.5) rotate(-12deg);
      }
    }
    .mp-confirm-icon--accent {
      color: var(--mp-accent);
      background: color-mix(in srgb, var(--mp-accent) 16%, transparent);
    }
    .mp-confirm-icon--danger {
      color: var(--text-negative, #f3727f);
      background: color-mix(in srgb, var(--text-negative, #f3727f) 16%, transparent);
    }
    .mp-confirm > b {
      font-size: 19px;
      font-weight: 800;
      letter-spacing: -0.01em;
    }
    .mp-confirm > p {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      color: var(--text-subdued);
    }
    .mp-confirm-choices {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mp-confirm-points {
      list-style: none;
      width: 100%;
      margin: 2px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      text-align: center;
    }
    .mp-confirm-points li {
      display: block;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.45;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.45s var(--mp-out) backwards;
      animation-delay: calc(120ms + var(--i) * 60ms);
    }
    .mp-confirm-points .mp-ic {
      display: inline-block;
      margin-right: 7px;
      vertical-align: -2px;
      color: var(--text-subdued);
    }
    .mp-confirm-points li.is-warn .mp-ic {
      color: var(--text-warning, #ffa42b);
    }
    .mp-confirm-options {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .mp-confirm-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 10px 8px 14px;
      border-radius: 14px;
      font-size: 13px;
      text-align: left;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-confirm-actions {
      display: flex;
      gap: 10px;
      width: 100%;
      margin-top: 8px;
    }
    .mp-confirm-actions .mp-btn {
      flex: 1;
      height: 42px;
    }
    .mp-btn.is-inert {
      cursor: default;
      opacity: 0.75;
    }
    .mp-btn.is-inert:hover,
    .mp-btn.is-inert:active {
      transform: none;
    }
    @keyframes mp-fade {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
    }
    @keyframes mp-in {
      from {
        opacity: 0;
        transform: translateY(18px) scale(0.97);
      }
    }
    @keyframes mp-rise {
      from {
        transform: translateY(10px);
      }
    }
    .mp-empty > * {
      animation: mp-fade 0.5s var(--mp-out) backwards;
    }
    @keyframes mp-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes mp-pulse {
      50% {
        opacity: 0.45;
      }
    }
    button[data-spotikit="topbarLeft"][data-mp-button] {
      box-sizing: border-box;
      width: 48px;
      min-width: 48px;
      height: 48px;
      padding: 12px;
      margin-inline-start: 8px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background-color: var(--background-elevated-base, #1f1f1f);
      color: var(--text-subdued);
      transition:
        background-color 0.2s ease-in-out,
        color 0.2s ease-in-out,
        transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    button[data-spotikit="topbarLeft"][data-mp-button]:hover {
      background-color: var(--background-elevated-highlight, #2a2a2a);
      color: var(--text-base);
      transform: scale(1.04);
    }
    button[data-spotikit="topbarLeft"][data-mp-button]:active {
      transform: scale(0.95);
    }
    button[data-spotikit="topbarLeft"][data-mp-button][data-active="true"] {
      color: var(--text-base) !important;
    }
    button[data-spotikit-app-button] svg {
      width: 24px !important;
      height: 24px !important;
      display: block;
    }
    button[data-mp-button] .mp-shop-icon {
      width: 24px;
      height: 24px;
      display: block;
    }
    .mp-ic {
      flex: none;
    }
    .mp-header {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .mp-title {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-right: auto;
    }
    .mp-title .mp-title-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--mp-accent);
      background: var(--background-elevated-base, #1f1f1f);
      box-shadow:
        var(--mp-edge),
        0 14px 30px -14px rgba(0, 0, 0, 0.8);
      transition: transform 0.5s var(--mp-spring);
    }
    .mp-title-icon svg {
      width: 26px;
      height: 26px;
    }
    .mp-title:hover .mp-title-icon {
      transform: rotate(-8deg) scale(1.06);
    }
    .mp-title h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    .mp-title span {
      font-size: 14px;
      color: var(--text-subdued);
    }
    .mp-search {
      display: flex;
      align-items: center;
      gap: 10px;
      width: min(320px, 100%);
      height: 40px;
      box-sizing: border-box;
      padding: 0 12px 0 14px;
      border-radius: 999px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      color: var(--text-subdued);
      transition: background-color 0.2s;
    }
    .mp-search:hover {
      background: var(--mp-glass-2);
    }
    .mp-search input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: none;
      color: var(--text-base);
      font: inherit;
      font-size: 14px;
      outline: none;
    }
    .mp-search input::placeholder {
      color: var(--text-subdued);
      opacity: 1;
    }
    .mp-search-clear,
    .mp-icon-btn {
      display: grid;
      place-items: center;
      border: 0;
      cursor: pointer;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      transition:
        transform 0.3s var(--mp-spring),
        color 0.2s,
        background-color 0.2s;
    }
    .mp-search-clear {
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }
    .mp-icon-btn {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 12px;
    }
    .mp-icon-btn:hover,
    .mp-search-clear:hover {
      color: var(--text-base);
      background: var(--mp-glass-2);
      transform: scale(1.08);
    }
    .mp-refresh {
      border-radius: 50%;
    }
    .mp-profiles {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin: 0 0 26px;
    }
    .mp-profile {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 7px 5px 5px;
      border-radius: 24px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      transition: box-shadow 0.2s;
    }
    .mp-profile.is-active {
      box-shadow:
        var(--mp-edge),
        inset 0 0 0 1.5px color-mix(in srgb, var(--text-bright-accent, #1ed760) 70%, transparent);
    }
    .mp-profile-main {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px 8px 12px;
      border: 0;
      border-radius: 19px;
      color: var(--text-base);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        background-color 0.2s,
        box-shadow 0.2s;
    }
    .mp-profile-main:hover {
      background: var(--mp-glass-2);
    }
    .mp-profile-main:disabled {
      cursor: default;
    }
    .mp-profile.is-active .mp-profile-main > svg {
      color: var(--text-bright-accent, #1ed760);
    }
    .mp-profile-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .mp-profile-text b {
      font-size: 13.5px;
    }
    .mp-profile-text span {
      max-width: 220px;
      overflow: hidden;
      font-size: 11.5px;
      color: var(--text-subdued);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .mp-profile .mp-icon-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
    }
    .mp-profile-new {
      border-radius: 20px;
    }
    .mp-refresh.is-spinning svg {
      animation: mp-spin 0.9s linear infinite;
    }
    .mp-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 0 14px;
      padding: 12px 14px;
      border-radius: 14px;
      font-size: 13.5px;
      background: color-mix(in srgb, var(--mp-accent) 12%, transparent);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.4s var(--mp-out) both;
    }
    .mp-banner > span {
      flex: 1;
    }
    .mp-banner--warn {
      background: color-mix(in srgb, var(--text-warning, #ffa42b) 14%, transparent);
    }
    .mp-banner--warn .mp-ic {
      color: var(--text-warning, #ffa42b);
    }
    .mp-tabs {
      position: relative;
      display: inline-flex;
      gap: 4px;
      padding: 5px;
      border-radius: 999px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .mp-tab-pill {
      position: absolute;
      top: 5px;
      bottom: 5px;
      left: 0;
      border-radius: 999px;
      background: var(--mp-glass-2);
      box-shadow: var(--mp-edge);
      transition:
        transform 0.42s var(--mp-spring-soft),
        width 0.42s var(--mp-spring-soft);
    }
    .mp-tab {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 36px;
      padding: 0 16px;
      border: 0;
      border-radius: 999px;
      background: none;
      color: var(--text-subdued);
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
      transition: color 0.2s;
    }
    .mp-tab:hover,
    .mp-tab.is-active {
      color: var(--text-base);
    }
    .mp-count {
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      font-size: 11px;
      background: var(--mp-glass-2);
      box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent);
    }
    .mp-count.has-update {
      position: relative;
    }
    .mp-count.has-update::after {
      content: "";
      position: absolute;
      top: -2px;
      right: -2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mp-accent);
      box-shadow: 0 0 0 2px var(--background-base, #121212);
    }
    .mp-tab.is-active .mp-count.has-update::after {
      background: var(--text-base, #fff);
    }
    .mp-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .mp-updates {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 6px;
    }
    .mp-updates-ask {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-right: 4px;
      font-size: 13px;
      color: var(--text-subdued, #b3b3b3);
    }
    .mp-auto-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 12px 0 2px;
      padding-top: 12px;
      border-top: 1px solid var(--mp-line);
    }
    .mp-auto-row > span {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 13px;
    }
    .mp-auto-row > span > span {
      font-size: 12px;
      color: var(--text-subdued);
    }
    .mp-updates-text {
      font-size: 13px;
      color: var(--text-subdued, #b3b3b3);
    }
    .mp-status--update {
      color: var(--mp-accent);
    }
    .mp-tab.is-active .mp-count {
      color: var(--mp-on-accent);
      background: var(--mp-accent);
    }
    .mp-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mp-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      flex: 1;
      min-width: 0;
    }
    .mp-chips-wrap {
      position: relative;
      flex: 1;
      min-width: 0;
      display: flex;
    }
    @property --mp-fade-l {
      syntax: "<length>";
      inherits: false;
      initial-value: 0px;
    }
    @property --mp-fade-r {
      syntax: "<length>";
      inherits: false;
      initial-value: 0px;
    }
    .mp-toolbar .mp-chips {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent,
        #000 var(--mp-fade-l),
        #000 calc(100% - var(--mp-fade-r)),
        transparent
      );
      mask-image: linear-gradient(
        to right,
        transparent,
        #000 var(--mp-fade-l),
        #000 calc(100% - var(--mp-fade-r)),
        transparent
      );
      transition:
        --mp-fade-l 0.3s ease,
        --mp-fade-r 0.3s ease;
    }
    .mp-chips-wrap.has-start .mp-chips {
      --mp-fade-l: 56px;
    }
    .mp-chips-wrap.has-end .mp-chips {
      --mp-fade-r: 56px;
    }
    .mp-toolbar .mp-chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      padding: 5px 10px;
      margin: -5px -10px;
    }
    .mp-toolbar .mp-chips::-webkit-scrollbar {
      display: none;
    }
    .mp-toolbar .mp-chip {
      flex: none;
    }
    .mp-chip {
      height: 32px;
      padding: 0 14px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-base);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      transition:
        transform 0.3s var(--mp-spring),
        background-color 0.2s,
        color 0.2s;
    }
    .mp-chip:hover {
      transform: scale(1.05);
      background: var(--mp-glass-2);
    }
    .mp-chip.is-on {
      color: var(--mp-on-text);
      background: var(--text-base);
    }
    .mp-dd {
      position: relative;
    }
    .mp-dd-trigger {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 12px 0 14px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      transition:
        background-color 0.2s,
        color 0.2s,
        transform 0.3s var(--mp-spring);
    }
    .mp-dd-trigger:hover,
    .mp-dd.is-open .mp-dd-trigger {
      background: var(--mp-glass-2);
      color: var(--text-base);
    }
    .mp-dd-trigger:active {
      transform: scale(0.95);
    }
    .mp-dd-trigger b {
      color: var(--text-base);
      font-weight: 700;
    }
    .mp-dd-chevron {
      transition: transform 0.4s var(--mp-spring);
    }
    .mp-dd.is-open .mp-dd-chevron {
      transform: rotate(180deg);
    }
    .mp-dd-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 60;
      min-width: 210px;
      padding: 6px;
      border-radius: 20px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: transparent;
      backdrop-filter: blur(24px) saturate(1.6) brightness(0.7);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 24%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 10%, transparent),
        0 24px 60px -18px rgba(0, 0, 0, 0.85);
      transform-origin: top right;
      animation: mp-dd-in 0.45s var(--mp-spring) both;
    }
    .mp-dd-menu.is-closing {
      animation: mp-dd-out 0.18s cubic-bezier(0.5, 0, 0.75, 0) both;
      pointer-events: none;
    }
    @keyframes mp-dd-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.9);
      }
    }
    @keyframes mp-dd-out {
      to {
        opacity: 0;
        transform: translateY(-6px) scale(0.94);
      }
    }
    .mp-dd-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      height: 38px;
      padding: 0 12px;
      border: 0;
      border-radius: 12px;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      color: var(--text-subdued);
      background: none;
      animation: mp-dd-item 0.35s var(--mp-out) both;
      animation-delay: calc(40ms + var(--i) * 35ms);
      transition:
        background-color 0.15s,
        color 0.15s,
        box-shadow 0.15s;
    }
    @keyframes mp-dd-item {
      from {
        opacity: 0;
        transform: translateX(-6px);
      }
    }
    .mp-dd-item.is-active {
      color: var(--text-base);
      background: var(--mp-glass-2);
      box-shadow: var(--mp-edge);
    }
    .mp-dd-item.is-selected {
      color: var(--text-base);
    }
    .mp-dd-item .mp-ic {
      color: var(--mp-accent);
    }
    .mp-body {
      margin-top: 12px;
      animation: mp-rise 0.35s var(--mp-out) backwards;
    }
    .mp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }
    .mp-card {
      position: relative;
      isolation: isolate;
      display: flex;
      flex-direction: column;
      border-radius: 20px;
      overflow: hidden;
      cursor: pointer;
      background: var(--mp-glass);
      box-shadow: 0 18px 40px -26px rgba(0, 0, 0, 0.7);
      animation: mp-in 0.55s var(--mp-out) backwards;
      animation-delay: calc(min(var(--i), 12) * 45ms);
      transition:
        transform 0.45s var(--mp-spring),
        box-shadow 0.3s,
        background-color 0.3s;
      outline: none;
    }
    .mp-card::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 3;
      border-radius: inherit;
      pointer-events: none;
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 30%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 11%, transparent),
        inset 0 -1px 0 color-mix(in srgb, #fff 5%, transparent);
    }
    .mp-card:hover {
      transform: translateY(-6px);
      background: var(--mp-glass-2);
      box-shadow: 0 30px 50px -24px rgba(0, 0, 0, 0.85);
    }
    .mp-card-media {
      position: relative;
    }
    .mp-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 26px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      background: transparent;
      backdrop-filter: blur(14px) saturate(1.6);
      text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 0 0 1px rgba(255, 255, 255, 0.12);
      animation: mp-in 0.4s var(--mp-spring) backwards;
    }
    .mp-badge .mp-ic {
      color: var(--mp-accent);
    }
    .mp-badge--error .mp-ic {
      color: var(--text-negative, #f3727f);
    }
    .mp-preview {
      position: relative;
      aspect-ratio: 16/10;
      overflow: hidden;
      background: var(--mp-glass);
    }
    .mp-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      opacity: 0;
      transform: scale(1.03);
      transition:
        opacity 0.5s ease,
        transform 0.6s var(--mp-out);
    }
    .mp-preview img.is-loaded {
      opacity: 1;
      transform: none;
    }
    .mp-preview.is-loading {
      background: var(--mp-glass-2, rgba(255, 255, 255, 0.1));
      animation: mp-pulse 1.4s ease-in-out infinite;
    }
    .mp-sheet-hero .mp-preview::after,
    .mp-list-row .mp-preview::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.24),
        inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .mp-card:hover .mp-preview img {
      transform: scale(1.05);
    }
    .mp-preview--none {
      display: grid;
      place-items: center;
      font-size: 48px;
      font-weight: 800;
      color: var(--text-subdued);
      background: color-mix(in srgb, var(--mp-accent) 14%, var(--mp-glass));
    }
    .mp-card-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 6px;
      padding: 18px;
      flex: 1;
    }
    .mp-card h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.015em;
    }
    .mp-card .mp-desc {
      max-width: 36ch;
    }
    .mp-card .mp-tags {
      justify-content: center;
      margin-top: 4px;
    }
    .mp-card-meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: auto;
      padding-top: 14px;
    }
    .mp-updated {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-subdued);
    }
    .mp-pills {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      margin-top: 2px;
    }
    .mp-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 22px;
      padding: 0 9px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
      white-space: nowrap;
    }
    .mp-pill--danger {
      color: var(--text-negative, #f3727f);
      background: color-mix(in srgb, var(--text-negative, #f3727f) 14%, transparent);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent),
        inset 0 0 0 1px color-mix(in srgb, var(--text-negative, #f3727f) 32%, transparent);
    }
    .mp-pill--accent {
      color: var(--mp-accent);
      background: color-mix(in srgb, var(--mp-accent) 13%, transparent);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent),
        inset 0 0 0 1px color-mix(in srgb, var(--mp-accent) 30%, transparent);
    }
    .mp-btn--block {
      width: 100%;
      height: 40px;
      margin-top: 12px;
    }
    .mp-authors {
      font-size: 13px;
      color: var(--text-subdued);
    }
    .mp-toasts {
      position: fixed;
      left: 50%;
      bottom: 28px;
      z-index: 2147483600;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      transform: translateX(-50%);
      pointer-events: none;
    }
    .mp-toast {
      max-width: min(520px, calc(100vw - 32px));
      padding: 12px 18px;
      border-radius: 14px;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      text-align: center;
      color: #fff;
      background: rgba(28, 28, 30, 0.72);
      backdrop-filter: blur(24px) saturate(1.6);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.18),
        inset 0 0 0 1px rgba(255, 255, 255, 0.08),
        0 12px 32px rgba(0, 0, 0, 0.35);
      animation: mp-toast-in 0.36s cubic-bezier(0.2, 0.9, 0.25, 1.06) both;
    }
    .mp-toast.is-error {
      background: rgba(120, 24, 28, 0.78);
    }
    .mp-toast.is-leaving {
      animation: mp-toast-out 0.24s ease-in both;
    }
    @keyframes mp-toast-in {
      from {
        opacity: 0;
        transform: translateY(14px) scale(0.96);
      }
    }
    @keyframes mp-toast-out {
      to {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
    }
    .mp-share-btn {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      margin-left: 6px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      vertical-align: middle;
      color: inherit;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      cursor: pointer;
      transition:
        background-color 0.2s,
        color 0.2s,
        transform 0.2s var(--mp-spring);
    }
    .mp-share-btn:hover {
      color: var(--text-base, #fff);
      background: var(--mp-glass-2);
    }
    .mp-share-btn:active {
      transform: scale(0.92);
    }
    .mp-authors a {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .mp-desc {
      margin: 2px 0 0;
      font-size: 13.5px;
      line-height: 1.45;
      color: var(--text-subdued);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .mp-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .mp-tag {
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-compat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-warning, #ffa42b);
      background: color-mix(in srgb, var(--text-warning, #ffa42b) 12%, transparent);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 20%, transparent),
        inset 0 0 0 1px color-mix(in srgb, var(--text-warning, #ffa42b) 28%, transparent);
    }
    .mp-compat.is-ok {
      color: var(--text-positive, #1ed760);
      background: color-mix(in srgb, var(--text-positive, #1ed760) 12%, transparent);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 20%, transparent),
        inset 0 0 0 1px color-mix(in srgb, var(--text-positive, #1ed760) 28%, transparent);
    }
    .mp-compat--big {
      font-size: 13px;
      padding: 6px 12px;
    }
    .mp-rating {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      color: var(--text-subdued);
    }
    .mp-star-full {
      fill: #ffc64d;
    }
    .mp-rating {
      font-weight: 700;
      color: var(--text-base);
    }
    .mp-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      height: 36px;
      padding: 0 16px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 13.5px;
      font-weight: 700;
      color: var(--text-base);
      background: var(--mp-glass-2);
      box-shadow: var(--mp-edge);
      white-space: nowrap;
      transition:
        transform 0.35s var(--mp-spring),
        background-color 0.2s,
        box-shadow 0.2s;
    }
    .mp-btn:hover:not(:disabled) {
      transform: scale(1.05);
    }
    .mp-btn:active:not(:disabled) {
      transform: scale(0.95);
    }
    .mp-btn--accent,
    .mp-btn--danger {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.5),
        inset 0 0 0 1px rgba(255, 255, 255, 0.2),
        inset 0 -1px 0 rgba(0, 0, 0, 0.12);
    }
    .mp-btn--accent {
      color: var(--mp-on-accent);
      background: var(--mp-accent);
    }
    .mp-btn--danger {
      color: #1d0507;
      background: var(--text-negative, #f3727f);
    }
    .mp-btn--danger:hover {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.5),
        inset 0 0 0 1px rgba(255, 255, 255, 0.2),
        0 8px 24px -8px color-mix(in srgb, var(--text-negative, #f3727f) 70%, transparent);
    }
    .mp-btn--accent:hover {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.5),
        inset 0 0 0 1px rgba(255, 255, 255, 0.2),
        0 8px 24px -8px color-mix(in srgb, var(--mp-accent) 70%, transparent);
    }
    .mp-btn--done {
      color: var(--mp-accent);
      background: color-mix(in srgb, var(--mp-accent) 14%, transparent);
    }
    .mp-btn--ghost {
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-btn--ghost:hover:not(.is-inert) {
      background: var(--mp-glass-2);
    }
    .mp-btn--small {
      height: 30px;
      padding: 0 12px;
      font-size: 12.5px;
    }
    .mp-btn--busy {
      cursor: progress;
      animation: mp-pulse 1.2s ease-in-out infinite;
    }
    .mp-spinner {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid var(--mp-line);
      border-top-color: var(--text-base);
      animation: mp-spin 0.7s linear infinite;
      flex: none;
    }
    .mp-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .mp-dot--error {
      background: var(--text-negative, #f3727f);
    }
    .mp-card--skeleton {
      cursor: default;
      pointer-events: none;
    }
    .mp-card--skeleton .mp-preview,
    .mp-card--skeleton i {
      background: var(--mp-glass-2);
      animation: mp-pulse 1.4s ease-in-out infinite;
    }
    .mp-card--skeleton i {
      display: block;
      width: 80%;
      height: 12px;
      border-radius: 6px;
    }
    .mp-card--skeleton i:first-child {
      width: 55%;
      height: 18px;
    }
    .mp-card--skeleton i:last-child {
      width: 40%;
    }
    .mp-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 64px 20px;
      animation: mp-rise 0.5s var(--mp-out) backwards;
    }
    .mp-empty-icon {
      width: 56px;
      height: 56px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      margin-bottom: 6px;
    }
    .mp-empty b {
      font-size: 18px;
    }
    .mp-empty p,
    .mp-muted {
      margin: 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--text-subdued);
    }
    .mp-section-title {
      margin: 6px 0 12px;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-subdued);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mp-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 28px;
    }
    .mp-list-row {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 14px 10px 10px;
      border-radius: 16px;
      cursor: pointer;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.45s var(--mp-out) backwards;
      animation-delay: calc(min(var(--i), 12) * 45ms);
      transition:
        background-color 0.35s ease,
        box-shadow 0.45s var(--mp-out),
        transform 0.55s var(--mp-spring);
    }
    .mp-list-row:hover {
      background: var(--mp-glass-2);
      transform: translateY(-2px);
      box-shadow:
        var(--mp-edge),
        0 16px 34px -20px rgba(0, 0, 0, 0.85);
    }
    .mp-list-row:active {
      transform: translateY(0) scale(0.99);
      transition-duration: 0.2s;
    }
    .mp-list-row .mp-preview img.is-loaded {
      transition:
        opacity 0.5s ease,
        transform 0.9s var(--mp-out);
    }
    .mp-list-row:hover .mp-preview img.is-loaded {
      transform: scale(1.07);
    }
    .mp-list-row .mp-icon-btn {
      transition:
        transform 0.35s var(--mp-spring),
        background-color 0.2s,
        color 0.2s,
        opacity 0.2s;
    }
    .mp-source-title {
      margin: 10px 0 14px;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--text-base);
    }
    .mp-section-head .mp-source-title {
      margin-bottom: 10px;
    }
    .mp-list + .mp-source-title,
    .mp-group + .mp-source-title,
    .mp-empty + .mp-source-title {
      margin-top: 22px;
    }
    .mp-group + .mp-group {
      margin-top: 8px;
    }
    .mp-group-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 6px 0 12px;
      color: var(--text-subdued);
    }
    .mp-group-head .mp-section-title {
      margin: 0;
    }
    .mp-group-icon {
      width: 18px;
      height: 18px;
    }
    .mp-list-tile {
      width: 86px;
      aspect-ratio: 16/10;
      flex: none;
      display: grid;
      place-items: center;
      border-radius: 10px;
      color: var(--text-subdued);
      background: var(--mp-glass);
    }
    .mp-list-tile svg {
      width: 22px;
      height: 22px;
    }
    .mp-list-row.is-static {
      cursor: default;
    }
    .mp-list-row.is-static:active {
      transform: translateY(-2px);
    }
    .mp-list-row .mp-preview {
      width: 86px;
      flex: none;
      border-radius: 10px;
    }
    .mp-list-main {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 0;
    }
    .mp-list-main b {
      font-size: 15px;
    }
    .mp-list-meta {
      font-size: 12.5px;
      color: var(--text-subdued);
    }
    .mp-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .mp-status i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }
    .mp-status--on {
      color: var(--mp-accent);
    }
    .mp-status--off {
      color: var(--text-subdued);
    }
    .mp-status--error {
      color: var(--text-negative, #f3727f);
    }
    .mp-status--warn {
      color: var(--text-warning, #ffa42b);
    }
    .mp-note--warn {
      background: color-mix(in srgb, var(--text-warning, #ffa42b) 12%, transparent);
    }
    .mp-note--warn .mp-ic {
      color: var(--text-warning, #ffa42b);
    }
    .mp-rating-count {
      white-space: nowrap;
    }
    .mp-list-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mp-list-actions .mp-icon-btn {
      width: 34px;
      height: 34px;
      border-radius: 10px;
    }
    .mp-toggle {
      --f: 0;
      --checked: var(--mp-accent, #1ed760);
      --track: color-mix(in srgb, rgba(120, 120, 128, 0.36), var(--checked) calc(var(--f) * 100%));
      position: relative;
      flex: 0 0 auto;
      width: 64px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent !important;
      cursor: pointer;
      touch-action: none;
      user-select: none;
    }
    .mp-toggle * {
      pointer-events: none;
    }
    .mp-toggle-track {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: var(--track) !important;
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.08),
        inset 0 0 4px rgba(0, 0, 0, 0.15);
    }
    .mp-toggle-knob {
      position: absolute;
      left: 0;
      top: 2px;
      width: 40px;
      height: 24px;
      border-radius: 999px;
      box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.2),
        0 0 1px rgba(0, 0, 0, 0.15);
    }
    .mp-toggle-knob > span {
      position: absolute;
      inset: 0;
      border-radius: inherit;
    }
    .mp-toggle-lens {
      overflow: hidden;
    }
    .mp-toggle-lens > span {
      position: absolute;
      width: 64px;
      height: 28px;
      border-radius: 999px;
      background: var(--track);
      filter: blur(5px);
    }
    .mp-toggle-surface {
      background: #fff !important;
    }
    .mp-toggle-rim {
      opacity: 0;
      background: rgba(255, 255, 255, 0.1);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.8),
        inset 0 -1px 0 rgba(255, 255, 255, 0.2),
        inset 0 0 0 1px rgba(255, 255, 255, 0.16),
        inset 0 0 6px rgba(0, 0, 0, 0.2);
    }
    .mp-hint {
      margin-top: -14px;
    }
    .mp-gap {
      margin-bottom: 28px;
    }
    .mp-note {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 14px 16px;
      border-radius: 16px;
      margin-bottom: 16px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-note > div {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 13.5px;
      line-height: 1.45;
    }
    .mp-note span {
      color: var(--text-subdued);
    }
    .mp-note--error {
      background: color-mix(in srgb, var(--text-negative, #f3727f) 12%, transparent);
    }
    .mp-note--error .mp-ic {
      color: var(--text-negative, #f3727f);
    }
    .mp-new {
      margin-bottom: 16px;
    }
    .mp-editor {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 18px;
      animation: mp-in 0.4s var(--mp-out) both;
    }
    .mp-confirm .mp-input {
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-input::placeholder {
      color: var(--text-subdued);
      opacity: 0.7;
    }
    .mp-input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      border: 0;
      border-radius: 14px;
      color: var(--text-base);
      background: color-mix(in srgb, #000 22%, transparent);
      box-shadow:
        inset 0 1px 0 rgba(0, 0, 0, 0.3),
        inset 0 0 0 1px var(--mp-line);
      font: inherit;
      font-size: 14px;
      outline: none;
      transition: box-shadow 0.2s;
    }
    .mp-code,
    .mp-snippet-code {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 12.5px;
    }
    .mp-snippet-code {
      color: var(--text-subdued);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mp-row-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .mp-sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 5vh 16px;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(10px);
      animation: mp-backdrop-in 0.3s ease both;
    }
    @keyframes mp-backdrop-in {
      from {
        opacity: 0;
      }
    }
    @keyframes mp-backdrop-out {
      to {
        opacity: 0;
      }
    }
    @keyframes mp-sheet-in {
      0% {
        opacity: 0;
        transform: translateY(56px) scale(0.93);
        animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      }
      62% {
        opacity: 1;
        transform: translateY(-6px) scale(1.008);
        animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
      }
      82% {
        transform: translateY(2px) scale(0.999);
        animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
      }
      100% {
        opacity: 1;
        transform: none;
      }
    }
    @keyframes mp-sheet-out {
      from {
        opacity: 1;
        transform: none;
      }
      to {
        opacity: 0;
        transform: translateY(36px) scale(0.95);
      }
    }
    .mp-sheet-backdrop.is-closing .mp-sheet {
      animation: mp-sheet-out 0.28s cubic-bezier(0.5, 0, 0.75, 0.2) both;
      pointer-events: none;
    }
    .mp-sheet-backdrop.is-closing {
      animation: mp-backdrop-out 0.3s ease 0.02s both;
      pointer-events: none;
    }
    .mp-sheet {
      position: relative;
      width: min(980px, 100%);
      max-height: 90vh;
      display: flex;
      border-radius: 20px;
      overflow: hidden;
      color: var(--text-base);
      background: transparent;
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 25%, transparent),
        inset 0 0 0 1px var(--mp-line, rgba(255, 255, 255, 0.08)),
        0 40px 100px -20px rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(30px) saturate(1.5);
      animation: mp-sheet-in 0.72s both;
    }
    .mp-sheet-hero {
      animation: mp-fade 0.5s var(--mp-out) 0.08s backwards;
    }
    .mp-sheet-grid {
      animation: mp-fade 0.5s var(--mp-out) 0.16s backwards;
    }
    .mp-sheet-close {
      position: absolute;
      top: 14px;
      right: 14px;
      z-index: 2;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: #fff;
      background: transparent;
      backdrop-filter: blur(14px) saturate(1.6);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.26),
        inset 0 0 0 1px rgba(255, 255, 255, 0.12);
      transition:
        transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
        background-color 0.2s;
    }
    .mp-sheet-close:hover {
      transform: scale(1.1) rotate(90deg);
      background: color-mix(in srgb, #fff 10%, transparent);
    }
    .mp-sheet-hero {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      gap: 24px;
      padding: 24px;
      align-items: center;
    }
    .mp-sheet-hero .mp-preview {
      border-radius: 16px;
      box-shadow: 0 20px 50px -20px rgba(0, 0, 0, 0.7);
    }
    .mp-sheet-title {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      text-align: center;
    }
    .mp-sheet-title h2 {
      margin: 0;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.05;
    }
    .mp-sheet-title p {
      margin: 4px 0 0;
      font-size: 14.5px;
      line-height: 1.5;
      color: var(--text-subdued);
    }
    .mp-kind {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-bright-accent, #1ed760);
    }
    .mp-sheet-actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .mp-sheet-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 24px;
      padding: 0 24px 28px;
    }
    .mp-sheet-main > h4,
    .mp-panel h4 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text-subdued);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mp-sheet-side {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .mp-panel {
      padding: 14px 16px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--text-base, #fff) 5%, transparent);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 16%, transparent),
        inset 0 0 0 1px color-mix(in srgb, var(--text-base, #fff) 8%, transparent);
    }
    .mp-panel .mp-muted {
      margin-top: 8px;
      font-size: 12.5px;
    }
    .mp-rate {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .mp-rate .mp-muted {
      margin: 0;
    }
    .mp-rate-big {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mp-rate-big b {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .mp-rate-big span {
      font-size: 13px;
      color: var(--text-subdued);
    }
    .mp-floating {
      position: fixed;
      z-index: 1200;
      pointer-events: none;
      margin: 0;
    }
    .mp-floating > * {
      pointer-events: auto;
    }
    .mp-chip-arrow {
      position: absolute;
      z-index: 2;
      top: 50%;
      width: 34px;
      height: 34px;
      margin-top: -17px;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: var(--text-base, #fff);
      background: transparent;
      backdrop-filter: blur(18px) saturate(1.6);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 24%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 11%, transparent),
        0 6px 18px -6px rgba(0, 0, 0, 0.85);
      transition:
        opacity 0.25s ease,
        transform 0.4s var(--mp-spring),
        background-color 0.2s;
    }
    .mp-chip-arrow.is-start {
      left: -6px;
    }
    .mp-chip-arrow.is-end {
      right: -6px;
    }
    .mp-chip-arrow:hover {
      transform: scale(1.1);
      background: transparent;
    }
    .mp-chip-arrow:active {
      transform: scale(0.92);
    }
    .mp-chip-arrow.is-hidden {
      opacity: 0;
      transform: scale(0.7);
      pointer-events: none;
    }
    .mp-tooltip {
      position: fixed;
      left: 0;
      top: 0;
      z-index: 10000;
      max-width: 280px;
      box-sizing: border-box;
      padding: 7px 12px;
      border-radius: 12px;
      pointer-events: none;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.4;
      text-align: center;
      color: var(--text-base, #fff);
      background: transparent;
      backdrop-filter: blur(18px) saturate(1.7);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 26%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 11%, transparent),
        0 14px 34px -12px rgba(0, 0, 0, 0.75);
      opacity: 0;
      transform: translateY(5px) scale(0.96);
      transition:
        opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .mp-tooltip[data-placement="bottom"] {
      transform: translateY(-5px) scale(0.96);
    }
    .mp-tooltip.is-shown {
      opacity: 1;
      transform: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .mp-tooltip {
        transition: opacity 0.15s linear;
        transform: none;
      }
    }
    .mp-panel--schemes.is-highlight {
      animation: mp-highlight 2.6s ease both;
    }
    @keyframes mp-highlight {
      0%,
      100% {
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, #fff 16%, transparent),
          inset 0 0 0 1px color-mix(in srgb, var(--text-base, #fff) 8%, transparent);
      }
      18%,
      62% {
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent),
          inset 0 0 0 1px color-mix(in srgb, var(--mp-accent) 70%, transparent),
          0 0 0 4px color-mix(in srgb, var(--mp-accent) 24%, transparent);
      }
    }
    .mp-card-scheme {
      margin-top: 8px;
    }
    .mp-card-scheme .mp-dd-trigger {
      height: 32px;
    }
    .mp-facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 14px;
      margin: 0 0 12px;
      font-size: 13px;
    }
    .mp-facts dt {
      color: var(--text-subdued);
    }
    .mp-facts dd {
      margin: 0;
    }
    .mp-changes {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 13px;
    }
    .mp-changes li {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mp-changes a {
      color: var(--text-base);
    }
    .mp-changes a:hover {
      text-decoration: underline;
    }
    .mp-needs {
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
    }
    .mp-files {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
    }
    .mp-files li {
      display: grid;
      grid-template-columns: 62px 1fr;
      gap: 8px;
      align-items: baseline;
    }
    .mp-files span {
      font-weight: 700;
      color: var(--text-subdued);
    }
    .mp-files a {
      color: var(--text-base);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mp-readme {
      font-size: 14.5px;
      line-height: 1.65;
      color: var(--text-base);
      overflow-wrap: anywhere;
    }
    .mp-readme > :first-child {
      margin-top: 0;
    }
    .mp-readme h1,
    .mp-readme h2,
    .mp-readme h3,
    .mp-readme h4,
    .mp-readme h5,
    .mp-readme h6 {
      margin: 26px 0 12px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.01em;
      scroll-margin-top: 16px;
    }
    .mp-readme h1 {
      font-size: 26px;
      padding-bottom: 10px;
      box-shadow: inset 0 -1px 0 var(--mp-line);
    }
    .mp-readme h2 {
      font-size: 21px;
      padding-bottom: 8px;
      box-shadow: inset 0 -1px 0 var(--mp-line);
    }
    .mp-readme h3 {
      font-size: 17px;
    }
    .mp-readme h4,
    .mp-readme h5,
    .mp-readme h6 {
      font-size: 15px;
    }
    .mp-readme p {
      margin: 0 0 14px;
    }
    .mp-readme a {
      color: var(--text-bright-accent, #1ed760);
      text-decoration: none;
    }
    .mp-readme a:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .mp-readme ul,
    .mp-readme ol {
      margin: 0 0 14px;
      padding-left: 1.7em;
    }
    .mp-readme li + li {
      margin-top: 4px;
    }
    .mp-readme li > ul,
    .mp-readme li > ol {
      margin: 4px 0 0;
    }
    .mp-readme hr {
      height: 1px;
      margin: 24px 0;
      border: 0;
      background: var(--mp-line);
    }
    .mp-readme,
    .mp-readme * {
      -webkit-user-select: text;
      user-select: text;
    }
    .mp-readme button,
    .mp-readme button * {
      -webkit-user-select: none;
      user-select: none;
    }
    .mp-code-block {
      position: relative;
      margin: 0 0 14px;
    }
    .mp-code-block > .mp-readme-scroll {
      margin: 0;
    }
    .mp-code-copy {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2;
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 10px;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: var(--text-subdued);
      background: color-mix(in srgb, var(--background-elevated-highlight, #2a2a2a) 80%, transparent);
      box-shadow: var(--mp-edge);
      opacity: 0;
      transition:
        opacity 0.2s ease,
        transform 0.35s var(--mp-spring),
        color 0.2s;
    }
    .mp-code-block:hover .mp-code-copy,
    .mp-code-copy.is-copied {
      opacity: 1;
    }
    .mp-code-copy:hover {
      color: var(--text-base);
      transform: scale(1.08);
    }
    .mp-code-copy:active {
      transform: scale(0.92);
    }
    .mp-code-copy.is-copied {
      color: var(--mp-accent);
    }
    .mp-readme code {
      padding: 2px 7px;
      border-radius: 7px;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.86em;
      background: var(--mp-glass-2);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 14%, transparent),
        inset 0 0 0 1px var(--mp-line);
    }
    .mp-readme-scroll {
      margin: 0 0 14px;
      border-radius: 14px;
      background: color-mix(in srgb, #000 24%, var(--mp-glass));
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 9%, transparent),
        0 12px 30px -20px rgba(0, 0, 0, 0.8);
    }
    .mp-readme pre {
      margin: 0;
      padding: 14px 16px;
      font-size: 12.5px;
      line-height: 1.55;
      white-space: pre;
    }
    .mp-readme pre code {
      padding: 0;
      background: none;
      font-size: inherit;
    }
    .mp-readme table {
      border-collapse: collapse;
      min-width: 100%;
      font-size: 13.5px;
    }
    .mp-readme th,
    .mp-readme td {
      padding: 9px 13px;
      text-align: left;
      box-shadow: inset 0 -1px 0 var(--mp-line);
    }
    .mp-readme th {
      font-weight: 700;
      background: var(--mp-glass);
    }
    .mp-readme tr:last-child td {
      box-shadow: none;
    }
    .mp-readme blockquote {
      margin: 0 0 14px;
      padding: 10px 16px;
      border-radius: 0 12px 12px 0;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow:
        inset 3px 0 0 var(--mp-line),
        inset 0 1px 0 color-mix(in srgb, #fff 12%, transparent);
    }
    .mp-readme blockquote > :last-child {
      margin-bottom: 0;
    }
    .mp-readme blockquote[data-alert] {
      padding: 10px 16px;
      border-radius: 0 12px 12px 0;
      color: var(--text-base);
      background: var(--mp-glass);
    }
    .mp-readme [data-alert-title] {
      margin-bottom: 6px;
      font-weight: 800;
      color: var(--mp-alert);
    }
    .mp-readme [data-alert] {
      --mp-alert: #4493f8;
      box-shadow: inset 3px 0 0 var(--mp-alert);
    }
    .mp-readme [data-alert="tip"] {
      --mp-alert: #3fb950;
    }
    .mp-readme [data-alert="important"] {
      --mp-alert: #ab7df8;
    }
    .mp-readme [data-alert="warning"] {
      --mp-alert: #d29922;
    }
    .mp-readme [data-alert="caution"] {
      --mp-alert: #f85149;
    }
    .mp-readme kbd {
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 0.85em;
      background: var(--mp-glass-2);
      box-shadow:
        var(--mp-edge),
        inset 0 -1px 0 rgba(0, 0, 0, 0.4);
    }
    .mp-readme img {
      max-width: 100%;
      height: auto;
      vertical-align: middle;
      border-radius: inherit;
      opacity: 0;
      transition: opacity 0.45s ease;
    }
    .mp-readme img.is-loaded {
      opacity: 1;
    }
    .mp-readme-media {
      position: relative;
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
      line-height: 0;
      border-radius: 6px;
    }
    .mp-readme-media.is-framed {
      border-radius: 14px;
      box-shadow: 0 16px 38px -20px rgba(0, 0, 0, 0.85);
    }
    .mp-readme-media.is-framed::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 30%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 12%, transparent),
        inset 0 -1px 0 color-mix(in srgb, #fff 5%, transparent);
    }
    .mp-readme p > .mp-readme-media:only-child,
    .mp-readme div > .mp-readme-media:only-child,
    .mp-fold-inner > .mp-readme-media {
      display: block;
      width: fit-content;
      margin: 12px auto;
    }
    .mp-fold {
      margin: 0 0 14px;
      border-radius: 14px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-fold-summary {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 12px 16px;
      border: 0;
      border-radius: 14px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      text-align: left;
      color: var(--text-base);
      background: none;
      transition: background-color 0.2s;
    }
    .mp-fold-summary:hover {
      background: var(--mp-glass);
    }
    .mp-fold-chevron {
      color: var(--text-subdued);
      transition: transform 0.45s var(--mp-spring);
    }
    .mp-fold.is-open .mp-fold-chevron {
      transform: rotate(90deg);
    }
    .mp-fold-body {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.55s var(--mp-out);
    }
    .mp-fold.is-open .mp-fold-body {
      grid-template-rows: 1fr;
    }
    .mp-fold-inner {
      min-height: 0;
      overflow: hidden;
      padding: 0 16px;
      opacity: 0;
      transform: translateY(-6px);
      transition:
        opacity 0.3s ease,
        transform 0.45s var(--mp-out),
        padding 0.55s var(--mp-out);
    }
    .mp-fold.is-open .mp-fold-inner {
      padding: 2px 16px 14px;
      opacity: 1;
      transform: none;
    }
    .mp-sheet-scroll {
      flex: 1;
      min-height: 0;
      max-height: 90vh;
    }
    .mp-sheet-scroll > .os-scrollbar-vertical {
      top: 14px !important;
      bottom: 14px !important;
      right: 4px;
    }
    .mp-scroll-native {
      overflow: auto;
    }
    .mp-loading {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.35s var(--mp-out) backwards;
    }
    .mp-more {
      display: grid;
      place-items: center;
      padding: 28px 0;
    }
    .mp-gap-small {
      margin: -6px 0 14px;
    }
    a.mp-btn {
      text-decoration: none;
    }
    .mp-readme-loading {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .mp-readme-loading i {
      display: block;
      height: 12px;
      border-radius: 6px;
      background: var(--mp-glass-2, rgba(255, 255, 255, 0.1));
      animation: mp-pulse 1.4s ease-in-out infinite;
    }
    .mp-readme-loading i:nth-child(2) {
      width: 80%;
    }
    .mp-readme-loading i:nth-child(3) {
      width: 55%;
    }
    @media (max-width: 860px) {
      .mp-sheet-hero,
      .mp-sheet-grid {
        grid-template-columns: 1fr;
      }
    }
    .mp-page {
      container-type: inline-size;
      container-name: mp-page;
    }
    .mp-dd-trigger {
      white-space: nowrap;
      max-width: 100%;
      box-sizing: border-box;
    }
    .mp-dd-trigger b {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mp-tab-short {
      display: none;
    }
    .mp-tab-icon {
      display: none;
    }
    @container mp-page (max-width:500px) {
      .mp-tabs {
        justify-content: space-between;
        gap: 2px;
      }
      .mp-tabs .mp-tab {
        flex: none;
        padding: 0 9px;
      }
      .mp-tabs .mp-tab.is-active {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
      }
      .mp-tabs .mp-tab.is-active .mp-tab-short {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mp-tabs .mp-count {
        flex: none;
      }
      .mp-tabs .mp-tab-icon {
        display: block;
      }
      .mp-tabs .mp-tab-long,
      .mp-tabs .mp-tab:not(.is-active) .mp-tab-short,
      .mp-tabs .mp-tab:not(.is-active) .mp-count {
        display: none !important;
      }
      .mp-tabs .mp-tab.is-active .mp-tab-short {
        display: inline;
      }
    }
    @container mp-page (max-width:900px) {
      .mp-tab-long {
        display: none;
      }
      .mp-tab-short {
        display: inline;
      }
      .mp-tab:not(.is-active) .mp-count {
        display: none;
      }
      .mp-tab {
        padding: 0 12px;
        gap: 6px;
      }
    }
    @container mp-page (max-width:820px) {
      .mp-sticky-row {
        gap: 10px;
      }
      .mp-tabs {
        width: 100%;
        box-sizing: border-box;
        justify-content: space-between;
      }
      .mp-sticky-tools {
        width: 100%;
        margin-left: 0;
      }
      .mp-search {
        flex: 1;
        width: auto;
      }
      .mp-toolbar {
        flex-wrap: wrap;
        gap: 10px;
      }
      .mp-chips-wrap {
        flex: 1 1 100%;
      }
      .mp-toolbar .mp-dd {
        flex: 1 1 0;
        min-width: 0;
      }
      .mp-toolbar .mp-dd-trigger {
        width: 100%;
        justify-content: center;
      }
      .mp-loading {
        flex: 1 1 100%;
        justify-content: center;
      }
    }
    .mp-header-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .mp-account-btn {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      height: 52px;
      padding: 0 18px 0 14px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-base);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      transition:
        background-color 0.2s,
        transform 0.35s var(--mp-spring);
    }
    .mp-account-btn.is-in {
      padding-left: 9px;
    }
    .mp-account-btn:hover {
      background: var(--mp-glass-2);
      transform: scale(1.03);
    }
    .mp-account-btn:active {
      transform: scale(0.97);
    }
    .mp-account-btn > span:not(.mp-avatar):not(.mp-count) {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mp-count--alert {
      color: var(--mp-on-accent);
      background: var(--mp-accent);
    }
    .mp-avatar {
      width: 34px;
      height: 34px;
      flex: none;
      border-radius: 50%;
      display: grid;
      place-items: center;
      overflow: hidden;
      font-size: 13px;
      font-weight: 800;
      color: var(--text-base);
      background: var(--mp-glass-2);
      box-shadow: var(--mp-edge);
    }
    .mp-avatar {
      position: relative;
    }
    .mp-avatar::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.3),
        inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    }
    .mp-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .mp-avatar--large {
      width: 64px;
      height: 64px;
      font-size: 24px;
      animation: mp-pop 0.55s var(--mp-spring) 0.1s backwards;
    }
    .mp-star-empty {
      fill: color-mix(in srgb, var(--text-base, #fff) 18%, transparent);
    }
    .mp-starrow {
      display: inline-flex;
      gap: 1px;
      vertical-align: middle;
    }
    .mp-rating-of {
      font-weight: 500;
      color: var(--text-subdued);
    }
    .mp-dd--block,
    .mp-dd--block .mp-dd-trigger {
      width: 100%;
    }
    .mp-dd--block .mp-dd-trigger {
      height: 44px;
      border-radius: 14px;
      padding: 0 14px;
      justify-content: space-between;
      background: color-mix(in srgb, #000 22%, transparent);
      box-shadow:
        inset 0 1px 0 rgba(0, 0, 0, 0.3),
        inset 0 0 0 1px var(--mp-line);
    }
    .mp-confirm .mp-dd--block .mp-dd-trigger {
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-confirm .mp-dd--block .mp-dd-trigger:hover,
    .mp-confirm .mp-dd--block.is-open .mp-dd-trigger {
      background: var(--mp-glass-2);
    }
    .mp-dd--block .mp-dd-trigger b {
      margin-right: auto;
      font-weight: 600;
    }
    .mp-dd-trigger b.is-placeholder {
      color: var(--text-subdued);
      font-weight: 500;
    }
    .mp-floating--menu .mp-dd-menu {
      max-height: min(340px, 60vh);
      overflow-y: auto;
    }
    .mp-floating--block .mp-dd-menu {
      left: 0;
      right: 0;
      min-width: 0;
      transform-origin: top center;
    }
    .mp-star-cell {
      position: relative;
      display: inline-grid;
    }
    .mp-star-cell > svg + svg {
      position: absolute;
      inset: 0;
    }
    .mp-form {
      width: min(470px, 100%);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .mp-form-fields {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: center;
    }
    .mp-form-fields .mp-input {
      text-align: center;
    }
    .mp-form-fields .mp-textarea {
      text-align: left;
    }
    .mp-form-field {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .mp-form-field--center {
      align-items: center;
    }
    .mp-form-label {
      font-size: 13px;
      font-weight: 700;
    }
    .mp-form-hint {
      display: flex;
      justify-content: center;
      gap: 10px;
      font-size: 12px;
      color: var(--text-subdued);
    }
    .mp-form-hint i {
      font-style: normal;
    }
    .mp-textarea {
      height: 140px;
      resize: none;
      line-height: 1.5;
      scrollbar-width: thin;
    }
    .mp-form-check {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 12px 14px;
      border: 0;
      border-radius: 14px;
      cursor: pointer;
      font: inherit;
      font-size: 13.5px;
      line-height: 1.45;
      text-align: center;
      color: var(--text-subdued);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      transition:
        background-color 0.2s,
        color 0.3s;
    }
    .mp-form-check:hover {
      background: var(--mp-glass-2);
    }
    .mp-form-check.is-on {
      color: var(--text-base);
    }
    .mp-form-check a {
      color: var(--text-base);
      text-decoration: underline;
    }
    .mp-form-box {
      position: relative;
      width: 22px;
      height: 22px;
      flex: none;
      border-radius: 7px;
      display: grid;
      place-items: center;
      color: var(--mp-on-accent);
      background: color-mix(in srgb, #000 22%, transparent);
      box-shadow: inset 0 0 0 1px var(--mp-line);
      transition: transform 0.45s var(--mp-spring);
    }
    .mp-form-box::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: var(--mp-accent);
      opacity: 0;
      transform: scale(0.3);
      transition:
        transform 0.45s var(--mp-spring),
        opacity 0.2s;
    }
    .mp-form-box svg {
      position: relative;
      clip-path: inset(0 100% 0 0);
      transition: clip-path 0.18s ease-in;
    }
    .mp-form-check:active .mp-form-box {
      transform: scale(0.86);
    }
    .mp-form-check.is-on .mp-form-box::before {
      opacity: 1;
      transform: scale(1);
    }
    .mp-form-check.is-on .mp-form-box svg {
      clip-path: inset(0 0 0 0);
      transition: clip-path 0.32s cubic-bezier(0.65, 0, 0.35, 1) 0.1s;
    }
    .mp-form-foot {
      margin: 0;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--text-subdued);
    }
    .mp-form-error {
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.45;
      text-align: center;
      color: var(--text-negative, #f3727f);
      background: color-mix(in srgb, var(--text-negative, #f3727f) 12%, transparent);
    }
    .mp-btn--danger-text {
      color: var(--text-negative, #f3727f);
    }
    .mp-panel--schemes .mp-chip {
      display: inline-flex;
      align-items: center;
      gap: 0;
    }
    .mp-chip-swatch {
      width: 10px;
      height: 10px;
      margin-right: 6px;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
    }
    .mp-form-hint.is-error {
      color: var(--text-negative, #f3727f);
    }
    .mp-form-tools {
      display: flex;
      justify-content: center;
      gap: 8px;
    }
    .mp-form-link {
      align-self: center;
      padding: 4px 8px;
      border: 0;
      background: none;
      font: inherit;
      font-size: 12.5px;
      color: var(--text-subdued);
      text-decoration: underline;
      cursor: pointer;
    }
    .mp-form-link:hover {
      color: var(--text-base);
    }
    .mp-colors {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .mp-colors-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .mp-color-row {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      padding: 7px 10px 7px 7px;
      border: 0;
      border-radius: 12px;
      font: inherit;
      text-align: left;
      color: var(--text-base);
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      cursor: pointer;
      transition:
        background-color 0.2s,
        transform 0.35s var(--mp-spring);
    }
    .mp-color-row:hover,
    .mp-color-row.is-open {
      background: var(--mp-glass-2);
    }
    .mp-color-row:active {
      transform: scale(0.97);
    }
    .mp-color-swatch {
      width: 22px;
      height: 22px;
      flex: none;
      border-radius: 7px;
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.18),
        0 1px 3px rgba(0, 0, 0, 0.35);
    }
    .mp-color-name {
      flex: 1;
      min-width: 0;
      font-size: 12.5px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mp-color-hex {
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: var(--text-subdued);
    }
    .mp-picker {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border-radius: 16px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.35s var(--mp-out) both;
    }
    .mp-picker-sv,
    .mp-picker-hue {
      position: relative;
      touch-action: none;
      cursor: crosshair;
    }
    .mp-picker-sv {
      height: 150px;
      border-radius: 12px;
    }
    .mp-picker-sv::before,
    .mp-picker-sv::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
    }
    .mp-picker-sv::before {
      background: linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
    }
    .mp-picker-sv::after {
      background: linear-gradient(to top, #000, rgba(0, 0, 0, 0));
    }
    .mp-picker-hue {
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    }
    .mp-picker-dot {
      position: absolute;
      z-index: 1;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow:
        0 0 0 2px #fff,
        0 2px 6px rgba(0, 0, 0, 0.5);
      pointer-events: none;
    }
    .mp-picker-hex {
      font-variant-numeric: tabular-nums;
      text-transform: uppercase;
    }
    .mp-star-picker {
      display: flex;
      gap: 4px;
    }
    .mp-star-pick {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      background: none;
      animation: mp-pop 0.5s var(--mp-spring) backwards;
      animation-delay: calc(80ms + var(--i) * 45ms);
      transition: transform 0.35s var(--mp-spring);
    }
    .mp-star-pick:hover {
      transform: scale(1.18);
    }
    .mp-star-pick:active {
      transform: scale(0.9);
    }
    .mp-star-pick.is-on svg {
      filter: drop-shadow(0 4px 10px color-mix(in srgb, #ffc64d 45%, transparent));
    }
    .mp-reviews {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 26px 18px 20px;
    }
    .mp-reviews-head {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      text-align: center;
      margin-bottom: 6px;
    }
    .mp-reviews-head h3 {
      margin: 0;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.015em;
    }
    .mp-reviews-head .mp-starrow svg {
      width: 18px;
      height: 18px;
    }
    .mp-reviews-head .mp-btn {
      margin-top: 4px;
    }
    .mp-reviews > .mp-muted {
      text-align: center;
    }
    .mp-sheet-row {
      position: relative;
      display: flex;
      align-items: flex-start;
      max-width: 100%;
      will-change: transform;
      transition: transform 0.42s cubic-bezier(0.32, 0.72, 0, 1) 0.04s;
    }
    .mp-sheet-row.has-island {
      transform: translateX(-198px);
      transition: transform 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.06);
    }
    .mp-island-wrap {
      position: absolute;
      top: 0;
      left: 100%;
      width: 396px;
      height: 100%;
      pointer-events: none;
    }
    @media (max-width: 1440px) {
      .mp-sheet-row.has-island {
        max-width: calc(100% - 396px);
      }
    }
    .mp-island-wrap.is-in .mp-island,
    .mp-island-wrap.is-mount .mp-island {
      pointer-events: auto;
    }
    .mp-island {
      position: relative;
      width: 380px;
      max-height: 90vh;
      margin-left: 16px;
      display: flex;
      border-radius: 20px;
      overflow: hidden;
      color: var(--text-base);
      background: transparent;
      backdrop-filter: blur(30px) saturate(1.5);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 25%, transparent),
        inset 0 0 0 1px var(--mp-line, rgba(255, 255, 255, 0.08)),
        0 40px 100px -20px rgba(0, 0, 0, 0.8);
      transform-origin: left center;
    }
    .mp-island-wrap.is-closed .mp-island {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    .mp-island-wrap.is-pre .mp-island {
      opacity: 0;
      animation: none !important;
    }
    .mp-island-wrap.is-mount .mp-island {
      animation: mp-sheet-in 0.78s 0.07s both;
    }
    .mp-island-wrap.is-in .mp-island {
      animation: mp-sheet-in 0.72s both;
    }
    .mp-island-wrap.is-out .mp-island {
      animation: mp-island-out 0.22s cubic-bezier(0.4, 0, 1, 1) both;
      pointer-events: none;
    }
    @keyframes mp-island-out {
      to {
        opacity: 0;
        transform: translateX(-56px);
      }
    }
    .mp-island-scroll {
      flex: 1;
      min-height: 0;
      max-height: 90vh;
    }
    .mp-sheet-backdrop.is-closing .mp-island-wrap .mp-island {
      animation: mp-sheet-out 0.28s cubic-bezier(0.5, 0, 0.75, 0.2) both;
    }
    .mp-sheet-row > .mp-sheet-frame {
      position: relative;
      flex: 0 1 980px;
      min-width: 0;
      display: flex;
    }
    .mp-sheet-frame > .mp-sheet {
      flex: 1;
      width: auto;
      min-width: 0;
    }
    .mp-sheet-frame > .mp-sheet-close {
      animation: mp-close-in 0.4s var(--mp-spring) 0.42s backwards;
    }
    .mp-sheet-frame.is-pre > .mp-sheet-close {
      opacity: 0;
      animation: none;
    }
    .mp-sheet-backdrop.is-closing .mp-sheet-close {
      opacity: 0;
      transform: scale(0.6);
      transition:
        opacity 0.15s,
        transform 0.2s;
    }
    @keyframes mp-close-in {
      from {
        opacity: 0;
        transform: scale(0.5) rotate(-90deg);
      }
    }
    .mp-island-close {
      left: 346px;
      right: auto;
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 0.15s,
        transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
        background-color 0.2s;
    }
    .mp-island-wrap.is-mount .mp-island-close,
    .mp-island-wrap.is-in .mp-island-close {
      opacity: 1;
      pointer-events: auto;
      animation: mp-close-in 0.35s var(--mp-spring) 0.25s backwards;
    }
    .mp-island-wrap.is-pre .mp-island-close {
      opacity: 0;
      animation: none;
    }
    @media (max-width: 1100px) {
      .mp-island-close {
        left: 286px;
      }
    }
    .mp-reviews-toggle.is-on {
      background: var(--mp-glass-2);
      box-shadow:
        var(--mp-edge),
        inset 0 0 0 1px color-mix(in srgb, #ffc64d 45%, transparent);
    }
    @media (max-width: 1100px) {
      .mp-sheet-row.has-island {
        transform: translateX(-168px);
      }
      .mp-island-wrap {
        width: 336px;
      }
      .mp-island {
        width: 320px;
      }
    }
    .mp-reviews-loading {
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .mp-review-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mp-review {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px;
      border-radius: 16px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      animation: mp-in 0.45s var(--mp-out) backwards;
      animation-delay: calc(var(--i) * 45ms);
    }
    .mp-review.is-mine {
      background: color-mix(in srgb, var(--mp-accent) 7%, transparent);
    }
    .mp-review-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .mp-review-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .mp-review-text {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .mp-review-flag,
    .mp-shared .mp-icon-btn {
      width: 32px;
      height: 32px;
      opacity: 0.7;
    }
    .mp-review-flag:hover,
    .mp-shared .mp-icon-btn:hover {
      opacity: 1;
    }
    .mp-reviews-tools {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .mp-reviews-head .mp-reviews-tools .mp-btn {
      margin-top: 0;
    }
    .mp-review-version {
      font-size: 12px;
      color: var(--text-subdued, #b3b3b3);
    }
    .mp-review-version.is-old {
      color: var(--text-warning, #ffa42b);
    }
    .mp-review-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 12px;
    }
    .mp-review-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 10px;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-subdued, #b3b3b3);
      background: transparent;
      cursor: pointer;
      transition:
        background-color 0.2s,
        color 0.2s;
    }
    .mp-review-action:hover {
      color: var(--text-base, #fff);
      background: var(--mp-glass-2);
    }
    .mp-review-action.is-on {
      color: var(--mp-accent);
    }
    .mp-review-action--quiet {
      align-self: flex-start;
      height: 24px;
      padding: 0 8px;
      margin-left: -8px;
    }
    .mp-review-reply {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 2px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--mp-glass);
      box-shadow: inset 2px 0 0 var(--mp-accent);
    }
    .mp-review-reply.is-hidden {
      opacity: 0.6;
    }
    .mp-review-reply .mp-avatar {
      width: 22px;
      height: 22px;
      font-size: 11px;
    }
    .mp-reviews-more {
      align-self: center;
      margin-top: 4px;
    }
    .mp-reviews-note {
      font-size: 12px;
    }
    .mp-account {
      width: min(500px, 100%);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      scrollbar-color: auto;
    }
    .mp-account::-webkit-scrollbar {
      width: 10px;
    }
    .mp-account::-webkit-scrollbar-track {
      margin: 22px 0;
      background: transparent;
    }
    .mp-account::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      border-radius: 10px;
      background: color-mix(in srgb, var(--text-base, #fff) 22%, transparent) padding-box;
    }
    .mp-account::-webkit-scrollbar-thumb:hover {
      background-color: color-mix(in srgb, var(--text-base, #fff) 38%, transparent);
    }
    .mp-account::-webkit-scrollbar-button {
      display: none;
    }
    .mp-account-terms {
      width: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      font-size: 13px;
      justify-content: center;
      flex-wrap: wrap;
      text-align: center;
      color: var(--text-base);
      background: color-mix(in srgb, var(--text-warning, #ffa42b) 13%, transparent);
    }
    .mp-account-terms a,
    .mp-account-legal a {
      color: inherit;
    }
    .mp-account-section {
      width: 100%;
      text-align: center;
    }
    .mp-account-section h4 {
      margin: 6px 0 8px;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-subdued);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mp-notices {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mp-notice {
      border-radius: 14px;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
      overflow: hidden;
    }
    .mp-notice.is-new {
      box-shadow:
        var(--mp-edge),
        inset 3px 0 0 var(--mp-accent);
    }
    .mp-notice-head {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 14px;
      border: 0;
      cursor: pointer;
      font: inherit;
      font-size: 13.5px;
      justify-content: center;
      text-align: center;
      color: var(--text-base);
      background: none;
    }
    .mp-notice-head .mp-muted {
      font-size: 12px;
      white-space: nowrap;
    }
    .mp-notice-chevron {
      flex-shrink: 0;
      color: var(--text-subdued);
      transition: transform 0.45s var(--mp-spring);
    }
    .mp-notice.is-open .mp-notice-chevron {
      transform: rotate(90deg);
    }
    .mp-notice-fold {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.5s var(--mp-out);
    }
    .mp-notice.is-open .mp-notice-fold {
      grid-template-rows: 1fr;
    }
    .mp-notice-body {
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 10px;
      padding: 0 14px;
      font-size: 13px;
      opacity: 0;
      transform: translateY(-6px);
      transition:
        opacity 0.25s ease,
        transform 0.45s var(--mp-out),
        padding 0.5s var(--mp-out);
    }
    .mp-notice.is-open .mp-notice-body {
      padding-bottom: 14px;
      opacity: 1;
      transform: none;
      transition:
        opacity 0.35s ease 0.08s,
        transform 0.45s var(--mp-out),
        padding 0.5s var(--mp-out);
    }
    .mp-notice-body .mp-facts {
      width: 100%;
    }
    .mp-notice-body .mp-facts {
      grid-template-columns: 1fr;
      gap: 2px;
    }
    .mp-notice-body .mp-facts dt {
      margin-top: 8px;
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mp-notice-body .mp-facts dt:first-child {
      margin-top: 0;
    }
    .mp-confirm > .mp-input {
      text-align: center;
    }
    .mp-account-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin-top: 4px;
    }
    .mp-account-section > .mp-account-actions {
      margin-top: 12px;
    }
    .mp-account-legal {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--text-subdued);
    }
    .mp-shared:not(.is-hidden) {
      cursor: pointer;
    }
    .mp-sheet-title .mp-authors {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .mp-sheet-title .mp-authors .mp-avatar {
      width: 24px;
      height: 24px;
      font-size: 11px;
    }
    .mp-shared-about {
      margin: 0 0 24px;
      font-size: 14.5px;
      line-height: 1.6;
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .mp-shared-group {
      margin-bottom: 18px;
    }
    .mp-shared-group-label {
      display: block;
      margin: 0 0 8px;
      font-size: 12.5px;
      font-weight: 700;
      color: var(--text-subdued);
    }
    .mp-shared-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 8px;
    }
    .mp-shared-list li {
      min-width: 0;
      animation: mp-in 0.45s var(--mp-out) backwards;
      animation-delay: calc(120ms + var(--i) * 35ms);
    }
    .mp-shared-list li > button,
    .mp-shared-list li > div {
      width: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px 8px 8px;
      border: 0;
      border-radius: 14px;
      font: inherit;
      color: inherit;
      text-align: left;
      background: var(--mp-glass);
      box-shadow: var(--mp-edge);
    }
    .mp-shared-list li > button {
      cursor: pointer;
      transition:
        background-color 0.2s,
        transform 0.35s var(--mp-spring-soft);
    }
    .mp-shared-list li > button:hover {
      background: var(--mp-glass-2);
      transform: translateY(-2px);
    }
    .mp-shared-list img,
    .mp-shared-thumb {
      width: 52px;
      height: 34px;
      flex: none;
      border-radius: 8px;
      object-fit: cover;
      background: var(--mp-glass-2);
    }
    .mp-shared-thumb {
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 800;
    }
    .mp-shared-name {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mp-shared-name b,
    .mp-shared-name span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mp-shared-name b {
      font-size: 13.5px;
    }
    .mp-shared-name span {
      font-size: 12px;
      color: var(--text-subdued);
    }
    .mp-shared-list .mp-tag {
      flex: none;
    }
    .mp-shared-fact {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 0;
      font-size: 13px;
      border-top: 1px solid var(--mp-line);
    }
    .mp-shared-fact:first-of-type {
      border-top: 0;
    }
    .mp-shared-fact span {
      color: var(--text-subdued);
    }
    .mp-shared-head {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
    }
    .mp-shared-head p {
      flex: 1;
      max-width: 70ch;
    }
    .mp-shared-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .mp-shared {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 18px;
      border-radius: 20px;
      background: var(--mp-glass);
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #fff 30%, transparent),
        inset 0 0 0 1px color-mix(in srgb, #fff 11%, transparent),
        0 18px 40px -26px rgba(0, 0, 0, 0.7);
      animation: mp-in 0.55s var(--mp-out) backwards;
      animation-delay: calc(var(--i) * 45ms);
      transition:
        transform 0.45s var(--mp-spring),
        background-color 0.3s;
    }
    .mp-shared:hover {
      transform: translateY(-4px);
      background: var(--mp-glass-2);
    }
    .mp-shared.is-hidden {
      opacity: 0.6;
    }
    .mp-shared-top {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mp-shared-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .mp-shared-title b {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: -0.015em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mp-shared-title .mp-muted {
      font-size: 12.5px;
    }
    .mp-shared-desc {
      margin: 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--text-subdued);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .mp-shared-items {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .mp-tag.is-installed {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-base);
    }
    .mp-shared-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: auto;
      font-size: 12.5px;
    }
    .mp-shared-foot .mp-row-actions {
      margin-left: auto;
      align-items: center;
    }
    @container mp-page (max-width:560px) {
      .mp-title h1 {
        font-size: 26px;
      }
      .mp-title .mp-title-icon {
        width: 46px;
        height: 46px;
      }
      .mp-header-tools {
        width: 100%;
      }
      .mp-shared-head {
        flex-direction: column;
        align-items: flex-start;
      }
      .mp-toolbar .mp-dd-label {
        display: none;
      }
      .mp-tab {
        padding: 0 9px;
        font-size: 13px;
      }
      .mp-tabs {
        gap: 2px;
      }
      .mp-grid {
        grid-template-columns: 1fr;
      }
    }
    @layer spotikit-guard {
      .mp-btn--accent,
      .mp-reload-pill,
      .mp-prompt-icon,
      .mp-tab.is-active .mp-count,
      .mp-count--alert,
      .mp-form-check .mp-form-box::before {
        color: var(--mp-on-accent) !important;
        -webkit-text-fill-color: currentColor !important;
        background: var(--mp-accent) !important;
      }
      .mp-form-check .mp-form-box {
        color: var(--mp-on-accent) !important;
      }
      .mp-chip.is-on {
        color: var(--mp-on-text) !important;
        -webkit-text-fill-color: currentColor !important;
        background: var(--text-base) !important;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .mp-page *,
      .mp-sheet-backdrop,
      .mp-sheet {
        animation: none !important;
        transition: none !important;
      }
    }
  `;

  function ensureStyles() {
    if (document.getElementById("spotikit-marketplace-ui")) return;
    var style = document.createElement("style");
    style.id = "spotikit-marketplace-ui";
    style.textContent = CSS;
    document.head.appendChild(style);
    watchContrast();
  }

  function readableOn(color) {
    var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
    if (!m) return "#000";
    var l = [m[1], m[2], m[3]].map(function (v) {
      v = v / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000" : "#fff";
  }

  function watchContrast() {
    var probe = document.createElement("div");
    probe.className = "mp-floating";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;color:var(--mp-accent);background-color:var(--text-base,#fff)";
    document.body.appendChild(probe);
    var queued = false;
    var update = function () {
      queued = false;
      var cs = getComputedStyle(probe);
      var root = document.documentElement.style;
      var accent = readableOn(cs.color);
      var text = readableOn(cs.backgroundColor);
      if (root.getPropertyValue("--mp-on-accent-auto") !== accent) root.setProperty("--mp-on-accent-auto", accent);
      if (root.getPropertyValue("--mp-on-text-auto") !== text) root.setProperty("--mp-on-text-auto", text);
    };
    var queue = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    new MutationObserver(queue).observe(document.head, { childList: true, subtree: true, characterData: true });
    new MutationObserver(queue).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    new MutationObserver(queue).observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    update();
  }

  internal.signals.platform.on(function () {
    ensureStyles();
    SpotiKit.Apps.register({ id: "marketplace", name: "Marketplace", component: Page, button: false });
    var promptHost = document.createElement("div");
    promptHost.id = "spotikit-reload-host";
    document.body.appendChild(promptHost);
    internal.renderInto(promptHost, h(ReloadHost));
    SpotiKit.loaded.then(function () {
      setTimeout(function () {
        offerUpdates().catch(function (e) {
          internal.log.warn("Checking the Marketplace for updates failed", e);
        });
      }, 6000);
    });
    var button = SpotiKit.Topbar.add({
      label: "Marketplace",
      icon: SHOP_ICON,
      onClick: function () {
        SpotiKit.Navigation.go(PATH);
      },
    });
    button.element.setAttribute("data-mp-button", "");
    if (button.tooltip) button.tooltip.remove();
    button.tooltip = glassTip(button.element, { content: "Marketplace", placement: "bottom" });
    var mark = function (path) {
      var open = path === PATH || path.indexOf(PATH + "/") === 0;
      if (button.active !== open) {
        button.active = open;
        button.icon = open ? SHOP_ICON_ACTIVE : SHOP_ICON;
      }
    };
    mark(SpotiKit.Navigation.path);
    SpotiKit.Navigation.on("change", mark);
  });
  SpotiKit.Marketplace.open = function () {
    SpotiKit.Navigation.go(PATH);
  };
})(window.SpotiKit);
