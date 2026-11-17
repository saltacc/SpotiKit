import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../Framework/api/08-bars.js', import.meta.url), 'utf8');

class Element {
  constructor(classes = '') {
    this.className = classes;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
  }
  get classList() { return this.className.split(' ').filter(Boolean); }
  get parentElement() { return this.parentNode; }
  get previousSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) - 1]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener() {}
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  appendChild(child) { this.append(child); }
  append(...children) {
    children.forEach(child => { child.remove(); child.parentNode = this; this.children.push(child); });
  }
  prepend(...children) {
    children.slice().reverse().forEach(child => { child.remove(); child.parentNode = this; this.children.unshift(child); });
  }
  after(child) {
    child.remove();
    child.parentNode = this.parentNode;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this) + 1, 0, child);
  }
  querySelector() { return null; }
}

function runtime(matches) {
  const SpotiKit = {
    Icons: { has: () => false },
    Tooltip: { attach: () => ({ setContent() {}, hide() {} }) },
    _internal: { trackRemove: value => value },
  };
  vm.runInNewContext(source, {
    window: { SpotiKit },
    document: {
      createElement: () => new Element(), documentElement: new Element(),
      querySelector: selector => matches.get(selector)?.[0] || null,
      querySelectorAll: selector => matches.get(selector) || [],
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame: fn => fn(),
  });
  return SpotiKit;
}

test('player buttons keep upstream lyric-button styling when stable selectors match', () => {
  const container = new Element();
  const lyrics = new Element('lyrics-button upstream-style');
  const queue = new Element('queue-style');
  container.append(lyrics, queue);
  const sk = runtime(new Map([
    ['.now-playing-bar-extra-controls', [container]],
    ['.now-playing-bar-extra-controls button.lyrics-button:not(.now-playing-bar-extra-button)', [lyrics]],
    ['[data-testid="control-button-queue"]', [queue]],
  ]));
  const button = sk.Playbar.add({ label: 'Extension' });
  assert.equal(button.element.className, 'lyrics-button upstream-style');
  assert.equal(container.children[0], button.element);
});

test('player buttons use the native Mac queue anchor when mapped selectors are absent', () => {
  const container = new Element();
  const queue = new Element('native-queue-button native-queue-button--active');
  container.append(queue);
  const sk = runtime(new Map([['[data-testid="control-button-queue"]', [queue]]]));
  const button = sk.Playbar.add({ label: 'Extension' });
  assert.equal(button.element.parentNode, container);
  assert.equal(button.element.className, 'native-queue-button');
  assert.equal(container.children[0], button.element);
});

test('navigation buttons stay after the native home anchor when stable classes are absent', () => {
  const container = new Element();
  const home = new Element('native-home');
  const search = new Element('native-search');
  container.append(home, search);
  const sk = runtime(new Map([['[data-testid="home-button"]', [home]]]));
  const button = new sk._internal.BarButton('nav', { label: 'Extension' }).show();
  assert.equal(button.element.className, 'native-home');
  assert.deepEqual(container.children, [home, button.element, search]);
});

test('toolbar styling excludes previously mounted extension buttons', () => {
  const container = new Element();
  const extension = new Element('extension-style');
  extension.setAttribute('data-spotikit', 'topbarLeft');
  const back = new Element('native-back');
  container.append(extension, back);
  const sk = runtime(new Map([
    ['.global-nav-bar-history-buttons', [container]],
    ['.global-nav-bar-history-buttons button', [extension, back]],
  ]));
  const button = sk.Topbar.add({ label: 'Marketplace' });
  assert.equal(button.element.className, 'native-back');
  assert.equal(container.children.at(-1), button.element);
});

test('extension buttons wait without throwing when their native anchors are unavailable', () => {
  const sk = runtime(new Map());
  const button = sk.Playbar.add({ label: 'Extension' });
  assert.equal(button.element.parentNode, undefined);
  assert.equal(button.element.className, '');
});
