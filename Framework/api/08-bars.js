/* SpotiKit Topbar and Playbar */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  function iconMarkup(icon, large) {
    if (icon && SpotiKit.Icons.has(icon)) {
      var size = large ? "base" : "smaller";
      var px = large ? 24 : 16;
      return (
        '<svg data-encore-id="icon" role="img" aria-hidden="true" class="e-icon" viewBox="0 0 16 16" fill="currentColor" ' +
        'style="--encore-icon-height:var(--encore-graphic-size-decorative-' +
        size +
        ");--encore-icon-width:var(--encore-graphic-size-decorative-" +
        size +
        ");width:" +
        px +
        "px;height:" +
        px +
        'px">' +
        SpotiKit.Icons.markup(icon) +
        "</svg>"
      );
    }
    return typeof icon === "string" && /<svg[\s>]/i.test(icon) ? sizedSvg(icon, large ? 24 : 16) : icon || "";
  }
  internal.iconMarkup = iconMarkup;

  function sizedSvg(markup, px) {
    var holder = document.createElement("div");
    holder.innerHTML = markup.trim();
    var svg = holder.querySelector("svg");
    if (!svg || svg.getAttribute("class")) return markup;
    if (!svg.getAttribute("viewBox")) {
      var w = parseFloat(svg.getAttribute("width")) || 24;
      var h = parseFloat(svg.getAttribute("height")) || 24;
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    }
    svg.setAttribute("width", px);
    svg.setAttribute("height", px);
    svg.setAttribute("aria-hidden", "true");
    [svg].concat(Array.prototype.slice.call(svg.querySelectorAll("[fill],[stroke]"))).forEach(function (node) {
      ["fill", "stroke"].forEach(function (attr) {
        var value = node.getAttribute(attr);
        if (value && !/^(none|currentColor|url\()/i.test(value)) node.setAttribute(attr, "currentColor");
      });
    });
    if (!svg.getAttribute("fill") && !svg.querySelector("[fill]") && !svg.getAttribute("stroke")) svg.setAttribute("fill", "currentColor");
    return svg.outerHTML;
  }

  var places = {
    topbarLeft: {
      container: ".global-nav-bar-history-buttons",
      sibling: ".global-nav-bar-history-buttons button",
      insert: "append",
    },
    topbarRight: {
      container: ".global-nav-bar-actions",
      sibling: ".global-nav-bar-actions button:not(.user-widget-button)",
      insert: "prepend",
    },
    playbar: {
      container: ".now-playing-bar-extra-controls",
      sibling: ".now-playing-bar-extra-controls button.lyrics-button:not(.now-playing-bar-extra-button)",
      insert: "prepend",
    },
    widget: {
      container: ".now-playing-widget-actions",
      sibling: ".now-playing-widget-actions button",
      insert: "append",
    },
    nav: { container: ".global-nav-bar-search-area", sibling: ".global-nav-home-button", insert: "afterSibling" },
  };
  var mounted = {
    topbarLeft: new Set(),
    topbarRight: new Set(),
    playbar: new Set(),
    widget: new Set(),
    nav: new Set(),
  };

  function siblingClasses(place) {
    var sibling = document.querySelector(places[place].sibling);
    if (!sibling) {
      return null;
    }
    return Array.prototype.filter
      .call(sibling.classList, function (name) {
        return !/--active|--active-dot|-active$/.test(name);
      })
      .join(" ");
  }

  function place() {
    Object.keys(mounted).forEach(function (where) {
      if (mounted[where].size === 0) {
        return;
      }
      var container = document.querySelector(places[where].container);
      if (!container) {
        return;
      }
      var classes = siblingClasses(where);
      var buttons = Array.from(mounted[where]);
      buttons.forEach(function (button) {
        if (classes && button._baseClasses !== classes) {
          button._baseClasses = classes;
          button._applyClasses();
        }
      });
      var missing = buttons.filter(function (button) {
        return button.element.parentNode !== container;
      });
      if (missing.length === 0) {
        return;
      }
      var nodes = missing.map(function (button) {
        return button.element;
      });
      var anchor = places[where].insert === "afterSibling" && container.querySelector(places[where].sibling);
      if (anchor) {
        var after = anchor;
        buttons.forEach(function (button) {
          if (button.element.parentNode !== container || button.element.previousSibling !== after) {
            after.after(button.element);
          }
          after = button.element;
        });
      } else if (places[where].insert === "prepend") {
        container.prepend.apply(container, nodes);
      } else {
        container.append.apply(container, nodes);
      }
    });
  }

  var scheduled = false;
  function schedulePlace() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      place();
    });
  }
  new MutationObserver(function () {
    if (
      mounted.topbarLeft.size +
        mounted.topbarRight.size +
        mounted.playbar.size +
        mounted.widget.size +
        mounted.nav.size >
      0
    ) {
      schedulePlace();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  function attachTooltip(button) {
    if (!button.tooltip) {
      button.tooltip = SpotiKit.Tooltip.attach(button.element, { content: button._label });
    }
  }

  function BarButton(where, options) {
    this._where = where;
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.setAttribute("data-encore-id", "buttonTertiary");
    this.element.setAttribute("data-spotikit", where);
    this.iconElement = document.createElement("span");
    this.iconElement.className = "e-button__icon-wrapper";
    this.iconElement.setAttribute("aria-hidden", "true");
    this.element.appendChild(this.iconElement);
    this._baseClasses = siblingClasses(where) || "";
    var self = this;
    this.element.addEventListener("click", function (event) {
      if (!self._disabled && typeof self._onClick === "function") {
        self._onClick(self, event);
      }
    });
    this.label = options.label;
    this.icon = options.icon;
    this.onClick = options.onClick;
    this.disabled = !!options.disabled;
    this.active = !!options.active;
  }
  BarButton.prototype._applyClasses = function () {
    var classes = this._baseClasses ? this._baseClasses.split(" ") : [];
    var base =
      this._where === "playbar" &&
      classes.find(function (name) {
        return /button$/.test(name) && !/^e-/.test(name);
      });
    if (this._active && base) {
      classes.push(base + "--active", base + "--active-dot");
    }
    this.element.className = classes.join(" ");
    this.element.style.color =
      this._active && !base ? (this._where === "nav" ? "var(--text-base)" : "var(--text-bright-accent)") : "";
    this.element.style.opacity = this._disabled ? "0.4" : "";
  };
  Object.defineProperties(BarButton.prototype, {
    label: {
      get: function () {
        return this._label;
      },
      set: function (text) {
        this._label = text;
        this.element.setAttribute("aria-label", text);
        attachTooltip(this);
        this.tooltip.setContent(text);
      },
    },
    icon: {
      get: function () {
        return this._icon;
      },
      set: function (icon) {
        this._icon = icon;
        this.iconElement.innerHTML = iconMarkup(icon, this._where === "nav");
      },
    },
    onClick: {
      get: function () {
        return this._onClick;
      },
      set: function (fn) {
        this._onClick = fn;
      },
    },
    disabled: {
      get: function () {
        return this._disabled;
      },
      set: function (value) {
        this._disabled = !!value;
        this.element.disabled = this._disabled;
        this.element.setAttribute("aria-disabled", String(this._disabled));
        this._applyClasses();
      },
    },
    active: {
      get: function () {
        return this._active;
      },
      set: function (value) {
        this._active = !!value;
        this.element.setAttribute("aria-pressed", String(this._active));
        this.element.setAttribute("data-active", String(this._active));
        this._applyClasses();
      },
    },
  });
  BarButton.prototype.update = function (options) {
    var self = this;
    ["label", "icon", "onClick", "disabled", "active"].forEach(function (key) {
      if (options && key in options) {
        self[key] = options[key];
      }
    });
    return this;
  };
  BarButton.prototype.show = function () {
    mounted[this._where].add(this);
    place();
    return this;
  };
  BarButton.prototype.remove = function () {
    mounted[this._where].delete(this);
    this.element.remove();
    if (this.tooltip) {
      this.tooltip.hide();
    }
  };

  function add(where) {
    return function (options) {
      if (!options || !options.label) {
        throw new Error("A button needs a label (it is its tooltip).");
      }
      return internal.trackRemove(new BarButton(typeof where === "function" ? where(options) : where, options).show());
    };
  }

  SpotiKit.Topbar = {
    add: add(function (options) {
      return options.side === "right" ? "topbarRight" : "topbarLeft";
    }),
  };

  SpotiKit.Playbar = { add: add("playbar"), addWidget: add("widget") };
  internal.BarButton = BarButton;
})(window.SpotiKit);
