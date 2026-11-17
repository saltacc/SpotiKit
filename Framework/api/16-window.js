/* SpotiKit window */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  var NAMES = { 1: "normal", 2: "maximized", 3: "minimized", 4: "hidden" };
  var CODES = { normal: 1, maximized: 2, minimized: 3 };
  var isWindows = /Windows/.test(navigator.userAgent);
  var events = new internal.Emitter("Window");
  var state = "normal";
  var owners = {};
  var custom = false;
  var spotifyShows = true;
  var element = null;
  var nativeApi = null;
  var nativeSet = null;
  var uiClient = null;
  var nativeTitlebar = null;
  var titlebarHeight = 64;

  var CSS = `
    .spotikit-window-controls {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 2147483000;
      display: flex;
      height: 64px;
      color: var(--text-base, #fff);
      -webkit-app-region: no-drag;
    }
    .spotikit-window-controls[hidden] {
      display: none;
    }
    .spotikit-window-button {
      width: 46px;
      height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      display: grid;
      place-items: center;
      color: inherit;
      background: transparent;
      outline: none;
      transition: background-color 0.15s;
    }
    .spotikit-window-button:hover {
      background: color-mix(in srgb, currentColor 12%, transparent);
    }
    .spotikit-window-button:active {
      background: color-mix(in srgb, currentColor 20%, transparent);
    }
    .spotikit-window-button--close:hover {
      color: #fff;
      background: #c42b1c;
    }
    .spotikit-window-button--close:active {
      color: #fff;
      background: color-mix(in srgb, #c42b1c 80%, transparent);
    }
    .spotikit-window-button svg {
      width: 10px;
      height: 10px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1;
    }
    .global-nav-bar-window-controls-spacer:has(> .spotikit-window-menu) {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .spotikit-window-menu[hidden] {
      display: none;
    }
    .spotikit-window-menu-button {
      flex: none;
      width: 32px;
      height: 32px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--text-subdued, #b3b3b3);
      background: transparent;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .spotikit-window-menu-button:hover {
      color: var(--text-base, #fff);
    }
    .spotikit-window-menu-button svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
  `;

  var CONTROL = "sp://messages/v1/container/control";
  var controlSubs = new Map();

  function trackSends(send) {
    if (typeof send !== "function" || send._spotikitControl) {
      return send;
    }
    var wrapped = function (args) {
      var id = send.apply(this, arguments);
      try {
        var request = args && args.persistent && JSON.parse(args.request);
        if (request && request.uri === CONTROL) {
          var body = request.body ? JSON.parse(request.body) : {};
          controlSubs.set(id, { type: body && body.type, onSuccess: args.onSuccess });
        }
      } catch (e) {}
      return id;
    };
    wrapped._spotikitControl = true;
    return wrapped;
  }

  function trackCancels(cancel) {
    if (typeof cancel !== "function" || cancel._spotikitControl) {
      return cancel;
    }
    var wrapped = function (id) {
      controlSubs.delete(id);
      return cancel.apply(this, arguments);
    };
    wrapped._spotikitControl = true;
    return wrapped;
  }

  try {
    window.sendCosmosRequest = trackSends(window.sendCosmosRequest);
    window.cancelCosmosRequest = trackCancels(window.cancelCosmosRequest);
  } catch (e) {}

  function sendControl(type) {
    var response = JSON.stringify({ status: 200, headers: {}, body: JSON.stringify({ type: type }) });
    var reached = 0;
    controlSubs.forEach(function (sub) {
      if (sub.type && sub.type !== type) {
        return;
      }
      reached++;
      try {
        sub.onSuccess(response);
      } catch (e) {
        internal.log.error("Window: the handler for " + type + " threw", e);
      }
    });
    return reached;
  }
  internal.sendControl = sendControl;

  var GLYPHS = {
    minimize: "M0,5 L10,5",
    maximize: "M0.5,0.5 L9.5,0.5 L9.5,9.5 L0.5,9.5 Z",
    restore: "M0.5,2.5 L7.5,2.5 L7.5,9.5 L0.5,9.5 Z M2.5,2.5 L2.5,0.5 L9.5,0.5 L9.5,7.5 L7.5,7.5",
    close: "M0,0 L10,10 M10,0 L0,10",
  };

  function client() {
    var focus = SpotiKit.Platform && SpotiKit.Platform.FocusMainWindowAPI;
    return focus && focus._windowStateClient;
  }

  function setState(code) {
    var c = client();
    if (!c) {
      return Promise.reject(new Error("Window: this Spotify version doesn't offer window controls."));
    }
    return c.setWindowState({ state: code });
  }

  function button(kind, label, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "spotikit-window-button spotikit-window-button--" + kind;
    b.setAttribute("aria-label", label);
    b.tabIndex = -1;
    b.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="' + GLYPHS[kind] + '"/></svg>';
    b.addEventListener("click", onClick);
    return b;
  }

  function render() {
    if (!element) {
      var style = document.createElement("style");
      style.id = "spotikit-window-controls-style";
      style.textContent = CSS;
      document.head.insertBefore(style, document.head.firstChild);
      element = document.createElement("div");
      element.className = "spotikit-window-controls";
      element.append(
        button("minimize", "Minimize", Window.minimize),
        button("maximize", "Maximize", Window.toggleMaximize),
        button("close", "Close", Window.close)
      );
      document.body.appendChild(element);
    }
    var max = element.querySelector(".spotikit-window-button--maximize, .spotikit-window-button--restore");
    var maximized = state === "maximized";
    max.className = "spotikit-window-button spotikit-window-button--" + (maximized ? "restore" : "maximize");
    max.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    max.querySelector("path").setAttribute("d", maximized ? GLYPHS.restore : GLYPHS.maximize);
    element.hidden = !spotifyShows || document.fullscreenElement !== null;
    showMenu();
    placeMenu();
  }

  var LABELS = {
    en: {
      menu: "Menu",
      file: "File",
      newPlaylist: "New Playlist",
      newFolder: "New Playlist Folder",
      privateSession: "Private Session",
      offlineMode: "Offline Mode",
      logOut: "Log Out",
      edit: "Edit",
      undo: "Undo",
      redo: "Redo",
      cut: "Cut",
      copy: "Copy",
      paste: "Paste",
      delete: "Delete",
      selectAll: "Select All",
      search: "Search",
      filter: "Filter",
      preferences: "Preferences…",
      view: "View",
      zoomIn: "Zoom In",
      zoomOut: "Zoom Out",
      resetZoom: "Reset Zoom",
      playback: "Playback",
      play: "Play",
      pause: "Pause",
      next: "Next",
      previous: "Previous",
      seekForward: "Seek Forward",
      seekBackward: "Seek Backward",
      shuffle: "Shuffle",
      repeat: "Repeat",
      volumeUp: "Volume Up",
      volumeDown: "Volume Down",
      develop: "Develop",
      debugWindow: "Show Debug Window",
      help: "Help",
      spotifyHelp: "Spotify Help",
      community: "Spotify Community",
      account: "Your Account",
      licensing: "Licensing Information",
      thirdParty: "Third-party Software",
      reportIssue: "Report Issue…",
      about: "About Spotify",
    },
    de: {
      menu: "Menü",
      file: "Datei",
      newPlaylist: "Neue Playlist",
      newFolder: "Neuer Playlist-Ordner",
      privateSession: "Private Session",
      offlineMode: "Offline-Modus",
      logOut: "Abmelden",
      edit: "Bearbeiten",
      undo: "Rückgängig",
      redo: "Wiederholen",
      cut: "Ausschneiden",
      copy: "Kopieren",
      paste: "Einfügen",
      delete: "Löschen",
      selectAll: "Alles auswählen",
      search: "Suchen",
      filter: "Filtern",
      preferences: "Einstellungen …",
      view: "Ansicht",
      zoomIn: "Vergrößern",
      zoomOut: "Verkleinern",
      resetZoom: "Zoom zurücksetzen",
      playback: "Wiedergabe",
      play: "Abspielen",
      pause: "Pause",
      next: "Weiter",
      previous: "Zurück",
      seekForward: "Vorspulen",
      seekBackward: "Zurückspulen",
      shuffle: "Zufallswiedergabe",
      repeat: "Wiederholen",
      volumeUp: "Lauter",
      volumeDown: "Leiser",
      develop: "Entwickeln",
      debugWindow: "Debug-Fenster anzeigen",
      help: "Hilfe",
      spotifyHelp: "Spotify-Hilfe",
      community: "Spotify Community",
      account: "Dein Konto",
      licensing: "Lizenzinformationen",
      thirdParty: "Software von Drittanbietern",
      reportIssue: "Problem melden …",
      about: "Über Spotify",
    },
  };
  var SEEK_STEP = 5000;

  function label(key) {
    var language = (SpotiKit.Locale && SpotiKit.Locale.language) || "en";
    var table = LABELS[language] || LABELS.en;
    return table[key] || LABELS.en[key];
  }

  function hasControl(type) {
    var found = false;
    controlSubs.forEach(function (sub) {
      if (sub.type === type) {
        found = true;
      }
    });
    return found;
  }

  var privateSession = false;
  var forcedOffline = false;
  var menuWatchers = [];

  function connectivity() {
    var offline = SpotiKit.Platform.OfflineAPI;
    return offline && offline._events && offline._events._connectivityPolicy;
  }

  function watchMenuState() {
    var privacy = SpotiKit.Platform.PrivateSessionAPI;
    if (privacy && typeof privacy.subscribeToPrivateSession === "function") {
      var stop = privacy.subscribeToPrivateSession(function (on) {
        privateSession = !!on;
      });
      menuWatchers.push(typeof stop === "function" ? stop : function () {});
    }
    var policy = connectivity();
    if (policy && typeof policy.subState === "function") {
      var sub = policy.subState({}, function (s) {
        forcedOffline = !!s && s.status === "forced_offline";
      });
      menuWatchers.push(function () {
        sub && sub.cancel && sub.cancel();
      });
    }
  }

  function unwatchMenuState() {
    menuWatchers.forEach(function (stop) {
      try {
        stop();
      } catch (e) {}
    });
    menuWatchers = [];
  }

  var focusBeforeMenu = null;

  function run(action) {
    var focus = focusBeforeMenu;
    setTimeout(function () {
      if (focus && focus.isConnected && typeof focus.focus === "function") {
        focus.focus({ preventScroll: true });
      }
      try {
        action();
      } catch (e) {
        internal.log.error("Window: a menu entry failed", e);
      }
    }, 0);
  }

  function MenuContent() {
    var R = SpotiKit.React;
    var h = R.createElement;
    var C = SpotiKit.Components;
    var P = SpotiKit.Platform;
    var Player = SpotiKit.Player;

    function item(key, onSelect, options) {
      options = options || {};
      return h(
        C.MenuItem,
        {
          key: key,
          role: "menuitem",
          disabled: !!options.disabled,
          divider: options.divider,
          textValue: label(options.label || key),
          trailingIcon: options.checked ? internal.iconElement("check") : undefined,
          onClick: function () {
            run(onSelect);
          },
        },
        label(options.label || key)
      );
    }

    function control(key, type, options) {
      return item(
        key,
        function () {
          sendControl(type);
        },
        Object.assign({ disabled: !hasControl(type) }, options)
      );
    }

    function submenu(key, children) {
      return h(
        C.SubMenuItem,
        {
          key: key,
          displayText: label(key),
          depth: 1,
          placement: "right-start",
          onOpenChange: function () {},
          onClick: function () {},
        },
        children.filter(Boolean)
      );
    }

    var zoom = P.ZoomAPI;
    var policy = connectivity();
    var repeat = Player.repeat;

    return h(
      C.Menu,
      null,
      submenu("file", [
        control("newPlaylist", "create_new_playlist"),
        control("newFolder", "create_new_folder"),
        P.PrivateSessionAPI &&
          item(
            "privateSession",
            function () {
              P.PrivateSessionAPI.setPrivateSession(!privateSession);
            },
            { checked: privateSession, divider: "before" }
          ),
        policy &&
          item(
            "offlineMode",
            function () {
              policy.setForceOffline({ forceOffline: !forcedOffline });
            },
            { checked: forcedOffline }
          ),
        control("logOut", "logout", { divider: "before" }),
      ]),
      submenu("edit", [
        control("undo", "undo"),
        control("redo", "redo"),
        control("cut", "cut", { divider: "before" }),
        control("copy", "copy"),
        control("paste", "paste"),
        control("delete", "delete"),
        control("selectAll", "select_all", { divider: "before" }),
        control("search", "show_search"),
        control("filter", "filter"),
        control("preferences", "show_preferences", { divider: "before" }),
      ]),
      zoom &&
        submenu("view", [
          item("zoomIn", function () {
            zoom.zoomIn();
          }),
          item("zoomOut", function () {
            zoom.zoomOut();
          }),
          item("resetZoom", function () {
            zoom.setZoomLevel(0);
          }),
        ]),
      submenu("playback", [
        item(
          "play",
          function () {
            Player.toggle();
          },
          { label: Player.isPlaying ? "pause" : "play" }
        ),
        item("next", function () {
          Player.next();
        }),
        item("previous", function () {
          Player.previous();
        }),
        item(
          "seekForward",
          function () {
            Player.seekBy(SEEK_STEP);
          },
          { divider: "before" }
        ),
        item("seekBackward", function () {
          Player.seekBy(-SEEK_STEP);
        }),
        item(
          "shuffle",
          function () {
            Player.setShuffle(!Player.shuffle);
          },
          { checked: Player.shuffle, divider: "before" }
        ),
        item(
          "repeat",
          function () {
            Player.setRepeat(repeat === "off" ? "context" : repeat === "context" ? "track" : "off");
          },
          { checked: repeat !== "off" }
        ),
        item(
          "volumeUp",
          function () {
            Player.volumeUp();
          },
          { divider: "before" }
        ),
        item("volumeDown", function () {
          Player.volumeDown();
        }),
      ]),
      P.isDeveloperMode && submenu("develop", [control("debugWindow", "show_debug_window")]),
      submenu("help", [
        control("spotifyHelp", "show_help"),
        control("community", "show_community"),
        control("account", "show_account"),
        control("licensing", "show_licensing_information", { divider: "before" }),
        control("thirdParty", "show_licenses"),
        control("reportIssue", "show_report_issue", { divider: "before" }),
        control("about", "show_about"),
      ])
    );
  }

  function AppMenu() {
    var h = SpotiKit.React.createElement;
    return h(
      SpotiKit.Components.ContextMenu,
      { trigger: "click", action: "toggle", placement: "bottom-start", offset: [0, 8], menu: h(MenuContent) },
      function (isOpen, toggle, ref) {
        return h(
          "button",
          {
            ref: ref,
            type: "button",
            className: "spotikit-window-menu-button",
            "aria-label": label("menu"),
            "aria-expanded": !!isOpen,
            onPointerDown: function () {
              focusBeforeMenu = document.activeElement;
            },
            onClick: function (event) {
              toggle(event);
            },
          },
          internal.iconElement("more")
        );
      }
    );
  }

  var menuHost = null;
  var menuUnmount = null;
  var menuObserver = null;

  function placeMenu() {
    if (!menuHost) {
      return;
    }
    var spacer = document.querySelector(".global-nav-bar-window-controls-spacer");
    if (spacer && menuHost.parentNode !== spacer) {
      spacer.appendChild(menuHost);
    }
    if (spacer && !menuUnmount) {
      menuUnmount = internal.renderInto(menuHost, SpotiKit.React.createElement(AppMenu), spacer);
    }
    menuHost.hidden = !spotifyShows || document.fullscreenElement !== null;
  }

  var menuPending = false;

  function menuReady() {
    var C = SpotiKit.Components;
    return SpotiKit.React && internal.nativeReactDOM && C.ContextMenu && C.Menu && C.MenuItem && C.SubMenuItem;
  }

  function showMenu() {
    if (menuHost || menuPending) {
      return;
    }
    if (!menuReady()) {
      menuPending = true;
      internal.waitFor(menuReady).then(function () {
        menuPending = false;
        if (custom) {
          showMenu();
        }
      });
      return;
    }
    menuHost = document.createElement("div");
    menuHost.className = "spotikit-window-menu";
    watchMenuState();
    var scheduled = false;
    menuObserver = new MutationObserver(function () {
      if (scheduled) {
        return;
      }
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        placeMenu();
      });
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });
    placeMenu();
  }

  function hideMenu() {
    if (!menuHost) {
      return;
    }
    menuObserver.disconnect();
    menuObserver = null;
    unwatchMenuState();
    if (menuUnmount) {
      menuUnmount();
      menuUnmount = null;
    }
    menuHost.remove();
    menuHost = null;
  }

  // Hidden caption buttons still catch the mouse; height 1 removes them (0 isn't sent).
  function syncTitlebar() {
    if (!nativeTitlebar) return;
    nativeTitlebar.call(uiClient, { height: custom ? 1 : titlebarHeight }).catch(function (e) {
      internal.log.warn("Window: the titlebar height couldn't be set", e);
    });
  }

  function update() {
    var want = isWindows && !!nativeSet && Object.keys(owners).some((o) => owners[o]);
    if (want === custom) {
      if (custom) render();
      return;
    }
    custom = want;
    if (custom) {
      nativeSet.call(nativeApi, false);
      syncTitlebar();
      render();
    } else {
      element && element.remove();
      hideMenu();
      var style = document.getElementById("spotikit-window-controls-style");
      style && style.remove();
      element = null;
      nativeSet.call(nativeApi, spotifyShows);
      syncTitlebar();
    }
    events.emit("controls", custom);
  }

  internal.windowControls = function (owner, on) {
    owners[owner] = !!on;
    update();
  };

  var Window = {
    get state() {
      return state;
    },
    minimize: function () {
      return setState(CODES.minimized);
    },
    maximize: function () {
      return setState(CODES.maximized);
    },
    restore: function () {
      return setState(CODES.normal);
    },
    toggleMaximize: function () {
      return setState(state === "maximized" ? CODES.normal : CODES.maximized);
    },
    close: function () {
      var c = client();
      return c ? c.closeWindow({}) : Promise.reject(new Error("Window: this Spotify version can't close the window."));
    },
    get customControls() {
      return custom;
    },
    useCustomControls: function (on) {
      internal.windowControls("api", on);
    },
    on: function (type, listener) {
      return events.on(type, listener);
    },
  };
  SpotiKit.Window = Window;

  internal.platformReady.then(function () {
    var resolver = SpotiKit.Platform.Cosmos && SpotiKit.Platform.Cosmos.resolver;
    if (resolver) {
      resolver.send = trackSends(resolver.send);
      resolver.cancel = trackCancels(resolver.cancel);
    }
    var c = client();
    nativeApi = SpotiKit.Platform.NativeAPI || null;
    var proto = nativeApi && Object.getPrototypeOf(nativeApi);
    if (proto && typeof proto.setWindowButtonsVisibility === "function") {
      nativeSet = proto.setWindowButtonsVisibility;
      proto.setWindowButtonsVisibility = function (show) {
        spotifyShows = !!show;
        if (custom) {
          render();
          return Promise.resolve();
        }
        return nativeSet.call(this, show);
      };
    }
    uiClient = nativeApi && nativeApi._updateUiClient;
    var uiProto = uiClient && Object.getPrototypeOf(uiClient);
    if (uiProto && typeof uiProto.updateTitlebarHeight === "function") {
      nativeTitlebar = uiProto.updateTitlebarHeight;
      uiProto.updateTitlebarHeight = function (request) {
        if (request && typeof request.height === "number") titlebarHeight = request.height;
        if (custom) return nativeTitlebar.call(this, Object.assign({}, request, { height: 1 }));
        return nativeTitlebar.apply(this, arguments);
      };
    }
    document.addEventListener("fullscreenchange", function () {
      if (!custom) {
        return;
      }
      render();
      [0, 300, 1000].forEach(function (ms) {
        setTimeout(function () {
          if (custom) {
            nativeSet.call(nativeApi, false);
          }
        }, ms);
      });
    });
    if (c) {
      var take = function (message) {
        var next = NAMES[message && message.state];
        if (next && next !== state) {
          state = next;
          if (custom) render();
          events.emit("change", state);
        }
      };
      c.getWindowState({}).then(take, function () {});
      c.subscribeWindowState({}, take);
    }
    update();
  });
})(window.SpotiKit);
