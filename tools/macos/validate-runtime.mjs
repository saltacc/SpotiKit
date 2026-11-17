// Node 22+; Spotify must have been launched with --remote-debugging-port=9229.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(option('--output', 'bin/macos-implementation/runtime.json'));
const port = Number(option('--port', '9229'));
const exercise = args.includes('--exercise');
const lifecycle = args.includes('--lifecycle');
const pagesCheck = args.includes('--pages');
const playback = args.includes('--playback');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid debugging port.');
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = pages.find(page => page.type === 'page' && page.url.includes('xpui'));
if (!target) throw new Error('Spotify is not listening on the selected local debugging port.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let next = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  const entry = pending.get(message.id);
  if (!entry) return;
  clearTimeout(entry.timeout);
  pending.delete(message.id);
  message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
});
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
function probe() {
  const sk = window.SpotiKit;
  if (!sk) return { loaded: false };
  function control(selector) {
    const element = document.querySelector(selector);
    if (!element) return { count: 0, visible: false, clickable: false };
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { count: document.querySelectorAll(selector).length, visible: rect.width > 0 && rect.height > 0,
      clickable: hit === element || element.contains(hit), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const selectors = ['.global-nav-bar', '.main-view-panel', '.now-playing-bar-area', '.global-nav-bar-actions', '.entity-header'];
  return {
    loaded: true, version: sk.version, support: sk.Diagnostics?.themeSupport(),
    bindings: { React: !!sk.React, ReactDOM: !!sk.ReactDOM, Platform: !!sk.Platform,
      playerEvents: typeof sk.Player?.on === 'function', queue: !!sk.Queue },
    selectors: Object.fromEntries(selectors.map(selector => [selector, document.querySelectorAll(selector).length])),
    controls: { marketplace: control('[data-mp-button]'), settings: control('#liquify-settings-gear-btn') },
    themes: Object.entries(sk.Marketplace.installed()).filter(([, record]) => record.kind === 'theme')
      .map(([id, record]) => ({ id, enabled: record.enabled, error: record.error || null })),
    styles: Array.from(document.querySelectorAll('.spotikit-marketplace-style')).map(style => ({ item: style.dataset.item,
      length: style.textContent.length })),
    nativeControlsPreserved: !document.querySelector('.spotikit-window-controls'),
    playerStyle: (() => { const player = document.querySelector('.now-playing-bar-area'); if (!player) return null;
      const style = getComputedStyle(player); return { borderRadius: style.borderRadius, backdropFilter: style.backdropFilter,
        backgroundColor: style.backgroundColor }; })(),
  };
}
try {
  const deadline = Date.now() + 30000;
  let report;
  do {
    report = await evaluate(`(${probe.toString()})()`);
    if (report.loaded && report.controls.settings.visible) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  if (exercise && report.loaded) {
    report.navigation = await evaluate(`(async function () {
      var original = SpotiKit.Navigation.path;
      var delay = function () { return new Promise(resolve => setTimeout(resolve, 700)); };
      var result = {};
      try {
        SpotiKit.Navigation.go('/'); await delay();
        document.querySelector('[data-mp-button]').click(); await delay();
        result.marketplaceOpened = SpotiKit.Navigation.path === '/marketplace' &&
          Array.from(document.querySelectorAll('h1')).some(el => /Marketplace/.test(el.textContent));
        SpotiKit.Navigation.go('/'); await delay();
        document.querySelector('[data-mp-button]').click(); await delay();
        result.marketplaceReopened = SpotiKit.Navigation.path === '/marketplace';
        result.uniqueMarketplace = document.querySelectorAll('[data-mp-button]').length === 1;
        document.querySelector('#liquify-settings-gear-btn').click(); await delay();
        result.settingsOpened = !!document.querySelector('#liquify-settings-react-overlay .liquifySettingsPanel');
        document.querySelector('#liquify-settings-react-overlay')?.click(); await delay();
        result.settingsClosed = !document.querySelector('#liquify-settings-react-overlay');
      } finally { SpotiKit.Navigation.go(original); }
      return result;
    })()`);
  }
  if (pagesCheck && report.loaded) {
    report.pages = await evaluate(`(async function () {
      var original = SpotiKit.Navigation.path;
      var metadata = SpotiKit.Player.track?.metadata || {};
      var route = function (uri, kind) { return typeof uri === 'string' && uri.startsWith('spotify:' + kind + ':')
        ? '/' + kind + '/' + uri.split(':')[2] : null; };
      var pages = [['home', '/'], ['playlist', '/collection/tracks'], ['search', '/search/music'],
        ['album', route(metadata.album_uri, 'album')], ['artist', route(metadata.artist_uri, 'artist')], ['lyrics', '/lyrics']];
      var results = [];
      try {
        for (var page of pages) {
          if (!page[1]) { results.push({ page: page[0], skipped: 'No current-track URI available' }); continue; }
          SpotiKit.Navigation.go(page[1]);
          await new Promise(resolve => setTimeout(resolve, 1300));
          results.push({ page: page[0], coreLayoutReady: SpotiKit.Diagnostics.themeSupport().ready,
            entityHeaders: document.querySelectorAll('.entity-header').length,
            trackRows: document.querySelectorAll('.track-list-row').length,
            settings: document.querySelectorAll('#liquify-settings-gear-btn').length,
            marketplace: document.querySelectorAll('[data-mp-button]').length,
            errorScreen: !!document.querySelector('[data-testid="error-screen"]') });
        }
      } finally { SpotiKit.Navigation.go(original); }
      return results;
    })()`);
  }
  if (lifecycle && report.loaded) {
    report.lifecycle = await evaluate(`(async function () {
      var id = 'nmwplays/liquify/liquify';
      var enabled = SpotiKit.Marketplace.installed()[id]?.enabled;
      if (!enabled) throw new Error('Lifecycle validation requires enabled Liquify.');
      var settings = function () { return JSON.stringify(Object.keys(localStorage).filter(key => /liquify/i.test(key))
        .sort().map(key => [key, localStorage.getItem(key)])); };
      var before = settings();
      var wait = function (ms) { return new Promise(resolve => setTimeout(resolve, ms)); };
      var result = {};
      try {
        await SpotiKit.Marketplace.setEnabled(id, false); await wait(1200);
        result.disabled = document.querySelectorAll('#liquify-settings-gear-btn').length === 0 &&
          !document.querySelector('.spotikit-marketplace-style[data-item="' + id + '"]');
        await SpotiKit.Marketplace.setEnabled(id, true);
        var deadline = Date.now() + 20000;
        while (!document.querySelector('#liquify-settings-gear-btn') && Date.now() < deadline) await wait(250);
        await wait(1000);
        result.reenabled = document.querySelectorAll('#liquify-settings-gear-btn').length === 1 &&
          document.querySelectorAll('.spotikit-marketplace-style[data-item="' + id + '"]').length === 1;
        result.settingsPreserved = settings() === before;
        result.coreLayoutReady = SpotiKit.Diagnostics.themeSupport().ready;
      } finally {
        if (!SpotiKit.Marketplace.installed()[id]?.enabled) await SpotiKit.Marketplace.setEnabled(id, true);
      }
      return result;
    })()`);
  }
  if (report.loaded) {
    report.mappings = await evaluate(`(function () {
      var entries = Object.entries(SpotiKit.classMap).filter(pair => document.querySelector('.' + CSS.escape(pair[1])));
      if (!entries.length) return { tested: 0, translated: false, rendered: false };
      var pair = entries[0];
      var element = document.querySelector('.' + CSS.escape(pair[1]));
      var style = document.createElement('style');
      style.textContent = '.' + CSS.escape(pair[1]) + '{--spotikit-mapping-probe:verified}';
      document.head.appendChild(style);
      try { return { tested: entries.length, from: pair[0], to: pair[1],
        translated: document.querySelector('.' + CSS.escape(pair[0])) === element,
        rendered: getComputedStyle(element).getPropertyValue('--spotikit-mapping-probe').trim() === 'verified' };
      } finally { style.remove(); }
    })()`);
  }
  if (playback && report.loaded) {
    report.playback = await evaluate(`(async function () {
      var player = SpotiKit.Player, queue = SpotiKit.Queue;
      if (!player.track || !player.state.isPaused || !queue.next.length)
        throw new Error('Playback validation requires a paused track and a nonempty queue.');
      var original = { uri: player.track.uri, position: player.position, volume: player.volume,
        context: player.state.context?.uri, queue: queue.next.slice(0, 5).map(entry => entry.uri) };
      var tracks = 0, queues = 0;
      var offTrack = player.on('track', function () { tracks++; });
      var offQueue = queue.on('change', function () { queues++; });
      var wait = function (ms) { return new Promise(resolve => setTimeout(resolve, ms)); };
      var until = async function (condition) { var end = Date.now() + 7000;
        while (!condition() && Date.now() < end) await wait(100); return !!condition(); };
      var result = {};
      try {
        await player.setVolume(0);
        await player.next();
        result.trackChanged = await until(function () { return player.track?.uri !== original.uri; });
        await player.pause(); await wait(800);
        result.hasArtworkAfterChange = !!player.track?.metadata?.image_url;
        result.playerEvent = tracks > 0;
        result.queueEvent = queues > 0;
        await player.previous();
        await until(function () { return player.track?.uri === original.uri; });
      } finally {
        if (player.track?.uri !== original.uri) await player.playUri(original.uri, { context: original.context });
        await player.pause(); await player.seek(original.position); await player.setVolume(original.volume);
        await wait(300);
        offTrack(); offQueue();
        result.restoredTrack = player.track?.uri === original.uri;
        result.restoredPause = player.state?.isPaused === true;
        result.restoredPosition = Math.abs(player.position - original.position) < 1000;
        result.restoredVolume = Math.abs(player.volume - original.volume) < 0.01;
        result.restoredQueue = JSON.stringify(queue.next.slice(0, 5).map(entry => entry.uri)) === JSON.stringify(original.queue);
      }
      return result;
    })()`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  if (args.includes('--screenshot')) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(output.replace(/\.json$/, '') + '.png', Buffer.from(screenshot.data, 'base64'));
  }
  const passed = report.support?.ready && report.bindings.React && report.bindings.Platform &&
    report.controls.marketplace.visible && report.controls.settings.visible && report.nativeControlsPreserved &&
    report.controls.marketplace.clickable && report.controls.settings.clickable &&
    (!exercise || Object.values(report.navigation).every(Boolean)) &&
    (!lifecycle || Object.values(report.lifecycle).every(Boolean)) &&
    (!playback || Object.values(report.playback).every(Boolean)) &&
    (!pagesCheck || report.pages.every(page => page.skipped || page.coreLayoutReady && page.settings === 1 && page.marketplace === 1 && !page.errorScreen)) &&
    report.mappings?.translated && report.mappings?.rendered;
  console.log(JSON.stringify({ passed: !!passed, output, profile: report.support?.profile, missing: report.support?.missing,
    controls: report.controls, navigation: report.navigation, pages: report.pages, lifecycle: report.lifecycle,
    mappings: report.mappings, playback: report.playback }, null, 2));
  process.exitCode = passed ? 0 : 1;
} finally { socket.close(); }
