/* SpotiKit loader {{VERSION}} ({{CHANNEL}}) */
(function () {
  "use strict";
  if (window.SpotiKit) {
    return;
  }

  var classMap = window.__spotikitClassMap || {};
  var map = new Map();
  Object.keys(classMap).forEach(function (generated) {
    map.set(generated, classMap[generated]);
  });

  var nativeReplace = DOMTokenList.prototype.replace;
  var nativeQueryAll = Element.prototype.querySelectorAll;

  function swap(element) {
    var list = element.classList;
    if (!list || list.length === 0) {
      return;
    }
    for (var i = list.length - 1; i >= 0; i--) {
      var to = map.get(list[i]);
      if (to !== undefined) {
        nativeReplace.call(list, list[i], to);
      }
    }
  }

  function swapTree(node) {
    if (node.nodeType !== 1) {
      return;
    }
    swap(node);
    var found = nativeQueryAll.call(node, "[class]");
    for (var i = 0; i < found.length; i++) {
      swap(found[i]);
    }
  }

  var classCache = new Map();

  function translateClasses(value) {
    if (typeof value !== "string" || value === "") {
      return value;
    }
    var cached = classCache.get(value);
    if (cached !== undefined) {
      return cached;
    }
    var parts = value.split(" ");
    var changed = false;
    for (var i = 0; i < parts.length; i++) {
      var to = map.get(parts[i]);
      if (to !== undefined) {
        parts[i] = to;
        changed = true;
      }
    }
    var translated = changed ? parts.join(" ") : value;
    if (classCache.size > 5000) {
      classCache.clear();
    }
    classCache.set(value, translated);
    return translated;
  }

  function installTranslation(win) {
    var proto = win.Element.prototype;
    var nativeSetAttribute = proto.setAttribute;
    proto.setAttribute = function (name, value) {
      if (name === "class" || (typeof name === "string" && name.toLowerCase() === "class")) {
        value = translateClasses(value);
      }
      return nativeSetAttribute.call(this, name, value);
    };

    var nativeSetAttributeNS = proto.setAttributeNS;
    proto.setAttributeNS = function (namespace, name, value) {
      if (name === "class") {
        value = translateClasses(value);
      }
      return nativeSetAttributeNS.call(this, namespace, name, value);
    };

    var className = Object.getOwnPropertyDescriptor(proto, "className");
    if (className && className.set && className.configurable) {
      Object.defineProperty(proto, "className", {
        configurable: true,
        enumerable: className.enumerable,
        get: className.get,
        set: function (value) {
          className.set.call(this, translateClasses(value));
        },
      });
    }
  }

  var selectorCache = new Map();
  var classToken = /.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;

  function translateSelector(selector) {
    if (typeof selector !== "string" || selector.indexOf(".") < 0) {
      return selector;
    }
    var cached = selectorCache.get(selector);
    if (cached !== undefined) {
      return cached;
    }
    var translated = selector.replace(classToken, function (match, name) {
      var to = map.get(name);
      return to === undefined ? match : ":is(." + name + ",." + to + ")";
    });
    if (selectorCache.size > 2000) {
      selectorCache.clear();
    }
    selectorCache.set(selector, translated);
    return translated;
  }

  function wrapSelector(proto, name) {
    var original = proto[name];
    if (typeof original !== "function") {
      return;
    }
    proto[name] = function (selector) {
      return original.call(this, translateSelector(selector));
    };
  }

  function wrapClassNames(proto) {
    var original = proto.getElementsByClassName;
    proto.getElementsByClassName = function (names) {
      return original.call(
        this,
        typeof names === "string"
          ? names
              .split(/s+/)
              .map(function (n) {
                return map.get(n) || n;
              })
              .join(" ")
          : names
      );
    };
  }

  function installCompatibility(win) {
    [win.Element.prototype, win.Document.prototype, win.DocumentFragment.prototype].forEach(function (proto) {
      wrapSelector(proto, "querySelector");
      wrapSelector(proto, "querySelectorAll");
    });
    wrapSelector(win.Element.prototype, "matches");
    wrapSelector(win.Element.prototype, "closest");
    wrapClassNames(win.Element.prototype);
    wrapClassNames(win.Document.prototype);

    var tokenList = win.DOMTokenList.prototype;
    var contains = tokenList.contains;
    var add = tokenList.add;
    var remove = tokenList.remove;
    var replace = tokenList.replace;
    var toggle = tokenList.toggle;

    tokenList.contains = function (token) {
      if (contains.call(this, token)) {
        return true;
      }
      var to = map.get(token);
      return to !== undefined && contains.call(this, to);
    };
    tokenList.add = function () {
      var tokens = Array.prototype.map.call(arguments, function (t) {
        return map.get(t) || t;
      });
      return add.apply(this, tokens);
    };
    tokenList.remove = function () {
      var tokens = [];
      Array.prototype.forEach.call(arguments, function (t) {
        tokens.push(t);
        var to = map.get(t);
        if (to !== undefined) {
          tokens.push(to);
        }
      });
      return remove.apply(this, tokens);
    };
    tokenList.toggle = function (token, force) {
      var to = map.get(token);
      if (to === undefined) {
        return arguments.length > 1 ? toggle.call(this, token, force) : toggle.call(this, token);
      }
      var on = arguments.length > 1 ? !!force : !(contains.call(this, to) || contains.call(this, token));
      remove.call(this, token);
      if (on) {
        add.call(this, to);
      } else {
        remove.call(this, to);
      }
      return on;
    };
    tokenList.replace = function (token, replacement) {
      var to = map.get(token);
      var by = map.get(replacement) || replacement;
      if (to !== undefined && contains.call(this, to)) {
        return replace.call(this, to, by);
      }
      return replace.call(this, token, by);
    };
  }

  function observe(doc) {
    swapTree(doc.documentElement);
    new doc.defaultView.MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === "attributes") {
          swap(mutation.target);
        } else {
          for (var j = 0; j < mutation.addedNodes.length; j++) {
            swapTree(mutation.addedNodes[j]);
          }
        }
      }
    }).observe(doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  var translatedWindows = [];

  function translateWindow(win) {
    if (!win || translatedWindows.indexOf(win) >= 0) {
      return;
    }
    translatedWindows = translatedWindows.filter(function (w) {
      return !w.closed;
    });
    translatedWindows.push(win);
    installTranslation(win);
    installCompatibility(win);
    observe(win.document);
  }

  var installed = false;
  function install() {
    if (installed) {
      return;
    }
    installed = true;
    translateWindow(window);
    var pip = window.documentPictureInPicture;
    if (pip && typeof pip.addEventListener === "function") {
      pip.addEventListener("enter", function (event) {
        translateWindow(event.window);
      });
      if (pip.window) {
        translateWindow(pip.window);
      }
    }
  }
  if (map.size > 0) {
    install();
  }

  var SpotiKit = {};
  [
    ["version", "{{VERSION}}"],
    ["channel", "{{CHANNEL}}"],
    ["loadedAt", new Date().toISOString()],
    ["classMap", Object.freeze(Object.assign({}, classMap))],
  ].forEach(function (fact) {
    Object.defineProperty(SpotiKit, fact[0], { value: fact[1], enumerable: true });
  });

  Object.defineProperty(window, "SpotiKit", { value: SpotiKit, enumerable: true });
  console.info(
    "[SpotiKit] loader " +
      SpotiKit.version +
      " (" +
      SpotiKit.channel +
      ") is active, " +
      map.size +
      " mapped class" +
      (map.size === 1 ? "" : "es")
  );
})();
