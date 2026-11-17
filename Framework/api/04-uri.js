/* SpotiKit URI */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  var SAMPLE_ID = "0VjIjW4GlUZAMYd2vXMi3b";
  var SAMPLE = "spotify:track:" + SAMPLE_ID;

  var native = {
    parse: null,
    parseStrict: null,
    Class: null,
    Type: null,
    functions: [],
    builders: {},
    checks: {},
    same: null,
  };
  var URI = {};
  SpotiKit.URI = URI;
  internal.uri = native;

  function camel(type, upperFirst) {
    return type
      .toLowerCase()
      .split("_")
      .map(function (word, i) {
        return i > 0 || upperFirst ? word.charAt(0).toUpperCase() + word.slice(1) : word;
      })
      .join("");
  }

  function parses(fn) {
    try {
      var uri = fn(SAMPLE);
      return !!(uri && uri.type === "track" && uri.id === SAMPLE_ID && typeof uri.toURI === "function");
    } catch (e) {
      return false;
    }
  }

  var ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  URI.toHex = function (id) {
    if (typeof id !== "string" || id.length !== 22) {
      throw new Error("URI.toHex needs a 22 character id.");
    }
    var n = BigInt(0);
    for (var i = 0; i < id.length; i++) {
      var digit = ALPHABET.indexOf(id.charAt(i));
      if (digit < 0) {
        throw new Error("URI.toHex: " + id + " is not a base62 id.");
      }
      n = n * BigInt(62) + BigInt(digit);
    }
    return n.toString(16).padStart(32, "0");
  };
  URI.fromHex = function (hex) {
    if (typeof hex !== "string" || !/^[0-9a-f]{32}$/i.test(hex)) {
      throw new Error("URI.fromHex needs a 32 character hex id.");
    }
    var n = BigInt("0x" + hex);
    var out = "";
    for (var i = 0; i < 22; i++) {
      out = ALPHABET.charAt(Number(n % BigInt(62))) + out;
      n = n / BigInt(62);
    }
    return out;
  };

  URI.parse = function (value) {
    if (!native.parse) {
      throw new Error("SpotiKit.URI isn't ready yet; await SpotiKit.ready first.");
    }
    try {
      return native.parse(value) || null;
    } catch (e) {
      return null;
    }
  };
  URI.parseStrict = function (text) {
    return native.parseStrict(text);
  };
  URI.isValid = function (value) {
    return URI.parse(value) !== null;
  };
  URI.type = function (value) {
    var parsed = URI.parse(value);
    return parsed ? parsed.type : null;
  };
  URI.is = function (value, types) {
    var t = URI.type(value);
    return t !== null && (Array.isArray(types) ? types.indexOf(t) >= 0 : t === types);
  };
  URI.isPlaylist = function (value) {
    return URI.is(value, ["playlist", "playlist-v2"]);
  };
  URI.equals = function (a, b) {
    if (native.same) {
      try {
        return native.same(a, b);
      } catch (e) {
        return false;
      }
    }
    var x = URI.parse(a);
    var y = URI.parse(b);
    return !!x && !!y && x.toURI() === y.toURI();
  };
  URI.toUrl = function (value) {
    var parsed = URI.parse(value);
    return parsed ? parsed.toURL() : null;
  };
  URI.toPath = function (value) {
    var parsed = URI.parse(value);
    return parsed ? parsed.toURLPath(true) : null;
  };
  URI.create = function (type, props) {
    var key = Object.keys(URI.types).find(function (k) {
      return URI.types[k] === type;
    });
    var builder = key && native.builders[key];
    if (builder && props && props.id && Object.keys(props).length === 1) {
      return builder(props.id);
    }
    return new native.Class(type, props || {});
  };

  internal.signals.modules.on(function () {
    var module = internal.findModule(function (m) {
      return (
        Object.keys(m).some(function (k) {
          return m[k] && m[k].COLLECTION_MISSING_ALBUM && m[k].CONTEXT_GROUP;
        }) &&
        Object.keys(m).some(function (k) {
          return typeof m[k] === "function";
        })
      );
    });
    if (!module) {
      internal.log.warn("Spotify's URI module was not found; only URI.toHex and URI.fromHex work.");
      return;
    }
    var functions = Object.keys(module)
      .map(function (k) {
        return module[k];
      })
      .filter(function (v) {
        return typeof v === "function";
      });
    var Type = Object.keys(module)
      .map(function (k) {
        return module[k];
      })
      .find(function (v) {
        return v && v.COLLECTION_MISSING_ALBUM && v.CONTEXT_GROUP;
      });
    URI.types = Object.freeze(Object.assign({}, Type));
    native.Type = Type;
    native.functions = functions;

    native.parseStrict = functions.find(function (fn) {
      return internal.source(fn).indexOf("must be a string") >= 0 && parses(fn);
    });
    native.parse =
      functions.find(function (fn) {
        if (!parses(fn)) {
          return false;
        }
        try {
          return fn(fn(SAMPLE)).id === SAMPLE_ID && fn({}) == null;
        } catch (e) {
          return false;
        }
      }) ||
      function (value) {
        return native.parseStrict(String(value));
      };
    native.Class = native.parse(SAMPLE).constructor;

    functions.forEach(function (fn) {
      var text = internal.source(fn);
      var build = /return [\w$]+\([\w$]+\.([A-Z][A-Z0-9_]*),\{/.exec(text);
      if (build && /^function/.test(text) && Type[build[1]]) {
        native.builders[build[1]] = fn;
        URI[camel(build[1])] = fn;
      }
    });

    native.same =
      functions.find(function (fn) {
        try {
          return (
            fn("spotify:user:someone:playlist:37i9dQZF1DXcBWIGoYBM5M", "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M") ===
              true && fn(SAMPLE, "spotify:album:" + SAMPLE_ID) === false
          );
        } catch (e) {
          return false;
        }
      }) || null;
  });
})(window.SpotiKit);
