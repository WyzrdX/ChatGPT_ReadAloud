const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

async function setup(t, failWrite = false) {
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const writes = [];
  w.chrome = { runtime: {}, storage: { sync: {
    get(defaults, callback) { callback({ ...defaults, autoPlayEnabled: true }); },
    set(value, callback) {
      writes.push(value);
      if (failWrite) w.chrome.runtime.lastError = { message: 'write failed' };
      callback();
      delete w.chrome.runtime.lastError;
    },
  } } };
  w.eval(fs.readFileSync('src/popup/popup.js', 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, d: w.document, writes };
}

test('popup loads the autoplay preference and persists autoplay and diagnostic toggles independently', async t => {
  const h = await setup(t);
  const autoplay = h.d.querySelector('#autoPlayToggle');
  const diagnostics = h.d.querySelector('#diagnosticsToggle');
  assert.equal(autoplay.checked, true); assert.equal(diagnostics.checked, false);
  autoplay.checked = false; autoplay.dispatchEvent(new h.w.Event('change'));
  diagnostics.checked = true; diagnostics.dispatchEvent(new h.w.Event('change'));
  assert.equal(JSON.stringify(h.writes), '[{"autoPlayEnabled":false},{"diagnosticsEnabled":true}]');
  assert.equal(autoplay.disabled, false); assert.equal(diagnostics.disabled, false);
});

test('a rejected popup setting write restores the toggle and reports the failure', async t => {
  const h = await setup(t, true); const diagnostics = h.d.querySelector('#diagnosticsToggle');
  diagnostics.checked = true; diagnostics.dispatchEvent(new h.w.Event('change'));
  assert.equal(diagnostics.checked, false); assert.equal(diagnostics.disabled, false);
  assert.equal(h.d.querySelector('#statusMessage').hidden, false);
  assert.match(h.d.querySelector('#statusMessage').textContent, /Could not save setting/);
});
