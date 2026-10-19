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

The only extension permission is `storage`, used for the two settings. The content script examines DOM control attributes and temporary turn identifiers. It does not read, store, log, or transmit conversation text. It adds no network requests, analytics, external speech services, or background worker. ChatGPT itself makes the requests required by its native audio service.

## DOM contract

The signed-in ChatGPT interface was inspected on 2026-10-19:

- Native speaker: `button[aria-label="Read aloud"][aria-pressed="false"]`. During a native playback request, its label changed to `Loading audio…` and it became disabled.
- Turn identity: enclosing `[data-turn-key]`; a turn includes its user message and assistant response.
- User marker: `[data-user-message-bubble]`.
- Assistant marker: `[data-conversation-role="assistant"]`.
- Completion marker: `[data-talvt-turn-state="complete"]`.
- Composer controls: `button[aria-label="Send"]` and `button[aria-label="Stop"]`.

The completion marker was also present while a new request was starting. It is therefore insufficient by itself. Playback requires a bound new turn, the assistant marker, the completion marker, an enabled native speaker button, and no generation Stop button. The script never uses icon paths, positional button indexes, or More actions as a fallback.

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
