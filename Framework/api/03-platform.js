/* SpotiKit core */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  function Emitter(name) {
    this._name = name;
    this._listeners = {};
  }
  Emitter.prototype.on = function (type, listener) {
    var list = this._listeners[type] || (this._listeners[type] = []);
    list.push(listener);
    var self = this;
    return internal.track(function off() {
      self.off(type, listener);
    });
  };
  Emitter.prototype.off = function (type, listener) {
    var list = this._listeners[type];
    var at = list ? list.indexOf(listener) : -1;
    if (at >= 0) {
      list.splice(at, 1);
    }
  };
  Emitter.prototype.count = function (type) {
    return (this._listeners[type] || []).length;
  };
  Emitter.prototype.emit = function (type, value) {
    var list = (this._listeners[type] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](value);
      } catch (e) {
        internal.log.error("A " + this._name + " '" + type + "' listener threw", e);
      }
    }
  };
  internal.Emitter = Emitter;

  SpotiKit.Libraries = {};

  internal.signals.modules.on(function () {
    SpotiKit.React = internal.findModule(function (m) {
      return typeof m.useMemo === "function" && typeof m.createElement === "function";
    });
    SpotiKit.Libraries.jsxRuntime = internal.findModule(function (m) {
      return typeof m.jsx === "function" && typeof m.jsxs === "function";
    });
    SpotiKit.Libraries.ReactDOMServer = internal.findModule(function (m) {
      return typeof m.renderToString === "function";
    });

    var nativeDOM = internal.findModule(function (m) {
      return typeof m.createPortal === "function" && typeof m.createRoot === "function";
    });
    internal.nativeReactDOM = nativeDOM;
    if (nativeDOM) {
      var bridged = function (element) {
        return internal.withSpotifyContexts(
          document.querySelector(".main-view-container, #main [data-testid=root]"),
          element
        );
      };
      var dom = Object.create(nativeDOM);
      dom.createRoot = function (container, options) {
        var root = nativeDOM.createRoot(container, options);
        var render = root.render.bind(root);
        root.render = function (element) {
          return render(bridged(element));
        };
        return root;
      };
      SpotiKit.ReactDOM = dom;
    }
  });

  var Platform = {};
  SpotiKit.Platform = Platform;

  // Adapted from how Spicetify fills Spicetify.Platform (spicetify/cli, LGPL-2.1). See THIRD-PARTY-NOTICES.md.
  function fillPlatform(platform) {
    Object.keys(platform).forEach(function (key) {
      try {
        if (key.indexOf("get") === 0 && typeof platform[key] === "function" && key.length > 3) {
          Platform[key.slice(3)] = platform[key]();
        } else {
          Platform[key] = platform[key];
        }
      } catch (e) {
        internal.log.warn("Platform." + key + " could not be read", e);
      }
    });
    var registry = Platform.Registry;
    if (registry && registry._map) {
      registry._map.forEach(function (_, symbol) {
        var name = typeof symbol === "symbol" ? symbol.description : String(symbol);
        if (!name || Object.prototype.hasOwnProperty.call(Platform, name)) {
          return;
        }
        if (
          !/API$/.test(name) &&
          ["Cosmos", "History", "RequestBuilder", "GraphQLLoader", "Transport", "EventSender", "DataPool"].indexOf(
            name
          ) < 0
        ) {
          return;
        }
        try {
          Platform[name] = registry.resolve(symbol);
        } catch (e) {}
      });
    }
  }

  Object.defineProperty(Platform, "get", {
    value: function (name) {
      if (Object.prototype.hasOwnProperty.call(Platform, name)) {
        return Platform[name];
      }
      var registry = Platform.Registry;
      var result;
      if (registry && registry._map) {
        registry._map.forEach(function (_, symbol) {
          if (result === undefined && typeof symbol === "symbol" && symbol.description === name) {
            try {
              result = registry.resolve(symbol);
            } catch (e) {
              result = null;
            }
          }
        });
      }
      return result || undefined;
    },
  });

  internal.platformReady = internal.waitFor(internal.findPlatform).then(function (platform) {
    fillPlatform(platform);
    internal.signals.platform.fire();
    return Platform;
  });

  function api() {
    return Platform.PlayerAPI;
  }

  function state() {
    var p = api();
    return (p && (p._state || (p.getState && p.getState()))) || null;
  }

  var repeatModes = ["off", "context", "track"];
  var playerEvents = new Emitter("Player");
  var lastVolume = 0.5;

  function libraryHas(uri) {
    var library = Platform.LibraryAPI;
    if (library && typeof library.containsSync === "function") {
      try {
        var known = library.containsSync(uri);
        if (typeof known === "boolean") {
          return known;
        }
      } catch (e) {}
    }
    return undefined;
  }

  function muteHelper() {
    var playback = Platform.PlaybackAPI;
    return playback && playback.getMuteHelper ? playback.getMuteHelper() : null;
  }

  var Player = {
    get state() {
      var s = state();
      return s && s.item ? s : null;
    },
    get track() {
      var s = state();
      return (s && s.item) || null;
    },
    get isPlaying() {
      var s = state();
      return !!s && s.isPaused === false;
    },
    get position() {
      var s = state();
      if (!s || !s.item) {
        return 0;
      }
      var at = (s.isPaused ? 0 : (Date.now() - s.timestamp) * (s.speed || 1)) + s.positionAsOfTimestamp;
      return Math.max(0, Math.min(at, s.duration || at));
    },
    get duration() {
      var s = state();
      return (s && s.duration) || 0;
    },
    get progress() {
      var d = Player.duration;
      return d ? Player.position / d : 0;
    },
    get shuffle() {
      var s = state();
      return !!(s && s.shuffle);
    },
    get repeat() {
      var s = state();
      return repeatModes[(s && s.repeat) || 0];
    },
    get volume() {
      var playback = Platform.PlaybackAPI;
      return playback ? (typeof playback._volume === "number" ? playback._volume : playback.__volume || 0) : 0;
    },
    get muted() {
      var helper = muteHelper();
      return helper && typeof helper.isMuted === "function" ? !!helper.isMuted() : Player.volume === 0;
    },
    get liked() {
      var item = Player.track;
      if (!item) {
        return false;
      }
      var known = libraryHas(item.uri);
      return known !== undefined ? known : !!item.metadata && item.metadata["collection.in_collection"] === "true";
    },
    get service() {
      return api();
    },

    play: function () {
      return api().resume();
    },
    pause: function () {
      return api().pause();
    },
    toggle: function () {
      return Player.isPlaying ? Player.pause() : Player.play();
    },
    next: function () {
      return api().skipToNext();
    },
    previous: function () {
      return api().skipToPrevious();
    },
    playUri: function (uri, options) {
      options = options || {};
      var context = options.context
        ? typeof options.context === "string"
          ? { uri: options.context }
          : options.context
        : {};
      return api().play({ uri: uri }, context, options.options || {});
    },
    seek: function (ms) {
      return api().seekTo(Math.max(0, Math.round(ms)));
    },
    seekBy: function (ms) {
      return ms >= 0 ? api().seekForward(ms) : api().seekBackward(-ms);
    },
    setShuffle: function (on) {
      return api().setShuffle(!!on);
    },
    setRepeat: function (mode) {
      var index = typeof mode === "number" ? mode : repeatModes.indexOf(mode);
      if (index < 0) {
        throw new Error('Player.setRepeat: use "off", "context" or "track".');
      }
      return api().setRepeat(index);
    },
    setVolume: function (level) {
      return Platform.PlaybackAPI.setVolume(Math.max(0, Math.min(1, level)));
    },
    volumeUp: function () {
      return Platform.PlaybackAPI.raiseVolume();
    },
    volumeDown: function () {
      return Platform.PlaybackAPI.lowerVolume();
    },
    setMuted: function (muted) {
      var helper = muteHelper();
      if (helper && typeof helper.mute === "function" && typeof helper.unmute === "function") {
        return muted ? helper.mute() : helper.unmute();
      }
      if (muted) {
        lastVolume = Player.volume || lastVolume;
        return Player.setVolume(0);
      }
      return Player.setVolume(lastVolume);
    },
    setLiked: function (liked) {
      var item = Player.track;
      if (!item) {
        return Promise.resolve();
      }
      var uris = [item.uri];
      return liked ? Platform.LibraryAPI.add({ uris: uris }) : Platform.LibraryAPI.remove({ uris: uris });
    },

    on: function (type, listener) {
      return playerEvents.on(type, listener);
    },
    off: function (type, listener) {
      playerEvents.off(type, listener);
    },
  };
  SpotiKit.Player = Player;

  internal.platformReady
    .then(function () {
      return internal.waitFor(function () {
        return api() && api()._events;
      });
    })
    .then(function () {
      var last = Player.state;
      api()._events.addListener("update", function () {
        var current = Player.state;
        playerEvents.emit("state", current);
        if ((last && last.item.uri) !== (current && current.item.uri)) {
          playerEvents.emit("track", current);
        }
        if ((last && last.isPaused) !== (current && current.isPaused)) {
          playerEvents.emit("playpause", current);
        }
        last = current;
      });
      setInterval(function () {
        if (playerEvents.count("progress") > 0 && Player.isPlaying) {
          playerEvents.emit("progress", Player.position);
        }
      }, 100);
    });

  var navigationEvents = new Emitter("Navigation");
  SpotiKit.Navigation = {
    get path() {
      var history = Platform.History;
      return (history && history.location && history.location.pathname) || "/";
    },
    go: function (path) {
      Platform.History.push(path);
    },
    replace: function (path) {
      Platform.History.replace(path);
    },
    back: function () {
      Platform.History.goBack();
    },
    forward: function () {
      Platform.History.goForward();
    },
    on: function (type, listener) {
      return navigationEvents.on(type, listener);
    },
  };
  internal.platformReady.then(function () {
    if (Platform.History && Platform.History.listen) {
      Platform.History.listen(function (location) {
        navigationEvents.emit("change", (location && location.pathname) || SpotiKit.Navigation.path);
      });
    }
  });

  function queueState() {
    var queue = api() && api()._queue;
    return (queue && (queue._queue || queue._state)) || { nextTracks: [], prevTracks: [] };
  }

  function entry(raw) {
    var track = raw && raw.contextTrack ? raw.contextTrack : raw || {};
    var meta = track.metadata || {};
    return {
      uri: track.uri,
      uid: track.uid,
      title: meta.title,
      artist: meta.artist_name,
      album: meta.album_title,
      image: meta.image_url,
      provider: raw && raw.provider,
    };
  }

  function contextTracks(items) {
    return (Array.isArray(items) ? items : [items]).map(function (item) {
      return typeof item === "string" ? { uri: item } : item;
    });
  }

  var queueEvents = new Emitter("Queue");
  SpotiKit.Queue = {
    get next() {
      return (queueState().nextTracks || []).map(entry);
    },
    get previous() {
      return (queueState().prevTracks || []).map(entry);
    },
    get current() {
      return queueState().track ? entry(queueState().track) : null;
    },
    add: function (items) {
      return api().addToQueue(contextTracks(items));
    },
    remove: function (items) {
      return api().removeFromQueue(contextTracks(items));
    },
    playNext: function (items) {
      return api().playAsNextInQueue(contextTracks(items));
    },
    clear: function () {
      return api().clearQueue();
    },
    on: function (type, listener) {
      return queueEvents.on(type, listener);
    },
  };
  internal.platformReady
    .then(function () {
      return internal.waitFor(function () {
        return api() && api()._events;
      });
    })
    .then(function () {
      api()._events.addListener("queue_update", function () {
        queueEvents.emit("change", SpotiKit.Queue.next);
      });
    });

  function token() {
    var auth = Platform.AuthorizationAPI;
    var s = auth && auth.getState && auth.getState();
    return s && s.token && s.token.accessToken;
  }

  function isInternal(url) {
    return /^(sp|wg|hm):\/\//.test(url);
  }

  function HttpError(response) {
    var message =
      (response.body && response.body.error && (response.body.error.message || response.body.error)) ||
      "Request failed with status " + response.status;
    var error = new Error(String(message));
    error.status = response.status;
    error.body = response.body;
    error.headers = response.headers;
    return error;
  }

  function request(method, url, options) {
    method = String(method || "GET").toUpperCase();
    options = options || {};
    if (isInternal(url)) {
      var cosmos = Platform.Cosmos || Platform.get("Cosmos");
      return Promise.resolve(cosmos.resolve(method, url, options.body, options.headers)).then(function (response) {
        return response && typeof response === "object" && "body" in response
          ? response
          : { status: 200, headers: {}, body: response };
      });
    }
    var target = new URL(url);
    var init = { method: method, headers: Object.assign({}, options.headers) };
    var isWebApi = target.hostname === "api.spotify.com";
    var isSpClient = /spclient/.test(target.hostname) && /spotify\.com$/.test(target.hostname);
    if (isWebApi || isSpClient) {
      init.headers.Authorization = "Bearer " + token();
    }
    if (isSpClient) {
      init.headers["Spotify-App-Version"] = Platform.version;
      if (Platform.PlatformData && Platform.PlatformData.app_platform) {
        init.headers["App-Platform"] = Platform.PlatformData.app_platform;
      }
    }
    Object.keys(options.query || {}).forEach(function (key) {
      target.searchParams.append(key, options.query[key]);
    });
    var body = options.body;
    if (body !== undefined && body !== null) {
      if (typeof body === "string" || body instanceof Blob || body instanceof FormData || body instanceof ArrayBuffer) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
      }
    }
    return fetch(target.toString(), init).then(function (response) {
      var headers = {};
      response.headers.forEach(function (value, key) {
        headers[key] = value;
      });
      return response.text().then(function (text) {
        var parsed = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch (e) {}
        return { status: response.status, headers: headers, body: parsed };
      });
    });
  }

  function bodyOf(method) {
    return function (url, options) {
      return request(method, url, options).then(function (response) {
        if (response.status >= 400) {
          throw HttpError(response);
        }
        return response.body;
      });
    };
  }

  SpotiKit.Http = {
    get: bodyOf("GET"),
    post: bodyOf("POST"),
    put: bodyOf("PUT"),
    patch: bodyOf("PATCH"),
    delete: bodyOf("DELETE"),
    request: request,
    subscribe: function (url, onMessage, onError) {
      if (!isInternal(url)) {
        throw new Error("Http.subscribe works with internal addresses (sp://, wg://, hm://).");
      }
      var subscription = (Platform.Cosmos || Platform.get("Cosmos")).sub(url, onMessage, onError);
      if (subscription && typeof subscription.cancel === "function") internal.trackRemove(subscription, "cancel");
      return subscription;
    },
  };
})(window.SpotiKit);
