# ChatGPT Read Aloud (WyzrdX fork)

A Brave-tested extension maintained in [WyzrdX/ChatGPT_ReadAloud](https://github.com/WyzrdX/ChatGPT_ReadAloud). It automatically starts ChatGPT's native **Read aloud** after a new assistant response completes.

## Features

- **Automatic playback:** activates the native speaker button beneath a newly completed response, once per eligible response.
- **Auto Read Aloud ON/OFF:** controlled by **Auto-play new responses** in the popup. Enabling it does not replay conversation history.
- **Toolbar indicator:** a green **ON** badge highlights the existing speaker icon when enabled; OFF removes the badge. Hover text shows the setting. Changes update immediately, and the saved indicator restores after restart. It indicates the setting, not active playback.
- **Native controls:** ChatGPT handles audio, pause, resume, stop, and errors; manual playback is respected.
- **Optional settings:** hide feedback buttons or enable temporary diagnostic logging.

## Install in Brave

Clone this fork, or download and extract its `main` branch using **Code → Download ZIP**:

`````sh
git clone https://github.com/WyzrdX/ChatGPT_ReadAloud.git
`````

- Open `brave://extensions` and enable **Developer mode**.
- Choose **Load unpacked** and select the directory containing `manifest.json`.
- Pin **ChatGPT Read Aloud** to the toolbar so its state is visible.
- Refresh any ChatGPT tabs that were already open.

No build step or Node.js installation is required.

## Configure and use

- Open the toolbar popup and enable **Auto-play new responses**. It is off by default; the green **ON** badge confirms the saved setting.
- Allow site access for `chatgpt.com`. Keep the ChatGPT tab visible and submit a message with **Send** or **Enter**.
- Use ChatGPT's native controls for manual playback. Disable autoplay in the popup to return to manual-only use.

Settings persist through browser restarts. **Diagnostic logging (temporary)** can normally remain off.

## Update in Brave

For a Git installation, run these commands from the cloned repository directory:

`````sh
git fetch origin
git switch main
git pull --ff-only origin main
`````

For a ZIP installation, download the latest `main` branch and replace the extension files in the same directory Brave currently loads.

After either update, open `brave://extensions`, click **Reload** for this extension, and refresh ChatGPT tabs. Unpacked installations do not automatically download GitHub updates.

## Compatibility and limitations

**Brave:** live playback and toggle behavior verified; toolbar restart restoration covered by automated tests, with live restart verification pending. **Other Chromium browsers:** unverified; support is not currently claimed.

- ChatGPT's native Read aloud control and audio service must be available. ChatGPT interface changes can break response detection.
- Only new, locally submitted turns whose generation is observed are eligible. Existing history, replies already in progress when the page loads, and regeneration without a new user turn are skipped.
- Manual controls, stopping generation, disabling autoplay, navigation, or hiding the tab cancel a pending start. Existing narration is not interrupted or queued over.
- Uncertain responses and failed automatic clicks are not retried. Use the native speaker button manually. Browser audio policies still apply.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No automatic playback | Enable **Auto-play new responses** and check for the **ON** badge. Keep ChatGPT visible and submit a new message. |
| Still running older behavior | Reload the extension, then refresh ChatGPT. Verify Brave loads the directory you updated and has site access. |
| Native speaker also fails manually | Check ChatGPT's audio availability and Brave's sound settings. The extension uses ChatGPT's player. |
| Native playback works but autoplay fails | Enable **Diagnostic logging (temporary)**, open DevTools **Console**, show **Info** messages, and filter for `ReadAloud`. Submit one new message and inspect the last waiting or cancellation event. Disable diagnostics afterward. |

Diagnostics identify script startup, preferences, response detection, completion, and click attempts. Report extension/Brave versions and filtered `ReadAloud` lines only; exclude full console output and conversation content.

## Privacy and development

The only declared permission is `storage` for settings. The extension examines control attributes and temporary turn identifiers, not conversation text. Diagnostics exclude text, DOM identifiers, and URLs. No analytics, external speech services, or extension network requests are added; ChatGPT makes its own audio requests.

For development, use Node.js 18 or later, run `npm ci`, then `npm test`. Tests use synthetic DOM fixtures and mocked Chrome APIs; they do not replace live browser/audio testing.

## Origins and Credits

Based on [3choff/ChatGPT_ReadAloud](https://github.com/3choff/ChatGPT_ReadAloud). **3choff** created the original extension, speaker artwork, and popup/settings foundation.

**WyzrdX fork modifications:** direct native-button activation replacing menu-driven playback, stronger response/preference handling, toolbar state indication, diagnostics, and regression tests. This README was rewritten by the fork's maintainer to document these modifications, separately from the original author's work.

## License

The original work and this fork's modifications remain under the **Apache License 2.0**. See [LICENSE](LICENSE) for the unchanged license text. Existing copyright and attribution notices are retained; credit for the original work does not imply endorsement of this fork.
