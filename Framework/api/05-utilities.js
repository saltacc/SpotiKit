/* SpotiKit utilities */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }
  var Platform = SpotiKit.Platform;

  function store(prefix) {
    var key = function (name) {
      return prefix + name;
    };
    return {
      get: function (name, fallback) {
        var raw = localStorage.getItem(key(name));
        if (raw === null) {
          return fallback;
        }
        try {
          return JSON.parse(raw);
        } catch (e) {
          return raw;
        }
      },
      set: function (name, value) {
        localStorage.setItem(key(name), JSON.stringify(value));
      },
      remove: function (name) {
        localStorage.removeItem(key(name));
      },
      has: function (name) {
        return localStorage.getItem(key(name)) !== null;
      },
      keys: function () {
        var out = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k.indexOf(prefix) === 0) {
            out.push(k.slice(prefix.length));
          }
        }
        return out;
      },
      clear: function () {
        this.keys().forEach(function (name) {
          localStorage.removeItem(key(name));
        });
      },
      scope: function (name) {
        return store(prefix + name + ":");
      },
    };
  }
  SpotiKit.Storage = store("spotikit:");

  internal.lazy(SpotiKit.Libraries, "Mousetrap", function () {
    return (
      window.Mousetrap ||
      internal.findModule(function (m) {
        return typeof m.stopCallback === "function" && typeof m.handleKey === "function";
      })
    );
  });

  var shortcuts = new Map();
  SpotiKit.Keyboard = {
    add: function (combo, handler) {
      var trap = SpotiKit.Libraries.Mousetrap;
      if (!trap) {
        throw new Error("SpotiKit.Keyboard isn't ready: Spotify's Mousetrap was not found.");
      }
      if (typeof combo !== "string" || !combo.trim()) {
        throw new Error('Keyboard.add needs a key combination like "mod+shift+l".');
      }
      var list = shortcuts.get(combo) || [];
      list.push(handler);
      shortcuts.set(combo, list);
      trap.bind(combo, function (event, keys) {
        var current = shortcuts.get(combo) || [];
        for (var i = 0; i < current.length; i++) {
          if (current[i](event, keys) === false) {
            return false;
          }
        }
      });
      return internal.trackRemove({
        remove: function () {
          var now = (shortcuts.get(combo) || []).filter(function (h) {
            return h !== handler;
          });
          if (now.length) {
            shortcuts.set(combo, now);
          } else {
            shortcuts.delete(combo);
            trap.unbind(combo);
          }
        },
      });
    },
    list: function () {
      return Array.from(shortcuts.keys());
    },
  };

  function isDefinition(v) {
    return (
      v &&
      typeof v === "object" &&
      typeof v.sha256Hash === "string" &&
      typeof v.operation === "string" &&
      typeof v.name === "string"
    );
  }

  var definitions = null;
  var builtAt = 0;
  function allDefinitions() {
    var r = internal.require();
    var count = r ? Object.keys(r.m).length : 0;
    if (definitions && count === builtAt) {
      return definitions;
    }
    var result = {};
    var sample = internal.findExport(isDefinition);
    var Definition = sample && sample.constructor;
    var make = function (name, operation, hash) {
      return Definition && Definition !== Object
        ? new Definition(name, operation, hash, null)
        : { name: name, operation: operation, sha256Hash: hash, value: null };
    };
    internal.factories().forEach(function (entry) {
      var text = internal.source(entry.factory);
      ["query", "mutation", "subscription"].forEach(function (operation) {
        var marker = '","' + operation + '","';
        for (var at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) {
          var name = text.slice(text.lastIndexOf('"', at - 1) + 1, at);
          var hash = text.substr(at + marker.length, 64);
          if (!result[name] && /^\w+$/.test(name) && /^[0-9a-f]{64}$/.test(hash) && text.charAt(at + marker.length + 64) === '"') {
            result[name] = make(name, operation, hash);
          }
        }
      });
    });
    internal.findExports(isDefinition).forEach(function (d) {
      result[d.name] = d;
    });
    definitions = Object.freeze(result);
    builtAt = count;
    return definitions;
  }

  SpotiKit.GraphQL = {
    get definitions() {
      return allDefinitions();
    },
    get names() {
      return Object.keys(allDefinitions());
    },
    has: function (name) {
      return !!allDefinitions()[name];
    },
    query: function (nameOrDefinition, variables) {
      var definition = typeof nameOrDefinition === "string" ? allDefinitions()[nameOrDefinition] : nameOrDefinition;
      if (!definition) {
        return Promise.reject(new Error("This Spotify version has no GraphQL query named " + nameOrDefinition + "."));
      }
      return SpotiKit.GraphQL.request(definition, variables).then(function (response) {
        if (response && response.errors && response.errors.length && !response.data) {
          var error = new Error(response.errors[0].message || "GraphQL request failed");
          error.errors = response.errors;
          throw error;
        }
        return response && response.data;
      });
    },
    request: function (definition, variables) {
      return Platform.GraphQLLoader(definition, variables || {});
    },
  };

  var localeModule = null;
  function locale() {
    if (!localeModule) {
      localeModule = internal.findExport(function (v) {
        return (
          v &&
          typeof v === "object" &&
          typeof v.get === "function" &&
          typeof v.getPluralKey === "function" &&
          typeof v.getUntranslated === "function"
        );
      });
    }
    if (!localeModule) {
      throw new Error("Spotify's locale module was not found.");
    }
    return localeModule;
  }
  internal.locale = locale;

  function toDate(value) {
    return value instanceof Date ? value : new Date(value);
  }

  SpotiKit.Locale = {
    get language() {
      var l = locale();
      return String(l.getLocaleForTranslation ? l.getLocaleForTranslation() : l._localeForTranslation.baseName);
    },
    get languages() {
      return Object.keys(
        internal.findExport(function (v) {
          return v && typeof v === "object" && typeof v.ptBR === "string" && typeof v.zhTW === "string";
        }) || {}
      );
    },
    t: function () {
      var l = locale();
      return l.get.apply(l, arguments);
    },
    has: function (key) {
      return Object.prototype.hasOwnProperty.call(locale().getTranslations(), key);
    },
    dictionary: function () {
      return locale().getTranslations();
    },
    formatNumber: function (value, options) {
      return locale().formatNumber(value, options);
    },
    formatCompact: function (value) {
      return locale().formatNumberCompact(value);
    },
    formatDate: function (date, options) {
      return locale().formatDate(toDate(date), options);
    },
    formatRelative: function (date, options) {
      return locale().formatRelativeDate(toDate(date), options);
    },
    list: function (items) {
      return items.join(locale().getSeparator());
    },
    lower: function (text) {
      return locale().toLocaleLowerCase(text);
    },
    upper: function (text) {
      return locale().toLocaleUpperCase(text);
    },
  };

  internal.lazy(SpotiKit.Libraries, "classnames", function () {
    var r = internal.require();
    var id =
      r &&
      Object.keys(r.m).find(function (key) {
        var text = internal.source(r.m[key]);
        return text.length < 2000 && text.indexOf("window.classNames=") >= 0;
      });
    var m = id && r(id);
    return typeof m === "function" ? m : m && typeof m.default === "function" ? m.default : undefined;
  });

  internal.signals.modules.on(function () {
    var React = SpotiKit.React;
    var providerModule = internal.findModule(function (m) {
      return Object.keys(m).some(function (k) {
        var text = typeof m[k] === "function" ? internal.source(m[k]) : "";
        return /client:[\w$]+,children/.test(text) && /\.mount\(\)/.test(text);
      });
    });
    var QueryClientProvider, useQueryClient;
    if (providerModule) {
      Object.keys(providerModule).forEach(function (k) {
        var v = providerModule[k];
        var text = typeof v === "function" ? internal.source(v) : "";
        if (/\.mount\(\)/.test(text)) {
          QueryClientProvider = v;
        } else if (typeof v === "function" && /useContext/.test(text)) {
          useQueryClient = v;
        }
      });
    }
    var QueryObserver = internal.findExport(function (v) {
      return (
        typeof v === "function" &&
        v.prototype &&
        Object.prototype.hasOwnProperty.call(v.prototype, "trackProp") &&
        Object.prototype.hasOwnProperty.call(v.prototype, "shouldFetchOnWindowFocus")
      );
    });
    function useQuery(options) {
      var client = useQueryClient();
      var defaulted = client.defaultQueryOptions(options);
      var observer = React.useState(function () {
        return new QueryObserver(client, defaulted);
      })[0];
      var result = observer.getOptimisticResult(defaulted);
      React.useSyncExternalStore(
        React.useCallback(
          function (onChange) {
            return observer.subscribe(onChange);
          },
          [observer]
        ),
        function () {
          return observer.getCurrentResult();
        },
        function () {
          return observer.getCurrentResult();
        }
      );
      React.useEffect(
        function () {
          observer.setOptions(defaulted);
        },
        [defaulted, observer]
      );
      return defaulted.notifyOnChangeProps ? result : observer.trackResult(result);
    }
    SpotiKit.Libraries.ReactQuery = {
      QueryClientProvider: QueryClientProvider,
      useQueryClient: useQueryClient,
      QueryObserver: QueryObserver,
      useQuery: QueryObserver && useQueryClient ? useQuery : undefined,
    };
  });

  var Colors = {};
  SpotiKit.Colors = Colors;

  internal.lazy(Colors, "Color", function () {
    var Color = internal.findExport(function (v) {
      return (
        typeof v === "function" &&
        v.prototype &&
        typeof v.prototype.contrastAdjust === "function" &&
        typeof v.prototype.toRGBA255 === "function"
      );
    });
    if (Color && !Color.CSSFormat) {
      Color.CSSFormat = internal.findExport(function (v) {
        return v && typeof v === "object" && typeof v.HEXA === "number" && typeof v.HSLA === "number";
      });
    }
    return Color;
  });

  function hex(color) {
    return color && (color.hex || (typeof color === "string" ? color : null));
  }

  function imageOf(value) {
    if (/^https?:|^spotify:image:/.test(value)) {
      return Promise.resolve(value);
    }
    var type = SpotiKit.URI.type(value);
    var plans = {
      track: [
        "getTrack",
        function (d) {
          return d.trackUnion && d.trackUnion.albumOfTrack && d.trackUnion.albumOfTrack.coverArt;
        },
      ],
      album: [
        "getAlbum",
        function (d) {
          return d.albumUnion && d.albumUnion.coverArt;
        },
      ],
      artist: [
        "queryArtistOverview",
        function (d) {
          return d.artistUnion && d.artistUnion.visuals && d.artistUnion.visuals.avatarImage;
        },
      ],
      "playlist-v2": [
        "fetchPlaylistMetadata",
        function (d) {
          return d.playlistV2 && d.playlistV2.images && d.playlistV2.images.items && d.playlistV2.images.items[0];
        },
      ],
    };
    var plan = plans[type];
    if (!plan || !SpotiKit.GraphQL.has(plan[0])) {
      return Promise.reject(new Error("Colors.extract can't find an image for " + value + "."));
    }
    return SpotiKit.GraphQL.query(plan[0], {
      uri: value,
      locale: "",
      offset: 0,
      limit: 1,
      includePrerelease: false,
      enableWatchFeedEntrypoint: false,
    }).then(function (data) {
      var art = plan[1](data || {});
      var source = art && art.sources ? art.sources[0] : art;
      if (!source || !source.url) {
        throw new Error("Colors.extract can't find an image for " + value + ".");
      }
      return source.url;
    });
  }

  Colors.extract = function (value) {
    return imageOf(value)
      .then(function (image) {
        return SpotiKit.GraphQL.query("fetchExtractedColors", { imageUris: [image], uris: [image] });
      })
      .then(function (data) {
        var entry = data && data.extractedColors && data.extractedColors[0];
        if (!entry) {
          throw new Error("Spotify returned no colors for " + value + ".");
        }
        return {
          raw: hex(entry.colorRaw),
          light: hex(entry.colorLight),
          dark: hex(entry.colorDark),
          isFallback: !!(entry.colorRaw && entry.colorRaw.isFallback),
        };
      });
  };

  var snackbar = null;
  function findSnackbar() {
    if (!snackbar) {
      snackbar = internal.findContextValue(function (v) {
        return typeof v.enqueueSnackbar === "function" && typeof v.closeSnackbar === "function";
      });
    }
    return snackbar;
  }
  internal.findSnackbar = findSnackbar;

  SpotiKit.notify = function (message, options) {
    options = options || {};
    var bar = findSnackbar();
    if (!bar) {
      internal.log.warn("Notification not shown, the snackbar isn't mounted yet:", message);
      return { close: function () {} };
    }
    var key = bar.enqueueSnackbar(message, {
      variant: options.type === "error" ? "error" : "default",
      autoHideDuration: options.duration,
      persist: options.duration === Infinity,
    });
    return {
      close: function () {
        bar.closeSnackbar(key);
      },
    };
  };

  function productState() {
    var service = Platform.ProductStateAPI;
    return service && service.productStateApi;
  }
  var titleWatch = null;
  SpotiKit.Title = {
    get: function () {
      return Promise.resolve(productState().getValues()).then(function (values) {
        return values.pairs.name;
      });
    },
    set: function (title) {
      var state = productState();
      if (titleWatch) {
        titleWatch.cancel();
      }
      return Promise.resolve(state.putOverridesValues({ pairs: { name: title } })).then(function () {
        titleWatch = state.subValues({ keys: ["name"] }, function (values) {
          if (values.pairs.name !== title) {
            state.putOverridesValues({ pairs: { name: title } });
          }
        });
      });
    },
    reset: function () {
      if (titleWatch) {
        titleWatch.cancel();
        titleWatch = null;
      }
      return Promise.resolve(productState().delOverridesValues({ keys: ["name"] }));
    },
    on: function (type, listener) {
      var sub = productState().subValues({ keys: ["name"] }, function (values) {
        listener(values.pairs.name);
      });
      return internal.track(function () {
        sub.cancel();
      });
    },
  };

  var tooltipCount = 0;

  function place(tip) {
    var rect = tip.element.getBoundingClientRect();
    var box = tip.popper.getBoundingClientRect();
    var gap = 8;
    var placement = (tip.options.placement || "top").split("-")[0];
    if (placement === "top" && rect.top - box.height - gap < 4) {
      placement = "bottom";
    }
    var x, y;
    if (placement === "left" || placement === "right") {
      x = placement === "left" ? rect.left - box.width - gap : rect.right + gap;
      y = rect.top + rect.height / 2 - box.height / 2;
    } else {
      x = rect.left + rect.width / 2 - box.width / 2;
      y = placement === "top" ? rect.top - box.height - gap : rect.bottom + gap;
    }
    x = Math.max(4, Math.min(x, window.innerWidth - box.width - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - box.height - 4));
    tip.popper.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
    tip.frame.setAttribute("data-placement", placement);
  }

  SpotiKit.Tooltip = {
    attach: function (element, options) {
      if (typeof options === "string") {
        options = { content: options };
      }
      options = Object.assign({ placement: "top", delay: 200 }, options);
      var popper = document.createElement("div");
      popper.id = "spotikit-tooltip-" + ++tooltipCount;
      popper.style.cssText = "pointer-events:none;z-index:9999;position:fixed;left:0;top:0;margin:0";
      var frame = document.createElement("div");
      frame.id = "context-menu";
      var box = document.createElement("div");
      box.className = "tooltip";
      var label = document.createElement("span");
      label.setAttribute("role", "tooltip");
      label.textContent = options.content;
      box.appendChild(label);
      frame.appendChild(box);
      popper.appendChild(frame);
      var tip = { element: element, popper: popper, frame: frame, options: options };
      var timer = null;
      var shown = false;
      var api = {
        setContent: function (content) {
          options.content = content;
          label.textContent = content;
          if (shown) {
            place(tip);
          }
        },
        show: function () {
          if (!options.content) {
            return;
          }
          document.body.appendChild(popper);
          shown = true;
          place(tip);
        },
        hide: function () {
          clearTimeout(timer);
          popper.remove();
          shown = false;
        },
        remove: function () {
          api.hide();
          listeners.forEach(function (pair) {
            element.removeEventListener(pair[0], pair[1]);
          });
        },
      };
      var enter = function () {
        clearTimeout(timer);
        timer = setTimeout(api.show, options.delay);
      };
      var listeners = [
        ["mouseenter", enter],
        ["focus", enter],
        ["mouseleave", api.hide],
        ["blur", api.hide],
        ["mousedown", api.hide],
      ];
      listeners.forEach(function (pair) {
        element.addEventListener(pair[0], pair[1]);
      });
      return api;
    },
  };

  var textStyles = [
    "headline-large",
    "headline-medium",
    "title-large",
    "title-medium",
    "title-small",
    "body-medium",
    "body-medium-bold",
    "body-small",
    "body-small-bold",
    "marginal",
    "marginal-bold",
  ];
  SpotiKit.Typography = {
    styles: textStyles,
    className: function (style) {
      if (textStyles.indexOf(style) < 0) {
        throw new Error("Typography.className: unknown style " + style + ". Use one of " + textStyles.join(", ") + ".");
      }
      return "e-text encore-text-" + style;
    },
  };

  SpotiKit.Audio = {
    analysis: function (uri) {
      var target = uri || (SpotiKit.Player.track && SpotiKit.Player.track.uri);
      if (!target || SpotiKit.URI.type(target) !== "track") {
        return Promise.reject(new Error("Audio.analysis needs a track URI."));
      }
      return SpotiKit.Http.get(
        "https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/" +
          SpotiKit.URI.parse(target).id +
          "?format=json"
      );
    },
  };
})(window.SpotiKit);
