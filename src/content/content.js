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
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.sync : null;
  let autoPlayEnabled = false;
  let hideFeedbackEnabled = false;
  let pending = null;
  let route = location.pathname;
  let scanTimer;
  const mediaInUse = new Set();
  const hiddenFeedback = new Map();

  function enabled(button) {
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  function turns() {
    return Array.from(document.querySelectorAll(TURN));
  }

  function generating() {
    return Boolean(document.querySelector(STOP_GENERATING));
  }

  function cancelPending() {
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
    if (next !== autoPlayEnabled) cancelPending();
    autoPlayEnabled = next;
  }

  function arm() {
    if (!autoPlayEnabled || generating()) return;
    pending = {
      baseline: new Set(turns().map(turn => turn.getAttribute('data-turn-key'))),
      key: null,
      expires: Date.now() + 15000,
    };
    route = location.pathname;
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
      if (!newChat && !localCommit) cancelPending();
      route = location.pathname;
    }
    if (!autoPlayEnabled || !pending) return;
    if (Date.now() > pending.expires) {
      cancelPending();
      return;
    }
    if (!pending.key) {
      // Require evidence of a live generation and a new user turn without
      // playback controls. A historical completed turn cannot qualify merely
      // because virtualization mounted it after Send was pressed.
      if (!generating()) return;
      const latest = currentTurns.at(-1);
      const key = latest?.getAttribute('data-turn-key');
      if (!key || pending.baseline.has(key) ||
          !latest.querySelector('[data-user-message-bubble]') || latest.querySelector(PLAYBACK)) return;
      pending.key = key;
      pending.expires = Date.now() + 10 * 60 * 1000;
    }
    const turn = currentTurns.find(item => item.getAttribute('data-turn-key') === pending.key);
    // Temporarily unmounted turns may return; never substitute a different one.
    if (!turn || generating()) return;
    const complete = turn.querySelector('[data-talvt-turn-state="complete"]');
    if (!complete?.querySelector('[data-conversation-role="assistant"]')) return;
    const speaker = complete.querySelector(SPEAKER);
    if (!enabled(speaker) || speaker.getAttribute('aria-pressed') === 'true') return;
    // Consume before clicking, including failures/overlap: retries could undo
    // a manual pause, restart a stopped reply, or interrupt existing narration.
    cancelPending();
    if (document.visibilityState !== 'visible' || playbackInUse()) return;
    speaker.click();
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
      cancelPending();
    }
  }

  // Yield at the beginning of a manual interaction, before a held mouse press
  // or keyboard activation has a chance to race the completion scan.
  document.addEventListener('pointerdown', event => cancelForManualControl(buttonFrom(event)), true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && generating()) cancelPending();
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
      cancelPending();
    }
  }, true);
  // A pause remains owned by the user/player. Only an actual end/reset releases it.
  for (const type of ['ended', 'emptied']) {
    document.addEventListener(type, event => mediaInUse.delete(event.target), true);
  }
  window.addEventListener('popstate', cancelPending);
  window.addEventListener('pagehide', cancelPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') cancelPending();
  });

  new MutationObserver(() => {
    // Capture a new turn immediately; a short reply may finish before a timer.
    if (pending && !pending.key) {
      clearTimeout(scanTimer);
      scan();
    } else {
      scheduleScan();
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-talvt-turn-state', 'data-turn-key', 'aria-label', 'aria-pressed', 'aria-disabled', 'disabled'],
  });

  if (storage) {
    storage.get({ [STORAGE_KEY]: false, [FEEDBACK_KEY]: false }, result => {
      if (chrome.runtime?.lastError) return;
      setAutoPlayEnabled(result[STORAGE_KEY]);
      hideFeedbackEnabled = Boolean(result[FEEDBACK_KEY]);
      scheduleScan();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        setAutoPlayEnabled(changes[STORAGE_KEY].newValue);
      }
      if (Object.prototype.hasOwnProperty.call(changes, FEEDBACK_KEY)) {
        hideFeedbackEnabled = Boolean(changes[FEEDBACK_KEY].newValue);
        scheduleScan();
      }
    });
  }
})();
