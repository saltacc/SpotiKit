/* SpotiKit apps, extensions and configuration */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  var base = "/spotikit/";
  internal.base = base;

  function readSession(key, fallback) {
    try {
      return JSON.parse(sessionStorage.getItem(key)) || fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeSession(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      internal.log.warn("Live preview: Spotify's session storage is full", e);
    }
  }

  var DEV_FILES = "spotikit:dev-files";
  var DEV_CONFIG = "spotikit:dev-config";
  var devFiles = readSession(DEV_FILES, {});
  var devConfig = readSession(DEV_CONFIG, { themes: [], apps: [], extensions: [], snippets: [] });
  devConfig.snippets = devConfig.snippets || [];

  var config = window.__spotikitConfig || {};
  config.themes = config.themes || [];
  config.apps = config.apps || [];
  config.snippets = config.snippets || [];
  config.extensions = (config.extensions || []).map(function (e) {
    return typeof e === "string" ? { id: e.split("/")[0].replace(/\.m?js$/, ""), name: e, path: e } : e;
  });
  ["themes", "apps", "extensions", "snippets"].forEach(function (list) {
    devConfig[list].forEach(function (entry) {
      if (
        !config[list].some(function (e) {
          return e.id === entry.id;
        })
      )
        config[list].push(entry);
    });
  });
  internal.config = config;
  SpotiKit.Config = Object.freeze({
    get extensions() {
      return config.extensions.map(function (e) {
        return Object.freeze({ id: e.id, name: e.name, path: e.path });
      });
    },
    get apps() {
      return config.apps.map(function (a) {
        return Object.freeze({ id: a.id, name: a.name });
      });
    },
    get themes() {
      return config.themes.map(function (t) {
        return Object.freeze({ id: t.id, name: t.name });
      });
    },
    get snippets() {
      return config.snippets.map(function (s) {
        return Object.freeze({ id: s.id, name: s.name });
      });
    },
  });

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function hasDevFile(path) {
    return Object.prototype.hasOwnProperty.call(devFiles, path);
  }

  internal.addonText = function (path) {
    if (hasDevFile(path)) return Promise.resolve(devFiles[path]);
    return fetch(base + encodePath(path)).then(function (r) {
      if (!r.ok) throw new Error(path + " is missing");
      return r.text();
    });
  };

  internal.addonUrl = function (path) {
    if (!hasDevFile(path)) return base + encodePath(path);
    var type = /\.css$/i.test(path) ? "text/css" : "text/javascript";
    var text = devFiles[path] + (type === "text/javascript" ? "\n//# sourceURL=spotikit-dev/" + path : "");
    return URL.createObjectURL(new Blob([text], { type: type }));
  };

  internal.addonCss = function (text, path) {
    var folder = base + encodePath(path.slice(0, path.lastIndexOf("/") + 1));
    var css = String(text).replace(/url\(\s*("|'|)([^"')]+)\1\s*\)/g, function (match, quote, url) {
      if (/^(https?:|data:|blob:|#|\/)/i.test(url)) return match;
      return "url(" + quote + new URL(url, location.origin + folder).pathname + quote + ")";
    });
    return css;
  };

  var localStore = SpotiKit.Storage.scope("local");
  function isLocalOn(key) {
    return localStore.get("off", []).indexOf(key) < 0;
  }
  function setLocalOn(key, on) {
    var off = localStore.get("off", []).filter(function (k) {
      return k !== key;
    });
    if (!on) off.push(key);
    localStore.set("off", off);
  }

  var started = {};
  var orphans = {};

  function finish(owner, run) {
    run.controller.abort();
    run.stops
      .splice(0)
      .reverse()
      .forEach(function (stop) {
        try {
          stop();
        } catch (e) {
          internal.log.error(owner + " failed to stop", e);
        }
      });
  }

  function forget(owner) {
    Object.keys(orphans).forEach(function (dependency) {
      delete orphans[dependency][owner];
    });
  }

  function stopAddon(owner) {
    forget(owner);
    var run = started[owner];
    if (!run) return false;
    Object.keys(started).forEach(function (other) {
      if (other !== owner && started[other].needs.indexOf(owner) >= 0) {
        var dependent = started[other];
        stopAddon(other);
        (orphans[owner] = orphans[owner] || {})[other] = dependent.restart;
      }
    });
    delete started[owner];
    finish(owner, run);
    internal.owners.dispose(owner);
    return true;
  }

  function startAddon(owner, module, options) {
    options = options || {};
    stopAddon(owner);
    var needs = options.dependencies || {};
    var run = {
      module: module,
      stops: [],
      controller: new AbortController(),
      done: false,
      needs: Object.keys(needs).map(function (ref) {
        return needs[ref];
      }),
      restart: function () {
        return startAddon(owner, module, options);
      },
    };
    started[owner] = run;
    var context = Object.assign({}, options.context, {
      id: owner,
      signal: run.controller.signal,
      onStop: function (stop) {
        if (typeof stop === "function") run.stops.push(stop);
      },
      style: function (css) {
        var style = document.createElement("style");
        style.setAttribute("data-addon", owner);
        style.textContent = css;
        (document.body || document.head).appendChild(style);
        run.stops.push(function () {
          style.remove();
        });
        return style;
      },
      use: function (ref) {
        var dependency = needs[ref] && started[needs[ref]];
        if (!dependency || !dependency.done) {
          throw new Error(ref + " isn't one of its dependencies, or isn't running.");
        }
        return dependency.module;
      },
    });
    run.ready = Promise.all(
      Object.keys(needs).map(function (ref) {
        return internal
          .waitFor(function () {
            return started[needs[ref]] && started[needs[ref]].done;
          }, 20000)
          .catch(function () {
            throw new Error("It needs " + ref + ", which isn't running.");
          });
      })
    )
      .then(function () {
        if (started[owner] !== run) return null;
        return module.default(context);
      })
      .then(function (stop) {
        if (typeof stop === "function") run.stops.push(stop);
        if (started[owner] !== run) {
          finish(owner, run);
          return module;
        }
        run.done = true;
        var waiting = orphans[owner] || {};
        delete orphans[owner];
        Object.keys(waiting).forEach(function (other) {
          waiting[other]().catch(function () {});
        });
        return module;
      });
    run.ready.catch(function () {
      if (started[owner] === run) stopAddon(owner);
    });
    return run.ready;
  }

  internal.addons = {
    start: startAddon,
    stop: stopAddon,
    isRunning: function (owner) {
      return !!started[owner];
    },
    dependents: function (owner) {
      return Object.keys(started).filter(function (other) {
        return started[other].needs.indexOf(owner) >= 0;
      });
    },
    register: function (url, owner) {
      internal.owners.add(new URL(url, location.href).href, owner);
    },
  };

  function readDependencies(value) {
    var out = {};
    if (Array.isArray(value)) {
      value.forEach(function (ref) {
        if (typeof ref === "string" && ref.trim()) out[ref.trim()] = "";
      });
    } else if (value && typeof value === "object") {
      Object.keys(value).forEach(function (ref) {
        if (ref.trim()) out[ref.trim()] = typeof value[ref] === "string" ? value[ref].trim() : "";
      });
    }
    return out;
  }
  internal.readDependencies = readDependencies;

  function localExtensionOwner(ref) {
    var entry = config.extensions.find(function (e) {
      return e.id.toLowerCase() === ref.toLowerCase();
    });
    return entry ? { owner: "extension:" + entry.path, version: null, local: true } : null;
  }

  function resolveDependencies(value) {
    var refs = readDependencies(value);
    var out = {};
    Object.keys(refs).forEach(function (ref) {
      var found =
        localExtensionOwner(ref) || (internal.marketplace && internal.marketplace.resolve(ref, refs[ref])) || null;
      if (!found) throw new Error("It needs " + ref + ", which isn't installed.");
      if (found.error) throw new Error(found.error);
      out[ref] = found.owner;
    });
    return out;
  }
  internal.resolveDependencies = resolveDependencies;

  var loadedExtensions = {};
  var lifecycle = {};
  var appStyles = {};
  var snippetStyles = {};

  function unloadSnippet(id) {
    (snippetStyles[id] || []).forEach(function (style) {
      style.remove();
    });
    delete snippetStyles[id];
  }

  function loadSnippet(entry) {
    var folder = "snippets/" + entry.id + "/";
    return internal
      .addonText(folder + "spotikit.json")
      .then(JSON.parse)
      .then(function (manifest) {
        return Promise.all(
          files(manifest.style).map(function (file) {
            return internal.addonText(folder + file).then(function (css) {
              return internal.addonCss(css, folder + file);
            });
          })
        );
      })
      .then(function (sheets) {
        unloadSnippet(entry.id);
        if (!isLocalOn("snippet:" + entry.id)) return;
        snippetStyles[entry.id] = sheets.map(function (css) {
          var style = document.createElement("style");
          style.className = "spotikit-snippet-style";
          style.setAttribute("data-snippet", entry.id);
          style.textContent = css;
          (document.body || document.head).appendChild(style);
          return style;
        });
      })
      .catch(function (e) {
        internal.log.error("The snippet " + (entry.name || entry.id) + " could not be loaded", e);
      });
  }

  internal.local = {
    isOn: isLocalOn,
    extensions: function () {
      return config.extensions.map(function (e) {
        return {
          id: e.id,
          name: e.name,
          path: e.path,
          on: isLocalOn("extension:" + e.path),
          loaded: !!loadedExtensions[e.path],
          live: !!lifecycle[e.path],
        };
      });
    },
    apps: function () {
      return config.apps.map(function (a) {
        return { id: a.id, name: a.name, on: isLocalOn("app:" + a.id) };
      });
    },
    snippets: function () {
      return config.snippets.map(function (s) {
        return { id: s.id, name: s.name, on: isLocalOn("snippet:" + s.id), loaded: !!snippetStyles[s.id] };
      });
    },
    setSnippet: function (id, on) {
      setLocalOn("snippet:" + id, on);
      var entry = config.snippets.find(function (s) {
        return s.id === id;
      });
      if (on && entry) return loadSnippet(entry);
      unloadSnippet(id);
      return Promise.resolve();
    },
    setExtension: function (path, on) {
      setLocalOn("extension:" + path, on);
      var entry = config.extensions.find(function (e) {
        return e.path === path;
      });
      if (on && entry && (!loadedExtensions[path] || lifecycle[path])) {
        loadExtension(entry);
        return false;
      }
      if (!on && lifecycle[path]) {
        stopAddon("extension:" + path);
        return false;
      }
      return !on && !!loadedExtensions[path];
    },
    setApp: function (id, on) {
      setLocalOn("app:" + id, on);
      var entry = config.apps.find(function (a) {
        return a.id === id;
      });
      if (on && entry) return loadApp(entry);
      remove(id);
      internal.owners.dispose("app:" + id);
      (appStyles[id] || []).forEach(function (style) {
        style.remove();
      });
      delete appStyles[id];
      return Promise.resolve();
    },
  };

  var DIRS = { theme: "themes", extension: "extensions", app: "apps", snippet: "snippets" };
  var reloadTimer = 0;
  internal.dev = {
    push: function (update) {
      var dir = DIRS[update.kind];
      var root = dir + "/" + (update.folder ? update.id + "/" : "");
      Object.keys(update.files || {}).forEach(function (rel) {
        devFiles[root + rel] = update.files[rel];
      });
      writeSession(DEV_FILES, devFiles);
      var list = config[dir];
      var entry = { id: update.id, name: update.name, path: update.path };
      if (
        !list.some(function (e) {
          return e.id === update.id;
        })
      ) {
        list.push(entry);
        devConfig[dir].push(entry);
        writeSession(DEV_CONFIG, devConfig);
      }
      if (update.kind === "theme" && internal.devTheme) return internal.devTheme(update.id, update.changed || []);
      if (update.kind === "snippet") {
        setLocalOn("snippet:" + update.id, true);
        var snippet = config.snippets.find(function (s) {
          return s.id === update.id;
        });
        return loadSnippet(snippet || entry).then(function () {
          return "css";
        });
      }
      if (update.kind === "extension" && lifecycle[update.path] && isLocalOn("extension:" + update.path)) {
        var current = config.extensions.find(function (e) {
          return e.path === update.path;
        });
        return loadExtension(current || entry).then(function () {
          return "restarted";
        });
      }
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () {
        location.reload();
      }, 150);
      return "reload";
    },
    clear: function () {
      sessionStorage.removeItem(DEV_FILES);
      sessionStorage.removeItem(DEV_CONFIG);
      location.reload();
    },
    get active() {
      return Object.keys(devFiles).length > 0;
    },
  };

  var apps = new Map();

  function appPath(id) {
    return "/" + id;
  }

  function isOpen(app) {
    var path = SpotiKit.Navigation.path;
    return path === appPath(app.id) || path.indexOf(appPath(app.id) + "/") === 0;
  }

  var Boundary = null;
  function boundary() {
    if (Boundary) {
      return Boundary;
    }
    var R = SpotiKit.React;
    Boundary = function SpotiKitAppBoundary(props) {
      R.Component.call(this, props);
      this.state = { error: null };
    };
    Boundary.prototype = Object.create(R.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.getDerivedStateFromError = function (error) {
      return { error: error };
    };
    Boundary.prototype.componentDidCatch = function (error) {
      internal.log.error("The app " + this.props.name + " crashed", error);
    };
    Boundary.prototype.render = function () {
      if (this.state.error) {
        var C = SpotiKit.Components;
        return R.createElement(
          "div",
          { style: { padding: 32 } },
          R.createElement(C.Text || "h1", { as: "h1", variant: "titleMedium" }, this.props.name + " stopped working"),
          R.createElement(
            "pre",
            { style: { marginTop: 16, whiteSpace: "pre-wrap", color: "var(--text-subdued)" } },
            String(this.state.error && (this.state.error.stack || this.state.error))
          )
        );
      }
      return this.props.children;
    };
    return Boundary;
  }

  function AppPage(props) {
    var R = SpotiKit.React;
    var app = props.app;
    return R.createElement(
      "div",
      { className: "spotikit-app", "data-spotikit-app": app.id, style: { minHeight: "100%" } },
      R.createElement(
        boundary(),
        { name: app.name },
        R.createElement(app.component, { app: { id: app.id, name: app.name, path: appPath(app.id) } })
      )
    );
  }

  internal.platformReady
    .then(function () {
      return internal.waitFor(function () {
        return SpotiKit.Components.Routes && SpotiKit.Components.Route;
      });
    })
    .then(function () {
      internal.onElement(SpotiKit.Components.Routes, function (props) {
        if (apps.size === 0) {
          return props;
        }
        var children = SpotiKit.React.Children.toArray(props.children);
        var isMainView =
          children.length > 20 &&
          children.some(function (child) {
            return (
              child &&
              child.props &&
              typeof child.props.path === "string" &&
              child.props.path.indexOf("/collection") === 0
            );
          });
        if (!isMainView) {
          return props;
        }
        var R = SpotiKit.React;
        var routes = [];
        apps.forEach(function (app) {
          routes.push(
            R.createElement(SpotiKit.Components.Route, {
              key: "spotikit-app-" + app.id,
              path: appPath(app.id) + "/*",
              element: R.createElement(AppPage, { app: app }),
            })
          );
        });
        return Object.assign({}, props, { children: routes.concat(children) });
      });
      routesHooked = true;
      showOpenApp();
      SpotiKit.Navigation.on("change", updateLinks);
    });

  var routesHooked = false;
  var rerender = 0;
  function showOpenApp() {
    if (!routesHooked || rerender) {
      return;
    }
    rerender = setTimeout(function () {
      rerender = 0;
      var open = Array.from(apps.values()).some(function (app) {
        return isOpen(app) && !document.querySelector('[data-spotikit-app="' + app.id + '"]');
      });
      if (open) {
        var history = SpotiKit.Platform.History;
        var at = history.location;
        history.replace({ pathname: at.pathname, search: at.search, hash: at.hash, state: at.state });
      }
    }, 50);
  }

  function updateLinks() {
    apps.forEach(function (app) {
      if (app.link) {
        var openNow = isOpen(app);
        app.link.active = openNow;
        app.link.icon = openNow && app.activeIcon ? app.activeIcon : app.icon;
      }
    });
  }

  function register(options) {
    if (!options || !options.id || typeof options.component !== "function") {
      throw new Error("Apps.register needs an id and a component.");
    }
    var id = String(options.id)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    if (apps.has(id)) {
      remove(id);
    }
    var app = {
      id: id,
      name: options.name || id,
      icon: options.icon || "apps",
      activeIcon: options.activeIcon || null,
      component: options.component,
      link: null,
    };
    apps.set(id, app);
    showOpenApp();
    internal.track(function () {
      if (apps.get(id) === app) remove(id);
    });
    internal.signals.platform.on(function () {
      if (!apps.has(id) || app.link || options.button === false) {
        return;
      }
      app.link = new internal.BarButton("topbarLeft", {
        label: app.name,
        icon: app.icon,
        onClick: function () {
          SpotiKit.Navigation.go(appPath(id));
        },
      }).show();
      app.link.element.setAttribute("data-mp-button", "");
      app.link.element.setAttribute("data-spotikit-app-button", id);
      updateLinks();
    });
    return {
      id: id,
      path: appPath(id),
      open: function () {
        SpotiKit.Navigation.go(appPath(id));
      },
      remove: function () {
        if (apps.get(id) === app) remove(id);
      },
    };
  }

  function remove(id) {
    var app = apps.get(id);
    if (!app) {
      return;
    }
    if (app.link) {
      app.link.remove();
    }
    apps.delete(id);
  }

  SpotiKit.Apps = {
    register: register,
    remove: remove,
    open: function (id) {
      SpotiKit.Navigation.go(appPath(id));
    },
    list: function () {
      return Array.from(apps.values()).map(function (app) {
        return { id: app.id, name: app.name, path: appPath(app.id) };
      });
    },
  };

  function localized(value) {
    if (value && typeof value === "object") {
      var language;
      try {
        language = SpotiKit.Locale.language;
      } catch (e) {
        language = "en";
      }
      return (
        value[language] ||
        value.en ||
        Object.keys(value).map(function (k) {
          return value[k];
        })[0]
      );
    }
    return value;
  }
  internal.localized = localized;

  function files(value) {
    return (Array.isArray(value) ? value : [value]).filter(function (f) {
      return typeof f === "string" && f.trim();
    });
  }
  internal.manifestFiles = files;

  function extensionManifest(entry) {
    var slash = entry.path.indexOf("/");
    if (slash < 0) return Promise.resolve({});
    return internal
      .addonText("extensions/" + entry.path.slice(0, slash) + "/spotikit.json")
      .then(JSON.parse)
      .catch(function () {
        return {};
      });
  }

  function loadExtension(entry) {
    var owner = "extension:" + entry.path;
    var path = "extensions/" + entry.path;
    var url = internal.addonUrl(path);
    internal.addons.register(url, owner);
    internal.owners.add("spotikit-dev/" + path, owner);
    loadedExtensions[entry.path] = true;
    return import(url)
      .then(function (module) {
        if (typeof module.default !== "function") {
          if (lifecycle[entry.path]) stopAddon(owner);
          delete lifecycle[entry.path];
          return;
        }
        lifecycle[entry.path] = true;
        return extensionManifest(entry).then(function (manifest) {
          var folder = base + encodePath(path.slice(0, path.lastIndexOf("/") + 1));
          return startAddon(owner, module, {
            dependencies: resolveDependencies(manifest.dependencies),
            context: {
              url: function (file) {
                return new URL(file, location.origin + folder).href;
              },
            },
          });
        });
      })
      .catch(function (e) {
        internal.log.error("The extension " + entry.name + " failed to start", e);
      });
  }

  function loadApp(entry) {
    var folder = "apps/" + entry.id + "/";
    return internal
      .addonText(folder + "spotikit.json")
      .then(JSON.parse)
      .catch(function () {
        return {};
      })
      .then(function (manifest) {
        appStyles[entry.id] = files(manifest.style).map(function (file) {
          var style = document.createElement("style");
          style.className = "spotikit-app-style";
          style.setAttribute("data-app", entry.id);
          (document.body || document.head).appendChild(style);
          internal.addonText(folder + file).then(function (css) {
            style.textContent = internal.addonCss(css, folder + file);
          });
          return style;
        });
        var main = folder + (manifest.main || "index.js");
        var url = internal.addonUrl(main);
        internal.addons.register(url, "app:" + entry.id);
        internal.owners.add("spotikit-dev/" + main, "app:" + entry.id);
        return import(url).then(function (module) {
          var component = module.default;
          if (typeof component !== "function") {
            throw new Error((manifest.main || "index.js") + " has no default export (the app's page component).");
          }
          register({
            id: entry.id,
            name: localized(manifest.name) || entry.name || entry.id,
            icon: manifest.icon,
            activeIcon: manifest.activeIcon,
            component: component,
          });
        });
      })
      .catch(function (e) {
        internal.log.error("The app " + entry.id + " could not be loaded", e);
      });
  }

  internal.platformReady
    .then(function () {
      return internal.waitFor(function () {
        return SpotiKit.React && SpotiKit.ReactDOM;
      });
    })
    .then(function () {
      var chain = Promise.resolve();
      if (internal.safeMode) return chain;
      config.snippets.forEach(function (entry) {
        if (isLocalOn("snippet:" + entry.id)) loadSnippet(entry);
      });
      config.extensions.forEach(function (entry) {
        if (!isLocalOn("extension:" + entry.path)) return;
        chain = chain.then(function () {
          return loadExtension(entry);
        });
      });
      return chain.then(function () {
        return Promise.all(
          config.apps
            .filter(function (a) {
              return isLocalOn("app:" + a.id);
            })
            .map(loadApp)
        );
      });
    })
    .then(function () {
      internal.signals.addons.fire();
    });

  var expected = {
    "": [
      "Player",
      "Navigation",
      "Queue",
      "Platform",
      "Http",
      "GraphQL",
      "URI",
      "React",
      "ReactDOM",
      "Components",
      "Hooks",
      "ContextMenu",
      "ProfileMenu",
      "Topbar",
      "Playbar",
      "Dialog",
      "Panels",
      "Apps",
      "Themes",
      "Keyboard",
      "Storage",
      "Locale",
      "Colors",
      "Icons",
      "Tooltip",
      "Title",
      "Typography",
      "Audio",
      "Libraries",
      "Config",
      "notify",
    ],
    Player: [
      "position",
      "play",
      "pause",
      "toggle",
      "next",
      "previous",
      "seek",
      "seekBy",
      "playUri",
      "setShuffle",
      "setRepeat",
      "setVolume",
      "setMuted",
      "setLiked",
      "on",
      "service",
    ],
    Components: [
      "Button",
      "ButtonSecondary",
      "ButtonTertiary",
      "Text",
      "Icon",
      "Tooltip",
      "Toggle",
      "Slider",
      "Chip",
      "Dropdown",
      "Card",
      "Cards",
      "ConfirmDialog",
      "ContextMenu",
      "RightClickMenu",
      "Menu",
      "MenuItem",
      "SubMenuItem",
      "TrackMenu",
      "AlbumMenu",
      "ArtistMenu",
      "PlaylistMenu",
      "ShowMenu",
      "EpisodeMenu",
      "Link",
      "ScrollRow",
      "PanelFrame",
      "PanelBody",
      "PanelHeader",
      "Router",
      "Routes",
      "Route",
    ],
    Hooks: ["usePlayer", "usePosition", "useQueue", "useNavigation", "useColors", "useDrag"],
    URI: [
      "parse",
      "parseStrict",
      "is",
      "type",
      "equals",
      "toUrl",
      "toPath",
      "create",
      "types",
      "track",
      "album",
      "toHex",
      "fromHex",
    ],
    Locale: ["language", "t", "formatNumber", "formatDate", "dictionary"],
    GraphQL: ["definitions", "query", "request"],
    Libraries: ["jsxRuntime", "ReactDOMServer", "ReactQuery", "classnames", "Mousetrap"],
    Colors: ["extract", "Color"],
  };

  SpotiKit.selfTest = function () {
    var report = {};
    var missing = [];
    Object.keys(expected).forEach(function (group) {
      var target = group ? SpotiKit[group] : SpotiKit;
      var ok = 0;
      expected[group].forEach(function (name) {
        var value;
        try {
          value = target && target[name];
        } catch (e) {
          value = undefined;
        }
        if (value === undefined || value === null) {
          missing.push((group ? group + "." : "") + name);
        } else {
          ok++;
        }
      });
      report[group || "SpotiKit"] = ok + "/" + expected[group].length;
    });
    console.table(report);
    if (missing.length) {
      internal.log.warn("Not available in this client: " + missing.join(", "));
    }
    return { report: report, missing: missing };
  };
})(window.SpotiKit);
