(function () {
  'use strict';

  // Verified on the signed-in ChatGPT interface, 2026-10-19. Do not fall
  // back to More actions: that menu now contains Branch conversation.
  const TURN = '[data-turn-key]';
  const SPEAKER = 'button[aria-label="Read aloud"]';
  const PLAYBACK = 'button[aria-label="Read aloud"], button[aria-label="Loading audio…"]';
  const SEND = 'button[aria-label="Send"], button[aria-label="Send message"], button[data-testid="send-button"]';
  const STOP_GENERATING = 'button[aria-label="Stop"], button[aria-label="Stop generating"], button[data-testid="stop-button"]';
  const STORAGE_KEY = 'autoPlayEnabled';
  const FEEDBACK_KEY = 'hideFeedbackButtonsEnabled';
  const DIAGNOSTICS_KEY = 'diagnosticsEnabled';
  const VERSION = '1.2';
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.sync : null;
  let autoPlayEnabled = false;
  let hideFeedbackEnabled = false;
  let diagnosticsEnabled = false;
  let requestSequence = 0;
  let observer;
  const changedSettings = new Set();
  let pending = null;
  let route = location.pathname;
  let scanTimer;
  const mediaInUse = new Set();
  const hiddenFeedback = new Map();

  function log(event, details = {}, always = false) {
    if (diagnosticsEnabled || always) console.info(`[ReadAloud ${VERSION}] ${event}`, details);
  }

  function snapshot() {
    return {
      turnCount: turns().length,
      speakerCount: document.querySelectorAll(SPEAKER).length,
      userMarkerCount: document.querySelectorAll('[data-user-message-bubble]').length,
      assistantMarkerCount: document.querySelectorAll('[data-conversation-role="assistant"]').length,
      completionMarkerCount: document.querySelectorAll('[data-talvt-turn-state="complete"]').length,
      sendControl: Boolean(document.querySelector(SEND)),
      generationControl: generating(),
      autoPlayEnabled,
      visible: document.visibilityState === 'visible',
      executionWorld: 'ISOLATED',
    };
  }

  function phase(reason, details = {}) {
    if (pending?.phase === reason) return;
    if (pending) pending.phase = reason;
    log(reason, { request: pending?.sequence || 0, ...details });
  }

  log('content-script-loaded', { storageAvailable: Boolean(storage), executionWorld: 'ISOLATED' }, true);

  function enabled(button) {
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  function turns() {
    return Array.from(document.querySelectorAll(TURN));
  }

  function generating() {
    return Boolean(document.querySelector(STOP_GENERATING));
  }

  function cancelPending(reason = 'cancelled') {
    if (pending) log('request-finished', { request: pending.sequence, reason });
    pending = null;
  }

  function updateFeedback() {
    if (!hideFeedbackEnabled) {
      for (const [button, display] of hiddenFeedback) {
        if (display.value) button.style.setProperty('display', display.value, display.priority);
        else button.style.removeProperty('display');
      }
      hiddenFeedback.clear();
      return;
    }
    for (const button of document.querySelectorAll('button[aria-label="Good response"], button[aria-label="Bad response"]')) {
      if (!hiddenFeedback.has(button)) {
        hiddenFeedback.set(button, {
          value: button.style.getPropertyValue('display'),
          priority: button.style.getPropertyPriority('display'),
        });
        button.style.setProperty('display', 'none');
      }
    }
    for (const button of hiddenFeedback.keys()) {
      if (!button.isConnected) hiddenFeedback.delete(button);
    }
  }

  function setAutoPlayEnabled(value) {
    const next = Boolean(value);
    // Enabling is prospective; never replay a reply that completed while off.
    if (next !== autoPlayEnabled) cancelPending('setting-changed');
    autoPlayEnabled = next;
    log('autoplay-setting', { enabled: next });
  }

  function arm() {
    if (!autoPlayEnabled || generating()) {
      log('submission-ignored', { autoPlayEnabled, generationControl: generating() });
      return;
    }
    // Ignore mutations queued before this submission (for example an old Stop
    // control removed just before Send).
    observer?.takeRecords();
    pending = {
      sequence: ++requestSequence,
      sawGeneration: false,
      baseline: new Set(turns().map(turn => turn.getAttribute('data-turn-key'))),
      key: null,
      expires: Date.now() + 15000,
    };
    route = location.pathname;
    log('submission-observed', { request: pending.sequence, ...snapshot() });
    scheduleScan();
  }

  function playbackInUse() {
    return mediaInUse.size > 0 || Boolean(document.querySelector(
      'button[aria-label="Read aloud"][aria-pressed="true"], button[aria-label="Loading audio…"]'
    )) || Array.from(document.querySelectorAll('audio')).some(audio => !audio.paused && !audio.ended);
  }

  function scan() {
    scanTimer = undefined;
    updateFeedback();
    const currentTurns = turns();
    if (location.pathname !== route) {
      // Sending from New chat creates a route, sometimes via a local-chatgpt
      // route first. All other navigation cancels the old request.
      const newChat = pending && pending.baseline.size === 0 && !route.includes('/c/');
      const localCommit = pending && route.includes('/c/local-chatgpt') &&
        currentTurns.some(turn => turn.getAttribute('data-turn-key') === pending.key);
      if (!newChat && !localCommit) cancelPending('navigation');
      route = location.pathname;
    }
    if (!autoPlayEnabled || !pending) return;
    if (Date.now() > pending.expires) {
      cancelPending('expired');
      return;
    }
    if (generating() && !pending.sawGeneration) {
      pending.sawGeneration = true;
      pending.expires = Date.now() + 10 * 60 * 1000;
      log('generation-observed', { request: pending.sequence });
    }
    if (!pending.key) {
      // Bind the new user turn independently from generation controls. React
      // may mount the user turn before Stop, or mount Stop before the turn.
      // A completed historical turn with playback controls cannot bind.
      const latest = currentTurns.at(-1);
      const key = latest?.getAttribute('data-turn-key');
      if (!key || pending.baseline.has(key) ||
          !latest.querySelector('[data-user-message-bubble]') || latest.querySelector(PLAYBACK)) {
        phase('waiting-new-turn', snapshot());
        return;
      }
      pending.key = key;
      log('response-bound', { request: pending.sequence });
    }
    const turn = currentTurns.find(item => item.getAttribute('data-turn-key') === pending.key);
    // Temporarily unmounted turns may return; never substitute a different one.
    if (!turn) { phase('waiting-bound-turn'); return; }
    if (generating()) { phase('waiting-generation-end'); return; }
    if (!pending.sawGeneration) { phase('waiting-generation-evidence'); return; }
    const complete = turn.querySelector('[data-talvt-turn-state="complete"]');
    if (!complete?.querySelector('[data-conversation-role="assistant"]')) { phase('waiting-assistant-completion'); return; }
    if (!pending.completedLogged) {
      log('generation-complete', { request: pending.sequence });
      pending.completedLogged = true;
    }
    const speaker = complete.querySelector(SPEAKER);
    if (!speaker) { phase('waiting-speaker', { globalSpeakerCount: document.querySelectorAll(SPEAKER).length }); return; }
    if (!enabled(speaker)) { phase('waiting-speaker-enabled'); return; }
    if (speaker.getAttribute('aria-pressed') === 'true') { cancelPending('native-player-active'); return; }
    log('speaker-found', { request: pending.sequence, scoped: true });
    // Consume before clicking, including failures/overlap: retries could undo
    // a manual pause, restart a stopped reply, or interrupt existing narration.
    const request = pending.sequence;
    const turnKey = pending.key;
    if (document.visibilityState !== 'visible' || playbackInUse()) {
      cancelPending('hidden-or-playback-in-use');
      return;
    }
    cancelPending('attempt-consumed');
    log('click-attempt', { request, executionWorld: 'ISOLATED', userActivationActive: Boolean(navigator.userActivation?.isActive), userActivationSeen: Boolean(navigator.userActivation?.hasBeenActive) });
    try {
      speaker.click();
      log('click-dispatched', { request });
    } catch {
      log('click-threw', { request }, true);
      return;
    }
    // Diagnostic observation only: never retry a click or infer audible success.
    if (diagnosticsEnabled) {
      setTimeout(() => {
        const current = turns().find(item => item.getAttribute('data-turn-key') === turnKey);
        const control = current?.querySelector(PLAYBACK);
        log('click-observation', {
          request,
          controlConnected: Boolean(control?.isConnected),
          loading: control?.getAttribute('aria-label') === 'Loading audio…',
          pressed: control?.getAttribute('aria-pressed') === 'true',
          disabled: Boolean(control && !enabled(control)),
          mediaActive: playbackInUse(),
        });
      }, 300);
    }
  }

  function scheduleScan() {
    // Throttle rather than debounce so streaming mutations cannot starve scans.
    if (scanTimer === undefined) scanTimer = setTimeout(scan, 50);
  }

  function buttonFrom(event) {
    return event.target instanceof Element ? event.target.closest('button') : null;
  }

  document.addEventListener('click', event => {
    const button = buttonFrom(event);
    if (!button) return;
    if (button.matches(SEND) && enabled(button)) {
      arm();
      return;
    }
    cancelForManualControl(button);
  }, true);

  function cancelForManualControl(button) {
    if (!button) return;
    const label = button.getAttribute('aria-label') || '';
    if (button.matches(STOP_GENERATING) || button.matches(PLAYBACK) ||
        /^(Pause|Resume|Play|Stop reading|Stop playback|Pause audio|Resume audio|Close player|Close audio player)$/i.test(label)) {
      cancelPending('manual-control');
    }
  }

  // Yield at the beginning of a manual interaction, before a held mouse press
  // or keyboard activation has a chance to race the completion scan.
  document.addEventListener('pointerdown', event => cancelForManualControl(buttonFrom(event)), true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && generating()) cancelPending('manual-stop');
    if (event.key === 'Enter' || event.key === ' ') cancelForManualControl(buttonFrom(event));
    if (event.key !== 'Enter' || event.repeat || event.isComposing ||
        event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
        !(event.target instanceof Element) ||
        !event.target.closest('textarea, [contenteditable="true"]')) return;
    if (enabled(document.querySelector(SEND))) arm();
  }, true);

  document.addEventListener('play', event => {
    if (event.target instanceof HTMLMediaElement) {
      mediaInUse.add(event.target);
      cancelPending('media-started');
      log('media-play-event');
    }
  }, true);
  // A pause remains owned by the user/player. Only an actual end/reset releases it.
  for (const type of ['ended', 'emptied']) {
    document.addEventListener(type, event => mediaInUse.delete(event.target), true);
  }
  window.addEventListener('popstate', () => cancelPending('navigation'));
  window.addEventListener('pagehide', () => cancelPending('page-hidden'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') cancelPending('tab-hidden');
  });

  observer = new MutationObserver(records => {
    // Stop can appear and disappear in a single render batch. Its removal or
    // old aria-label is still evidence of generation, even if a scan missed it.
    if (pending && !pending.sawGeneration) {
      const hadStop = records.some(record =>
        (record.type === 'attributes' && record.attributeName === 'aria-label' &&
          ['Stop', 'Stop generating'].includes(record.oldValue)) ||
        Array.from(record.removedNodes).some(node => node instanceof Element &&
          (node.matches(STOP_GENERATING) || node.querySelector(STOP_GENERATING)))
      );
      if (hadStop) {
        pending.sawGeneration = true;
        pending.expires = Date.now() + 10 * 60 * 1000;
        log('generation-observed', { request: pending.sequence, fromMutation: true });
      }
    }
    // Capture a new turn immediately; a short reply may finish before a timer.
    if (pending && !pending.key) {
      clearTimeout(scanTimer);
      scan();
    } else {
      scheduleScan();
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['data-talvt-turn-state', 'data-turn-key', 'aria-label', 'aria-pressed', 'aria-disabled', 'disabled'],
  });

  if (storage) {
    // Register before get and do not overwrite a newer toggle with a delayed
    // initial read. Only booleans are logged; no text, IDs or URLs are collected.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(changes)) changedSettings.add(key);
      if (Object.prototype.hasOwnProperty.call(changes, DIAGNOSTICS_KEY)) {
        diagnosticsEnabled = Boolean(changes[DIAGNOSTICS_KEY].newValue);
        log('diagnostics-enabled', snapshot());
      }
      if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        setAutoPlayEnabled(changes[STORAGE_KEY].newValue);
      }
      if (Object.prototype.hasOwnProperty.call(changes, FEEDBACK_KEY)) {
        hideFeedbackEnabled = Boolean(changes[FEEDBACK_KEY].newValue);
        scheduleScan();
      }
    });
    storage.get({ [STORAGE_KEY]: false, [FEEDBACK_KEY]: false, [DIAGNOSTICS_KEY]: false }, result => {
      if (chrome.runtime?.lastError) { log('settings-read-failed', {}, true); return; }
      if (!changedSettings.has(DIAGNOSTICS_KEY)) diagnosticsEnabled = Boolean(result[DIAGNOSTICS_KEY]);
      if (!changedSettings.has(STORAGE_KEY)) setAutoPlayEnabled(result[STORAGE_KEY]);
      if (!changedSettings.has(FEEDBACK_KEY)) hideFeedbackEnabled = Boolean(result[FEEDBACK_KEY]);
      log('settings-loaded', { autoPlayEnabled, diagnosticsEnabled }, true);
      log('dom-snapshot', snapshot());
      scheduleScan();
    });
  } else {
    log('settings-unavailable', {}, true);
  }
})();
