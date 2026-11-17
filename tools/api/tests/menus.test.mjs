import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const menus = readFileSync(new URL('../../../Framework/api/07-menus.js', import.meta.url), 'utf8');

function runtime() {
  const errors = [];
  const notifications = [];
  const menu = { props: { uri: 'spotify:track:fixture', uid: 'row', contextUri: 'spotify:playlist:fixture' }, trigger: 'contextmenu' };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    createContext: () => ({}),
    useReducer: () => [0, () => {}],
    useEffect: () => {},
    useContext: () => menu,
  };
  const SpotiKit = {
    React,
    Components: { MenuItem: 'menu-item' },
    Icons: { has: () => false },
    Platform: {},
    notify: (message, options) => notifications.push({ message, options }),
    _internal: {
      platformReady: new Promise(() => {}),
      trackRemove: value => value,
      log: { info: () => {}, warn: () => {}, error: (...args) => errors.push(args) },
    },
  };
  const context = vm.createContext({
    window: { SpotiKit },
    document: { createElement: () => ({}), head: { insertBefore: () => {} } },
    HTMLElement: class {},
    customElements: { get: () => undefined, define: () => {} },
  });
  vm.runInContext(menus, context);
  const click = (entry, event = {}) => {
    const element = entry._element();
    return element.type(element.props).props.onClick(event);
  };
  return { SpotiKit, errors, notifications, click, menu };
}

test('a rejected native extension menu action is handled and reports one visible error', async () => {
  const r = runtime();
  const failure = new Error('data source unavailable');
  const entry = r.SpotiKit.ContextMenu.add({ label: 'View Song Stats', onSelect: async () => { throw failure; } });
  await r.click(entry);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0][1], failure);
  assert.equal(r.notifications.length, 1);
  assert.equal(r.notifications[0].message, "View Song Stats couldn't finish. Try again later.");
  assert.equal(r.notifications[0].options.type, 'error');
});

test('a synchronous menu action failure also reports an error without escaping into Spotify', () => {
  const r = runtime();
  const entry = r.SpotiKit.ContextMenu.add({ label: 'Broken action', onSelect: () => { throw new Error('broken'); } });
  assert.doesNotThrow(() => r.click(entry));
  assert.equal(r.errors.length, 1);
  assert.equal(r.notifications.length, 1);
});

test('successful actions retain their target, event and asynchronous result', async () => {
  const r = runtime();
  const event = {};
  const entry = r.SpotiKit.ContextMenu.add({ label: 'Working action', onSelect: async (target, clicked) => {
    assert.equal(target.uri, r.menu.props.uri);
    assert.equal(clicked, event);
    return 'opened';
  } });
  assert.equal(await r.click(entry, event), 'opened');
  assert.equal(r.notifications.length, 0);
  assert.equal(r.errors.length, 0);
});

test('native profile menu actions receive their entry and surface asynchronous failures', async () => {
  const r = runtime();
  const event = {};
  const failure = new Error('profile failed');
  const entry = r.SpotiKit.ProfileMenu.add({ label: 'Profile action', onSelect: async (self, clicked) => {
    assert.equal(self, entry);
    assert.equal(clicked, event);
    throw failure;
  } });
  await r.click(entry, event);
  assert.equal(r.errors[0][1], failure);
  assert.equal(r.notifications.length, 1);
});

test('successful native profile actions retain their asynchronous result', async () => {
  const r = runtime();
  const entry = r.SpotiKit.ProfileMenu.add({ label: 'Profile action', onSelect: async () => 'opened' });
  assert.equal(await r.click(entry), 'opened');
  assert.equal(r.errors.length, 0);
  assert.equal(r.notifications.length, 0);
});

test('non-text menu labels use a readable fallback when an action fails', async () => {
  const r = runtime();
  const entry = r.SpotiKit.ContextMenu.add({ label: { type: 'span' }, onSelect: async () => { throw new Error('failed'); } });
  await r.click(entry);
  assert.match(r.notifications[0].message, /^Extension action /);
});
