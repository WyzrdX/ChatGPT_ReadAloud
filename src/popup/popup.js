'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const statusMessage = document.getElementById('statusMessage');
  const settings = [
    {
      element: document.getElementById('diagnosticsToggle'),
      key: 'diagnosticsEnabled',
      defaultValue: false,
    },
    {
      element: document.getElementById('autoPlayToggle'),
      key: 'autoPlayEnabled',
      defaultValue: false,
    },
    {
      element: document.getElementById('hideFeedbackToggle'),
      key: 'hideFeedbackButtonsEnabled',
      defaultValue: false,
    },
  ];

  if (settings.some(setting => !setting.element)) {
    return;
  }

  const storage = typeof chrome !== 'undefined' ? chrome.storage?.sync : null;

  const getLastErrorMessage = () => {
    if (typeof chrome === 'undefined') {
      return '';
    }

    return chrome.runtime?.lastError?.message || '';
  };

  const setStatus = (message) => {
    if (!statusMessage) {
      return;
    }

    statusMessage.textContent = message;
    statusMessage.hidden = !message;
  };

  const setTogglesDisabled = (disabled) => {
    settings.forEach(({ element }) => {
      element.disabled = disabled;
    });
  };

  if (storage) {
    const defaults = settings.reduce((values, { key, defaultValue }) => {
      values[key] = defaultValue;
      return values;
    }, {});

    storage.get(defaults, (result) => {
      const error = getLastErrorMessage();
      if (error) {
        setStatus(`Could not load settings: ${error}`);
        setTogglesDisabled(true);
        return;
      }

      settings.forEach(({ element, key }) => {
        element.checked = Boolean(result[key]);
      });
    });
  } else {
    settings.forEach(({ element, defaultValue }) => {
      element.checked = Boolean(defaultValue);
      element.disabled = true;
    });
    setStatus('Settings storage is unavailable.');
  }

  settings.forEach(({ element, key }) => {
    element.addEventListener('change', () => {
      const enabled = element.checked;
      if (!storage) {
        element.checked = !enabled;
        setStatus('Settings storage is unavailable.');
        return;
      }

      element.disabled = true;
      storage.set({ [key]: enabled }, () => {
        const error = getLastErrorMessage();
        element.disabled = false;

        if (error) {
          element.checked = !enabled;
          setStatus(`Could not save setting: ${error}`);
          return;
        }

        setStatus('');
      });
    });
  });
});
