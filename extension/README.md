# nextDash Bookmark Saver Extension

A browser extension that allows you to save bookmarks directly to your nextDash pages. It runs in Chromium-based browsers (Chrome, Edge, Brave, Vivaldi) and in Firefox 140 or later.

## Features

- **Save Tab**: Automatically detects the current page title and URL, allows editing the name, and saves to a selected nextDash page.
- **Save to Inbox**: Sends the tab to the nextDash Inbox, for links you have not filed yet.
- **Context menu**: Right-click a page or a link to save it to a page or to the Inbox.
- **Shortcuts**: `Ctrl+Shift+Y` (`Cmd+Shift+Y` on a Mac) quick-saves the tab with your defaults or the last used page and category; `Ctrl+Shift+U` (`Cmd+Shift+U`) saves it to the Inbox. The toolbar badge answers with **+** saved, **D** duplicate, **?** not set up yet, **!** failed.
- **Settings**: Configure the nextDash server URL and set a default page for saving bookmarks.
- **TUI Style**: Matches the terminal-inspired design of nextDash.

## Installation

### Chrome, Edge and other Chromium browsers

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select the `extension` folder from this repository
4. The extension should now be installed and visible in your extensions list

### Firefox

Install **nextDash Bookmark Saver** from [addons.mozilla.org](https://addons.mozilla.org/). Firefox only keeps add-ons that Mozilla has signed, so the `extension` folder cannot be installed there permanently.

When you click **Save Settings** for the first time, Firefox asks to let the extension reach your nextDash server. Allow it: without that access the popup cannot list your pages, and the shortcuts and context menu show **?** on the toolbar button. If you said no, click **Save Settings** again. You can also turn the access on in the extensions menu (puzzle icon) or under `about:addons` → nextDash Bookmark Saver → Permissions.

To change a shortcut, open `about:addons`, click the gear icon and choose **Manage Extension Shortcuts**. On Linux, Firefox uses `Ctrl+Shift+Y` for the Downloads window; pick another key there if the two collide.

## Usage

1. Click the extension icon in your browser toolbar
2. In the **Settings** tab:
   - Enter your nextDash server URL (e.g., `http://192.168.1.10:8080`)
   - If your server uses `NEXTDASH_WRITE_TOKEN`, paste the same value in **Write token (optional)**
   - Select your default page for saving bookmarks
   - Click "Save Settings"
3. In the **Save** tab:
   - The current page title and URL will be pre-filled
   - Edit the name if desired
   - Optional **shortcut** — leave empty for an auto-suggested key from the name, or type your own single-character shortcut
   - Select the page to save to (or use default)
   - Optional tags and note
   - Click "Save Bookmark", or "Save to Inbox"

## API Integration

The extension communicates with nextDash via the following API endpoints:

- `GET /api/pages` - Retrieves available pages
- `POST /api/bookmarks/add` - Adds a new bookmark to a page
- `POST /api/inbox` - Adds a link to the Inbox

## Development

To modify the extension:

- Edit `popup.html` for structure
- Edit `popup.css` for styling (uses CSS variables for theming)
- Edit `popup.js` for functionality
- Code shared by the popup and the background script lives in `save-common.js`

The code uses the `chrome.*` API, which Firefox supports as well, so both browsers run the same files. `manifest.json` is the Chromium manifest; the Firefox one is made from it by the build below.

### Shared bookmark-form modules

`extension/bookmark-form/` is a copy of `static/js/bookmark-form/`. Edit the **static** files as the source of truth, then sync into the extension:

```sh
./scripts/sync-extension-bookmark-form.sh
```

Make sure to reload the extension in `chrome://extensions/` after changes.

### Building for Chromium and Firefox

The build script is on the `dev` branch (`scripts/` is not part of `main`).

```sh
npm run build:extension
```

This writes an unpacked folder and a zip for each browser to `dist/extension/` (not checked in):

- `dist/extension/chromium/` and `nextdash-chromium-<version>.zip`
- `dist/extension/firefox/` and `nextdash-firefox-<version>.zip`

For one browser only: `node scripts/build-extension.mjs firefox` (or `chromium`).

The Firefox manifest differs from the Chromium one in three ways:

- `background.scripts` instead of `service_worker`. The list is read from the `importScripts(...)` call in `background.js`, so add a new helper there and both builds pick it up.
- `optional_host_permissions` instead of `host_permissions`. The popup asks for the server's origin when the settings are saved (`requestServerAccess` in `save-common.js`).
- `browser_specific_settings.gecko` with the add-on id `bookmark-saver@nextdash.cc`, `strict_min_version` 140 and `data_collection_permissions`. Firefox ties storage and updates to the id, so it must not change after the first signing.

Check the Firefox build against Mozilla's rules (the same checks addons.mozilla.org runs on upload):

```sh
npm run lint:extension-firefox
```

This fetches `web-ext` through `npx` on first use; it is not a project dependency.

`npm run test:extension-build` checks the build output itself.

### Trying the Firefox build

1. Run `npm run build:extension`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and choose `dist/extension/firefox/manifest.json`.
4. The add-on stays loaded until Firefox restarts. After a change, rebuild and click **Reload** on its card.

### Publishing on addons.mozilla.org

Publishing is a separate, manual step.

1. Raise `version` in `extension/manifest.json`; addons.mozilla.org refuses a version it has seen.
2. Run `npm run build:extension` and `npm run lint:extension-firefox`.
3. Sign in at the [Developer Hub](https://addons.mozilla.org/developers/) and choose **Submit a New Add-on** (the first time) or **Upload New Version**.
4. Upload `dist/extension/nextdash-firefox-<version>.zip`. Choose **On this site** to have it listed, or **On your own** for a signed `.xpi` to share yourself.
5. The code is not minified or bundled, so no source code upload is needed.
6. The first time, fill in the listing: description, icon, screenshots and the data the add-on sends (the URL and title you save, to your own nextDash server).

## Requirements

- nextDash server running and accessible
- A Chromium-based browser, or Firefox 140 or later
