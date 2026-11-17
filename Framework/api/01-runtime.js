/* SpotiKit runtime */
(function (SpotiKit) {
  "use strict";
  if (!SpotiKit || SpotiKit._internal || SpotiKit.devPlaceholder) {
    return;
  }

  var internal = {};
  Object.defineProperty(SpotiKit, "_internal", { value: internal });

  var safeMode = false;
  try {
    safeMode = localStorage.getItem("spotikit:safe-mode") === "true";
  } catch (e) {}
  internal.safeMode = safeMode;
  Object.defineProperty(SpotiKit, "safeMode", { value: safeMode, enumerable: true });
  Object.defineProperty(SpotiKit, "leaveSafeMode", {
    value: function () {
      localStorage.removeItem("spotikit:safe-mode");
      location.reload();
    },
  });

  var prefix = "[SpotiKit]";
  internal.log = {
    info: function () {
      console.info.apply(console, [prefix].concat([].slice.call(arguments)));
    },
    warn: function () {
      console.warn.apply(console, [prefix].concat([].slice.call(arguments)));
    },
    error: function () {
      console.error.apply(console, [prefix].concat([].slice.call(arguments)));
    },
  };

  internal.waitFor = function (get, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var delay = 16;
      (function check() {
        var value;
        try {
          value = get();
        } catch (e) {
          value = undefined;
        }
        if (value) {
          resolve(value);
          return;
        }
        if (timeoutMs && Date.now() - started > timeoutMs) {
          reject(new Error("Timed out"));
          return;
        }
        delay = Math.min(delay * 1.5, 500);
        setTimeout(check, delay);
      })();
    });
  };

  function Signal(name) {
    this.name = name;
    this._callbacks = [];
    this.fired = false;
  }
  Signal.prototype.on = function (callback) {
    if (this.fired) {
      callback();
    } else {
      this._callbacks.push(callback);
    }
  };
  Signal.prototype.fire = function () {
    if (this.fired) {
      return;
    }
    this.fired = true;
    var callbacks = this._callbacks;
    this._callbacks = [];
    callbacks.forEach(function (callback) {
      try {
        callback();
      } catch (e) {
        internal.log.error("A " + this.name + " listener threw", e);
      }
    }, this);
  };
  internal.Signal = Signal;

  internal.signals = {
    modules: new Signal("modules"),
    platform: new Signal("platform"),
    addons: new Signal("addons"),
  };

  var ownerKeys = {};
  var bags = {};
  function ownerOf(stack) {
    var keys = Object.keys(ownerKeys);
    if (!keys.length || typeof stack !== "string") return null;
    var lines = stack.split("\n");
    for (var i = 0; i < lines.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        if (lines[i].indexOf(keys[k] + ":") >= 0) return ownerKeys[keys[k]];
      }
    }
    return null;
  }
  function ownerHere() {
    if (!Object.keys(ownerKeys).length) return null;
    var limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 100;
    var stack = new Error().stack;
    Error.stackTraceLimit = limit;
    return ownerOf(stack);
  }
  internal.owners = {
    add: function (key, owner) {
      ownerKeys[key] = owner;
    },
    of: ownerOf,
    here: ownerHere,
    dispose: function (owner) {
      var bag = bags[owner];
      delete bags[owner];
      if (!bag) return 0;
      var list = Array.from(bag).reverse();
      list.forEach(function (run) {
        try {
          run();
        } catch (e) {
          internal.log.error("Cleaning up after " + owner + " failed", e);
        }
      });
      return list.length;
    },
  };
  internal.track = function (dispose) {
    var owner = ownerHere();
    if (!owner) return dispose;
    var bag = bags[owner] || (bags[owner] = new Set());
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      bag.delete(run);
      return dispose.apply(this, arguments);
    };
    bag.add(run);
    return run;
  };
  internal.trackRemove = function (handle, method) {
    internal.track(function () {
      handle[method || "remove"]();
    });
    return handle;
  };

  Object.defineProperty(SpotiKit, "ready", {
    enumerable: true,
    value: new Promise(function (resolve) {
      internal.signals.platform.on(resolve);
    }),
  });
  Object.defineProperty(SpotiKit, "loaded", {
    enumerable: true,
    value: new Promise(function (resolve) {
      internal.signals.addons.on(resolve);
    }),
  });

  var require = null;
  internal.require = function () {
    if (require) {
      return require;
    }
    var queue = null;
    Object.keys(window).some(function (key) {
      if (!/^(rs|web)packChunk/.test(key) || !Array.isArray(window[key])) return false;
      queue = window[key];
      return true;
    });
    if (!queue) {
      return null;
    }
    queue.push([
      [Symbol("spotikit")],
      {},
      function (r) {
        require = r;
      },
    ]);
    return require;
  };

  var scannedIds = new Set();
  var moduleList = [];
  var exportList = [];

  function ownKeys(value) {
    try {
      return Object.keys(value);
    } catch (e) {
      return [];
    }
  }

  internal.scan = function () {
    var r = internal.require();
    if (!r) {
      return 0;
    }
    var added = 0;
    Object.keys(r.m).forEach(function (id) {
      if (scannedIds.has(id)) {
        return;
      }
      scannedIds.add(id);
      var exported;
      try {
        exported = r(id);
      } catch (e) {
        return;
      }
      added++;
      moduleList.push({ id: id, exports: exported });
      if (exported && (typeof exported === "object" || typeof exported === "function")) {
        ownKeys(exported).forEach(function (key) {
          var value;
          try {
            value = exported[key];
          } catch (e) {
            return;
          }
          if (value !== undefined && value !== null) {
            exportList.push({ id: id, key: key, value: value });
          }
        });
      }
    });
    return added;
  };

  var sourceCache = new WeakMap();
  internal.source = function (fn) {
    if (typeof fn !== "function") {
      return "";
    }
    var cached = sourceCache.get(fn);
    if (cached === undefined) {
      try {
        cached = Function.prototype.toString.call(fn);
      } catch (e) {
        cached = "";
      }
      sourceCache.set(fn, cached);
    }
    return cached;
  };

  var MEMO = Symbol.for("react.memo");
  var FORWARD_REF = Symbol.for("react.forward_ref");

  internal.renderFunction = function (component) {
    if (typeof component === "function") {
      return component;
    }
    if (component && component.$$typeof === FORWARD_REF) {
      return component.render;
    }
    if (component && component.$$typeof === MEMO) {
      return internal.renderFunction(component.type);
    }
    return null;
  };

  internal.findModule = function (test) {
    internal.scan();
    for (var i = 0; i < moduleList.length; i++) {
      try {
        if (moduleList[i].exports && test(moduleList[i].exports)) {
          return moduleList[i].exports;
        }
      } catch (e) {}
    }
    return undefined;
  };

  internal.findExport = function (test) {
    internal.scan();
    for (var i = 0; i < exportList.length; i++) {
      try {
        if (test(exportList[i].value, exportList[i])) {
          return exportList[i].value;
        }
      } catch (e) {}
    }
    return undefined;
  };

  internal.findExports = function (test) {
    internal.scan();
    return exportList
      .filter(function (entry) {
        try {
          return test(entry.value, entry);
        } catch (e) {
          return false;
        }
      })
      .map(function (entry) {
        return entry.value;
      });
  };

  internal.findComponent = function (markers, extra) {
    return internal.findExport(function (value) {
      var fn = internal.renderFunction(value);
      if (!fn) {
        return false;
      }
      var text = internal.source(fn);
      for (var i = 0; i < markers.length; i++) {
        var marker = markers[i];
        if (typeof marker === "string" ? text.indexOf(marker) < 0 : !marker.test(text)) {
          return false;
        }
      }
      return !extra || extra(value, text);
    });
  };

  internal.lazy = function (target, name, find) {
    var found;
    Object.defineProperty(target, name, {
      enumerable: true,
      configurable: true,
      get: function () {
        if (found === undefined || found === null) {
          try {
            found = find();
          } catch (e) {
            found = undefined;
          }
        }
        return found;
      },
      set: function (value) {
        found = value;
      },
    });
  };

  internal.factories = function () {
    var r = internal.require();
    return r
      ? Object.keys(r.m).map(function (id) {
          return { id: id, factory: r.m[id] };
        })
      : [];
  };

  internal.fiberOf = function (element) {
    if (!element) {
      return null;
    }
    for (var key in element) {
      if (key.indexOf("__reactFiber$") === 0) {
        return element[key];
      }
    }
    return null;
  };

  internal.rootFiber = function () {
    var root = document.getElementById("main") || document.querySelector("#main, body > div");
    if (!root) {
      return null;
    }
    for (var key in root) {
      if (key.indexOf("__reactContainer$") === 0) {
        return root[key];
      }
    }
    return null;
  };

  internal.walkFibers = function (visit, start) {
    var stack = [start || internal.rootFiber()];
    var count = 0;
    while (stack.length && count < 400000) {
      var fiber = stack.pop();
      if (!fiber) {
        continue;
      }
      count++;
      if (visit(fiber)) {
        return fiber;
      }
      if (fiber.sibling) {
        stack.push(fiber.sibling);
      }
      if (fiber.child) {
        stack.push(fiber.child);
      }
    }
    return null;
  };

  internal.closestProps = function (fiber, test, limit) {
    for (var i = 0; fiber && i < (limit || 120); i++, fiber = fiber.return) {
      var props = fiber.memoizedProps;
      if (props && typeof props === "object" && test(props, fiber)) {
        return props;
      }
    }
    return null;
  };

  internal.findContextValue = function (test) {
    var found = internal.walkFibers(function (fiber) {
      var props = fiber.memoizedProps;
      return !!(
        props &&
        props.value &&
        typeof props.value === "object" &&
        fiber.type &&
        fiber.type._context &&
        test(props.value)
      );
    });
    return found ? found.memoizedProps.value : null;
  };

  internal.withSpotifyContexts = function (domNode, element) {
    var React = window.SpotiKit.React;
    var fiber = internal.fiberOf(domNode);
    if (!fiber) {
      var probe = domNode && domNode.querySelector ? domNode.querySelector("*") : null;
      fiber = internal.fiberOf(probe);
    }
    for (var i = 0; fiber && i < 2000; i++, fiber = fiber.return) {
      var type = fiber.type;
      if (type && type._context && fiber.memoizedProps && "value" in fiber.memoizedProps) {
        element = React.createElement(type._context.Provider, { value: fiber.memoizedProps.value }, element);
      }
    }
    return element;
  };

  var typeHandlers = new Map();
  var wrappedRuntimes = new WeakSet();

  function applyHandlers(type, props) {
    var handlers = typeHandlers.get(type);
    for (var i = 0; i < handlers.length; i++) {
      try {
        var next = handlers[i](props, type);
        if (next) {
          props = next;
        }
      } catch (e) {
        internal.log.error("An element hook threw", e);
      }
    }
    return props;
  }

  function wrapJsx(original) {
    return function (type, props) {
      if (typeHandlers.size > 0 && typeHandlers.has(type)) {
        var args = [].slice.call(arguments);
        args[1] = applyHandlers(type, props || {});
        return original.apply(this, args);
      }
      return original.apply(this, arguments);
    };
  }

  function wrapCreateElement(original) {
    return function (type, config) {
      if (typeHandlers.size > 0 && typeHandlers.has(type)) {
        var props = Object.assign({}, config);
        if (arguments.length === 3) {
          props.children = arguments[2];
        } else if (arguments.length > 3) {
          props.children = [].slice.call(arguments, 2);
        }
        return original.call(this, type, applyHandlers(type, props));
      }
      return original.apply(this, arguments);
    };
  }

  internal.installElementHooks = function () {
    var count = 0;
    internal.findExports(function () {
      return false;
    });
    moduleList.forEach(function (entry) {
      var m = entry.exports;
      if (!m || typeof m !== "object" || wrappedRuntimes.has(m)) {
        return;
      }
      try {
        if (typeof m.jsx === "function" && typeof m.jsxs === "function" && "Fragment" in m) {
          m.jsx = wrapJsx(m.jsx);
          m.jsxs = wrapJsx(m.jsxs);
          wrappedRuntimes.add(m);
          count++;
        } else if (typeof m.createElement === "function" && typeof m.useState === "function") {
          m.createElement = wrapCreateElement(m.createElement);
          wrappedRuntimes.add(m);
          count++;
        }
      } catch (e) {
        internal.log.warn("Could not hook a React runtime", e);
      }
    });
    return count;
  };

  internal.onElement = function (type, handler) {
    if (!type) {
      return function () {};
    }
    var list = typeHandlers.get(type);
    if (!list) {
      typeHandlers.set(type, (list = []));
    }
    list.push(handler);
    return function remove() {
      var at = list.indexOf(handler);
      if (at >= 0) {
        list.splice(at, 1);
      }
      if (list.length === 0) {
        typeHandlers.delete(type);
      }
    };
  };

  internal.findPlatform = function () {
    var found = internal.walkFibers(function (fiber) {
      var props = fiber.memoizedProps;
      return !!(
        props &&
        props.platform &&
        typeof props.platform.getEqualizerAPI === "function" &&
        typeof props.platform.getServiceWorkerMessenger === "function"
      );
    });
    return found ? found.memoizedProps.platform : null;
  };

  internal.boot = internal
    .waitFor(function () {
      return internal.require();
    })
    .then(function () {
      internal.scan();
      var hooked = internal.installElementHooks();
      if (hooked === 0) {
        internal.log.warn("No React runtime found to hook; menus and app routes won't get SpotiKit items.");
      }
      internal.signals.modules.fire();
    });
})(window.SpotiKit);
