'use strict';

// The popup and content script already share this preference. The worker only
// reflects it in the global toolbar action; it never interacts with page audio.
const AUTO_PLAY_KEY = 'autoPlayEnabled';
let preferenceRevision = 0;
let actionUpdates = Promise.resolve();

function showState(enabled) {
  // Serialize updates so a slow older action call cannot overwrite a newer
  // toggle when the user switches settings quickly.
  actionUpdates = actionUpdates.then(async () => {
    const results = await Promise.allSettled([
      chrome.action.setBadgeBackgroundColor({ color: '#15803D' }),
      chrome.action.setBadgeTextColor({ color: '#FFFFFF' }),
      chrome.action.setBadgeText({ text: enabled ? 'ON' : '' }),
      chrome.action.setTitle({ title: `ChatGPT Read Aloud | Auto Read Aloud ${enabled ? 'ON' : 'OFF'}` }),
    ]);
    if (results.some(result => result.status === 'rejected')) {
      console.warn('[ReadAloud] toolbar-update-failed');
    }
  }).catch(() => {
    console.warn('[ReadAloud] toolbar-update-failed');
  });
  return actionUpdates;
}

function restoreState() {
  const revision = preferenceRevision;
  chrome.storage.sync.get({ [AUTO_PLAY_KEY]: false }, result => {
    if (chrome.runtime.lastError) {
      console.warn('[ReadAloud] toolbar-settings-read-failed');
      return;
    }
    // Do not let a delayed startup read undo a newer storage-change event.
    if (revision === preferenceRevision) showState(Boolean(result[AUTO_PLAY_KEY]));
  });
}

// Register wake-up listeners synchronously, as required for MV3 workers.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !Object.prototype.hasOwnProperty.call(changes, AUTO_PLAY_KEY)) return;
  preferenceRevision++;
  showState(Boolean(changes[AUTO_PLAY_KEY].newValue));
});
chrome.runtime.onStartup.addListener(restoreState);
chrome.runtime.onInstalled.addListener(restoreState);
restoreState();
