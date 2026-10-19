const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/background/background.js', 'utf8');

function setup({ saved, deferredRead = false, delayFirstText = false, failFirstTitle = false } = {}) {
  const listeners = {};
  const reads = [];
  const state = {};
  const warnings = [];
  let releaseText;
  let firstText = true;
  let firstTitle = true;
  const event = name => ({ addListener(callback) { listeners[name] = callback; } });
  const chrome = {
    runtime: { onStartup: event('startup'), onInstalled: event('installed') },
    storage: {
      sync: { get(defaults, callback) {
        const complete = () => callback(saved === undefined ? defaults : { autoPlayEnabled: saved });
        reads.push(complete);
        if (!deferredRead) complete();
      } },
      onChanged: event('changed'),
    },
    action: {
      async setBadgeBackgroundColor({ color }) { state.background = color; },
      async setBadgeTextColor({ color }) { state.foreground = color; },
      async setBadgeText({ text }) {
        if (firstText && delayFirstText) {
          firstText = false;
          await new Promise(resolve => { releaseText = resolve; });
        }
        state.text = text;
      },
      async setTitle({ title }) {
        if (firstTitle && failFirstTitle) { firstTitle = false; throw new Error('simulated action failure'); }
        state.title = title;
      },
    },
  };
  vm.runInNewContext(source, { chrome, console: { warn: message => warnings.push(message) } });
  return {
    chrome, state, listeners, reads, warnings,
    changed(value, area = 'sync', key = 'autoPlayEnabled') { listeners.changed({ [key]: { newValue: value } }, area); },
    releaseText() { releaseText(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('toolbar defaults to the normal icon with no badge and an OFF title', async () => {
  const h = setup(); await h.settle();
  assert.equal(h.state.text, ''); assert.match(h.state.title, /Auto Read Aloud OFF$/);
});

test('saved ON preference restores the highlighted badge on a fresh worker and browser startup', async () => {
  const h = setup({ saved: true }); await h.settle();
  assert.equal(h.state.text, 'ON'); assert.equal(h.state.background, '#15803D'); assert.equal(h.state.foreground, '#FFFFFF');
  h.state.text = ''; h.listeners.startup(); await h.settle();
  assert.equal(h.state.text, 'ON'); assert.match(h.state.title, /Auto Read Aloud ON$/);
  const restarted = setup({ saved: true }); await restarted.settle(); assert.equal(restarted.state.text, 'ON');
});

test('install/update restores the saved preference', async () => {
  const h = setup({ saved: true }); await h.settle(); h.state.text = ''; h.listeners.installed(); await h.settle();
  assert.equal(h.state.text, 'ON');
});

test('ON/OFF changes update immediately without opening popup or accessing any tabs', async () => {
  const h = setup(); await h.settle();
  h.changed(true); await h.settle(); assert.equal(h.state.text, 'ON'); assert.match(h.state.title, /ON$/);
  h.changed(false); await h.settle(); assert.equal(h.state.text, ''); assert.match(h.state.title, /OFF$/);
});

test('unrelated preferences and non-sync storage changes do not alter the indicator', async () => {
  const h = setup({ saved: true }); await h.settle();
  h.changed(false, 'local'); h.changed(false, 'sync', 'hideFeedbackButtonsEnabled'); h.changed(false, 'sync', 'diagnosticsEnabled');
  await h.settle(); assert.equal(h.state.text, 'ON');
});

test('a stale startup read cannot overwrite a newer toggle event', async () => {
  const h = setup({ saved: false, deferredRead: true });
  h.changed(true); await h.settle(); h.reads[0](); await h.settle();
  assert.equal(h.state.text, 'ON'); assert.match(h.state.title, /ON$/);
});

test('rapid toggles remain ordered even when an older API call is slow and another fails', async () => {
  const h = setup({ saved: false, delayFirstText: true, failFirstTitle: true }); await h.settle();
  h.changed(true); h.changed(false); h.changed(true); await h.settle();
  h.releaseText(); await h.settle();
  assert.equal(h.state.text, 'ON'); assert.match(h.state.title, /ON$/);
  assert.ok(h.warnings.includes('[ReadAloud] toolbar-update-failed'));
});

test('a storage read failure reports the issue without claiming an ON state', async () => {
  const h = setup({ saved: true, deferredRead: true }); h.chrome.runtime.lastError = { message: 'simulated failure' };
  h.reads[0](); await h.settle();
  assert.equal(h.state.text, undefined); assert.ok(h.warnings.includes('[ReadAloud] toolbar-settings-read-failed'));
});
