# Split Translate

<img src="icons/icon128.png" width="64" alt="">

[日本語](README.ja.md)

A Chrome extension that opens the current page in Chrome's split view with the original on the left and a translation on the right. Scrolling and navigation stay in sync, so you can read both side by side and keep using the site.

- Translation runs on your device with Chrome's built-in [Translator API](https://developer.chrome.com/docs/ai/translator-api). Page content is never sent to an external server.
- The split view uses the [Split View API](https://developer.chrome.com/docs/extensions/reference/api/tabs) added in Chrome 155 (`splitWithTabId` in `tabs.create`).

## Requirements

- Chrome 155 or later (desktop)

## Install

1. Open `chrome://extensions` and turn on **Developer mode**
2. Click **Load unpacked** and select this folder (the one with `manifest.json`)
3. Pin **Split Translate** from the puzzle icon in the toolbar

No setup is needed. By default it translates English into your browser's display language (Japanese if that is English or unsupported).

## Usage

1. Click the toolbar button on the page you want to translate
   - The first time you use it on a site, Chrome asks for permission to access that site
2. The same page opens on the right in split view and is translated (a `●` badge appears on the toolbar button while the split view is active; hover over the button to see the current status)
3. Scroll either side and the other follows to the same position
4. Open another page on either side and the other side opens it too
5. Click the button again to close the translated tab. Unsplitting the tabs manually also stops syncing

Each language pair needs a one-time model download. If a **Start** button appears at the bottom right of the translated tab, click it. You can also download the model in advance from **Download translation model** on the settings page.

You can use the site normally on either side (type, post comments, click buttons). Clicks and input are not synced, so nothing is submitted twice. Input fields (such as `textarea`) and code (`code` / `pre`) are not translated.

## Settings

Right-click the toolbar button and choose **Options**. Changes are saved immediately.

| Setting | Default | Description |
|---|---|---|
| Original / Translate to | English → browser display language | The language pair to translate |
| Allow on all sites | Off | When off, permission is requested once per site. When on, it works on any site without asking |
| Sync scrolling | On | |
| Sync navigation | On | |

You can review or revoke site access at `chrome://extensions` → **Split Translate** → **Details** → **Site access**.

## How it works

- `src/background.js`: opens and closes the split view, tracks the original/translated tab pair, syncs navigation, and relays scroll positions
- `src/content.js`: translates the page (replacing text nodes only, so the DOM structure stays the same) and syncs scrolling. It is injected only into the two tabs of the split view
- `src/options.html` / `src/options.js`: settings page
- `src/shared.js`: default settings and helpers
- `_locales/`: UI strings (English, Japanese)

To sync scrolling, the extension sends the element at 25% of the viewport height and the position within that element to the other tab. Because the DOM structure is identical on both sides, the same paragraph lines up even when the translated text is longer or shorter.

## Limitations

- Text is translated node by node. A sentence split by bold text or links, such as `Click <b>here</b> to continue`, is translated in parts and may read unnaturally.
- If the two sides show different content (for example, a section is expanded on only one side), elements cannot be matched and scrolling falls back to the scroll percentage.
- After navigating to another site you have not granted access to, that page is not translated.
- It does not work on `chrome://` pages or the Chrome Web Store, and it does not translate inside iframes.

## Development / Testing

The E2E suite loads the extension into Playwright's bundled Chromium (Chrome for Testing 155+, which supports the Split View API and `--load-extension`) and checks the split view, translation, Chrome page-translate coexistence, scroll sync, and navigation sync.

```sh
npm install
npm test            # downloads Chromium on first run
HEADED=1 npm test   # watch the browser
```

The test runs against a patched copy of the extension in a temp directory: it grants `<all_urls>` up front (the permission dialog cannot be automated) and replaces the Translator API with a fake that returns `[ja] <text> <text>`, so no translation model is needed.

To check the UI strings for a specific locale, set `LOCALE=en` or `LOCALE=ja`. Without it, the test uses whatever language the browser starts in and skips the locale-specific checks. On macOS, Chrome picks the extension locale from the system language list rather than `--lang`, so set it for Chrome for Testing first and remove it afterwards:

```sh
defaults write com.google.chrome.for.testing AppleLanguages '(en)'
LOCALE=en npm test
defaults delete com.google.chrome.for.testing AppleLanguages
```

## Privacy

See [PRIVACY.md](PRIVACY.md). The extension collects no data.

## License

[MIT](LICENSE)
