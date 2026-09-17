# Local preview media cache

**Date:** 2 September 2026
**Status:** design approved, not yet planned or implemented

## Why

Hovering a bookmark makes the reader's browser talk to third parties. The preview
card sets `imageEl.src` to the remote og:image (`dashboard-preview.js:987`) and the
card favicon to a remote icon, so opening a dashboard page and moving the mouse
announces the reader to claude.ai, instagram, gstatic and whoever else a saved link
points at. For a self-hosted dashboard that is the wrong default.

The trigger was narrower — Safari refuses claude.ai's og:image because it is served
with `Cross-Origin-Resource-Policy: same-origin`, which logs three console errors and
leaves the card without a picture. Measured against the real cache, that is 2 of 16
images: 12 hosts send no CORP header and 2 send `cross-origin`. So the console noise
is not the reason to build this and would not justify it on its own. The privacy
property is.

## Scope

**In:** the card's og:image and the card's favicon, fetched server-side and served
from the reader's own origin.

**Out:** oEmbed players (`EmbedHTML`). An embed *is* a live third-party connection;
caching it is not possible and disabling it would be a behaviour change, not a cache.
Embeds already sit behind a `frame-src` boundary.

## 1. Storage

Directory: `data/preview-images/`.

Filename: `sha256(sourceURL)[:16] + ext`.

Addressed by **source URL, not by bytes**. Byte-addressing would dedupe two bookmarks
that share an image, but the local path then depends on content we may not have, so a
missing file needs a stored mapping to recover. Hashing the URL makes the path a pure
function of the source: a missing file is self-healing, because the worker can derive
what to fetch from the path alone. That property is what makes restore need no
reconciliation code (see §7). The cost is losing dedupe between two distinct URLs
serving identical bytes, which is rare.

Served through the existing narrow allowlist in `main.go:262` — one directory added
beside `icons/*`. Not a bare FileServer: that route is deliberately narrow because it
once exposed `settings.json` and every `bookmarks-N.json`.

## 2. Fetching — new `internal/app/preview_image_cache.go`

A sibling of `downloadIconFromURL` (`favicon_prefetch.go:53`), reusing:

- `newOutboundHTTPClient(allowLocal, timeout, maxRedirects)` — SSRF gate and redirect cap
- `isPublicHost` — private ranges refused unless local bookmarks are allowed
- `io.LimitReader` — bounded body
- `detectImageType` + content-type fallback — refuse anything that is not an image

Differences from the icon fetcher:

- **5 MB** per file rather than 2 MB. og:images are larger than favicons.
- **SVG is refused.** og:images are effectively never SVG, and `sanitizeSVGContent` is
  a liability worth avoiding where nothing needs it. Icons keep their own path and
  their sanitizer.

## 3. Hook point — `fetchBookmarkPreview` (`handlers.go:2432`)

The single choke point: a cache hit returns early, a miss fetches and parses. On the
miss path, the parsed image and icon URLs go to a bounded background worker (small
buffered queue, 2 workers).

The preview returns with an **empty** `Image`, not the remote URL — otherwise the
browser loads the third party anyway and the feature achieves nothing. So:

> `BookmarkPreview.Image` and `.Icon` mean "local path or nothing". They never hold a
> remote URL again.

New fields carry the origin:

- `ImageSource string` — the remote URL we intend to fetch or did fetch
- `IconSource string` — same for the card favicon

Without these, an evicted or missing file could never return without re-parsing the
page.

**First hover shows no picture.** That is the accepted trade: the card appears
immediately with its text and the image lands on the next hover. One slow host can
never hold up the UI.

**Watch:** the cache shortcut. New preview fields have been dropped before by the
early-return path that builds a preview from cache; both new fields must be carried
there too or they never arrive.

### Failed fetches

A source that 404s or times out must not be retried on every hover forever. The entry
records the attempt (`ImageFetchedAt`, set whether the fetch succeeded or not) and the
worker skips a source it already tried inside the preview TTL window. A refresh from
Config is the manual override, and the existing TTL expiry is the automatic one.

### Concurrent writes

Two bookmarks sharing a source URL resolve to the same filename, and both workers may
reach it at once. Writes go to a temp file in the same directory and are then renamed
into place, so a reader never sees a half-written image.

## 4. Eviction

Trigger: after every successful store.

Method: `os.ReadDir` the directory, stat for size and modtime, sort ascending by
modtime, delete until under the cap. No index file — an index can drift out of sync
with the disk; the disk cannot drift from itself. A few hundred files makes this
trivial, and it only runs after a write.

This is **oldest-first, not LRU.** modtime is the fetch moment, so an image looked at
daily can be evicted for age alone. The cost is one background download on the next
hover, not a permanent loss — that is what `ImageSource` is for. True LRU would cost a
write per hover, which is not worth it.

Default cap: **200 MB** (room for roughly a thousand images; small next to the 31 MB
`archives/`). Configurable: 50 / 200 / 500 MB.

No on/off switch for the feature. "Off" would mean hot-linking again, silently undoing
the privacy property — a trap, and not something that was asked for.

## 5. Config surface

Beside the existing `clearAllPreviews()` control (`dashboard-config.js:6604`):

- a read-out — "47 files, 8.2 MB of 200 MB"
- the cap as a choice of 50 / 200 / 500 MB
- **Remove cached images** → `POST /api/previews/images/clear`

The clear endpoint empties the directory and blanks `Image`/`Icon` in the preview
cache while keeping the `*Source` fields, so the images return on their own.

New setting: `PreviewImageCacheMB int`, with normalisation for values outside the
offered set.

Strings land in **all five locales** (`en`, `nl`, `de`, `fr`, `zh`), which are in
parity. The read-out contains counts and units, so it is a template with placeholders,
never assembled from fragments — that does not translate into Chinese. The What's New
entry stays English per convention.

## 6. Existing data

The 16 cached previews currently hold remote URLs in `Image`. One-time normalisation
on read — `Image` → `ImageSource`, `Image` cleared — in the shape of what
`normalizeHealthCacheFile` already does. The background worker fills them in
afterwards.

`Bookmark.PreviewImage` (`models.go:49`) is populated by the browser extension with a
remote URL and goes through the same normalisation.

## 7. Backup and restore

`preview-images/` is **excluded from the backup ZIP**, unconditionally, with
`filepath.SkipDir` in the `buildBackupZip` walk — the way `auto-backups/` already is.

This is not the default. `buildBackupZip` (`backup.go:777`) walks the whole data
directory and skips only `auto-backups/` and, optionally, `archives/`. A new directory
falls in automatically. The import allowlist (`backup.go:437-450`) accepts only
`icons/` and `archives/` as subdirectories, so without this change the result would be
ZIPs carrying up to 200 MB of images that are then *refused* on import: fat backups
that do not restore. Auto-backups are 1.8 MB today.

This follows the doctrine already written into that file: `preview-cache.json` and
`health-cache.json` are dropped on import because they are re-derived by scanning,
while `health-history.json` and `trash.json` are kept because they are measurements
that cannot be recomputed. Cached preview images are purely fetched — never authored
by the reader — so they belong with the first group. `icons/` is backed up precisely
because uploaded icons *are* irreplaceable. For "I want this kept", `archives/` already
exists and is included.

**No reconciliation code is needed on import.** A restored `Bookmark.PreviewImage`
points at a file that is not there; because the path is derived from the source URL
(§1), the worker re-fetches it, and until it lands the card hides the image via the
`error` listener at `dashboard-preview.js:708`.

## 8. Testing

Go:

- URL-addressing is stable — the same source URL yields the same filename
- eviction removes oldest first and stops at the cap
- the SSRF gate refuses a private host
- a non-image content-type is refused
- an oversized body is refused
- normalisation migrates a legacy remote URL into `ImageSource`
- a source that failed is not retried inside the TTL window
- `buildBackupZip` produces no `preview-images/` entries

Playwright:

- config shows the read-out; the clear button empties it
- a card renders a `/data/preview-images/` src and never an external host

## 9. Files

| | |
|---|---|
| New | `preview_image_cache.go` + tests (~350 lines) |
| Changed | `handlers.go`, `cache_store.go`, `models.go`, `main.go`, `backup.go` (~150) |
| Config | `dashboard-config.js` + HTML + 5 locales (~230) |
| Docs | changelog, MANUAL, help, What's New |

Roughly 10–13 files. About a day of focused work.

## Decisions taken deliberately

- oldest-first rather than LRU (§4)
- no on/off switch (§4)
- URL-addressed rather than byte-addressed, chosen for self-healing restore (§1, §7)
- SVG refused for preview images while icons keep their sanitizer (§2)
- embeds out of scope (Scope)
