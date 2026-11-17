/* SpotiKit Dialog and Panels */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  function renderInto(container, content, anchor) {
    if (content && content.$$typeof && internal.nativeReactDOM) {
      var root = internal.nativeReactDOM.createRoot(container);
      root.render(
        internal.withSpotifyContexts(
          anchor || document.querySelector("#main .main-view-container, #main [data-testid=root]"),
          content
        )
      );
      return function () {
        root.unmount();
      };
    }
    if (typeof content === "string") {
      container.innerHTML = content;
    } else if (content instanceof Node) {
      container.appendChild(content);
    }
    return function () {
      container.textContent = "";
    };
  }
  internal.renderInto = renderInto;

  var openDialog = null;

  function closeIcon() {
    return (
      '<svg data-encore-id="icon" role="img" aria-hidden="true" class="e-icon" fill="currentColor" viewBox="0 0 16 16" ' +
      'style="--encore-icon-height:16px;--encore-icon-width:16px;width:16px;height:16px">' +
      SpotiKit.Icons.markup("x") +
      "</svg>"
    );
  }

  function open(options) {
    options = options || {};
    if (openDialog) {
      openDialog.close();
    }
    var dialog = document.createElement("dialog");
    dialog.className = "spotikit-dialog";
    dialog.setAttribute("aria-label", options.title || "");
    var modal = document.createElement("div");
    modal.className = "track-credits-modal";
    modal.style.height = "auto";
    modal.style.maxHeight = "calc(100vh - 128px)";
    if (options.size === "large") {
      modal.style.width = "min(664px, calc(100vw - 64px))";
    }

    var header = document.createElement("div");
    header.className = "track-credits-modal-header";
    var titles = document.createElement("div");
    var title = document.createElement("h1");
    title.className = "e-text encore-text-title-small encore-internal-padding-block-end-tighter-4";
    title.setAttribute("data-encore-id", "text");
    title.textContent = options.title || "";
    titles.appendChild(title);
    var close = document.createElement("button");
    close.className =
      "e-legacy-button e-legacy-button-tertiary e-overflow-wrap-anywhere encore-text-body-small-bold e-legacy-button--small " +
      "e-button-tertiary--small e-button-tertiary--condensed e-button-tertiary--text-subdued encore-internal-color-text-subdued track-credits-modal-close";
    close.setAttribute("data-encore-id", "buttonTertiary");
    try {
      close.setAttribute("aria-label", SpotiKit.Locale.t("close"));
    } catch (e) {
      close.setAttribute("aria-label", "Close");
    }
    close.innerHTML = closeIcon();
    header.appendChild(titles);
    header.appendChild(close);

    var body = document.createElement("div");
    body.className = "track-credits-modal-body";
    body.style.overflowY = "auto";
    var main = document.createElement("main");
    body.appendChild(main);
    modal.appendChild(header);
    modal.appendChild(body);
    dialog.appendChild(modal);

    var cleanup = null;
    var handle = {
      close: function () {
        if (openDialog !== handle) {
          return;
        }
        openDialog = null;
        if (cleanup) {
          cleanup();
        }
        if (dialog.open) {
          dialog.close();
        }
        dialog.remove();
        if (typeof options.onClose === "function") {
          options.onClose();
        }
      },
    };
    close.addEventListener("click", handle.close);
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      handle.close();
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        handle.close();
      }
    });
    (document.getElementById("main") || document.body).appendChild(dialog);
    openDialog = handle;
    internal.trackRemove(handle, "close");
    cleanup = renderInto(main, typeof options.content === "function" ? options.content(handle) : options.content);
    dialog.showModal();
    return handle;
  }

  function confirm(options) {
    options = options || {};
    var ConfirmDialog = SpotiKit.Components.ConfirmDialog;
    if (!ConfirmDialog) {
      return Promise.reject(new Error("Spotify's confirmation dialog was not found."));
    }
    return new Promise(function (resolve) {
      var host = document.createElement("div");
      host.id = "spotikit-confirm-" + Date.now();
      document.body.appendChild(host);
      var cleanup = null;
      var done = function (answer) {
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
        host.remove();
        resolve(answer);
      };
      cleanup = renderInto(
        host,
        SpotiKit.React.createElement(ConfirmDialog, {
          isOpen: true,
          titleText: options.title || "",
          descriptionText: options.message,
          confirmText: options.confirmLabel || "OK",
          cancelText: options.cancelLabel || "Cancel",
          onConfirm: function () {
            done(true);
          },
          onClose: function () {
            done(false);
          },
          onOutside: function () {
            done(false);
          },
        })
      );
    });
  }

  SpotiKit.Dialog = {
    open: open,
    confirm: confirm,
    close: function () {
      if (openDialog) {
        openDialog.close();
      }
    },
  };

  var panels = new Map();
  var activeId = null;
  var nextId = 1;
  var panelEvents = new internal.Emitter("Panels");

  function builtIn() {
    return (
      internal.findExport(function (v) {
        return (
          v &&
          typeof v === "object" &&
          typeof v.EditTransition === "string" &&
          typeof v.DevicePicker === "string" &&
          typeof v.AssistedCuration === "string"
        );
      }) || {}
    );
  }

  function service() {
    var value = internal.findContextValue(function (v) {
      return (
        Array.isArray(v) &&
        v.length === 3 &&
        v[1] &&
        typeof v[1].send === "function" &&
        typeof v[1].subscribe === "function" &&
        v[2] &&
        (v[2].id || (v[2].config && v[2].config.id)) === "RightPanelState"
      );
    });
    return value && value[1];
  }

  var eventFor = null;
  function panelEvent(id) {
    if (!eventFor) {
      eventFor = internal.findExport(function (v) {
        var text = typeof v === "function" ? internal.source(v) : "";
        return /switch\(/.test(text) && /PANEL_CLOSE_CLICK/.test(text) && /BUDDY_FEED_BUTTON_CLICK/.test(text);
      });
    }
    return eventFor ? eventFor(id) : null;
  }

  function nativePanel() {
    var s = service();
    return s && s.state ? s.state.value : undefined;
  }

  function current() {
    return activeId !== null ? activeId : nativePanel();
  }

  function announce() {
    var id = current();
    panelEvents.emit("change", id);
    panels.forEach(function (panel, key) {
      var isOpen = key === activeId;
      if (panel.wasOpen !== isOpen) {
        panel.wasOpen = isOpen;
        panel.emitter.emit("change", isOpen);
      }
    });
  }

  var hostPanel = null;
  var watched = null;
  function watch() {
    var s = service();
    if (s && watched !== s) {
      watched = s;
      s.subscribe(function (state) {
        if (activeId !== null && state.value !== hostPanel) {
          closeOverlay();
        }
        announce();
      });
    }
    return s;
  }

  function openNative(id) {
    var s = watch();
    if (!s) {
      return Promise.reject(new Error("The right sidebar isn't mounted."));
    }
    if (nativePanel() === id) {
      return Promise.resolve();
    }
    var event = panelEvent(id);
    if (!event) {
      return Promise.reject(new Error("Spotify has no way to open the panel " + id + "."));
    }
    s.send({ type: event });
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        resolve();
      });
    });
  }

  var overlay = null;
  var overlayCleanup = null;
  var overlayId = null;

  function closeOverlay() {
    if (overlayCleanup) {
      overlayCleanup();
      overlayCleanup = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    overlayId = null;
    activeId = null;
  }

  function panelElement(id) {
    var panel = panels.get(id);
    var R = SpotiKit.React;
    var o = panel.options;
    var content = typeof o.render === "function" ? R.createElement(o.render, { panel: id }) : o.content;
    if (o.frame === false) {
      return content;
    }
    var C = SpotiKit.Components;
    return R.createElement(
      C.PanelFrame,
      { label: o.title, style: o.style },
      R.createElement(
        C.PanelBody,
        null,
        R.createElement(C.PanelHeader, { title: o.title, actions: o.actions }),
        content
      )
    );
  }

  function mountOverlay() {
    if (activeId === null) {
      return;
    }
    var slot = document.querySelector(".right-sidebar-panel-slot");
    if (!slot || (overlay && overlay.parentNode === slot && overlayId === activeId)) {
      return;
    }
    if (overlayCleanup) {
      overlayCleanup();
    }
    if (overlay) {
      overlay.remove();
    }
    overlay = document.createElement("div");
    overlay.className = "spotikit-panel-host";
    overlay.style.cssText =
      "position:absolute;inset:0;z-index:3;display:flex;background:var(--background-base,#121212)";
    slot.appendChild(overlay);
    overlayId = activeId;
    var anchor =
      slot.querySelector(
        "aside.panel-section .panel-section-header, aside.panel-section .panel-section-content, aside.panel-section"
      ) || slot;
    overlayCleanup = renderInto(overlay, panelElement(activeId), anchor);
  }

  new MutationObserver(function () {
    if (activeId !== null && (!overlay || !overlay.isConnected)) {
      mountOverlay();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  function openPanel(id) {
    if (panels.has(id)) {
      var builtins = builtIn();
      var now = nativePanel();
      var host = now && now !== builtins.Disabled ? now : builtins.BuddyFeed;
      return openNative(host)
        .catch(function () {
          return openNative(builtins.Queue);
        })
        .then(function () {
          hostPanel = nativePanel();
          activeId = id;
          mountOverlay();
          announce();
        });
    }
    closeOverlay();
    return openNative(id).then(announce);
  }

  SpotiKit.Panels = {
    get builtIn() {
      return builtIn();
    },
    get current() {
      return current();
    },
    open: openPanel,
    close: function () {
      closeOverlay();
      return openNative(builtIn().Disabled).then(announce);
    },
    on: function (type, listener) {
      watch();
      return panelEvents.on(type, listener);
    },
    register: function (options) {
      options = options || {};
      var id = "spotikit-panel-" + nextId++;
      var panel = { options: options, emitter: new internal.Emitter("Panel"), wasOpen: false };
      panels.set(id, panel);
      return internal.trackRemove({
        id: id,
        get isOpen() {
          return activeId === id;
        },
        open: function () {
          return openPanel(id);
        },
        close: function () {
          return activeId === id ? SpotiKit.Panels.close() : Promise.resolve();
        },
        toggle: function () {
          return activeId === id ? SpotiKit.Panels.close() : openPanel(id);
        },
        on: function (type, listener) {
          watch();
          return panel.emitter.on(type, listener);
        },
        remove: function () {
          if (activeId === id) {
            closeOverlay();
            announce();
          }
          panels.delete(id);
        },
      });
    },
  };

  internal.signals.modules.on(function () {
    var R = SpotiKit.React;
    var C = SpotiKit.Components;
    var nativeHeader = Object.getOwnPropertyDescriptor(C, "PanelHeader");
    var findHeader = function () {
      return nativeHeader && nativeHeader.get ? nativeHeader.get.call(C) : null;
    };
    C.PanelFrame = function PanelFrame(props) {
      return R.createElement(
        "aside",
        {
          className: "panel-section" + (props.className ? " " + props.className : ""),
          "aria-label": props.label,
          style: Object.assign({ position: "relative", width: "100%" }, props.style),
        },
        props.children
      );
    };
    C.PanelBody = function PanelBody(props) {
      var all = R.Children.toArray(props.children);
      var isHeader = function (child) {
        return child && child.type === C.PanelHeader;
      };
      return R.createElement(
        "div",
        { className: "panel-section-container" },
        all.filter(isHeader),
        R.createElement(
          "div",
          { className: "panel-section-scroll", style: { overflowY: "auto", flex: 1, minHeight: 0 } },
          R.createElement(
            "div",
            { className: "panel-section-content" + (props.className ? " " + props.className : "") },
            all.filter(function (c) {
              return !isHeader(c);
            })
          )
        )
      );
    };
    var Header = function PanelHeader(props) {
      var Native = findHeader();
      var onClose =
        props.onClose ||
        function () {
          SpotiKit.Panels.close();
        };
      if (Native) {
        return R.createElement(Native, {
          title: props.title,
          link: props.link,
          actions: props.actions,
          onBack: props.onBack,
          onClose: onClose,
          preventDefaultClose: true,
        });
      }
      return R.createElement(
        "div",
        { className: "panel-section-header" },
        R.createElement(
          "div",
          { className: "panel-section-title" },
          R.createElement("div", { className: "panel-section-title-text" }, props.title)
        )
      );
    };
    Object.defineProperty(C, "PanelHeader", { value: Header, enumerable: true, configurable: true, writable: true });
  });
})(window.SpotiKit);
