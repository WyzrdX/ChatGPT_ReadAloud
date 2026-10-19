# ChatGPT Read Aloud

A Chrome extension that optionally starts ChatGPT's native Read aloud control for newly completed responses. It uses the speaker button beneath the response directly. It does not inject duplicate buttons or open the More actions menu.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository directory containing `manifest.json`.
5. After an extension update, reload the extension and refresh any open ChatGPT tabs.

No build or npm installation is needed to use the extension.

## Usage

1. Open the extension popup and enable **Auto-play new responses**.
2. Send a message using the composer Send button or Enter.
3. When the new response completes, the extension clicks its native speaker button once.

ChatGPT continues to own playback, loading, pause, resume, stop, and errors. Use its native controls as usual. **Hide feedback buttons** remains a separate popup setting.

Autoplay is prospective: enabling it does not read existing replies. Loading history, scrolling, switching chats, and remounting an old response do not start narration. Manual playback controls, stopping generation, disabling autoplay, navigation, and hiding the tab cancel a pending automatic start. Existing playback is not interrupted or queued over.

The extension requires an observed generation following a local submission. Replies already in progress when the tab loads, regenerated replies without a new user turn, and replies whose generation could not be observed are skipped. An uncertain turn is skipped rather than treating loaded history as a new reply. A failed automatic click is not retried; use the native speaker button manually.

## Architecture and privacy

The existing Manifest V3 content script, popup, and synchronized settings remain. The obsolete proxy-button/menu layer has been removed because ChatGPT now provides the speaker button itself.

The only extension permission is `storage`, used for the popup settings. The content script examines DOM control attributes and temporary turn identifiers. It does not read, store, log, or transmit conversation text. Diagnostic output contains only event names, counts, booleans, and a temporary request sequence number; it never includes conversation text, DOM identifiers, or URLs. It adds no network requests, analytics, external speech services, or background worker. ChatGPT itself makes the requests required by its native audio service.

## DOM contract

The signed-in ChatGPT interface was inspected on 2026-10-19:

- Native speaker: `button[aria-label="Read aloud"][aria-pressed="false"]`. During a native playback request, its label changed to `Loading audio…` and it became disabled.
- Turn identity: enclosing `[data-turn-key]`; a turn includes its user message and assistant response.
- User marker: `[data-user-message-bubble]`.
- Assistant marker: `[data-conversation-role="assistant"]`.
- Completion marker: `[data-talvt-turn-state="complete"]`.
- Composer controls: `button[aria-label="Send"]` and `button[aria-label="Stop"]`.

The completion marker was also present while a new request was starting. It is therefore insufficient by itself. Turn binding and generation observation are recorded independently because those controls can render in separate batches. Stop removals and old labels are observed so a short generation is not lost between scans. Playback requires a bound new turn, the assistant marker, the completion marker, an enabled native speaker button, and no generation Stop button. The script never uses icon paths, positional button indexes, or More actions as a fallback.

These are private UI attributes and may change. If they disappear, autoplay fails closed instead of opening another action. The older `chat.openai.com` host match is retained for redirected tabs; the obsolete menu interface is not supported.

## Tests

For development, use Node.js 18 or later, then run `npm ci` and `npm test`.

The automated suite executes the actual content script against synthetic DOM fixtures using Node's test runner and jsdom. Fixtures reproduce the inspected turn/control attributes without conversation text. Tests cover completion timing, delayed and disabled controls, duplicates and remounts, historical mounts, sequential replies, settings, manual controls, media ownership, navigation, hidden tabs, IME input, failed submission expiry, and feedback styling. jsdom is a development dependency only and is not loaded by the extension.

Live browser verification is separate: signed-in DOM attributes and the native speaker's transition to `Loading audio…` were observed. The modified extension has not been installed in that browser, and audible playback has not been verified. Automated fixtures do not establish live audio success.

### Live acceptance checks

1. Load the unpacked extension, refresh ChatGPT, enable autoplay, and submit a short reply. Verify one automatic start through the native speaker, with no menu opening.
2. Load an existing chat, scroll through history, and toggle autoplay off/on. Verify no historical playback.
3. Submit a longer request, stop generation, and verify no automatic narration. Submit another request and verify normal autoplay.
4. Start or pause native narration manually while another response is pending. Verify the extension does not override it or restart it later.
5. Disable autoplay during generation, navigate away, or hide the tab. Verify the pending response does not start later.
6. Repeat from New chat and inside an existing chat. Check both Send and Enter submission.

ChatGPT's native audio availability and the browser's playback policy still apply. The extension does not bypass either.

## Version 1.2 investigation and temporary diagnostics

The user's Brave DevTools test verified that the native speaker selector and a programmatic page-console click work. Version 1.1 failed four added regression cases: a user turn mounted before Stop and completed with its speaker, a transient Stop control between scans, an in-place Stop-to-idle label change, and a delayed settings read overwriting a newer toggle. Version 1.2 fixes these reproduced defects. This does not establish which defect caused the reported Brave failure.

### Collect a focused Brave trace

1. Check out the PR branch `fix/native-read-aloud` and reload the unpacked extension at `brave://extensions`. Confirm version **1.2**, then refresh the ChatGPT tab. Refreshing replaces the old content script; merely reloading the extension does not update an already open page.
2. Open DevTools **Console**, enable **Info** messages, and filter for `ReadAloud`. On refresh, expect `[ReadAloud 1.2] content-script-loaded` and `settings-loaded`. If startup is absent, check the loaded extension directory, site access for `chatgpt.com`, enabled state, and extension errors. Version 1.1 messages/code indicate a stale tab or wrong directory.
3. In the popup, enable **Auto-play new responses** and **Diagnostic logging (temporary)**. Expect `diagnostics-enabled`, with marker counts, and `autoplay-setting` with `enabled: true`. This verifies the storage-change listener in the active tab. Toggle diagnostic logging off after the investigation.
4. Keep the tab visible, submit one short message, and wait for completion. Expect `submission-observed`, `response-bound`, `generation-observed`, `generation-complete`, `speaker-found`, `click-attempt`, and `click-dispatched`. Generation and binding can occur in either order. `click-observation` samples native control state after 300 ms; it is not proof of audible playback.
5. If playback fails, share only the filtered `ReadAloud` lines for that submission. Do not paste full console output or conversation DOM. The last waiting/cancellation event identifies the gate that blocked the attempt.

| Last event or finding | Meaning / next check |
| --- | --- |
| No `content-script-loaded` after refresh | Content script not active, site access blocked, stale tab, or wrong extension folder. |
| `settings-read-failed` / `settings-unavailable` | Extension storage could not be read; autoplay stays off. |
| `settings-loaded` with `autoPlayEnabled: false` | The active extension instance has autoplay disabled. |
| No `submission-observed` after Send | Submission control/input detection needs comparison with Brave's actual DOM. |
| `waiting-new-turn`, `turnCount: 0`, but `speakerCount > 0` | Speaker selector works, but Brave lacks the inspected turn markup; collect structural attributes before changing selectors. |
| `waiting-generation-evidence` | New turn bound, but no supported generation Stop control observed. |
| `waiting-assistant-completion` | Bound turn lacks the inspected assistant/completion markers. |
| `waiting-speaker` | Completion detected, but no native speaker inside that specific response. Global speaker count is diagnostic only, never a fallback click target. |
| `request-finished` | Reason explains cancellation or that the one click attempt was consumed. |
| `click-threw` | DOM click threw; no automatic retry. |
| `click-dispatched` without playback | Detection reached the click. Investigate native player behavior, browser audio policy, and execution context in Brave. |

### Execution context and verification limits

The content script stays in the default **ISOLATED** world with only the existing `storage` permission. [Chrome's content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) states that the page and content script share the DOM despite separate JavaScript environments. A DOM click is therefore a reasonable first approach; a successful page-console click alone does not prove the extension click will start audio. No MAIN-world bridge, script injection, audio-policy bypass, or additional permissions have been introduced without evidence that they are needed.

`click-attempt` reports the isolated-world configuration and browser user-activation booleans. These can help investigate browser playback policy, but they do not prove the cause of a failure. A native label/pressed-state transition confirms only UI activity, not audible playback.

Automated coverage is **36 passing Node/jsdom tests**, including content-script startup/settings, timing regressions, sanitized diagnostics, and actual popup preference reads/writes. The four new regression cases were also run against version 1.1 and failed there. Current read-only live inspection confirmed all three speaker buttons in the cloud test conversation were inside keyed, completed turns, had `aria-pressed="false"`, and lacked `data-testid`. This cloud DOM check does not verify Brave's ancestor markup.

An actual Chromium extension-context test could not run because the browser download returned an invalid archive. No real isolated-world audio or live Brave extension playback is claimed. Run the trace above in Brave, followed by the manual-control/history acceptance checks, before marking the PR ready or merging it.
