/* SpotiKit marketplace */
(function (SpotiKit) {
  "use strict";
  var internal = SpotiKit && SpotiKit._internal;
  if (!internal) {
    return;
  }

  var store = SpotiKit.Storage.scope("marketplace");
  var events = new internal.Emitter("Marketplace");
  var MAX_ITEM_BYTES = 25 * 1024 * 1024;
  var CATALOG_MAX_AGE = 60 * 60 * 1000;

  var SPOTIKIT_TOPICS = {
    theme: "spotikit-themes",
    extension: "spotikit-extensions",
    app: "spotikit-apps",
    snippet: "spotikit-snippets",
  };
  var SPOTIKIT_SNIPPETS_URL = "https://raw.githubusercontent.com/NMWplays/SpotiKit/main/marketplace/snippets.json";
  var PER_PAGE = 100;

  function rawBase(repo, branch) {
    return "https://raw.githubusercontent.com/" + repo + "/" + (branch || "HEAD") + "/";
  }

  function resolveUrl(base, path) {
    if (typeof path !== "string" || !path.trim()) {
      return null;
    }
    try {
      return new URL(path.trim(), base).toString();
    } catch (e) {
      return null;
    }
  }

  function slug(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // Same as AddonTemplates.IdFor.
  function addonId(name) {
    var id = slug(name).slice(0, 40).replace(/-+$/, "");
    return /^\d/.test(id) ? "x-" + id : id;
  }

  function versionParts(text) {
    var m = /^\d+(\.\d+)*/.exec(String(text || ""));
    return m ? m[0].split(".").map(Number) : [];
  }

  function compareTo(actual, end) {
    for (var i = 0; i < end.length; i++) {
      var a = actual[i] || 0;
      if (a !== end[i]) return a < end[i] ? -1 : 1;
    }
    return 0;
  }

  // Same rules as VersionRange.cs.
  function readRange(text) {
    var m = /^\s*(\d+(?:\.\d+)*)\s*(?:-\s*(\d+(?:\.\d+)*)\s*)?$/.exec(typeof text === "string" ? text : "");
    if (!m) return null;
    var from = m[1].split(".").map(Number);
    var to = m[2] ? m[2].split(".").map(Number) : from;
    if (compareTo(from, to) > 0 && compareTo(to, from) < 0) return null;
    return { from: from, to: to, text: m[2] && m[2] !== m[1] ? m[1] + " to " + m[2] : m[1] };
  }

  function inRange(version, range) {
    var actual = versionParts(version);
    return compareTo(actual, range.from) >= 0 && compareTo(actual, range.to) <= 0;
  }

  function spotifyVersion() {
    return (SpotiKit.Platform && SpotiKit.Platform.version) || "";
  }

  function compatibilityOf(requires) {
    var given = requires && requires.spotify;
    if (!given) {
      return {
        status: "unspecified",
        label: "Spotify versions not given",
        detail: "Its spotikit.json doesn't say which Spotify versions it was made for.",
      };
    }
    var range = readRange(given);
    if (!range) {
      return {
        status: "unspecified",
        label: "Spotify versions unreadable",
        detail: 'Its spotikit.json says "' + given + "\", which isn't a version range like 1.3.5 - 1.3.6.",
      };
    }
    var have = spotifyVersion();
    if (!have) return { status: "unspecified", label: "Made for Spotify " + range.text, detail: "" };
    return inRange(have, range)
      ? {
          status: "ok",
          label: "Made for your Spotify",
          detail: "Made for Spotify " + range.text + ". You have " + have + ".",
        }
      : {
          status: "other-spotify",
          label: "Not made for Spotify " + have,
          detail: "Made for Spotify " + range.text + ". You have " + have + ", so it may look or work wrong.",
        };
  }

  function readAuthors(list, repo) {
    var owner = repo.split("/")[0];
    var authors = (Array.isArray(list) ? list : [])
      .filter(function (a) {
        return a && typeof a.name === "string" && a.name.trim();
      })
      .map(function (a) {
        return {
          name: String(a.name).trim(),
          url: typeof a.url === "string" && /^https?:/i.test(a.url) ? a.url : null,
        };
      });
    return authors.length ? authors : [{ name: owner, url: "https://github.com/" + owner }];
  }

  function readTags(tags) {
    return (Array.isArray(tags) ? tags : typeof tags === "string" ? [tags] : [])
      .filter(function (t) {
        return typeof t === "string" && t.trim();
      })
      .map(function (t) {
        return t.trim().toLowerCase();
      });
  }

  function text(value) {
    var t = internal.localized(value);
    return typeof t === "string" ? t.trim() : "";
  }

  var spotikitManifest = {
    format: "spotikit",
    label: "spotikit.json",
    file: "spotikit.json",
    read: function (json, source) {
      var entries = Array.isArray(json) ? json : json && typeof json === "object" ? [json] : [];
      var items = [];
      entries.forEach(function (entry) {
        if (!entry || typeof entry !== "object") return;
        var name = text(entry.name);
        var kind = ["theme", "extension", "app", "snippet"].indexOf(entry.type) >= 0 ? entry.type : source.kind;
        var description = text(entry.description);
        if (!name || !kind || (source.strict && !description)) return;
        var base = rawBase(
          source.repo,
          typeof entry.branch === "string" && entry.branch.trim() ? entry.branch.trim() : source.branch
        );
        var files = [];
        var add = function (role, path) {
          var url = resolveUrl(base, path);
          if (url) files.push({ role: role, url: url });
        };
        internal.manifestFiles(entry.style).forEach(function (path) {
          add(kind === "snippet" ? "snippet" : "style", path);
        });
        internal
          .manifestFiles(
            kind === "snippet" ? null : entry.main || (kind === "extension" ? "extension.js" : kind === "app" ? "index.js" : null)
          )
          .forEach(function (path) {
            add("main", path);
          });
        if (kind === "theme" && typeof entry.schemes === "string") add("schemes", entry.schemes);
        else if (kind === "theme" && entry.schemes && typeof entry.schemes === "object")
          files.push({ role: "schemes", url: base + "spotikit.json#schemes", text: JSON.stringify(entry.schemes) });
        if (!files.length) return;
        var requires = {
          spotify: typeof entry.spotify === "string" && entry.spotify.trim() ? entry.spotify.trim() : null,
        };
        var dependencies = internal.readDependencies(entry.dependencies);
        items.push({
          id: source.repo.toLowerCase() + "/" + slug(name),
          kind: kind,
          origin: "spotikit",
          name: name,
          description: description,
          authors: readAuthors(entry.authors, source.repo),
          tags: readTags(entry.tags),
          preview: resolveUrl(base, entry.preview),
          readme: resolveUrl(base, entry.readme),
          files: files,
          app:
            kind === "app"
              ? {
                  id: addonId(name),
                  icon: typeof entry.icon === "string" ? entry.icon : null,
                  activeIcon: typeof entry.activeIcon === "string" ? entry.activeIcon : null,
                }
              : null,
          windowControls: entry.windowControls === "custom",
          version: typeof entry.version === "string" && entry.version.trim() ? entry.version.trim() : null,
          dependencies: Object.keys(dependencies).length ? dependencies : null,
          repoUrl: "https://github.com/" + source.repo,
          stars: source.stars || 0,
          updated: source.updated || null,
          source: {
            repo: source.repo,
            format: spotikitManifest.format,
            formatLabel: spotikitManifest.label,
            manifest: base + "spotikit.json",
          },
          requires: requires,
          compatibility: compatibilityOf(requires),
        });
      });
      return items;
    },
  };

  var manifestWorker = null;
  var workerCalls = {};
  var workerId = 0;
  function fetchJson(url) {
    if (manifestWorker === null) {
      try {
        var code =
          "self.onmessage=function(e){fetch(e.data.url).then(function(r){return r.ok?r.json():null}).catch(function(){return null}).then(function(d){self.postMessage({id:e.data.id,data:d})})};";
        manifestWorker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
        manifestWorker.onmessage = function (e) {
          var done = workerCalls[e.data.id];
          delete workerCalls[e.data.id];
          if (done) done(e.data.data);
        };
      } catch (e) {
        manifestWorker = false;
      }
    }
    if (!manifestWorker) {
      return fetch(url)
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        });
    }
    return new Promise(function (resolve) {
      var id = ++workerId;
      workerCalls[id] = resolve;
      manifestWorker.postMessage({ id: id, url: url });
    });
  }

  var catalog = null;
  var refreshing = null;
  var catalogEvent = 0;
  var seen = {};

  function emitCatalog(now) {
    if (now) {
      clearTimeout(catalogEvent);
      catalogEvent = 0;
      events.emit("catalog", catalog);
      return;
    }
    if (!catalogEvent) {
      catalogEvent = setTimeout(function () {
        catalogEvent = 0;
        events.emit("catalog", catalog);
      }, 150);
    }
  }

  function addItems(list) {
    var known = {};
    catalog.items.forEach(function (item, i) {
      known[item.id] = i;
    });
    list.forEach(function (item) {
      seen[item.id] = true;
      if (blockOf(item.id, item)) return;
      if (known[item.id] === undefined) {
        known[item.id] = catalog.items.length;
        catalog.items.push(item);
      } else {
        catalog.items[known[item.id]] = item;
      }
    });
    emitCatalog(false);
  }

  function pool(list, limit, task) {
    var at = 0;
    var next = function () {
      if (at >= list.length) return Promise.resolve();
      var item = list[at++];
      return Promise.resolve()
        .then(function () {
          return task(item);
        })
        .catch(function () {})
        .then(next);
    };
    var runners = [];
    for (var i = 0; i < Math.min(limit, list.length); i++) runners.push(next());
    return Promise.all(runners);
  }

  function searchPage(topic, page) {
    var url =
      "https://api.github.com/search/repositories?q=" +
      encodeURIComponent("topic:" + topic) +
      "&per_page=" +
      PER_PAGE +
      "&sort=stars&order=desc&page=" +
      page;
    return fetch(url, { headers: { Accept: "application/vnd.github+json" } }).then(function (response) {
      if (response.status === 403 || response.status === 429) {
        var reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        var error = new Error("GitHub's search limit was reached");
        error.retryAt = reset > Date.now() ? reset : Date.now() + 60000;
        throw error;
      }
      if (!response.ok) {
        throw new Error("GitHub search: HTTP " + response.status);
      }
      return response.json();
    });
  }

  function setError(key, message) {
    catalog.errors = catalog.errors.filter(function (e) {
      return e.repo !== key;
    });
    if (message) catalog.errors.push({ repo: key, message: message });
  }

  function loadTopic(kind, page) {
    var topic = SPOTIKIT_TOPICS[kind];
    var key = kind;
    var progress = catalog.progress[key] || (catalog.progress[key] = { loaded: 0, total: null, done: false });
    return searchPage(topic, page).then(
      function (result) {
        setError(topic, null);
        progress.total = result.total_count;
        var repos = (result.items || []).filter(function (repo) {
          return repo && !repo.archived;
        });
        progress.loaded += (result.items || []).length - repos.length;
        return pool(repos, 8, function (repo) {
          var source = {
            repo: repo.full_name,
            branch: repo.default_branch,
            stars: repo.stargazers_count,
            updated: repo.pushed_at,
            strict: true,
            kind: kind,
          };
          return fetchJson(rawBase(repo.full_name, repo.default_branch) + spotikitManifest.file)
            .then(function (json) {
              if (json) addItems(spotikitManifest.read(json, source));
            })
            .finally(function () {
              progress.loaded++;
              emitCatalog(false);
            });
        }).then(function () {
          if (page * PER_PAGE < result.total_count && (result.items || []).length) {
            return loadTopic(kind, page + 1);
          }
          progress.done = true;
          return null;
        });
      },
      function (error) {
        if (!error.retryAt) {
          setError(topic, error.message);
          progress.done = true;
          emitCatalog(true);
          return null;
        }
        setError(
          topic,
          error.message +
            "; the rest of the " +
            kind +
            "s loads at " +
            new Date(error.retryAt).toLocaleTimeString() +
            "."
        );
        emitCatalog(true);
        return new Promise(function (resolve) {
          setTimeout(resolve, error.retryAt - Date.now() + 1500);
        }).then(function () {
          return loadTopic(kind, page);
        });
      }
    );
  }

  store.remove("snippetsSource");

  function loadSpotikitSnippets() {
    return fetch(SPOTIKIT_SNIPPETS_URL, { cache: "no-cache" })
      .then(function (r) {
        if (r.status === 404) return [];
        if (!r.ok) throw new Error("SpotiKit snippets: HTTP " + r.status);
        return r.json();
      })
      .then(function (list) {
        setError("spotikit-snippets", null);
        addItems(
          (Array.isArray(list) ? list : [])
            .filter(function (s) {
              return s && typeof s.id === "string" && typeof s.name === "string" && typeof s.css === "string";
            })
            .map(function (s) {
              return {
                id: "spotikit/snippet/" + slug(s.id),
                kind: "snippet",
                origin: "spotikit",
                name: s.name.trim(),
                description: typeof s.description === "string" ? s.description.trim() : "",
                authors: (Array.isArray(s.authors) ? s.authors : []).filter(function (a) {
                  return a && typeof a.name === "string";
                }),
                tags: Array.isArray(s.tags) ? s.tags.filter(function (t) {
                  return typeof t === "string";
                }) : [],
                preview: typeof s.preview === "string" && s.preview ? resolveUrl(SPOTIKIT_SNIPPETS_URL, s.preview) : null,
                readme: null,
                code: s.css,
                files: [{ role: "snippet", url: SPOTIKIT_SNIPPETS_URL + "#" + slug(s.id), text: s.css }],
                repoUrl: "https://github.com/NMWplays/SpotiKit/blob/main/marketplace/snippets.json",
                stars: 0,
                updated: null,
                source: {
                  repo: "NMWplays/SpotiKit",
                  format: "spotikit-snippet",
                  formatLabel: "SpotiKit snippet",
                  manifest: SPOTIKIT_SNIPPETS_URL,
                },
                compatibility: {
                  status: "unspecified",
                  label: "Spotify versions not given",
                  detail: "SpotiKit's snippet list doesn't say which Spotify versions it was made for.",
                },
              };
            })
        );
      })
      .catch(function (error) {
        setError("spotikit-snippets", error.message);
      });
  }

  function saveCatalog() {
    return cache.put("catalog", catalog).catch(function (e) {
      internal.log.warn("The catalog could not be cached", e);
    });
  }

  function refresh(force) {
    if (refreshing) {
      return refreshing;
    }
    refreshing = cache
      .get("catalog")
      .catch(function () {
        return null;
      })
      .then(function (cached) {
        if (cached && cached.items) {
          cached.items = cached.items.filter(function (item) {
            return item.origin === "spotikit";
          });
          cached.items.forEach(function (item) {
            if (item.requires) item.compatibility = compatibilityOf(item.requires);
          });
          cached.items = cached.items.filter(function (item) {
            return !blockOf(item.id, item);
          });
          catalog = cached;
          emitCatalog(true);
          if (!force && Date.now() - cached.at < CATALOG_MAX_AGE) {
            return catalog;
          }
        }
        var previous = catalog;
        seen = {};
        catalog = {
          at: previous ? previous.at : Date.now(),
          items: previous ? previous.items.slice() : [],
          errors: [],
          progress: {},
          loading: true,
        };
        emitCatalog(true);
        var loads = Object.keys(SPOTIKIT_TOPICS)
          .map(function (kind) {
            return loadTopic(kind, 1);
          })
          .concat(loadSpotikitSnippets());
        return Promise.all(loads).then(function () {
          var failed = {};
          catalog.errors.forEach(function (e) {
            Object.keys(SPOTIKIT_TOPICS).forEach(function (kind) {
              if (SPOTIKIT_TOPICS[kind] === e.repo) failed[kind] = true;
            });
            if (e.repo === "spotikit-snippets") failed.snippet = true;
          });
          refreshBlocklist();
          catalog.items = catalog.items.filter(function (item) {
            if (blockOf(item.id, item) || item.origin !== "spotikit") return false;
            return seen[item.id] || failed[item.kind];
          });
          var map = installed();
          catalog.items.forEach(function (item) {
            var record = map[item.id];
            if (!record || item.origin !== "spotikit") return;
            if (JSON.stringify(record.item.requires) !== JSON.stringify(item.requires)) {
              updateRecord(item.id, { item: item });
              resume(item.id);
            }
          });
          catalog.at = Date.now();
          catalog.loading = false;
          emitCatalog(true);
          return saveCatalog().then(function () {
            return catalog;
          });
        });
      })
      .finally(function () {
        refreshing = null;
      });
    return refreshing;
  }

  function findItem(id) {
    var record = installed()[id];
    var fromCatalog =
      catalog &&
      catalog.items.find(function (item) {
        return item.id === id;
      });
    return fromCatalog || linked[id] || (record && record.item) || null;
  }

  var linked = {};

  function repoName(text) {
    var clean = String(text || "")
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/(\.git)?([?#].*)?$/i, "")
      .split("/")
      .filter(Boolean);
    return clean.length >= 2 && /^[\w.-]+$/.test(clean[0]) && /^[\w.-]+$/.test(clean[1])
      ? clean[0] + "/" + clean[1]
      : null;
  }

  function loadRepo(text) {
    var repo = repoName(text);
    if (!repo) return Promise.reject(new Error('"' + text + "\" isn't a GitHub repository like owner/repo."));
    var repoBlock = blockOf(repo);
    if (repoBlock) return Promise.reject(new Error("SpotiKit removed this from the Marketplace: " + repoBlock.reason));
    return fetch("https://api.github.com/repos/" + repo, { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (meta) {
        var source = {
          repo: meta ? meta.full_name : repo,
          branch: meta ? meta.default_branch : null,
          stars: meta ? meta.stargazers_count : 0,
          updated: meta ? meta.pushed_at : null,
          strict: false,
          kind: null,
        };
        return fetchJson(rawBase(source.repo, source.branch) + spotikitManifest.file)
          .then(function (json) {
            return json ? spotikitManifest.read(json, source) : [];
          })
          .then(function (items) {
            if (!items.length) {
              throw new Error(
                meta || source.branch
                  ? source.repo + " has no spotikit.json SpotiKit can read."
                  : source.repo + " wasn't found on GitHub, or it's private."
              );
            }
            var open = items.filter(function (item) {
              return !blockOf(item.id, item);
            });
            if (!open.length) throw new Error("SpotiKit removed this from the Marketplace: " + blockOf(items[0].id, items[0]).reason);
            open.forEach(function (item) {
              linked[item.id] = item;
            });
            return open;
          });
      });
  }

  function pickDependency(ref, ids, kindOf) {
    var key = ref.toLowerCase();
    if (ids.indexOf(key) >= 0) return key;
    var matches = ids.filter(function (id) {
      return id.indexOf(key + "/") === 0 && kindOf(id) === "extension";
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function satisfies(version, range) {
    if (!range || range === "*") return true;
    var wanted = readRange(range);
    return !!(wanted && version && inRange(version, wanted));
  }

  function installedDependency(ref) {
    var map = installed();
    return pickDependency(ref, Object.keys(map), function (id) {
      return map[id].kind;
    });
  }

  function resolveDependency(ref, range) {
    var id = installedDependency(ref);
    if (!id) return null;
    var record = installed()[id];
    if (!record.enabled) return { error: "It needs " + record.item.name + ", which is turned off." };
    if (!satisfies(record.item.version, range)) {
      return {
        error:
          "It needs " +
          record.item.name +
          " " +
          range +
          ", but " +
          (record.item.version ? record.item.version : "a version without a number") +
          " is installed.",
      };
    }
    return { owner: id, version: record.item.version };
  }

  function dependents(id) {
    var map = installed();
    return Object.keys(map).filter(function (other) {
      var needs = map[other].enabled && map[other].item && map[other].item.dependencies;
      return (
        needs &&
        Object.keys(needs).some(function (ref) {
          return installedDependency(ref) === id;
        })
      );
    });
  }

  function namesOf(ids) {
    var map = installed();
    return ids
      .map(function (id) {
        return map[id] ? map[id].item.name : id;
      })
      .join(", ");
  }

  function availableDependency(ref) {
    var items = (catalog ? catalog.items : []).concat(
      Object.keys(linked).map(function (id) {
        return linked[id];
      })
    );
    var byId = {};
    items.forEach(function (item) {
      if (item.origin === "spotikit") byId[item.id] = item;
    });
    var id = pickDependency(ref, Object.keys(byId), function (key) {
      return byId[key].kind;
    });
    if (id) return Promise.resolve(byId[id]);
    return loadRepo(ref).then(function (list) {
      var found = {};
      list.forEach(function (item) {
        if (item.origin === "spotikit") found[item.id] = item;
      });
      var picked = pickDependency(ref, Object.keys(found), function (key) {
        return found[key].kind;
      });
      if (!picked) throw new Error(ref + " has no SpotiKit extension with that name.");
      return found[picked];
    });
  }

  function installDependencies(item, seenIds) {
    var needs = item.dependencies || {};
    return Object.keys(needs).reduce(function (chain, ref) {
      return chain.then(function () {
        var range = needs[ref];
        var have = installedDependency(ref);
        var record = have && installed()[have];
        if (record && satisfies(record.item.version, range)) {
          return record.enabled ? null : setEnabled(have, true);
        }
        return availableDependency(ref).then(function (dependency) {
          if (!satisfies(dependency.version, range)) {
            throw new Error(
              item.name +
                " needs " +
                dependency.name +
                " " +
                range +
                ", but its newest version is " +
                (dependency.version || "without a number") +
                "."
            );
          }
          if (seenIds[dependency.id]) return null;
          seenIds[dependency.id] = true;
          return install(dependency.id, { seen: seenIds, dependency: true });
        });
      });
    }, Promise.resolve());
  }

  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var open = indexedDB.open("spotikit-marketplace", 3);
        open.onupgradeneeded = function () {
          var names = open.result.objectStoreNames;
          if (!names.contains("files")) open.result.createObjectStore("files");
          if (!names.contains("cache")) open.result.createObjectStore("cache");
          if (!names.contains("state")) open.result.createObjectStore("state");
        };
        open.onsuccess = function () {
          resolve(open.result);
        };
        open.onerror = function () {
          reject(open.error);
        };
      });
    }
    return dbPromise;
  }

  function idb(storeName, mode, run) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
        var request = run(tx.objectStore(storeName));
        tx.oncomplete = function () {
          resolve(request && request.result);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.onabort = function () {
          reject(tx.error);
        };
      });
    });
  }

  var files = {
    get: function (id, slot) {
      return idb("files", "readonly", function (s) {
        return s.get(id + "|" + slot);
      });
    },
    put: function (id, slot, value) {
      return idb("files", "readwrite", function (s) {
        return s.put(value, id + "|" + slot);
      });
    },
    remove: function (id, slot) {
      return idb("files", "readwrite", function (s) {
        return s.delete(id + "|" + slot);
      });
    },
  };
  var cache = {
    get: function (key) {
      return idb("cache", "readonly", function (s) {
        return s.get(key);
      });
    },
    put: function (key, value) {
      return idb("cache", "readwrite", function (s) {
        return s.put(value, key);
      });
    },
  };
  store.remove("catalog");

  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buffer) {
      return Array.from(new Uint8Array(buffer))
        .map(function (b) {
          return b.toString(16).padStart(2, "0");
        })
        .join("");
    });
  }

  function download(item) {
    return Promise.resolve(item.files)
      .then(function (sourceFiles) {
        return Promise.all(
          sourceFiles.map(function (file) {
        var text =
          typeof file.text === "string"
            ? Promise.resolve(file.text)
            : fetch(file.url, { cache: "no-cache" }).then(function (response) {
                if (!response.ok) {
                  throw new Error(file.url + ": HTTP " + response.status);
                }
                return response.text();
              });
        return text.then(function (content) {
          return sha256(content).then(function (hash) {
            return { role: file.role, url: file.url, text: content, sha256: hash, size: new Blob([content]).size };
          });
        });
          })
        );
      })
      .then(function (list) {
      if (!list.length) {
        throw new Error("It has no files to install.");
      }
      var total = list.reduce(function (sum, f) {
        return sum + f.size;
      }, 0);
      if (total > MAX_ITEM_BYTES) {
        throw new Error(
          "The download is " +
            Math.round(total / 1024 / 1024) +
            " MB; the marketplace accepts up to " +
            MAX_ITEM_BYTES / 1024 / 1024 +
            " MB per item."
        );
      }
      return list;
    });
  }

  function versionOf(list) {
    return sha256(
      list
        .map(function (f) {
          return f.role + ":" + f.sha256;
        })
        .join("|")
    );
  }

  var DURABLE = ["installed", "snippets", "profiles", "account"];
  function keep(key, value) {
    store.set(key, value);
    idb("state", "readwrite", function (s) {
      return s.put(value, key);
    }).catch(function (e) {
      internal.log.warn("Marketplace: " + key + " could not be saved to IndexedDB", e);
    });
  }

  var restored = Promise.all(
    DURABLE.map(function (key) {
      return idb("state", "readonly", function (s) {
        return s.get(key);
      }).then(function (saved) {
        var local = store.get(key, undefined);
        if (saved === undefined) {
          return local === undefined
            ? null
            : idb("state", "readwrite", function (s) {
                return s.put(local, key);
              });
        }
        if (JSON.stringify(saved) !== JSON.stringify(local)) {
          store.set(key, saved);
          internal.log.info("Marketplace: " + key + " restored from IndexedDB");
          return key;
        }
        return null;
      });
    })
  )
    .then(function (changed) {
      if (changed.indexOf("installed") >= 0) events.emit("installed", installed());
      if (changed.indexOf("profiles") >= 0) events.emit("profiles", profiles());
      if (changed.indexOf("snippets") >= 0) events.emit("snippets", snippets());
    })
    .catch(function (e) {
      internal.log.warn("Marketplace: the saved state could not be read from IndexedDB", e);
    });

  function installed() {
    return store.get("installed", {});
  }

  function saveInstalled(map) {
    keep("installed", map);
    events.emit("installed", map);
  }

  function updateRecord(id, change) {
    var map = installed();
    if (!map[id]) {
      return null;
    }
    map[id] = Object.assign({}, map[id], change);
    saveInstalled(map);
    return map[id];
  }

  function blockOf(id, item) {
    var list = store.get("blocked", []);
    if (!list.length) return null;
    var key = String(id || "").toLowerCase();
    var repo = item && item.source && item.source.repo ? String(item.source.repo).toLowerCase() : "";
    return (
      list.find(function (b) {
        var t = b.target;
        return key === t || key.indexOf(t + "/") === 0 || (!!repo && (repo === t || repo.indexOf(t + "/") === 0));
      }) || null
    );
  }

  function notifyLater(text) {
    internal
      .waitFor(function () {
        return internal.findSnackbar();
      })
      .then(
        function () {
          SpotiKit.notify(text, { type: "error", duration: 10000 });
        },
        function () {}
      );
  }

  function enforceBlocklist() {
    var map = installed();
    var stopped = [];
    Object.keys(map).forEach(function (id) {
      var record = map[id];
      var block = blockOf(id, record.item);
      if (!block) {
        if (record.blocked) updateRecord(id, { blocked: null });
        return;
      }
      if (record.blocked !== block.reason) updateRecord(id, { blocked: block.reason });
      if (!record.enabled) return;
      if (deactivate(id)) markReload(id, "disabled");
      updateRecord(id, { enabled: false });
      if (record.kind === "theme") releaseThemeSlot(record);
      stopped.push(record.item.name + " (" + block.reason + ")");
    });
    if (stopped.length)
      notifyLater("SpotiKit removed " + stopped.join(", ") + " from the Marketplace. It was turned off.");
    if (
      catalog &&
      catalog.items &&
      catalog.items.some(function (item) {
        return blockOf(item.id, item);
      })
    ) {
      catalog.items = catalog.items.filter(function (item) {
        return !blockOf(item.id, item);
      });
      emitCatalog(true);
    }
  }

  var blocklistLoading = null;
  function refreshBlocklist() {
    if (blocklistLoading) return blocklistLoading;
    var server = accountServer();
    if (!server) return Promise.resolve();
    blocklistLoading = fetch(server + "/api/blocklist", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("Blocklist: HTTP " + r.status);
        return r.json();
      })
      .then(function (list) {
        var clean = (Array.isArray(list) ? list : [])
          .filter(function (b) {
            return b && typeof b.target === "string" && b.target && typeof b.reason === "string";
          })
          .map(function (b) {
            return { target: b.target.toLowerCase(), reason: b.reason };
          });
        if (JSON.stringify(clean) !== JSON.stringify(store.get("blocked", []))) store.set("blocked", clean);
        enforceBlocklist();
      })
      .catch(function (e) {
        internal.log.warn("The Marketplace blocklist couldn't be loaded", e);
      })
      .finally(function () {
        blocklistLoading = null;
      });
    return blocklistLoading;
  }

  var running = {};
  var scriptOwners = {};

  function ownerOf(filename, error) {
    if (filename && scriptOwners[filename]) {
      return scriptOwners[filename];
    }
    var stack = error && typeof error.stack === "string" ? error.stack : "";
    var match = /spotikit-marketplace\/(.+?)\/[^/\s]+\.js/.exec(stack);
    return match && installed()[match[1]] ? match[1] : null;
  }

  function recordError(owner, error, fallback) {
    var message = (error && error.name && error.name + ": " + error.message) || fallback || "Error";
    var record = installed()[owner];
    if (record && record.error !== message) {
      updateRecord(owner, { error: message });
      internal.log.warn("Marketplace item " + owner + " failed: " + message);
    }
  }

  window.addEventListener("error", function (event) {
    var owner = ownerOf(event.filename, event.error);
    if (owner) recordError(owner, event.error, event.message);
  });

  var timersWatched = false;
  function watchTimers() {
    if (timersWatched) return;
    timersWatched = true;
    var guard = function (callback) {
      return function () {
        try {
          return callback.apply(this, arguments);
        } catch (error) {
          var owner = ownerOf(null, error);
          if (owner) recordError(owner, error);
          throw error;
        }
      };
    };
    ["setTimeout", "setInterval", "requestAnimationFrame"].forEach(function (name) {
      var original = window[name];
      window[name] = function (callback) {
        var args = Array.prototype.slice.call(arguments);
        if (typeof callback === "function") args[0] = guard(callback);
        return original.apply(window, args);
      };
    });
  }
  window.addEventListener("unhandledrejection", function (event) {
    var owner = ownerOf(null, event.reason);
    if (owner) recordError(owner, event.reason, String(event.reason));
  });

  function addStyle(id, role, text) {
    var style = document.createElement("style");
    style.className = "spotikit-marketplace-style";
    style.setAttribute("data-item", id);
    style.setAttribute("data-role", role);
    style.textContent = text;
    (document.body || document.head).appendChild(style);
    return style;
  }

  function cssUrls(text, url) {
    return String(text).replace(/url\(\s*("|'|)([^"')]+)\1\s*\)/g, function (match, quote, path) {
      if (/^(https?:|data:|blob:|#)/i.test(path)) return match;
      var resolved = resolveUrl(url, path);
      return resolved ? "url(" + quote + resolved + quote + ")" : match;
    });
  }

  function scriptUrl(id, file) {
    var name = "spotikit-marketplace/" + id + "/" + file.url.split("/").pop();
    var url = URL.createObjectURL(new Blob([file.text + "\n//# sourceURL=" + name], { type: "text/javascript" }));
    scriptOwners[url] = id;
    scriptOwners[name] = id;
    internal.owners.add(url, id);
    internal.owners.add(name, id);
    return url;
  }

  function runScript(id, file, module) {
    watchTimers();
    var url = scriptUrl(id, file);
    var script = document.createElement("script");
    if (module) script.type = "module";
    script.src = url;
    script.setAttribute("data-item", id);
    document.head.appendChild(script);
    return url;
  }

  function importScript(id, file) {
    watchTimers();
    return import(scriptUrl(id, file));
  }

  function spotikitSchemes(list) {
    var file = list.find(function (f) {
      return f.role === "schemes";
    });
    try {
      return file ? internal.readSchemes(JSON.parse(file.text)) : [];
    } catch (e) {
      return [];
    }
  }

  function activateSpotikit(id, record, list, entry, reason) {
    var item = record.item;
    var of = function (role) {
      return list.filter(function (f) {
        return f.role === role;
      });
    };
    of("style").forEach(function (f) {
      entry.styles.push(addStyle(id, "style", cssUrls(f.text, f.url)));
    });
    var fail = function (error) {
      recordError(id, error);
    };
    if (item.kind === "theme") {
      var schemes = spotikitSchemes(list);
      var scheme =
        schemes.find(function (s) {
          return s.id === record.scheme;
        }) || schemes[0];
      if (scheme) {
        SpotiKit.Themes.preview(scheme.colors, scheme.variables);
        entry.colors = true;
      }
      if (item.windowControls && internal.windowControls) {
        internal.windowControls("theme", true);
        entry.windowControls = true;
      }
      var themeId = addonId(item.name);
      document.documentElement.setAttribute("data-spotikit-theme", themeId);
      entry.themeAttribute = themeId;
      of("main").forEach(function (f, index) {
        importScript(id, f)
          .then(function (module) {
            if (typeof module.default !== "function") {
              entry.stuck = true;
              return;
            }
            if (running[id] !== entry) return;
            var owner = index ? id + "#" + index : id;
            entry.owners.push(owner);
            return internal.addons.start(owner, module, {
              context: {
                theme: themeId,
                scheme: scheme ? scheme.id : null,
                url: function (path) {
                  return resolveUrl(f.url, path);
                },
              },
            });
          })
          .catch(fail);
      });
      return;
    }
    if (item.kind === "app") {
      var app = item.app || { id: addonId(item.name) };
      of("main").forEach(function (f) {
        importScript(id, f)
          .then(function (module) {
            if (typeof module.default !== "function") {
              throw new Error(f.url.split("/").pop() + " has no default export (the app's page component).");
            }
            if (running[id] !== entry) return;
            entry.app = SpotiKit.Apps.register({
              id: app.id,
              name: item.name,
              icon: app.icon || undefined,
              activeIcon: app.activeIcon || undefined,
              component: module.default,
            });
          })
          .catch(fail);
      });
      return;
    }
    startExtension(id, record, entry, of("main"), reason);
  }

  function startExtension(id, record, entry, scripts, reason) {
    if (!scripts.length) return;
    if (executed[id] !== undefined) {
      runScripts(id, entry, scripts, reason, true);
      return;
    }
    var dependencies;
    try {
      dependencies = internal.resolveDependencies(record.item.dependencies);
    } catch (error) {
      recordError(id, error);
      return;
    }
    scripts.forEach(function (f, index) {
      var url = scriptUrl(id, f);
      watchTimers();
      import(url)
        .then(function (module) {
          if (typeof module.default !== "function") {
            executed[id] = scripts
              .map(function (s) {
                return s.sha256;
              })
              .join(",");
            entry.scripts.push(url);
            if (reason) markReload(id, reason);
            return;
          }
          if (running[id] !== entry) return;
          var owner = index ? id + "#" + index : id;
          entry.owners.push(owner);
          return internal.addons.start(owner, module, {
            dependencies: dependencies,
            context: {
              url: function (path) {
                return resolveUrl(f.url, path);
              },
            },
          });
        })
        .catch(function (error) {
          recordError(id, error);
        });
    });
  }

  function activate(id, record, list, reason) {
    var entry = { styles: [], scripts: [], stops: [], owners: [], blocked: false };
    running[id] = entry;
    if (record.kind === "snippet") {
      list
        .filter(function (f) {
          return f.role === "snippet";
        })
        .forEach(function (f) {
          entry.styles.push(
            addStyle(
              id,
              "snippet",
              record.item.source && record.item.source.format === "spotikit" ? cssUrls(f.text, f.url) : f.text
            )
          );
        });
      return;
    }
    if (record.item.origin !== "spotikit") {
      entry.blocked = true;
      return;
    }
    activateSpotikit(id, record, list, entry, reason);
  }

  var executed = {};
  function runScripts(id, entry, scripts, reason, module) {
    if (!scripts.length) return;
    var hashes = scripts
      .map(function (f) {
        return f.sha256;
      })
      .join(",");
    if (executed[id] === undefined) {
      executed[id] = hashes;
      scripts.forEach(function (f) {
        entry.scripts.push(runScript(id, f, module));
      });
      if (reason) markReload(id, reason);
      return;
    }
    entry.scripts = scripts.map(function () {
      return null;
    });
    if (executed[id] === hashes && pendingReload[id]) {
      delete pendingReload[id];
      events.emit("reload", Object.assign({}, pendingReload));
    }
  }

  function deactivate(id) {
    var entry = running[id];
    if (!entry) {
      return false;
    }
    entry.styles.forEach(function (style) {
      style.remove();
    });
    entry.stops.forEach(function (stop) {
      try {
        stop();
      } catch (e) {
        internal.log.error("Marketplace item " + id + " failed to stop", e);
      }
    });
    if (entry.colors) SpotiKit.Themes.preview(null);
    if (entry.windowControls && internal.windowControls) internal.windowControls("theme", false);
    if (entry.themeAttribute && document.documentElement.getAttribute("data-spotikit-theme") === entry.themeAttribute)
      document.documentElement.removeAttribute("data-spotikit-theme");
    if (entry.app) entry.app.remove();
    entry.owners.forEach(internal.addons.stop);
    if (!entry.scripts.length) internal.owners.dispose(id);
    var leftovers = entry.scripts.length > 0 || !!entry.stuck;
    delete running[id];
    return leftovers;
  }

  var pendingReload = {};
  function markReload(id, why, label) {
    var record = installed()[id];
    var name = label || (record ? record.item.name : pendingReload[id] ? pendingReload[id].name : id);
    pendingReload[id] = { reason: why, name: name };
    events.emit("reload", Object.assign({}, pendingReload));
  }

  function clearReload(id) {
    if (!pendingReload[id]) return;
    delete pendingReload[id];
    events.emit("reload", Object.assign({}, pendingReload));
  }

  function takeThemeSlot(id) {
    var map = installed();
    var inherited;
    Object.keys(map).forEach(function (other) {
      if (other !== id && map[other].kind === "theme" && map[other].enabled) {
        if (deactivate(other)) markReload(other, "disabled");
        map[other].enabled = false;
        inherited = map[other].previousNativeTheme;
        delete map[other].previousNativeTheme;
      }
    });
    var record = map[id];
    if (record && record.previousNativeTheme === undefined) {
      record.previousNativeTheme = inherited !== undefined ? inherited : SpotiKit.Themes.current;
    }
    saveInstalled(map);
    if (SpotiKit.Themes.current) {
      SpotiKit.Themes.reset();
    }
  }

  function releaseThemeSlot(record) {
    var previous = record && record.previousNativeTheme;
    if (record && installed()[record.id]) {
      var map = installed();
      delete map[record.id].previousNativeTheme;
      saveInstalled(map);
    }
    if (previous && previous.theme) {
      SpotiKit.Themes.apply(previous.theme, previous.scheme).catch(function () {});
    } else {
      SpotiKit.Themes.reset();
    }
  }

  var busy = {};
  function guard(id, run) {
    if (busy[id]) {
      return Promise.reject(new Error("Something is already happening with this item."));
    }
    busy[id] = true;
    events.emit("busy", Object.assign({}, busy));
    return Promise.resolve()
      .then(run)
      .finally(function () {
        delete busy[id];
        events.emit("busy", Object.assign({}, busy));
      });
  }

  function runsHere(record) {
    if (!record.item || record.item.origin !== "spotikit") return true;
    var have = spotifyVersion();
    return compatibilityOf(record.item.requires).status !== "other-spotify" || (!!have && record.runAnywayOn === have);
  }

  function resume(id) {
    var record = installed()[id];
    if (!record || !record.enabled || !record.paused || running[id] || !runsHere(record)) return Promise.resolve(false);
    updateRecord(id, { paused: null });
    if (record.kind === "theme") takeThemeSlot(id);
    return files.get(id, "current").then(function (stored) {
      if (stored) activate(id, installed()[id], stored.files);
      return true;
    });
  }

  function startNow(id) {
    return guard(id, function () {
      var record = installed()[id];
      if (!record || !record.enabled || running[id]) return record;
      if (!runsHere(record)) throw new Error("It isn't made for this Spotify version.");
      if (record.kind === "theme") takeThemeSlot(id);
      return files.get(id, "current").then(function (stored) {
        if (!stored) throw new Error("Its files are missing from storage. Reinstall it.");
        activate(id, installed()[id], stored.files, "started");
        return installed()[id];
      });
    });
  }

  function runAnyway(id) {
    return guard(id, function () {
      var record = installed()[id];
      if (!record) throw new Error("Not installed.");
      updateRecord(id, { runAnywayOn: spotifyVersion(), enabled: true, paused: record.paused || spotifyVersion() });
      return resume(id).then(function () {
        return installed()[id];
      });
    });
  }

  function install(id, options) {
    options = options || {};
    var item = findItem(id);
    var block = blockOf(id, item);
    if (block) return Promise.reject(new Error("SpotiKit removed this from the Marketplace: " + block.reason));
    if (!item) {
      return Promise.reject(new Error("There is no marketplace item " + id + "."));
    }
    if (item.compatibility && item.compatibility.status === "other-spotify" && !options.anyway && !installed()[id]) {
      return Promise.reject(new Error(item.compatibility.detail));
    }
    var seenIds = options.seen || {};
    seenIds[id] = true;
    return installDependencies(item, seenIds).then(function () {
      return installItem(id, item, options);
    });
  }

  function branchOf(item) {
    var file = item.files.find(function (f) {
      return /^https:\/\/raw\.githubusercontent\.com\//.test(f.url || "");
    });
    var parts = file ? file.url.split("/") : [];
    return parts.length > 6 ? decodeURIComponent(parts[5]) : "HEAD";
  }

  function githubApi(path) {
    return fetch("https://api.github.com/repos/" + path, { headers: { Accept: "application/vnd.github+json" } }).then(
      function (r) {
        if (!r.ok) throw new Error("GitHub: HTTP " + r.status);
        return r.json();
      }
    );
  }

  function headCommit(item) {
    if (!item.source || !item.source.repo || (item.kind === "snippet" && item.source.format !== "spotikit"))
      return Promise.resolve(null);
    return githubApi(item.source.repo + "/commits/" + encodeURIComponent(branchOf(item))).then(
      function (commit) {
        return commit && commit.sha ? commit.sha : null;
      },
      function () {
        return null;
      }
    );
  }

  function changes(id) {
    var record = installed()[id];
    var item = record && findItem(id);
    if (!item || !item.source || !item.source.repo) return Promise.resolve(null);
    var repo = item.source.repo;
    var branch = branchOf(item);
    if (!record.commit) {
      return Promise.resolve({ commits: [], url: "https://github.com/" + repo + "/commits/" + branch, known: false });
    }
    return githubApi(repo + "/compare/" + record.commit + "..." + encodeURIComponent(branch)).then(function (diff) {
      return {
        known: true,
        url: diff.html_url || "https://github.com/" + repo + "/compare/" + record.commit + "..." + branch,
        total: diff.total_commits || 0,
        commits: (diff.commits || [])
          .slice(-10)
          .reverse()
          .map(function (c) {
            return {
              message: String((c.commit && c.commit.message) || "").split("\n")[0],
              url: c.html_url,
              date: c.commit && c.commit.author ? c.commit.author.date : null,
            };
          }),
      };
    });
  }

  function installItem(id, item, options) {
    return guard(id, function () {
      var before = installed()[id];
      var commit = headCommit(item);
      return download(item)
        .then(function (list) {
          return Promise.all([versionOf(list), commit]).then(function (pair) {
            var version = pair[0];
            if (before && before.version === version) {
              updateRecord(id, {
                item: item,
                commit: pair[1] || before.commit || null,
                updateAvailable: false,
                latest: null,
                rolledBack: null,
              });
              resume(id);
              return { record: installed()[id], unchanged: true };
            }
            var keep = before
              ? files.get(id, "current").then(function (current) {
                  return current ? files.put(id, "previous", current) : null;
                })
              : Promise.resolve();
            return keep
              .then(function () {
                return files.put(id, "current", { files: list, version: version, at: Date.now(), commit: pair[1] || null });
              })
              .then(function () {
                var size = list.reduce(function (sum, f) {
                  return sum + f.size;
                }, 0);
                var map = installed();
                map[id] = Object.assign(
                  {},
                  before,
                  {
                    id: id,
                    kind: item.kind,
                    item: item,
                    version: version,
                    size: size,
                    installedAt: before ? before.installedAt : Date.now(),
                    updatedAt: Date.now(),
                    enabled: before ? before.enabled : true,
                    hasBackup: !!before,
                    previousVersion: before ? before.version : null,
                    previousCommit: before ? before.commit || null : null,
                    previousAt: before ? before.updatedAt || before.installedAt || null : null,
                    rolledBack: null,
                    updateAvailable: false,
                    commit: pair[1],
                    error: null,
                    runAnywayOn: before ? before.runAnywayOn || null : options.anyway ? spotifyVersion() : null,
                    paused: null,
                  },
                  options.scheme ? { scheme: options.scheme } : {}
                );
                saveInstalled(map);
                return { record: map[id], updated: !!before };
              });
          });
        })
        .then(function (result) {
          if (result.unchanged) {
            return result;
          }
          var record = result.record;
          if (result.updated && running[id]) {
            if (deactivate(id)) markReload(id, "updated");
          }
          if (record.enabled && !runsHere(record)) {
            updateRecord(id, { paused: spotifyVersion() });
          } else if (record.enabled) {
            if (record.kind === "theme") takeThemeSlot(id);
            return files.get(id, "current").then(function (stored) {
              activate(id, installed()[id], stored.files, result.updated ? null : "installed");
              return result;
            });
          }
          return result;
        });
    });
  }

  function setEnabled(id, enabled) {
    return guard(id, function () {
      var record = installed()[id];
      if (!record) throw new Error("Not installed.");
      if (record.enabled === enabled) return record;
      var needed = enabled ? [] : dependents(id);
      if (needed.length) throw new Error(namesOf(needed) + " needs " + record.item.name + ". Turn that off first.");
      if (!enabled) {
        if (deactivate(id)) markReload(id, "disabled");
        updateRecord(id, { enabled: false });
        if (record.kind === "theme") releaseThemeSlot(record);
        return installed()[id];
      }
      var block = blockOf(id, record.item);
      if (block) throw new Error("SpotiKit removed this from the Marketplace: " + block.reason);
      updateRecord(id, { enabled: true, error: null });
      if (!runsHere(record)) {
        updateRecord(id, { paused: spotifyVersion() });
        return installed()[id];
      }
      if (record.kind === "theme") takeThemeSlot(id);
      return files.get(id, "current").then(function (stored) {
        if (stored) activate(id, installed()[id], stored.files, "turned on");
        return installed()[id];
      });
    });
  }

  function rollback(id) {
    return guard(id, function () {
      var record = installed()[id];
      if (!record || !record.hasBackup) throw new Error("There is no earlier version to go back to.");
      return Promise.all([files.get(id, "current"), files.get(id, "previous")]).then(function (pair) {
        var current = pair[0];
        var previous = pair[1];
        if (!previous) throw new Error("The earlier version is missing from storage.");
        return files
          .put(id, "current", previous)
          .then(function () {
            return current ? files.put(id, "previous", current) : null;
          })
          .then(function () {
            updateRecord(id, {
              version: previous.version,
              commit: previous.commit || record.previousCommit || null,
              previousVersion: current ? current.version : null,
              previousCommit: record.commit || null,
              previousAt: record.updatedAt || record.installedAt || null,
              hasBackup: !!current,
              updateAvailable: !!current,
              latest: current ? current.version : null,
              rolledBack: current ? { at: Date.now(), to: previous.at || record.previousAt || null } : null,
              updatedAt: previous.at || record.previousAt || Date.now(),
              error: null,
            });
            if (current) {
              var later = store.get("updatesLater", {});
              later[id] = current.version;
              store.set("updatesLater", later);
            }
            if (running[id] && deactivate(id)) markReload(id, "rolled back");
            if (record.enabled && runsHere(record)) activate(id, installed()[id], previous.files);
            return installed()[id];
          });
      });
    });
  }

  function rollbackTarget(id) {
    var record = installed()[id];
    if (!record || !record.hasBackup) return Promise.resolve(null);
    return files.get(id, "previous").then(function (previous) {
      var commit = (previous && previous.commit) || record.previousCommit || null;
      var target = { at: (previous && previous.at) || record.previousAt || null, commit: commit, message: null };
      var repo = record.item && record.item.source && record.item.source.repo;
      if (!commit || !repo) return target;
      return githubApi(repo + "/commits/" + commit).then(
        function (c) {
          target.message = c && c.commit ? String(c.commit.message || "").split("\n")[0] : null;
          return target;
        },
        function () {
          return target;
        }
      );
    });
  }

  function uninstall(id) {
    return guard(id, function () {
      var record = installed()[id];
      if (!record) throw new Error("Not installed.");
      var needed = dependents(id);
      if (needed.length) throw new Error(namesOf(needed) + " needs " + record.item.name + ". Remove that first.");
      if (deactivate(id)) markReload(id, "removed");
      var map = installed();
      delete map[id];
      saveInstalled(map);
      if (record.kind === "theme" && record.enabled) releaseThemeSlot(record);
      return Promise.all([files.remove(id, "current"), files.remove(id, "previous")]).then(function () {
        return true;
      });
    });
  }

  function checkUpdate(id) {
    var item = findItem(id);
    var record = installed()[id];
    if (!item || !record) return Promise.resolve(null);
    return download(item)
      .then(versionOf)
      .then(function (version) {
        var available = version !== record.version;
        var change = { updateAvailable: available, latest: available ? version : null, checkedAt: Date.now() };
        if (!available) change.rolledBack = null;
        updateRecord(id, change);
        return available;
      });
  }

  var UPDATE_CHECK_EVERY = 3 * 60 * 60 * 1000;

  function pendingUpdates() {
    return restored
      .then(function () {
        var ids = Object.keys(installed());
        if (Date.now() - store.get("updateCheckAt", 0) < UPDATE_CHECK_EVERY || !ids.length) return null;
        return pool(ids, 3, function (id) {
          return checkUpdate(id).catch(function () {});
        }).then(function () {
          store.set("updateCheckAt", Date.now());
        });
      })
      .then(function () {
        var map = installed();
        var later = store.get("updatesLater", {});
        return Object.keys(map).filter(function (id) {
          return map[id].updateAvailable && map[id].latest && later[id] !== map[id].latest;
        });
      });
  }

  function availableUpdates() {
    var map = installed();
    return Object.keys(map).filter(function (id) {
      return map[id].updateAvailable;
    });
  }

  function checkUpdates() {
    return restored
      .then(function () {
        return pool(Object.keys(installed()), 3, function (id) {
          return checkUpdate(id).catch(function () {});
        });
      })
      .then(function () {
        store.set("updateCheckAt", Date.now());
        return availableUpdates();
      });
  }

  function updateAll(ids) {
    var failed = [];
    var list = ids || availableUpdates();
    return list
      .reduce(function (chain, id) {
        return chain.then(function () {
          return install(id).catch(function (error) {
            var record = installed()[id];
            failed.push((record ? record.item.name : id) + ": " + error.message);
          });
        });
      }, Promise.resolve())
      .then(function () {
        return { updated: list.length - failed.length, failed: failed };
      });
  }

  function setAutoUpdate(id, on) {
    return updateRecord(id, { autoUpdate: !!on });
  }

  function putOffUpdates(ids) {
    var map = installed();
    var later = store.get("updatesLater", {});
    ids.forEach(function (id) {
      if (map[id] && map[id].latest) later[id] = map[id].latest;
    });
    store.set("updatesLater", later);
  }

  function schemeNames(item, text) {
    try {
      return Object.keys(JSON.parse(text) || {});
    } catch (e) {
      return [];
    }
  }

  function setScheme(id, scheme) {
    var record = updateRecord(id, { scheme: scheme });
    if (record && record.enabled && running[id] && record.item.origin === "spotikit") {
      return files.get(id, "current").then(function (stored) {
        var picked = spotikitSchemes(stored.files).find(function (s) {
          return s.id === scheme;
        });
        if (picked) SpotiKit.Themes.preview(picked.colors, picked.variables);
      });
    }
    return Promise.resolve();
  }

  var SCHEME_MAX_AGE = 24 * 60 * 60 * 1000;
  var schemeLists = null;
  var schemeRequests = {};
  var schemeSave = 0;
  function rememberedSchemes() {
    if (!schemeLists) {
      schemeLists = cache.get("schemes").then(
        function (saved) {
          return saved || {};
        },
        function () {
          return {};
        }
      );
    }
    return schemeLists;
  }
  function schemesOf(id) {
    return files.get(id, "current").then(function (stored) {
      var file =
        stored &&
        stored.files.find(function (f) {
          return f.role === "schemes";
        });
      var item = findItem(id);
      if (file) return schemeNames(item, file.text);
      var remote =
        item &&
        item.files.find(function (f) {
          return f.role === "schemes";
        });
      if (!remote) return [];
      if (typeof remote.text === "string") return schemeNames(item, remote.text);
      return rememberedSchemes().then(function (known) {
        var entry = known[remote.url];
        if (entry && Date.now() - entry.at < SCHEME_MAX_AGE) {
          return entry.names || [];
        }
        if (!schemeRequests[remote.url]) {
          schemeRequests[remote.url] = fetch(remote.url)
            .then(function (r) {
              if (!r.ok) throw new Error("Schemes: HTTP " + r.status);
              return r.text();
            })
            .then(
              function (text) {
                return schemeNames(item, text);
              },
              function () {
                return null;
              }
            )
            .then(function (names) {
              known[remote.url] = { at: Date.now(), names: names };
              clearTimeout(schemeSave);
              schemeSave = setTimeout(function () {
                cache.put("schemes", known).catch(function () {});
              }, 1500);
              return names || [];
            });
        }
        return schemeRequests[remote.url];
      });
    });
  }

  var snippetStyles = {};
  function snippets() {
    return store.get("snippets", []);
  }
  function saveSnippets(list) {
    keep("snippets", list);
    applySnippets();
    events.emit("snippets", list);
  }
  var tested = {};
  function applySnippets() {
    var list = snippets().filter(function (s) {
      return !internal.safeMode || tested[s.id];
    });
    Object.keys(snippetStyles).forEach(function (id) {
      if (
        !list.some(function (s) {
          return s.id === id && s.enabled;
        })
      ) {
        snippetStyles[id].remove();
        delete snippetStyles[id];
      }
    });
    list.forEach(function (s) {
      if (!s.enabled) return;
      if (!snippetStyles[s.id]) snippetStyles[s.id] = addStyle("snippet:" + s.id, "snippet", "");
      snippetStyles[s.id].textContent = s.css;
    });
  }
  var Snippets = {
    list: snippets,
    save: function (snippet) {
      var list = snippets();
      var at = list.findIndex(function (s) {
        return s.id === snippet.id;
      });
      var next = Object.assign(
        { id: "s" + Date.now().toString(36), enabled: true, createdAt: Date.now() },
        at >= 0 ? list[at] : {},
        snippet,
        { updatedAt: Date.now() }
      );
      if (at >= 0) list[at] = next;
      else list.unshift(next);
      if (internal.safeMode) tested[next.id] = true;
      saveSnippets(list);
      return next;
    },
    toggle: function (id, enabled) {
      if (internal.safeMode) tested[id] = enabled;
      saveSnippets(
        snippets().map(function (s) {
          return s.id === id ? Object.assign({}, s, { enabled: enabled }) : s;
        })
      );
    },
    remove: function (id) {
      saveSnippets(
        snippets().filter(function (s) {
          return s.id !== id;
        })
      );
    },
  };

  var ACCOUNT_SERVER = "https://api.spotikit.com";
  var SIGN_IN_WAIT = 10 * 60 * 1000;

  function accountServer() {
    var custom = store.get("server", "");
    return String(custom || ACCOUNT_SERVER).replace(/\/+$/, "");
  }

  function base64Url(bytes) {
    var text = "";
    new Uint8Array(bytes).forEach(function (b) {
      text += String.fromCharCode(b);
    });
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function account() {
    return store.get("account", null);
  }

  function saveAccount(value) {
    if (JSON.stringify(value) === JSON.stringify(account())) return;
    keep("account", value);
    events.emit("account", value);
  }

  function call(path, options) {
    options = options || {};
    var server = accountServer();
    if (!server) return Promise.reject(new Error("SpotiKit accounts aren't available yet."));
    var headers = {};
    var current = account();
    if (current && current.token) headers.Authorization = "Bearer " + current.token;
    if (options.json !== undefined) headers["Content-Type"] = "application/json";
    return fetch(server + "/api" + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
      cache: "no-store",
    }).then(
      function (response) {
        return response.text().then(function (text) {
          var body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch (e) {
            body = null;
          }
          if (response.status === 401 && current && current.token) {
            saveAccount(null);
          }
          if (!response.ok) {
            var error = new Error((body && body.error) || "SpotiKit's server answered " + response.status + ".");
            error.status = response.status;
            throw error;
          }
          return body;
        });
      },
      function () {
        throw new Error("SpotiKit's server can't be reached right now.");
      }
    );
  }

  var configCache = null;
  var pendingSignIn = null;

  function pollSignIn() {
    var attempt = pendingSignIn;
    if (!attempt) return Promise.resolve(Account.user);
    if (attempt.polling) return attempt.polling;
    attempt.polling = call("/auth/poll", { method: "POST", json: { verifier: attempt.verifier } })
      .then(
        function (result) {
          if (pendingSignIn !== attempt) return Account.user;
          if (!result || !result.token) return null;
          pendingSignIn = null;
          saveAccount({ token: result.token, user: result.user });
          attempt.resolve(result.user);
          return result.user;
        },
        function (error) {
          if (pendingSignIn === attempt && error.status === 400) {
            pendingSignIn = null;
            events.emit("account", account());
            attempt.reject(error);
          }
          return null;
        }
      )
      .finally(function () {
        attempt.polling = null;
      });
    return attempt.polling;
  }

  function openOutside(url) {
    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  var Account = {
    get available() {
      return !!accountServer();
    },
    get server() {
      return accountServer();
    },
    get user() {
      var a = account();
      return a ? a.user : null;
    },
    get signingIn() {
      return !!pendingSignIn;
    },
    config: function () {
      if (!configCache) {
        configCache = call("/config").catch(function (e) {
          configCache = null;
          throw e;
        });
      }
      return configCache;
    },
    link: function (page) {
      return accountServer() + page;
    },
    siteLink: function (page) {
      return Account.config().then(function (config) {
        return (config.siteUrl || accountServer()) + page;
      });
    },
    signIn: function () {
      if (pendingSignIn) pendingSignIn.reject(new Error("Signing in started again."));
      var verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      return Promise.all([Account.config(), crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))]).then(
        function (parts) {
          var config = parts[0];
          if (!config.signIn) throw new Error("Signing in isn't set up on SpotiKit's server yet.");
          return new Promise(function (resolve, reject) {
            var ticker = null;
            var stop = function () {
              clearTimeout(timer);
              clearInterval(ticker);
              window.removeEventListener("focus", pollSignIn);
            };
            var timer = setTimeout(function () {
              if (pendingSignIn && pendingSignIn.verifier === verifier) {
                pendingSignIn = null;
                stop();
                events.emit("account", account());
                reject(new Error("Signing in took too long. Try again."));
              }
            }, SIGN_IN_WAIT);
            pendingSignIn = {
              verifier: verifier,
              resolve: function (user) {
                stop();
                resolve(user);
              },
              reject: function (error) {
                stop();
                reject(error);
              },
            };
            ticker = setInterval(pollSignIn, 2000);
            window.addEventListener("focus", pollSignIn);
            events.emit("account", account());
            openOutside(
              accountServer() +
                "/api/auth/discord/start?for=spotify&challenge=" +
                base64Url(parts[1]) +
                "&terms=" +
                encodeURIComponent(config.termsVersion)
            );
          });
        }
      );
    },
    finish: function (grant) {
      if (!pendingSignIn) {
        if (Account.user) return Promise.resolve(Account.user);
        return Promise.reject(new Error("This sign-in wasn't started here. Start it again from the Marketplace."));
      }
      return pollSignIn().then(function (user) {
        var attempt = pendingSignIn;
        if (user || !attempt || !grant) return user;
        pendingSignIn = null;
        return call("/auth/token", { method: "POST", json: { grant: grant, verifier: attempt.verifier } }).then(
          function (result) {
            saveAccount({ token: result.token, user: result.user });
            attempt.resolve(result.user);
            return result.user;
          },
          function (error) {
            events.emit("account", account());
            attempt.reject(error);
            throw error;
          }
        );
      });
    },
    cancelSignIn: function () {
      if (!pendingSignIn) return;
      var waiting = pendingSignIn;
      pendingSignIn = null;
      events.emit("account", account());
      waiting.reject(new Error("Signing in was cancelled."));
    },
    signOut: function () {
      var done = function () {
        saveAccount(null);
      };
      return call("/auth/logout", { method: "POST" }).then(done, done);
    },
    me: function () {
      return call("/me").then(function (me) {
        var current = account();
        if (current) saveAccount({ token: current.token, user: me.user });
        events.emit("notices", me.notices);
        return me;
      });
    },
    acceptTerms: function () {
      return call("/me/terms", { method: "POST" }).then(function (user) {
        var current = account();
        if (current) saveAccount({ token: current.token, user: user });
        return user;
      });
    },
    exportData: function () {
      return call("/me/export").then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "spotikit-account.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
          URL.revokeObjectURL(link.href);
        }, 5000);
      });
    },
    deleteAccount: function () {
      return call("/me", { method: "DELETE" }).then(function () {
        saveAccount(null);
        loadRatings(true);
      });
    },
    readNotice: function (id) {
      return call("/me/notices/" + id + "/read", { method: "POST" });
    },
    appeal: function (id, text) {
      return call("/me/notices/" + id + "/appeal", { method: "POST", json: { text: text } });
    },
    linkGithub: function () {
      return call("/me/github", { method: "POST" }).then(function (r) {
        openOutside(r.url);
      });
    },
    unlinkGithub: function () {
      return call("/me/github", { method: "DELETE" }).then(function () {
        return Account.me();
      });
    },
    report: function (type, id, reason, text, item) {
      if (!account()) {
        openOutside(
          accountServer() +
            "/report?type=" +
            encodeURIComponent(type) +
            "&id=" +
            encodeURIComponent(id) +
            (item ? "&name=" + encodeURIComponent(item.name || "") + "&kind=" + encodeURIComponent(item.kind || "") : "")
        );
        return Promise.resolve({ external: true });
      }
      return call("/reports", {
        method: "POST",
        json: {
          type: type,
          id: String(id),
          reason: reason,
          text: text,
          goodFaith: true,
          itemName: item ? item.name : undefined,
          itemKind: item ? item.kind : undefined,
        },
      });
    },
    openOutside: openOutside,
  };

  var ratingMap = null;
  var ratingsAt = 0;
  function loadRatings(force) {
    if (!accountServer()) return Promise.resolve(null);
    if (!force && ratingMap && Date.now() - ratingsAt < 10 * 60 * 1000) return Promise.resolve(ratingMap);
    ratingsAt = Date.now();
    return call("/ratings").then(
      function (result) {
        ratingMap = result.items || {};
        events.emit("rating", { all: true });
        return ratingMap;
      },
      function () {
        return ratingMap;
      }
    );
  }

  var githubRatings = {
    source: "github",
    label: "GitHub stars",
    canRate: false,
    summary: function (id) {
      var item = findItem(id);
      var stars = item && typeof item.stars === "number" && item.kind !== "snippet" ? item.stars : null;
      return { source: "github", stars: stars, url: item ? item.repoUrl || null : null };
    },
  };

  var reviewRatings = {
    source: "spotikit",
    label: "SpotiKit reviews",
    canRate: true,
    summary: function (id) {
      var entry = ratingMap && ratingMap[id];
      var github = githubRatings.summary(id);
      return {
        source: "spotikit",
        average: entry ? entry[0] : null,
        count: entry ? entry[1] : 0,
        stars: github.stars,
        url: github.url,
      };
    },
  };

  var Ratings = {
    get provider() {
      return accountServer() ? reviewRatings : githubRatings;
    },
    summary: function (id) {
      return Ratings.provider.summary(id);
    },
    load: loadRatings,
    score: function (id) {
      var entry = ratingMap && ratingMap[id];
      if (!entry) return 0;
      var weight = 3;
      return (entry[0] * entry[1] + 3.5 * weight) / (entry[1] + weight);
    },
    reviews: function (id, sort, cursor) {
      sort = sort === "new" ? "new" : "helpful";
      return call(
        "/reviews?item=" +
          encodeURIComponent(id) +
          "&sort=" +
          sort +
          (sort === "new" ? (cursor ? "&before=" + cursor : "") : "&page=" + (cursor || 0))
      );
    },
    versionOf: function (id) {
      var record = installed()[id];
      var item = (record && record.item) || findItem(id);
      if (item && item.version) return item.version;
      return record && record.version ? "#" + record.version.slice(0, 7) : null;
    },
    rate: function (id, stars, text) {
      return call("/reviews", {
        method: "PUT",
        json: { item: id, stars: stars, text: text || "", version: Ratings.versionOf(id) },
      }).then(function (review) {
        loadRatings(true);
        events.emit("rating", { id: id });
        return review;
      });
    },
    remove: function (id) {
      return call("/reviews?item=" + encodeURIComponent(id), { method: "DELETE" }).then(function () {
        loadRatings(true);
        events.emit("rating", { id: id });
      });
    },
    helpful: function (reviewId, on) {
      return call("/reviews/" + reviewId + "/helpful", { method: "POST", json: { helpful: !!on } });
    },
    reply: function (reviewId, text) {
      return call("/reviews/" + reviewId + "/reply", { method: "PUT", json: { text: text } }).then(function (review) {
        events.emit("rating", { id: review.item });
        return review;
      });
    },
    removeReply: function (reviewId, itemId) {
      return call("/reviews/" + reviewId + "/reply", { method: "DELETE" }).then(function () {
        events.emit("rating", itemId ? { id: itemId } : undefined);
      });
    },
  };

  var Shared = {
    list: function (sort, query, page) {
      return call(
        "/profiles?sort=" + (sort || "new") + "&page=" + (page || 0) + (query ? "&q=" + encodeURIComponent(query) : "")
      );
    },
    get: function (id) {
      return call("/profiles/" + encodeURIComponent(id));
    },
    mine: function () {
      return Account.me().then(function (me) {
        return me.profiles;
      });
    },
    itemsOf: function (localId) {
      var profile = profiles().find(function (p) {
        return p.id === localId;
      });
      if (!profile) return [];
      return Object.keys(profile.items)
        .filter(function (id) {
          return profile.items[id].enabled;
        })
        .map(function (id) {
          return { id: id, name: profile.items[id].name || id, scheme: profile.items[id].scheme || null };
        });
    },
    share: function (localId, name, description, remoteId) {
      var items = Shared.itemsOf(localId);
      var body = { name: name, description: description || "", items: items };
      return (
        remoteId
          ? call("/profiles/" + encodeURIComponent(remoteId), { method: "PUT", json: body })
          : call("/profiles", { method: "POST", json: body })
      ).then(function (shared) {
        var links = store.get("sharedProfiles", {});
        links[localId] = shared.id;
        store.set("sharedProfiles", links);
        events.emit("shared", shared);
        return shared;
      });
    },
    sharedIdOf: function (localId) {
      return store.get("sharedProfiles", {})[localId] || null;
    },
    remove: function (remoteId) {
      return call("/profiles/" + encodeURIComponent(remoteId), { method: "DELETE" }).then(function () {
        var links = store.get("sharedProfiles", {});
        Object.keys(links).forEach(function (k) {
          if (links[k] === remoteId) delete links[k];
        });
        store.set("sharedProfiles", links);
        events.emit("shared", null);
      });
    },
    link: function (remoteId) {
      return accountServer() + "/p/" + remoteId;
    },
    use: function (shared, onProgress) {
      var map = installed();
      var missing = shared.items.filter(function (i) {
        return !map[i.id];
      });
      var failed = [];
      var chain = Promise.resolve();
      missing.forEach(function (i, n) {
        chain = chain.then(function () {
          if (onProgress) onProgress(i, n, missing.length);
          if (!findItem(i.id)) {
            failed.push(i.name + " (not in the catalog)");
            return null;
          }
          return install(i.id, { scheme: i.scheme || undefined }).catch(function (e) {
            failed.push(i.name + ": " + e.message);
          });
        });
      });
      return chain.then(function () {
        var now = installed();
        var items = {};
        shared.items.forEach(function (i) {
          if (now[i.id]) items[i.id] = { enabled: true, scheme: i.scheme || now[i.id].scheme || null, name: i.name };
        });
        var list = profiles();
        var name = shared.name;
        var n = 2;
        while (
          list.some(function (p) {
            return p.name.toLowerCase() === name.toLowerCase();
          })
        ) {
          name = shared.name + " " + n++;
        }
        var profile = {
          id: "p" + Date.now().toString(36),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          name: name,
          items: items,
          snippets: {},
          theme: null,
          from: shared.id,
        };
        list.push(profile);
        saveProfiles(list);
        if (account())
          call("/profiles/" + encodeURIComponent(shared.id) + "/imported", { method: "POST" }).catch(function () {});
        return { profile: profile, failed: failed };
      });
    },
  };

  function setupNow() {
    var map = installed();
    var items = {};
    Object.keys(map).forEach(function (id) {
      items[id] = { enabled: !!map[id].enabled, scheme: map[id].scheme || null, name: map[id].item.name };
    });
    var own = {};
    snippets().forEach(function (s) {
      own[s.id] = !!s.enabled;
    });
    var theme = SpotiKit.Themes.current;
    return { items: items, snippets: own, theme: theme ? { theme: theme.theme, scheme: theme.scheme } : null };
  }

  function setupKey(setup) {
    var map = installed();
    var own = snippets();
    var on = [];
    Object.keys(setup.items).forEach(function (id) {
      var x = setup.items[id];
      if (x.enabled && map[id]) on.push(id + (map[id].kind === "theme" ? "|" + (x.scheme || "") : ""));
    });
    Object.keys(setup.snippets).forEach(function (id) {
      if (
        setup.snippets[id] &&
        own.some(function (s) {
          return s.id === id;
        })
      )
        on.push("snippet:" + id);
    });
    if (setup.theme) on.push("theme:" + setup.theme.theme + "|" + (setup.theme.scheme || ""));
    return on.sort().join(",");
  }

  function profiles() {
    return store.get("profiles", []);
  }

  function saveProfiles(list) {
    keep("profiles", list);
    events.emit("profiles", list);
  }

  function profileName(name, id) {
    name = String(name || "").trim();
    if (!name) throw new Error("A profile needs a name.");
    var taken = profiles().some(function (p) {
      return p.id !== id && p.name.toLowerCase() === name.toLowerCase();
    });
    if (taken) throw new Error("There's already a profile called " + name + ".");
    return name;
  }

  var applyingProfile = null;
  var Profiles = {
    list: function () {
      var now = setupKey(setupNow());
      return profiles().map(function (p) {
        return Object.assign({}, p, { active: setupKey(p) === now });
      });
    },
    save: function (name, id) {
      var list = profiles();
      var at = list.findIndex(function (p) {
        return p.id === id;
      });
      var profile = Object.assign(
        { id: "p" + Date.now().toString(36), createdAt: Date.now() },
        at >= 0 ? list[at] : {},
        setupNow(),
        { name: profileName(name || (at >= 0 && list[at].name), id), updatedAt: Date.now() }
      );
      if (at >= 0) list[at] = profile;
      else list.push(profile);
      saveProfiles(list);
      return profile;
    },
    rename: function (id, name) {
      var clean = profileName(name, id);
      saveProfiles(
        profiles().map(function (p) {
          return p.id === id ? Object.assign({}, p, { name: clean }) : p;
        })
      );
    },
    remove: function (id) {
      saveProfiles(
        profiles().filter(function (p) {
          return p.id !== id;
        })
      );
    },
    apply: function (id) {
      if (applyingProfile) return Promise.reject(new Error("A profile is already being switched to."));
      var profile = profiles().find(function (p) {
        return p.id === id;
      });
      if (!profile) return Promise.reject(new Error("There is no such profile."));
      var map = installed();
      var wants = function (k) {
        return !!(profile.items[k] && profile.items[k].enabled);
      };
      var missing = Object.keys(profile.items)
        .filter(function (k) {
          return profile.items[k].enabled && !map[k];
        })
        .map(function (k) {
          return profile.items[k].name || k;
        });
      var off = Object.keys(map).filter(function (k) {
        return map[k].enabled && !wants(k);
      });
      var turnOff = function () {
        var k =
          off.find(function (key) {
            return dependents(key).length === 0;
          }) || off[0];
        if (!k) return null;
        off.splice(off.indexOf(k), 1);
        return setEnabled(k, false).then(turnOff, turnOff);
      };
      var chain = Promise.resolve().then(turnOff);
      var needsOthers = function (k) {
        return map[k].item && map[k].item.dependencies ? 1 : 0;
      };
      Object.keys(map)
        .sort(function (a, b) {
          return needsOthers(a) - needsOthers(b);
        })
        .forEach(function (k) {
          if (!wants(k)) return;
          chain = chain.then(function () {
            var scheme = profile.items[k].scheme;
            return (installed()[k].enabled ? Promise.resolve() : setEnabled(k, true)).then(function () {
              return scheme && scheme !== installed()[k].scheme ? setScheme(k, scheme) : null;
            });
          });
        });
      chain = chain.then(function () {
        saveSnippets(
          snippets().map(function (s) {
            return Object.assign({}, s, { enabled: !!profile.snippets[s.id] });
          })
        );
        var marketTheme = Object.keys(map).some(function (k) {
          return wants(k) && map[k].kind === "theme";
        });
        if (profile.theme && !marketTheme) {
          return SpotiKit.Themes.apply(profile.theme.theme, profile.theme.scheme).catch(function () {
            missing.push(profile.theme.theme);
          });
        }
        if (!profile.theme && !marketTheme && SpotiKit.Themes.current) SpotiKit.Themes.reset();
        return null;
      });
      applyingProfile = id;
      return chain
        .then(function () {
          return { profile: profile, missing: missing };
        })
        .finally(function () {
          applyingProfile = null;
          events.emit("profiles", profiles());
        });
    },
  };

  var profileMenu = null;
  function buildProfileMenu() {
    var list = Profiles.list();
    if (!list.length) {
      if (profileMenu) profileMenu.remove();
      profileMenu = null;
      return;
    }
    var items = list
      .map(function (p) {
        return {
          label: p.name,
          checked: p.active,
          onSelect: function () {
            Profiles.apply(p.id).then(
              function (result) {
                SpotiKit.notify(
                  result.missing.length
                    ? p.name + " is on. Not installed anymore: " + result.missing.join(", ")
                    : p.name + " is on"
                );
              },
              function (e) {
                SpotiKit.notify(e.message, { type: "error", duration: 7000 });
              }
            );
          },
        };
      })
      .concat({
        label: "Manage profiles",
        divider: "before",
        onSelect: function () {
          SpotiKit.Storage.scope("marketplace").set("tab", "installed");
          SpotiKit.Navigation.go("/marketplace");
        },
      });
    if (profileMenu) profileMenu.update({ items: items });
    else profileMenu = SpotiKit.ProfileMenu.add({ label: "Setup profile", icon: "equalizer", items: items });
  }
  internal.signals.platform.on(function () {
    buildProfileMenu();
    ["profiles", "installed", "snippets"].forEach(function (type) {
      events.on(type, buildProfileMenu);
    });
    SpotiKit.Themes.on("change", buildProfileMenu);
  });

  var schemeMenu = null;
  var schemeRun = 0;
  function enabledTheme() {
    var map = installed();
    return (
      Object.keys(map).find(function (k) {
        return map[k].kind === "theme" && map[k].enabled;
      }) || null
    );
  }
  internal.paletteTarget = function () {
    var id = enabledTheme();
    return id ? { id: "market:" + id, name: installed()[id].item.name } : null;
  };
  events.on("installed", function () {
    if (internal.palettes) internal.palettes.refresh();
  });

  function activeSchemes() {
    var map = installed();
    var id = enabledTheme();
    if (id) {
      return schemesOf(id).then(function (names) {
        var now = installed()[id];
        var current = now && now.scheme && names.indexOf(now.scheme) >= 0 ? now.scheme : names[0];
        return names.map(function (name) {
          return {
            label: name,
            checked: name === current,
            pick: function () {
              return setScheme(id, name);
            },
          };
        });
      });
    }
    var local = SpotiKit.Themes.current;
    if (!local) return Promise.resolve([]);
    return SpotiKit.Themes.list().then(function (list) {
      var theme = list.find(function (t) {
        return t.id === local.theme;
      });
      if (!theme) return [];
      return theme.schemes.map(function (s, i) {
        return {
          label: s.name,
          checked: local.scheme ? s.id === local.scheme : i === 0,
          pick: function () {
            return SpotiKit.Themes.apply(theme.id, s.id);
          },
        };
      });
    });
  }
  function buildSchemeMenu() {
    var run = ++schemeRun;
    activeSchemes()
      .catch(function () {
        return [];
      })
      .then(function (schemes) {
        if (run !== schemeRun) return;
        var P = SpotiKit.Palettes;
        var palettes = P ? P.list() : [];
        var activePalette = P ? P.active : null;
        var fail = function (e) {
          SpotiKit.notify(e.message, { type: "error", duration: 7000 });
        };
        var items = schemes.map(function (s) {
          return {
            label: s.label,
            checked: s.checked && !activePalette,
            onSelect: function () {
              Promise.resolve()
                .then(function () {
                  if (P) P.use(null);
                  return s.pick();
                })
                .then(buildSchemeMenu, fail);
            },
          };
        });
        palettes.forEach(function (p, i) {
          items.push({
            label: p.name,
            icon: "edit",
            checked: p.id === activePalette,
            divider: i === 0 && schemes.length ? "before" : undefined,
            onSelect: function () {
              try {
                P.use(p.id);
                buildSchemeMenu();
              } catch (e) {
                fail(e);
              }
            },
          });
        });
        var editor = internal.openPaletteEditor;
        if (P && editor) {
          items.push({
            label: "New palette…",
            icon: "plus",
            divider: items.length ? "before" : undefined,
            onSelect: function () {
              editor(null);
            },
          });
          if (activePalette)
            items.push({
              label: "Edit palette…",
              icon: "edit",
              onSelect: function () {
                editor(activePalette);
              },
            });
        }
        if (!items.length) {
          if (schemeMenu) schemeMenu.remove();
          schemeMenu = null;
          return;
        }
        if (schemeMenu) schemeMenu.update({ items: items });
        else schemeMenu = SpotiKit.ProfileMenu.add({ label: "Color scheme", icon: "edit-image", items: items });
      });
  }
  internal.signals.platform.on(function () {
    buildSchemeMenu();
    events.on("installed", buildSchemeMenu);
    SpotiKit.Themes.on("change", buildSchemeMenu);
    if (SpotiKit.Palettes) SpotiKit.Palettes.on("change", buildSchemeMenu);
  });
  internal.rebuildSchemeMenu = buildSchemeMenu;

  var BOOT_KEY = "boot";
  var skipped = false;
  function dropForeignItems() {
    var map = installed();
    var gone = Object.keys(map).filter(function (id) {
      return !map[id].item || map[id].item.origin !== "spotikit";
    });
    if (!gone.length) return;
    var names = gone.map(function (id) {
      return map[id].item ? map[id].item.name : id;
    });
    var theme = gone
      .map(function (id) {
        return map[id];
      })
      .find(function (record) {
        return record.kind === "theme" && record.enabled;
      });
    gone.forEach(function (id) {
      delete map[id];
      files.remove(id, "current").catch(function () {});
      files.remove(id, "previous").catch(function () {});
    });
    saveInstalled(map);
    if (theme) releaseThemeSlot(theme);
    var list = profiles();
    var pruned = false;
    list.forEach(function (profile) {
      Object.keys(profile.items || {}).forEach(function (id) {
        if (gone.indexOf(id) >= 0 || id.indexOf("spicetify/") === 0) {
          delete profile.items[id];
          pruned = true;
        }
      });
    });
    if (pruned) saveProfiles(list);
    store.remove("spicetify");
    internal
      .waitFor(function () {
        return internal.findSnackbar();
      })
      .then(
        function () {
          SpotiKit.notify(
            names.join(", ") +
              (names.length === 1 ? " was" : " were") +
              " removed. The Marketplace only has themes, extensions, apps and snippets made for SpotiKit now.",
            { duration: 12000 }
          );
        },
        function () {}
      );
  }

  function startInstalled() {
    dropForeignItems();
    applySnippets();
    if (internal.safeMode) {
      internal
        .waitFor(function () {
          return internal.findSnackbar();
        })
        .then(
          function () {
            SpotiKit.notify(
              "Safe mode: extensions, apps, themes and snippets were not started. Leave it from the profile menu.",
              {
                duration: 9000,
              }
            );
          },
          function () {}
        );
      return Promise.resolve();
    }
    enforceBlocklist();
    setTimeout(refreshBlocklist, 3000);
    setInterval(refreshBlocklist, 30 * 60 * 1000);
    var map = installed();
    var ids = Object.keys(map).filter(function (id) {
      return map[id].enabled;
    });
    if (!ids.length) return Promise.resolve();
    var boot = store.get(BOOT_KEY, { pending: 0 });
    if (boot.pending >= 2) {
      skipped = true;
      store.set(BOOT_KEY, { pending: 0 });
      events.emit("skipped", true);
      internal
        .waitFor(function () {
          return internal.findSnackbar();
        })
        .then(
          function () {
            SpotiKit.notify("Marketplace content was skipped: Spotify didn't finish starting the last two times.", {
              type: "error",
              duration: 9000,
            });
          },
          function () {}
        );
      return Promise.resolve();
    }
    store.set(BOOT_KEY, { pending: boot.pending + 1 });
    setTimeout(function () {
      store.set(BOOT_KEY, { pending: 0 });
    }, 15000);
    var paused = [];
    ids = ids.filter(function (id) {
      if (runsHere(map[id])) {
        if (map[id].paused) updateRecord(id, { paused: null });
        return true;
      }
      if (map[id].paused !== spotifyVersion()) paused.push(map[id].item.name);
      updateRecord(id, { paused: spotifyVersion() });
      return false;
    });
    if (paused.length) {
      internal
        .waitFor(function () {
          return internal.findSnackbar();
        })
        .then(
          function () {
            SpotiKit.notify(
              paused.join(", ") +
                (paused.length === 1 ? " is" : " are") +
                " paused: not made for Spotify " +
                spotifyVersion() +
                ". You can run " +
                (paused.length === 1 ? "it" : "them") +
                " anyway in the Marketplace.",
              { duration: 9000 }
            );
          },
          function () {}
        );
    }
    return Promise.all(
      ids.map(function (id) {
        return files.get(id, "current").then(
          function (stored) {
            if (stored && map[id].error) updateRecord(id, { error: null });
            if (stored) activate(id, map[id], stored.files);
            else updateRecord(id, { error: "Its files are missing from storage. Reinstall it." });
          },
          function (error) {
            updateRecord(id, { error: "Couldn't read its files: " + error });
          }
        );
      })
    );
  }

  internal.signals.platform.on(function () {
    if (internal.safeMode) {
      SpotiKit.ProfileMenu.add({ label: "Leave safe mode", icon: "refresh", onSelect: SpotiKit.leaveSafeMode });
    }
    restored.then(function () {
      loadRatings(false);
      if (account()) Account.me().catch(function () {});
    });
    restored.then(startInstalled).catch(function (e) {
      internal.log.error("Marketplace content failed to start", e);
    });
  });

  SpotiKit.Marketplace = {
    topics: Object.assign({}, SPOTIKIT_TOPICS),
    get catalog() {
      return catalog;
    },
    refresh: refresh,
    installed: installed,
    install: install,
    load: loadRepo,
    uninstall: uninstall,
    setEnabled: setEnabled,
    rollback: rollback,
    checkUpdate: checkUpdate,
    pendingUpdates: pendingUpdates,
    rollbackTarget: rollbackTarget,
    updates: availableUpdates,
    checkUpdates: checkUpdates,
    updateAll: updateAll,
    putOffUpdates: putOffUpdates,
    setAutoUpdate: setAutoUpdate,
    get updatePrompt() {
      return store.get("updatePrompt", true) !== false;
    },
    setUpdatePrompt: function (on) {
      store.set("updatePrompt", !!on);
      events.emit("settings", { updatePrompt: !!on });
    },
    changes: changes,
    setScheme: setScheme,
    runAnyway: runAnyway,
    startNow: startNow,
    get safeMode() {
      return !!internal.safeMode;
    },
    leaveSafeMode: SpotiKit.leaveSafeMode,
    schemes: schemesOf,
    snippets: Snippets,
    profiles: Profiles,
    ratings: Ratings,
    account: Account,
    shared: Shared,
    get pendingReload() {
      return Object.assign({}, pendingReload);
    },
    get skipped() {
      return skipped;
    },
    on: function (type, listener) {
      return events.on(type, listener);
    },
  };
  internal.marketplace = {
    freeThemeSlot: function () {
      var map = installed();
      var changed = false;
      Object.keys(map).forEach(function (id) {
        if (map[id].kind !== "theme" || !map[id].enabled) return;
        if (deactivate(id)) markReload(id, "turned off");
        map[id].enabled = false;
        delete map[id].previousNativeTheme;
        changed = true;
      });
      if (changed) saveInstalled(map);
    },
    markReload: markReload,
    clearReload: clearReload,
    resolve: resolveDependency,
    busy: function () {
      return Object.assign({}, busy);
    },
    isRunning: function (id) {
      return !!running[id];
    },
    isPaused: function (id) {
      var record = installed()[id];
      return !!(record && record.enabled && !runsHere(record));
    },
    isBlocked: function (id) {
      return !!(running[id] && running[id].blocked);
    },
  };
})(window.SpotiKit);
