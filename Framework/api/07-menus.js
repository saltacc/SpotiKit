/* SpotiKit menus */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  function React() {
    return SpotiKit.React;
  }

  function iconElement(icon) {
    var R = React();
    if (!icon) {
      return undefined;
    }
    if (typeof icon === "object") {
      return icon;
    }
    if (SpotiKit.Icons.has(icon)) {
      return R.createElement("svg", {
        role: "img",
        "aria-hidden": "true",
        className: "e-icon",
        viewBox: "0 0 16 16",
        style: {
          "--encore-icon-fill": "var(--text-subdued)",
          "--encore-icon-height": "var(--encore-graphic-size-decorative-smaller)",
          "--encore-icon-width": "var(--encore-graphic-size-decorative-smaller)",
        },
        dangerouslySetInnerHTML: { __html: SpotiKit.Icons.markup(icon) },
      });
    }
    if (/^\s*<svg/i.test(icon)) {
      return R.createElement("span", {
        style: { display: "inline-flex", width: 16, height: 16 },
        dangerouslySetInnerHTML: { __html: icon },
      });
    }
    return undefined;
  }
  internal.iconElement = iconElement;

  function readMenu(fiber) {
    var menu = { props: null, trigger: null, element: null };
    for (var i = 0; fiber && i < 150; i++, fiber = fiber.return) {
      var p = fiber.memoizedProps;
      if (!p || typeof p !== "object") {
        continue;
      }
      if (
        !menu.props &&
        (typeof p.uri === "string" ||
          Array.isArray(p.uris) ||
          (p.item && p.item.uri) ||
          (p.reference && p.reference.uri) ||
          typeof p.folderUri === "string")
      ) {
        menu.props = p;
      }
      if (!menu.trigger && typeof p.trigger === "string" && (p.triggerRef || p.menu)) {
        menu.trigger = p.trigger;
        var ref = p.triggerRef;
        menu.element = ref && ref.current !== undefined ? ref.current : ref || null;
      }
      if (menu.props && menu.trigger) {
        break;
      }
    }
    return menu;
  }

  function targetOf(menu) {
    var p = menu.props || {};
    var uri = p.uri || (p.item && p.item.uri) || (p.reference && p.reference.uri) || p.folderUri || null;
    var uris = p.uris || (uri ? [uri] : []);
    var uid = p.uid || (p.item && p.item.uid);
    var target = {
      uris: uris,
      uri: uris[0] || null,
      uids: p.uids || (uid ? [uid] : []),
      contextUri: p.contextUri || (p.context && p.context.uri) || null,
      type: null,
      trigger: menu.trigger,
      element: menu.element,
      props: p,
    };
    try {
      target.type = target.uri ? SpotiKit.URI.type(target.uri) : null;
    } catch (e) {
      target.type = null;
    }
    return target;
  }

  var MenuContext = null;
  function menuContext() {
    if (!MenuContext) {
      MenuContext = React().createContext(null);
    }
    return MenuContext;
  }

  var entries = [];

  var MenuEntries = null;
  function menuEntriesComponent() {
    if (MenuEntries) {
      return MenuEntries;
    }
    var R = React();
    MenuEntries = function SpotiKitMenuEntries(props) {
      R.Component.call(this, props);
    };
    MenuEntries.prototype = Object.create(R.Component.prototype);
    MenuEntries.prototype.constructor = MenuEntries;
    MenuEntries.prototype.render = function () {
      var menu = readMenu(this._reactInternals && this._reactInternals.return);
      var shown = entries.filter(function (entry) {
        return entry._applies(menu);
      });
      if (shown.length === 0) {
        return null;
      }
      return R.createElement(
        menuContext().Provider,
        { value: menu },
        shown.map(function (entry) {
          return entry._element();
        })
      );
    };
    return MenuEntries;
  }

  internal.platformReady
    .then(function () {
      return internal.waitFor(function () {
        return SpotiKit.React && internal.MenuList && SpotiKit.Components.MenuItem;
      });
    })
    .then(function () {
      internal.onElement(internal.MenuList, function (props) {
        if (entries.length === 0) {
          return props;
        }
        var children = props.children;
        var list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
        return Object.assign({}, props, {
          children: [React().createElement(menuEntriesComponent(), { key: "spotikit-menu-entries" })].concat(list),
        });
      });
    });

  var nextKey = 0;

  function Entry(kind, options, parent) {
    this._kind = kind;
    this._parent = parent || null;
    this._key = "spotikit-entry-" + nextKey++;
    this._listeners = new Set();
    this._options = {};
    this._children = [];
    this.update(options);
  }

  Entry.prototype.update = function (options) {
    var self = this;
    Object.keys(options || {}).forEach(function (key) {
      if (key === "items") {
        self._children = (options.items || []).map(function (child) {
          return child instanceof Entry ? child : new Entry(self._kind, child, self);
        });
      } else {
        self._options[key] = options[key];
      }
    });
    this._listeners.forEach(function (listener) {
      listener();
    });
    return this;
  };

  ["label", "icon", "disabled", "checked", "divider"].forEach(function (name) {
    Object.defineProperty(Entry.prototype, name, {
      get: function () {
        return this._options[name];
      },
      set: function (value) {
        var change = {};
        change[name] = value;
        this.update(change);
      },
    });
  });

  Entry.prototype.remove = function () {
    if (this._parent) {
      this._parent._children = this._parent._children.filter(function (e) {
        return e !== this;
      }, this);
      this._parent.update({});
      return;
    }
    var at = entries.indexOf(this);
    if (at >= 0) {
      entries.splice(at, 1);
    }
  };

  Entry.prototype._applies = function (menu) {
    var when = this._options.when;
    try {
      if (this._kind === "profile") {
        var el = menu.element;
        var isProfile =
          menu.trigger === "click" &&
          !!el &&
          !!el.classList &&
          el.classList.contains("user-widget-button");
        return isProfile && (!when || !!when());
      }
      var target = targetOf(menu);
      if (target.uris.length === 0 && !this._options.anyMenu) {
        return false;
      }
      return !when || !!when(target);
    } catch (e) {
      internal.log.error("A menu entry's when() threw", e);
      return false;
    }
  };

  Entry.prototype._element = function () {
    var entry = this;
    return React().createElement(EntryView(), { key: this._key, entry: entry });
  };

  var View = null;
  function selectEntry(entry, menu, event) {
    var options = entry._options;
    if (typeof options.onSelect !== "function") {
      return;
    }
    var label = typeof options.label === "string" ? options.label : "Extension action";
    var failed = function (error) {
      internal.log.error("The menu action '" + label + "' failed", error);
      SpotiKit.notify(label + " couldn't finish. Try again later.", {
        type: "error",
        duration: 6000,
      });
    };
    try {
      var result = entry._kind === "profile"
        ? options.onSelect(entry, event)
        : options.onSelect(targetOf(menu), event);
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).catch(failed);
      }
      return result;
    } catch (error) {
      failed(error);
    }
  }

  function EntryView() {
    if (View) {
      return View;
    }
    View = function SpotiKitMenuEntry(props) {
      var R = React();
      var entry = props.entry;
      var tick = R.useReducer(function (x) {
        return x + 1;
      }, 0)[1];
      R.useEffect(
        function () {
          entry._listeners.add(tick);
          return function () {
            entry._listeners.delete(tick);
          };
        },
        [entry]
      );
      var menu = R.useContext(menuContext()) || {};
      var o = entry._options;
      var C = SpotiKit.Components;

      if (entry._children.length > 0) {
        var depth = 1;
        for (var p = entry._parent; p; p = p._parent) {
          depth++;
        }
        var children = entry._children
          .filter(function (child) {
            return child._applies(menu);
          })
          .map(function (child) {
            return child._element();
          });
        return R.createElement(
          C.SubMenuItem,
          {
            displayText: o.label,
            depth: depth,
            placement: "right-start",
            divider: o.divider,
            disabled: !!o.disabled,
            leadingIcon: iconElement(o.icon),
            onOpenChange: function () {},
            onClick: function () {},
          },
          children
        );
      }

      var checked = entry._kind === "profile" && o.checked;
      return R.createElement(
        C.MenuItem,
        {
          role: "menuitem",
          disabled: !!o.disabled,
          divider: o.divider,
          textValue: typeof o.label === "string" ? o.label : undefined,
          leadingIcon: iconElement(o.icon),
          trailingIcon: iconElement(checked ? "check" : o.trailingIcon),
          onClick: function (event) {
            return selectEntry(entry, menu, event);
          },
        },
        o.label
      );
    };
    return View;
  }

  function add(kind) {
    return function (options) {
      if (!options || !options.label) {
        throw new Error("A menu entry needs a label.");
      }
      var entry = new Entry(kind, options);
      entries.push(entry);
      return internal.trackRemove(entry);
    };
  }

  SpotiKit.ContextMenu = { add: add("context") };

  SpotiKit.ProfileMenu = { add: add("profile") };
})(window.SpotiKit);
