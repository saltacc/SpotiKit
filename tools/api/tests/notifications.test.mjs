import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const utilities = readFileSync(new URL('../../../Framework/api/05-utilities.js', import.meta.url), 'utf8');

function runtime(mounted = true) {
  const visible = [];
  const closed = [];
  const provider = {
    enqueueSnackbar(message, options) {
      // Match the native provider's registered content variants on the tested Mac build.
      if (['default', 'headless'].includes(options.variant)) visible.push({ message, options });
      return 'own-notification';
    },
    closeSnackbar: key => closed.push(key),
  };
  const SpotiKit = {
    Platform: {}, Libraries: {},
    _internal: {
      signals: { modules: { on: () => {} } },
      lazy: (target, name, get) => Object.defineProperty(target, name, { get }),
      findContextValue: test => mounted && test(provider) ? provider : null,
      log: { warn: () => {} },
    },
  };
  vm.runInNewContext(utilities, { window: { SpotiKit } });
  return { SpotiKit, visible, closed };
}

test('error messages render with Spotify registered content and close only their own notification', () => {
  const r = runtime();
  const notice = r.SpotiKit.notify('View Song Stats failed', { type: 'error', duration: 6000 });
  assert.equal(r.visible.length, 1);
  assert.equal(r.visible[0].message, 'View Song Stats failed');
  assert.equal(r.visible[0].options.autoHideDuration, 6000);
  notice.close();
  assert.deepEqual(r.closed, ['own-notification']);
});

test('persistent notifications retain their lifetime', () => {
  const r = runtime();
  r.SpotiKit.notify('Waiting for a response', { duration: Infinity });
  assert.equal(r.visible.length, 1);
  assert.equal(r.visible[0].options.persist, true);
});

test('notifications before the native provider mounts have a safe close handle', () => {
  const r = runtime(false);
  assert.doesNotThrow(() => r.SpotiKit.notify('Early notification').close());
  assert.equal(r.visible.length, 0);
});
