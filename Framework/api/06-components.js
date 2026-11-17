/* SpotiKit Components and Hooks */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  var MEMO = Symbol.for("react.memo");
  var C = {};
  SpotiKit.Components = C;

  function src(value) {
    return internal.source(internal.renderFunction(value));
  }

  function propNames(value) {
    var text = src(value);
    var start = /^(?:function\s*[\w$]*)?\s*\(\{/.exec(text);
    var at = start ? start[0].length : -1;
    if (at < 0) {
      var inner = /^(?:function\s*[\w$]*)?\s*\(?[\w$]+\)?\s*(?:=>)?\s*\{(?:let|var|const)\s*\{/.exec(text);
      at = inner ? inner[0].length : -1;
    }
    if (at < 0) {
      return [];
    }
    var names = [];
    var depth = 0;
    var token = "";
    var expectName = true;
    for (var i = at; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === "{" || ch === "(" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === ")" || ch === "]") {
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        var close = text.indexOf(ch, i + 1);
        if (expectName && depth === 0) {
          token = text.slice(i + 1, close);
        }
        i = close;
        continue;
      }
      if (depth > 0) {
        continue;
      }
      if (ch === ",") {
        if (token) {
          names.push(token.replace(/^\.\.\./, ""));
        }
        token = "";
        expectName = true;
      } else if (ch === ":" || ch === "=") {
        if (expectName && token) {
          names.push(token.replace(/^\.\.\./, ""));
        }
        token = "";
        expectName = false;
      } else if (expectName) {
        token += ch;
      }
    }
    if (expectName && token) {
      names.push(token.replace(/^\.\.\./, ""));
    }
    return names
      .map(function (name) {
        return name.trim();
      })
      .filter(Boolean);
  }

  function hasProps(value, names) {
    var props = propNames(value);
    return names.every(function (name) {
      return props.indexOf(name) >= 0;
    });
  }

  function component(literal, test) {
    var quoted = JSON.stringify(literal);
    return function () {
      return internal.findExport(function (value) {
        return (
          (typeof value === "function" || (value && value.$$typeof)) &&
          src(value).indexOf(quoted) >= 0 &&
          (!test || test(value))
        );
      });
    };
  }

  var routeTypes = null;
  function findRouteTypes() {
    if (routeTypes) {
      return routeTypes;
    }
    var found = null;
    internal.walkFibers(function (fiber) {
      var kids = fiber.memoizedProps && fiber.memoizedProps.children;
      if (!Array.isArray(kids) || kids.length < 5 || typeof fiber.elementType !== "function") {
        return false;
      }
      var routes = kids.filter(function (kid) {
        return kid && kid.props && typeof kid.props.path === "string" && "element" in kid.props;
      });
      if (routes.length < 5) {
        return false;
      }
      var type = routes[0].type;
      if (
        typeof type !== "function" ||
        !routes.every(function (kid) {
          return kid.type === type;
        })
      ) {
        return false;
      }
      found = { Routes: fiber.elementType, Route: type };
      return true;
    });
    routeTypes = found;
    return found;
  }

  function entityMenu(test) {
    return function () {
      return internal.findExport(function (value) {
        if (!value || value.$$typeof !== MEMO) {
          return false;
        }
        var text = src(value);
        return text.indexOf("SpecProvider") >= 0 && text.indexOf("data:{uri:") >= 0 && test(propNames(value), text);
      });
    };
  }

  internal.lazy(internal, "MenuList", function () {
    return internal.findExport(function (value) {
      var text = src(value);
      return (
        value &&
        value.$$typeof &&
        text.indexOf('"no-focus-outline"') >= 0 &&
        text.indexOf('"ArrowLeft"') >= 0 &&
        text.indexOf("onKeyDown") >= 0 &&
        text.indexOf("menuItemHeight") < 0
      );
    });
  });

  var finders = {
    Menu: function () {
      return internal.findExport(function (value) {
        var text = src(value);
        return (
          value &&
          value.$$typeof &&
          text.indexOf("menuItemHeight") >= 0 &&
          text.indexOf('"encore-layout-themes"') >= 0 &&
          text.indexOf('"data-v2-leading-slot-disabled"') < 0
        );
      });
    },
    MenuItem: function () {
      return internal.findExport(function (value) {
        return typeof value === "function" && /textValue:[\w$]+\.textValue,onClick/.test(src(value));
      });
    },
    SubMenuItem: function () {
      var r = internal.require();
      return internal.findExport(function (value, entry) {
        if (
          typeof value !== "function" ||
          !/^[\w$]+=>\(0,[\w$]+\.[\w$]+\)\(\)\?\(0,[\w$]+\.jsx\)\([\w$]+,\{\.\.\.[\w$]+\}\):\(0,[\w$]+\.jsx\)\([\w$]+,\{\.\.\.[\w$]+\}\)$/.test(
            src(value)
          )
        ) {
          return false;
        }
        var factory = internal.source(r.m[entry.id]);
        return factory.indexOf('"SubmenuTrigger"') >= 0 && factory.indexOf('"data-context-menu-submenu-header"') >= 0;
      });
    },
    TrackMenu: entityMenu(function (props) {
      return (
        props.indexOf("albumUri") >= 0 &&
        props.indexOf("leadingActions") >= 0 &&
        props.indexOf("isFromListeningActivity") >= 0
      );
    }),
    AlbumMenu: entityMenu(function (props) {
      return props[0] === "uri" && props[1] === "artistUri" && props.indexOf("isInLibrary") >= 0;
    }),
    ArtistMenu: entityMenu(function (props, text) {
      return text.indexOf('"contextmenu.share.copy-artist-link"') >= 0;
    }),
    ShowMenu: entityMenu(function (props, text) {
      return text.indexOf('"web-player.show.rating.rateShow"') >= 0;
    }),
    EpisodeMenu: entityMenu(function (props) {
      return (
        (props.indexOf("isPlayed") >= 0 && props.indexOf("showUri") >= 0) ||
        (props.indexOf("episodeUri") >= 0 && props.indexOf("isCurationBlocked") >= 0)
      );
    }),
    AudiobookMenu: entityMenu(function (props) {
      return props.some(function (p) {
        return /^includeGoToAu/.test(p);
      });
    }),
    PlaylistMenu: function () {
      var r = internal.require();
      var found;
      internal.findExports(function (value, entry) {
        if (
          found ||
          typeof value !== "function" ||
          !/^[\w$]+=>\(0,[\w$]+\.jsxs?\)\([\w$]+,\{\.\.\.[\w$]+\}\)$/.test(src(value))
        ) {
          return false;
        }
        var factory = internal.source(r.m[entry.id]);
        if (
          factory.indexOf("SpecProvider") >= 0 &&
          /playlist/i.test(factory) &&
          /canView|permissions|isOwnedBySelf|canAdministratePermissions/.test(factory)
        ) {
          found = value;
        }
        return false;
      });
      return found;
    },

    Tooltip: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["label", "children", "positioningStrategy", "labelClassName"]);
      });
    },
    ConfirmDialog: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["onClose", "isOpen", "titleText", "descriptionText", "confirmText", "cancelText"]);
      });
    },
    ScrollContainer: function () {
      return internal.findExport(function (value) {
        return (
          typeof value === "function" &&
          hasProps(value, ["scrollNodeRef", "className", "children", "options"]) &&
          /onInstanceCreated/.test(src(value))
        );
      });
    },

    Text: function () {
      return internal.findExport(function (value) {
        return !!(value && value.$$typeof) && src(value).indexOf('"viola"') >= 0;
      });
    },
    Icon: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["titleId", "descId"]) && src(value).indexOf('"informative"') >= 0;
      });
    },
    Button: component("legacy-button-primary"),
    ButtonSecondary: component("legacy-button-secondary"),
    ButtonTertiary: component("legacy-button-tertiary"),
    Chip: component("chip__label", function (value) {
      return hasProps(value, ["selectedColorSet"]);
    }),
    Dropdown: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["selectClassName", "value"]);
      });
    },
    Slider: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["value", "max", "labelText", "onDragStart", "onDragMove", "onDragEnd"]);
      });
    },
    Toggle: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["ariaDescribedBy", "condensed", "value"]);
      });
    },

    RemoteConfigProvider: function () {
      return internal.findExport(function (value) {
        return typeof value === "function" && hasProps(value, ["children"]) && /\.isSuspended\(/.test(src(value));
      });
    },
    StoreProvider: function () {
      return internal.findExport(function (value) {
        return typeof value === "function" && hasProps(value, ["store", "stabilityCheck", "noopCheck"]);
      });
    },
    PlatformProvider: function () {
      var fiber = internal.walkFibers(function (f) {
        return !!(
          f.memoizedProps &&
          f.memoizedProps.platform &&
          typeof f.memoizedProps.platform.getEqualizerAPI === "function" &&
          typeof f.memoizedProps.platform.getServiceWorkerMessenger === "function" &&
          typeof f.type === "function"
        );
      });
      return fiber && fiber.type;
    },
    Router: function () {
      return internal.findExport(function (value) {
        return typeof value === "function" && hasProps(value, ["future", "location", "children"]);
      });
    },
    Routes: function () {
      var types = findRouteTypes();
      return types && types.Routes;
    },
    Route: function () {
      var types = findRouteTypes();
      return types && types.Route;
    },

    PanelHeader: function () {
      return internal.findExport(function (value) {
        return hasProps(value, ["link", "title", "titleSlot", "actions", "onClose", "panelLinkRef"]);
      });
    },

    Card: component("card__footer", function (value) {
      return hasProps(value, ["titleGap"]);
    }),
  };

  Object.keys(finders).forEach(function (name) {
    internal.lazy(C, name, finders[name]);
  });

  internal.lazy(C, "ContextMenu", function () {
    return internal.findExport(function (value) {
      var text = typeof value === "function" ? internal.source(value) : "";
      return text.length < 600 && /\.interactive\b/.test(text) && /\{\.\.\.[\w$]+\}/.test(text);
    });
  });

  internal.signals.modules.on(function () {
    C.RightClickMenu = function (props) {
      return SpotiKit.React.createElement(
        C.ContextMenu,
        Object.assign({ action: "toggle", trigger: "right-click" }, props)
      );
    };
    C.Cards = createCards();
    C.ScrollRow = createScrollRow();
    C.Link = function (props) {
      var React = SpotiKit.React;
      return React.createElement(
        "a",
        Object.assign({}, props, {
          href: props.to,
          onClick: function (event) {
            if (props.onClick) {
              props.onClick(event);
            }
            if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && event.button === 0) {
              event.preventDefault();
              SpotiKit.Platform.History.push(props.to);
            }
          },
          to: undefined,
        })
      );
    };
  });

  function createCards() {
    var cards = {};
    internal.lazy(cards, "Default", function () {
      return C.Card;
    });
    var labels = {
      Album: "artist.latest-release",
      Artist: "card.tag.artist",
      Audiobook: "card.tag.audiobook",
      Episode: "card.tag.episode",
      Playlist: "card.tag.playlist",
      Profile: "card.tag.profile",
      Show: "card.tag.show",
      Track: "card.tag.track",
    };
    Object.keys(labels).forEach(function (name) {
      internal.lazy(
        cards,
        name,
        component(labels[name], function (value) {
          return hasProps(value, ["uri", "images"]);
        })
      );
    });
    internal.lazy(
      cards,
      "CardImage",
      component("card-image-fallback", function (value) {
        return src(value).indexOf('"card-image-age-restricted"') >= 0;
      })
    );
    return cards;
  }

  function createScrollRow() {
    var React = SpotiKit.React;
    return function ScrollRow(props) {
      var ref = React.useRef(null);
      var edges = React.useState({ start: true, end: true });
      var update = React.useCallback(function () {
        var el = ref.current;
        if (el) {
          edges[1]({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
        }
      }, []);
      React.useEffect(
        function () {
          update();
          var el = ref.current;
          var observer = new ResizeObserver(update);
          observer.observe(el);
          return function () {
            observer.disconnect();
          };
        },
        [update]
      );
      var scrollBy = function (direction) {
        var el = ref.current;
        el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
      };
      var arrow = function (direction) {
        var hidden = direction < 0 ? edges[0].start : edges[0].end;
        return React.createElement("button", {
          "aria-label": direction < 0 ? "Scroll left" : "Scroll right",
          onClick: function () {
            scrollBy(direction);
          },
          style: {
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            insetInlineStart: direction < 0 ? 0 : "auto",
            insetInlineEnd: direction > 0 ? 0 : "auto",
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: 0,
            background: "var(--background-elevated-highlight)",
            color: "var(--text-base)",
            cursor: "pointer",
            opacity: hidden ? 0 : 1,
            pointerEvents: hidden ? "none" : "auto",
            transition: "opacity .2s",
          },
          dangerouslySetInnerHTML: {
            __html:
              '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">' +
              SpotiKit.Icons.markup(direction < 0 ? "chevron-left" : "chevron-right") +
              "</svg>",
          },
        });
      };
      return React.createElement(
        "div",
        { className: props.className, style: { position: "relative" } },
        React.createElement(
          "div",
          {
            ref: ref,
            onScroll: update,
            style: {
              display: "flex",
              gap: props.gap === undefined ? 8 : props.gap,
              overflowX: "auto",
              scrollbarWidth: "none",
            },
          },
          props.children
        ),
        arrow(-1),
        arrow(1)
      );
    };
  }

  var Hooks = {};
  SpotiKit.Hooks = Hooks;

  function useLive(read, subscribe) {
    var React = SpotiKit.React;
    var state = React.useState(read);
    React.useEffect(function () {
      var update = function () {
        state[1](read());
      };
      update();
      return subscribe(update);
    }, []);
    return state[0];
  }

  Hooks.usePlayer = function () {
    var P = SpotiKit.Player;
    return useLive(
      function () {
        return { state: P.state, track: P.track, isPlaying: P.isPlaying, shuffle: P.shuffle, repeat: P.repeat };
      },
      function (update) {
        return P.on("state", update);
      }
    );
  };

  Hooks.usePosition = function () {
    var P = SpotiKit.Player;
    return useLive(
      function () {
        return P.position;
      },
      function (update) {
        var offProgress = P.on("progress", update);
        var offState = P.on("state", update);
        return function () {
          offProgress();
          offState();
        };
      }
    );
  };

  Hooks.useQueue = function () {
    var Q = SpotiKit.Queue;
    return useLive(
      function () {
        return Q.next;
      },
      function (update) {
        var offQueue = Q.on("change", update);
        var offTrack = SpotiKit.Player.on("track", update);
        return function () {
          offQueue();
          offTrack();
        };
      }
    );
  };

  Hooks.useNavigation = function () {
    return useLive(
      function () {
        return SpotiKit.Navigation.path;
      },
      function (update) {
        return SpotiKit.Navigation.on("change", update);
      }
    );
  };

  Hooks.useColors = function (value) {
    var React = SpotiKit.React;
    var state = React.useState(null);
    React.useEffect(
      function () {
        var alive = true;
        state[1](null);
        if (value) {
          SpotiKit.Colors.extract(value)
            .then(function (colors) {
              if (alive) {
                state[1](colors);
              }
            })
            .catch(function () {});
        }
        return function () {
          alive = false;
        };
      },
      [value]
    );
    return state[0];
  };

  internal.lazy(Hooks, "useDrag", function () {
    var nativeDrag = internal.findExport(function (value) {
      var text = typeof value === "function" ? internal.source(value) : "";
      return /dataTransfer/.test(text) && /data-dragging-type/.test(text) && /itemUris/.test(text);
    });
    if (!nativeDrag) {
      return undefined;
    }
    return function useDrag(uris, options) {
      options = options || {};
      var drag = nativeDrag({});
      return {
        draggable: drag.draggable,
        onDragStart: function (event) {
          drag.onDragStart(event, {
            itemUris: uris || [],
            dragLabelText: options.label || "",
            contextUri: options.contextUri || "",
          });
        },
      };
    };
  });
})(window.SpotiKit);
