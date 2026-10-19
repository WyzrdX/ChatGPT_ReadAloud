const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('src/content/content.js', 'utf8');

// Minimal structural fixture from signed-in DOM inspection on 2026-10-19.
// No conversation text, network, real audio service, or user data is used.
function turn(key, complete = false, speaker = complete) {
  return `<div data-turn-key="${key}"><div data-talvt-turn-state="complete">
    <div data-user-message-bubble="true"></div>
    ${complete ? '<h4 data-conversation-role="assistant"></h4>' : ''}
    ${speaker ? '<button aria-label="Read aloud" aria-pressed="false"></button>' : ''}
  </div></div>`;
}

async function setup(t, { enabled = true, initial = turn('old', true), path = '/c/test', deferredStorage = false, diagnostics = false, storageError = false } = {}) {
  const dom = new JSDOM(`<main><div id="turns">${initial}</div>
    <div contenteditable="true" id="composer"></div><button aria-label="Send"></button>
    <button aria-label="More actions"></button></main>`, {
    url: `https://chatgpt.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window: w } = dom;
  const d = w.document;
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  const logs = [];
  w.console.info = (...args) => logs.push(args);
  let changed, getSettings;
  w.chrome = { runtime: storageError ? { lastError: { message: 'storage failure' } } : {}, storage: {
    sync: { get(defaults, callback) { getSettings = () => callback({ ...defaults, autoPlayEnabled: enabled, diagnosticsEnabled: diagnostics }); if (!deferredStorage) getSettings(); } },
    onChanged: { addListener(callback) { changed = callback; } },
  } };
  let now = 0;
  const timers = new Map();
  let sequence = 0;
  w.Date.now = () => now;
  w.setTimeout = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  const clicks = [];
  d.addEventListener('click', e => { if (e.target.matches('button')) clicks.push(e.target.getAttribute('aria-label')); });
  w.eval(source);
  async function flush(ms = 60) {
    await Promise.resolve();
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
    await Promise.resolve();
  }
  const h = {
    w, d, clicks, logs, flush,
    loadSettings: () => getSettings(),
    setting(value, key = 'autoPlayEnabled') { changed({ [key]: { newValue: value } }, 'sync'); },
    send() { d.querySelector('[aria-label="Send"]').click(); },
    async start(key = 'new') {
      const stop = d.createElement('button'); stop.setAttribute('aria-label', 'Stop'); stop.id = 'stop'; d.querySelector('main').append(stop);
      d.querySelector('#turns').insertAdjacentHTML('beforeend', turn(key));
      await flush();
    },
    async finish(key = 'new', withSpeaker = true) {
      d.querySelector('#stop')?.remove();
      d.querySelector(`[data-turn-key="${key}"]`).outerHTML = turn(key, true, withSpeaker);
      await flush();
    },
    speaker(key = 'new') { return d.querySelector(`[data-turn-key="${key}"] button`); },
    plays() { return clicks.filter(label => label === 'Read aloud').length; },
  };
  await flush();
  return h;
}

test('initial history and enabling autoplay never play existing responses', async t => {
  const h = await setup(t, { enabled: false });
  h.setting(true); await h.flush();
  h.d.querySelector('#turns').insertAdjacentHTML('afterbegin', turn('older', true)); await h.flush();
  assert.equal(h.plays(), 0);
});

test('new generation plays once, only after completion, and never opens More actions', async t => {
  const h = await setup(t);
  h.send(); await h.start(); assert.equal(h.plays(), 0);
  await h.finish(); assert.equal(h.plays(), 1);
  for (let i = 0; i < 3; i++) { h.speaker().setAttribute('aria-pressed', String(i % 2 === 0)); await h.flush(); }
  h.d.querySelector('[data-turn-key="new"]').outerHTML = turn('new', true); await h.flush();
  assert.equal(h.plays(), 1);
  assert.equal(h.clicks.includes('More actions'), false);
  assert.equal(h.d.querySelector('[data-read-aloud-proxy]'), null);
});

test('history mounted during a request cannot become the autoplay target', async t => {
  const h = await setup(t);
  h.send();
  const stop = h.d.createElement('button'); stop.setAttribute('aria-label', 'Stop'); h.d.body.append(stop);
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('historic', true)); await h.flush();
  stop.remove(); await h.flush();
  assert.equal(h.plays(), 0);
});

test('only the bound turn plays even when historical controls mount while streaming', async t => {
  const h = await setup(t); h.send(); await h.start();
  h.d.querySelector('#turns').insertAdjacentHTML('afterbegin', turn('historic', true)); await h.flush();
  await h.finish(); assert.equal(h.plays(), 1);
});

test('a delayed or disabled speaker waits until it is ready', async t => {
  const h = await setup(t); h.send(); await h.start(); await h.finish('new', false);
  assert.equal(h.plays(), 0);
  h.d.querySelector('[data-turn-key="new"] [data-talvt-turn-state]').insertAdjacentHTML('beforeend', '<button aria-label="Read aloud" aria-pressed="false" disabled></button>');
  await h.flush(); assert.equal(h.plays(), 0);
  h.speaker().disabled = false; await h.flush(); assert.equal(h.plays(), 1);
});

test('a completion marker and button while generation is active cannot play early', async t => {
  const h = await setup(t); h.send(); await h.start();
  h.d.querySelector('[data-turn-key="new"]').outerHTML = turn('new', true); await h.flush();
  assert.equal(h.plays(), 0);
  h.d.querySelector('#stop').remove(); await h.flush(); assert.equal(h.plays(), 1);
});

test('disabling then re-enabling during generation cancels that response', async t => {
  const h = await setup(t); h.send(); await h.start(); h.setting(false); h.setting(true);
  await h.finish(); assert.equal(h.plays(), 0);
  h.send(); await h.start('next'); await h.finish('next'); assert.equal(h.plays(), 1);
});

test('generation started with autoplay off does not become eligible when enabled', async t => {
  const h = await setup(t, { enabled: false }); h.send(); await h.start(); h.setting(true);
  await h.finish(); assert.equal(h.plays(), 0);
});

test('manual speaker click cancels pending autoplay without preventing native click', async t => {
  const h = await setup(t); h.send(); await h.start();
  h.speaker('old').click(); assert.equal(h.plays(), 1);
  await h.finish(); assert.equal(h.plays(), 1);
});

test('manual stop generation and Escape cancel pending autoplay', async t => {
  const h = await setup(t); h.send(); await h.start(); h.d.querySelector('#stop').click();
  await h.finish(); assert.equal(h.plays(), 0);
  h.send(); await h.start('next'); h.d.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await h.finish('next'); assert.equal(h.plays(), 0);
});

test('active or paused media cannot be interrupted and is never queued for later', async t => {
  const h = await setup(t); const audio = h.d.createElement('audio'); h.d.body.append(audio);
  audio.dispatchEvent(new h.w.Event('play')); audio.dispatchEvent(new h.w.Event('pause'));
  h.send(); await h.start(); await h.finish(); assert.equal(h.plays(), 0);
  audio.dispatchEvent(new h.w.Event('ended')); await h.flush(); assert.equal(h.plays(), 0);
  h.send(); await h.start('next'); await h.finish('next'); assert.equal(h.plays(), 1);
});

test('native pressed/loading playback prevents automatic overlap', async t => {
  const h = await setup(t); h.speaker('old').setAttribute('aria-pressed', 'true');
  h.send(); await h.start(); await h.finish(); assert.equal(h.plays(), 0);
  h.speaker('old').setAttribute('aria-pressed', 'false'); await h.flush(); assert.equal(h.plays(), 0);
});

test('SPA navigation cancels pending playback before a new conversation mounts', async t => {
  const h = await setup(t); h.send(); await h.start();
  h.w.history.pushState({}, '', '/c/other'); await h.finish(); assert.equal(h.plays(), 0);
});

test('New chat route creation and local-to-server route changes preserve the new turn', async t => {
  const h = await setup(t, { path: '/', initial: '' }); h.send();
  h.w.history.pushState({}, '', '/c/local-chatgpt:test'); await h.start();
  h.w.history.replaceState({}, '', '/c/server'); await h.finish(); assert.equal(h.plays(), 1);
});

test('failed Send expires and a later historical mount cannot play', async t => {
  const h = await setup(t); h.send(); await h.flush(16000);
  await h.start(); await h.finish(); assert.equal(h.plays(), 0);
});

test('Enter submits, while Shift+Enter, IME composition, and repeats do not arm', async t => {
  const h = await setup(t);
  for (const options of [{ shiftKey: true }, { isComposing: true }, { repeat: true }]) {
    h.d.querySelector('#composer').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options }));
    await h.start('ignored'); await h.finish('ignored');
  }
  assert.equal(h.plays(), 0);
  h.d.querySelector('#composer').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await h.start(); await h.finish(); assert.equal(h.plays(), 1);
});

test('initial async settings load cannot retroactively arm an in-flight response', async t => {
  const h = await setup(t, { deferredStorage: true }); h.send(); await h.start(); h.loadSettings();
  await h.finish(); assert.equal(h.plays(), 0);
});

test('feedback toggle restores preexisting display styling', async t => {
  const h = await setup(t); const button = h.d.createElement('button');
  button.setAttribute('aria-label', 'Good response'); button.style.setProperty('display', 'inline-flex', 'important'); h.d.body.append(button);
  h.setting(true, 'hideFeedbackButtonsEnabled'); await h.flush(); assert.equal(button.style.display, 'none');
  h.setting(false, 'hideFeedbackButtonsEnabled'); await h.flush(); assert.equal(button.style.display, 'inline-flex');
  assert.equal(button.style.getPropertyPriority('display'), 'important');
});

test('hidden tabs do not start or defer narration', async t => {
  const h = await setup(t); h.send(); await h.start();
  Object.defineProperty(h.d, 'visibilityState', { configurable: true, value: 'hidden' });
  h.d.dispatchEvent(new h.w.Event('visibilitychange')); await h.finish(); assert.equal(h.plays(), 0);
  Object.defineProperty(h.d, 'visibilityState', { configurable: true, value: 'visible' });
  h.d.dispatchEvent(new h.w.Event('visibilitychange')); await h.flush(); assert.equal(h.plays(), 0);
});

test('multiple submissions each get one automatic attempt', async t => {
  const h = await setup(t);
  for (const key of ['one', 'two', 'three']) { h.send(); await h.start(key); await h.finish(key); }
  assert.equal(h.plays(), 3);
});

test('a bound turn may unmount but another completed turn cannot substitute for it', async t => {
  const h = await setup(t); h.send(); await h.start();
  h.d.querySelector('[data-turn-key="new"]').remove(); h.d.querySelector('#stop').remove();
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('other', true)); await h.flush(); assert.equal(h.plays(), 0);
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('new', true)); await h.flush(); assert.equal(h.plays(), 1);
});

test('a response with no observed new generation is skipped rather than guessing from historical DOM', async t => {
  const h = await setup(t); h.send();
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('unknown', true)); await h.flush(); assert.equal(h.plays(), 0);
});

test('missing extension APIs fails closed without changing native controls', async t => {
  const dom = new JSDOM(`<body>${turn('old', true)}</body>`, { url: 'https://chatgpt.com', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); assert.doesNotThrow(() => dom.window.eval(source));
  assert.equal(dom.window.document.querySelector('button[aria-label="Read aloud"]').getAttribute('aria-pressed'), 'false');
});

test('pointer and keyboard intent yield to manual playback before click activation', async t => {
  const h = await setup(t); h.send(); await h.start();
  h.speaker('old').dispatchEvent(new h.w.Event('pointerdown', { bubbles: true }));
  await h.finish(); assert.equal(h.plays(), 0);
  h.send(); await h.start('next');
  h.speaker('old').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await h.finish('next'); assert.equal(h.plays(), 0);
});

test('binds a new user turn before Stop mounts, even if completion mounts with its speaker', async t => {
  const h = await setup(t); h.send();
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('new')); await h.flush();
  assert.equal(h.plays(), 0);
  const stop = h.d.createElement('button'); stop.id = 'stop'; stop.setAttribute('aria-label', 'Stop'); h.d.body.append(stop);
  h.d.querySelector('[data-turn-key="new"]').outerHTML = turn('new', true); await h.flush();
  assert.equal(h.plays(), 0);
  stop.remove(); await h.flush(); assert.equal(h.plays(), 1);
});

test('recognizes a generation Stop mounted and removed between scans', async t => {
  const h = await setup(t); h.send();
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('new')); await h.flush();
  const stop = h.d.createElement('button'); stop.setAttribute('aria-label', 'Stop'); h.d.body.append(stop); stop.remove();
  await h.finish(); assert.equal(h.plays(), 1);
});

test('recognizes an in-place Stop-to-idle label change between scans', async t => {
  const h = await setup(t); h.send();
  h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('new')); await h.flush();
  const send = h.d.querySelector('[aria-label="Send"]'); send.setAttribute('aria-label', 'Stop'); send.setAttribute('aria-label', 'Start Voice');
  await h.finish(); assert.equal(h.plays(), 1);
});

test('an old Stop removal queued before submission cannot authorize another reply', async t => {
  const h = await setup(t); const stop = h.d.createElement('button'); stop.setAttribute('aria-label', 'Stop'); h.d.body.append(stop); stop.remove();
  h.send(); h.d.querySelector('#turns').insertAdjacentHTML('beforeend', turn('new')); await h.flush();
  await h.finish(); assert.equal(h.plays(), 0);
});

test('a delayed initial settings read never overwrites a newer autoplay toggle', async t => {
  const h = await setup(t, { enabled: false, deferredStorage: true });
  h.setting(true); h.loadSettings(); h.send(); await h.start(); await h.finish(); assert.equal(h.plays(), 1);
});

test('startup and settings receipt identify the active version and loaded preference', async t => {
  const h = await setup(t);
  assert.ok(h.logs.some(([event, data]) => event.includes('[ReadAloud 1.2] content-script-loaded') && data.storageAvailable));
  assert.ok(h.logs.some(([event, data]) => event.endsWith('settings-loaded') && data.autoPlayEnabled));
  assert.equal(h.logs.some(([event]) => event.endsWith('dom-snapshot')), false);
});

test('settings errors remain disabled and produce an explicit diagnostic', async t => {
  const h = await setup(t, { storageError: true }); h.send(); await h.start(); await h.finish(); assert.equal(h.plays(), 0);
  assert.ok(h.logs.some(([event]) => event.endsWith('settings-read-failed')));
});

test('diagnostics trace scoped response detection and clicks without text, IDs, or URLs', async t => {
  const h = await setup(t, { diagnostics: true });
  h.d.querySelector('#composer').textContent = 'PRIVATE_TEST_TEXT';
  h.send(); await h.start('PRIVATE_MESSAGE_ID'); await h.finish('PRIVATE_MESSAGE_ID'); await h.flush(400);
  for (const event of ['submission-observed', 'response-bound', 'generation-observed', 'generation-complete', 'speaker-found', 'click-attempt', 'click-dispatched', 'click-observation']) {
    assert.ok(h.logs.some(([label]) => label.endsWith(event)), event);
  }
  assert.equal(h.plays(), 1);
  const serialized = JSON.stringify(h.logs);
  assert.equal(/PRIVATE_|https:|\/c\/test/.test(serialized), false);
  h.setting(false, 'diagnosticsEnabled'); const count = h.logs.length;
  h.send(); await h.start('next'); await h.finish('next'); assert.equal(h.logs.length, count);
});

test('unsupported turn markup reports speaker and marker counts without a global click fallback', async t => {
  const h = await setup(t, { diagnostics: true, initial: '<button aria-label="Read aloud" aria-pressed="false"></button>' });
  h.send(); await h.start(); h.d.querySelector('[data-turn-key="new"]').remove(); await h.flush();
  const snapshot = h.logs.find(([event]) => event.endsWith('dom-snapshot'))[1];
  assert.equal(snapshot.turnCount, 0); assert.equal(snapshot.speakerCount, 1); assert.equal(h.plays(), 0);
});

test('a thrown click is logged and not retried on subsequent mutations', async t => {
  const h = await setup(t, { diagnostics: true }); h.send(); await h.start(); await h.finish('new', false);
  const speaker = h.d.createElement('button'); speaker.setAttribute('aria-label', 'Read aloud');
  let attempts = 0; speaker.click = () => { attempts++; throw new Error('not logged'); };
  h.d.querySelector('[data-turn-key="new"] [data-talvt-turn-state]').append(speaker); await h.flush();
  speaker.setAttribute('disabled', ''); speaker.removeAttribute('disabled'); await h.flush();
  assert.equal(attempts, 1); assert.ok(h.logs.some(([event]) => event.endsWith('click-threw')));
});
