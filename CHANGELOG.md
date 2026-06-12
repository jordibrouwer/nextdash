# nextDash — Changelog

Complete release history for [nextDash](README.md), in the same style as the in-app **What's new** modal: version tags, themed sections, and **new** / **fix** labels on each item.

For install and security, see the [README](README.md). For how to use features, see the [user manual](MANUAL.md). The dashboard **★** button and **Config → Advanced → What's new** show the latest highlights only.

---

## Table of contents

- [Unreleased](#unreleased)
- [v2026.06.17 — June 2026](#v20260617--june-2026)
- [v2026.06.16 — June 2026](#v20260616--june-2026)
- [v2026.06.15 — June 2026](#v20260615--june-2026)
- [v2026.06.14 — June 2026](#v20260614--june-2026)
- [v2026.06.13 — June 2026](#v20260613--june-2026)
- [v2026.06.12 — June 2026](#v20260612--june-2026)
- [v2026.06.11 — June 2026](#v20260611--june-2026)
- [v2026.06.10 — June 2026](#v20260610--june-2026)
- [v2026.06.9 — June 2026](#v2026069--june-2026)
- [v2026.06.8 — June 2026](#v2026068--june-2026)
- [v2026.06.7 — June 2026](#v2026067--june-2026)
- [v2026.06.6 — May 2026](#v2026066--may-2026)
- [v2026.06.5 — May 2026](#v2026065--may-2026)
- [v2026.06.4 — May 2026](#v2026064--may-2026)
- [v2026.06.3 — June 2026](#v2026063--june-2026)
- [v2026.06.2 — June 2026](#v2026062--june-2026)
- [v2026.06.1 — June 2026](#v2026061--june-2026)
- [v2026.05.7 — May 2026](#v2026057--may-2026)
- [v2026.05.6 — May 2026](#v2026056--may-2026)
- [v2026.05.5 — May 2026](#v2026055--may-2026)
- [v2026.05.4 — May 2026](#v2026054--may-2026)
- [v2026.05.3 — May 2026](#v2026053--may-2026)
- [v2026.05.2 — May 2026](#v2026052--may-2026)
- [v2026.05.1 — May 2026](#v2026051--may-2026)
- [v2026.05 — May 2026](#v202605--may-2026)
- [v2026.04 — April 2026](#v202604--april-2026)
- [v2026.03 — March 2026](#v202603--march-2026)
- [v2026.02 — February 2026](#v202602--february-2026)
- [v2026.01 and earlier — Foundation](#v202601-and-earlier--foundation)

---

## Unreleased

_No unreleased changes at this time._

---

## v2026.06.17 — June 2026

**Search guards, smart-collection sync, inline-edit polish, Config → General overhaul & structure-tab hardening** — `G` chord no longer leaks into page switch or shortcut search; search launcher keys respect overlays; inline delete and discard confirm work reliably over smart-collection rows with live sync to category columns and `allBookmarks`; reorder flush on navigation; page-rename error toast; Mac `Cmd+C` / `Cmd+Home`/`End`; overlay guards for swipe, omnibox, and paste during tag cloud. Config → General is reworked into Essentials / Advanced / All layers with restructured panels, sticky section nav, expand/collapse all, hash + sessionStorage deep links, ↺ resets on dozens of controls, expanded ℹ help, settings-search subtitles and panel expansion, mobile General search, 11-step General tour, smart-collection master sync, reset-card guard, and many form/a11y fixes. Config → Theme gains a packaged-themes editor, export/import, undo, scoped preview, and mobile read-only mode. Config → Pages and Categories get ID-safe remove/merge/archive, debounced reorder auto-save, keyboard ↑/↓, localized sync toasts, and mobile/search/tour polish.

### Dashboard

- **fix** **Smart collection sync** — inline edit and delete from smart-collection rows update the canonical bookmark on the page and `allBookmarks`; `note` and `tags` stay in sync across columns; delete undo restores the global view too.
- **fix** **Inline delete confirm** — delete from the inline editor no longer conflicts with click-outside handlers; the confirm modal stacks above the editor with correct focus.
- **fix** **Discard confirm modal** — unsaved inline-edit dismiss uses `AppModal` instead of a native browser dialog.
- **fix** **Reorder flush** — debounced bookmark reorder persists immediately on page switch or tab hide (mirrors category-order flush).
- **fix** **Page rename errors** — failed page-tab rename rolls back the local name and shows a localized error toast.
- **fix** **Neutral grid on page switch** — keyboard selection clears on page change unless you were already navigating with the keyboard.

### Keyboard & search

- **fix** **G chord** — `G` then `1–9` jumps to a category only; it no longer switches pages or feeds into shortcut search.
- **fix** **Search overlay guards** — `>`, `:`, `?`, `+`, and `&` are blocked while page overview, omnibox, inline edit, tag cloud, or other modals are open.
- **fix** **Search ghost overlay** — rebuilding shortcuts after a page switch or reorder closes an open search UI instead of leaving a stale overlay.
- **fix** **Page shortcuts vs search** — `1–9` and `Shift+←/→` no longer change pages while the search overlay is active.
- **fix** **Delete on smart rows** — the `Delete` key resolves the bookmark by URL/reference (same as `;`) so it works on smart-collection copies.
- **fix** **Mac shortcuts** — `Cmd+C` copies the selected URL; `Cmd+Home` / `Cmd+End` jump to the first/last bookmark on the page.
- **fix** **Swipe & omnibox guards** — horizontal swipes and keyboard grid navigation respect `isModalOpen()` (page overview, omnibox, app modal).
- **fix** **Paste during tag cloud** — `Ctrl+V` quick-add paste is ignored while the tag word cloud is open.

### Accessibility

- **fix** **Page overview** — desktop close button; focus returns to the trigger; list wraps at the ends; visible page names use locale fallbacks.
- **fix** **Omnibox focus** — closing the quick-add omnibox restores keyboard focus to the prior control.
- **fix** **Search input a11y** — mobile search field and bookmark grid use `data-i18n-aria` labels in EN / NL / DE / FR.

### Config → General — Layers & panels

- **new** **Essentials / Advanced / All** — three views on `config#general` with a persisted layer preference (`localStorage`), per-layer intros, and **Show all sections on one page** as a third tab with `aria-selected`.
- **new** **Panel restructure** — Appearance split into essentials vs advanced; everyday bookmark options moved to **Bookmarks (essentials)**; compact **Smart collections** and **Status monitoring** summaries in Essentials; full tuning stays under Advanced.
- **new** **Collapsible sections** — every General card can collapse/expand (click or keyboard on the title); state persists per panel; default open sets differ per layer; the **Reset** card always starts collapsed.
- **new** **Hash deep links** — `#general/advanced/layout` opens the right layer and scrolls to the panel; `sessionStorage` restores your General sub-path when you switch away and back from another config tab.
- **new** **Smart collections summary** — Essentials shows an enabled count (*{count} of {total}*) and a master toggle that mirrors the individual collection checkboxes.
- **new** **Status essentials** — compact on/off summary with monitored bookmark count and a contextual **Health →** link; refreshes when the header health badge updates.

### Config → General — Navigation & search

- **new** **Section nav** — sticky jump links for every Essentials and Advanced panel (including separate *Smart (overview)* vs *Smart (settings)*); horizontal scroll on narrow widths; active link highlights while you scroll (`IntersectionObserver`, tuned for All view).
- **new** **Expand / collapse all** — bulk controls in the All view; respects the always-collapsed Reset card and syncs expand state + reset-button guard.
- **new** **Jump to Advanced** — summary panels link deeper settings with a toast (*Switched to Advanced*) and automatic layer switch + scroll.
- **new** **Settings search** — results show `Tab › Layer › Section` subtitles; matching General panels expand before scroll; Help blocks scroll to the right anchor; General tour step for `Ctrl+Shift+K` / `Cmd+Shift+K` (desktop only).
- **new** **Mobile search in General** — on phone, settings search moves into the General tab and indexes only language, theme, and layout panels with a device-specific label.
- **new** **Scroll margins** — panel jump targets account for the sticky save bar and section nav (`scroll-margin-top` / tour scroll padding).

### Config → General — Resets, ℹ help & polish

- **new** **↺ Reset to default** — per-control reset on theme, layout version/preset, sort, columns, density, font preset/weight/size group, background type/opacity/gradient grid/image URL, weather, date/time formats, link-preview delay, status retries, smart-collection limits/keywords/page picks, search flags, bookmark display toggles, and more; tooltip shows previous vs default value.
- **new** **More ℹ info buttons** — short explanations added for packed columns, rotating tips, Hypr mode, fuzzy search, interleave mode, search-flow banner, finders-in-search, sync toasts, page tabs, tag cloud, health dashboard, status retries, bookmark preview maintenance, and related toggles.
- **new** **Theme editor link** — **Open theme editor →** from Appearance essentials with unsaved General/colour guards before navigating to `#colors`.
- **new** **Theme icon styling** — favicon harmonization controls mark the form dirty and show a *Preview only — click Save* hint instead of autosaving immediately.
- **new** **Language hint** — *Language changes apply immediately (no Save needed)* under the language dropdown; option names follow the current UI language.
- **new** **Gradient preset names** — background gradient chips use localized display names in EN / NL / DE / FR.
- **new** **Mobile General UX** — device-specific intro; layer toolbar, section nav, and bulk bar hidden on phone; named toast when a hidden panel is requested (*"{name}" is only available on a wider screen*); layout restores on resize.
- **new** **General tour (11 steps)** — adds a desktop **Search settings…** step before Save; skipped on mobile when the search field is not shown.

### Config → General — Fixes

- **fix** **Smart collections master** — Essentials master toggle syncs child checkboxes, dirty state, and the enabled-count line; `updateFromUI` re-syncs before save.
- **fix** **Hash & panel open** — bare `#general` keeps your stored layer (not forced to Essentials); nav links, hash routes, and settings-search hits force collapsed panels open.
- **fix** **Reset section guard** — destructive **Reset all data** button stays disabled until the Reset card is expanded.
- **fix** **↺ control sync** — custom selects, range sliders, and number inputs refresh their UI after reset; duplicate reset listeners prevented (`data-setting-reset-bound`).
- **fix** **Form readback** — `updateFromUI` reads font size from the active button, gradient from the active preset chip, and guards invalid column input (`NaN`).
- **fix** **Checkbox cascades** — page-tab names depend on **Show page tabs**; turning status monitoring off clears **Show ping**; smart-collection label clicks no longer toggle the parent card.
- **fix** **Defaults & markup** — `showTips` defaults to on; Add-bookmark footer button no longer ships `checked` in HTML; `tag-collections-min-count` row has a stable `id` for show/hide logic.
- **fix** **Accessibility labels** — breadcrumb, layer toolbar, advanced nav, columns steppers, and custom title field use `data-i18n-aria` in EN / NL / DE / FR; collapsible titles expose `aria-expanded`.

### Config → Theme

- **new** **Packaged themes editor** — fourth subtab edits built-in palette families; activate under General → Appearance, then Save in the config header.
- **new** **Export / import** — download active dark, light, custom, or packaged palette as JSON; import merges into the editor (Save colors to persist).
- **new** **Undo & reorder** — per-session undo stack; ↑/↓ reorders custom themes in the list.
- **new** **Scoped live preview** — preview CSS on palette cards only; contrast warning when primary text vs background is too low.
- **new** **Mobile viewer** — Theme tab read-only on phone with a banner; editing needs a wider screen.
- **fix** **Navigation guards** — unsaved-colour leave reloads from disk after confirm; `#colors` subtab restores from hash + `sessionStorage`; tab revisit reloads when another tab saved colours.
- **fix** **Custom theme autosave** — rename debounces to server; built-in edits merge on save only (`sanitizeColorTheme`); rgba/hex validation and `--accent-primary` mapping.
- **fix** **Editor shortcuts & search** — `S` saves colours from the editor; settings search indexes colour subtabs and groups; localized preview labels in EN / NL / DE / FR.

### Config → Pages

- **fix** **ID-based actions** — remove, archive, and restore use page id (not list index) so drag-reorder cannot target the wrong row.
- **new** **Auto-save reorder** — drag or ↑/↓ on a focused row debounces ~600 ms, syncs to disk, localized dashboard-sync toast; dirty state clears after success.
- **new** **Archive** — hide a page from dashboard and page picker without deleting bookmarks; restore from Structure or archived list.
- **new** **List & a11y** — semantic `<ul>` page list, visually hidden name labels, keyboard reorder, intro hint (drag, archive, rename).
- **fix** **Selectors & templates** — page dropdowns use visible (non-archived) pages; new-page templates ship localized default category names; mobile blocks page management with a toast.
- **fix** **Tour & search** — pages tour uses shared reorder handler; Escape dismisses without marking complete; settings search finds + Add page and archive.

### Config → Categories

- **fix** **ID-based actions** — remove and merge use category id (not list index).
- **new** **Auto-save reorder** — drag or ↑/↓ in config → categories debounces ~600 ms with localized sync toast.
- **new** **Bookmark counts** — each row shows bookmark count; merge modal previews how many will move.
- **new** **Page switch flush** — categories page selector saves pending order, names, and icons before loading another page.
- **fix** **Delete flow** — impacted bookmarks counted on the categories page even when bookmarks tab shows a different page.
- **fix** **Validation & polish** — duplicate/empty names blocked on persist; icon autosave on blur; empty-state hint; mobile guard; settings search indexes add-category and merge; tour a11y + Escape dismiss.

### Documentation

- **fix** **README & MANUAL** — smart-collection inline edit/delete sync, `G` chord vs page switch, `Ctrl`/`Cmd+Home`/`End`, overlay paste guards, Config → General layers, and Config → Theme / Pages / Categories structure-tab polish for v2026.06.17.
- **fix** **In-app Help (EN / NL / DE / FR)** — What's new recap lists v2026.06.17 dashboard search guards, smart-collection sync, General overhaul, and Theme / Pages / Categories updates.

### Developer

- **fix** **Cache-bust** — `whats-new-v66` data version; Config Theme (`colors.js`, `color-value-utils.js`), Pages (`config-pages.js`), and Categories (`config-categories.js`) assets plus existing General/dashboard query strings updated for Docker-mounted static files.

---

## v2026.06.16 — June 2026

**What's new lazy loading, dashboard hardening, keyboard & inline-edit polish, navigation guards, overlay fixes & i18n** — per-release JSON for the ★ modal with scroll fetch and skeleton; shorter Ko-fi intro; page-scoped async saves; serialized bookmark POSTs; debounced reorder save with toast; tab-close reorder keepalive; inline-edit confirm on page/config/tag-filter change; page-overview keyboard fixes; swipe/paste blocked during inline edit; page-move rollback; keyboard paused during inline edit; Shift+Arrow vs grid-nav fix; find-hidden rows skipped; smart-collection refresh without full re-render; page-tab and page-overview a11y; preview/recent/error i18n; http(s)-only images and recent-modal links; opaque inline-edit panel in glass launcher; mouse-softened keyboard highlight; skipped collapsed/dimmed rows; localized toasts and error messages.

### What's new modal

- **new** **Lazy-loaded release history** — latest release renders first; older releases fetch on scroll with inline skeleton placeholders.
- **new** **Stub bootstrap** — `whats-new-stub.js` sets the release token and loads `whats-new-modal.js` on first open; content lives in `/static/data/whats-new/*.json`.
- **fix** **Shorter support intro** — concise Ko-fi message at the top of the ★ modal.

### Dashboard

- **fix** **Inline shortcut conflict** — cross-page shortcut warnings only apply when **Global shortcuts** is enabled; per-page shortcuts no longer false-positive on other pages.
- **fix** **Category order on page switch** — debounced category reorder flushes before loading another page so order is not lost within the 1s save window.
- **fix** **Open tracking** — middle-click on a bookmark row increments `openCount` / smart-collection recency (primary click and keyboard **Enter** already did via `click`).
- **fix** **Page-scoped saves** — bookmark and category POSTs capture page id and payload at save start; in-flight saves are awaited before page switch so reorder data cannot write to the wrong page.
- **fix** **Move popover** — `Shift+M` outside-click and **Escape** listeners clean up correctly; toggle-close no longer leaks global key handlers.
- **fix** **Smart collections after open** — opening a bookmark refreshes smart-collection sections only (when enabled) instead of full `renderDashboard()`; skipped during inline edit.
- **fix** **Inline edit on re-render** — page switch and full re-render abort active inline edit state instead of leaving stale handlers.
- **fix** **Find filter** — interleave/find matches bookmark names via `.bookmark-text` (not a missing `.bookmark-name` selector).
- **fix** **Launcher search dimming** — compares canonical URL keys on both search matches and dashboard rows.
- **fix** **Drag reorder mismatch** — if DOM bookmark count drifts during drag, the grid re-renders from saved state instead of silently ignoring the drop.
- **fix** **HyprMode middle-click** — middle-click respects Hypr routing the same way as primary click when Hypr mode is on.
- **fix** **Preview metadata saves** — link preview title/description/image writes are debounced (1s) and flush on page switch or tab hide.
- **fix** **Open analytics index** — open count and `/api/track-open` prefer `data-bookmark-index` so duplicate URLs attribute to the correct bookmark.
- **fix** **Inline edit panel** — opaque themed background and clear border in classic, modern, and glass layouts; launcher tiles no longer blur the editor through `backdrop-filter`.
- **fix** **Inline edit toasts** — icon, upload, and shortcut notifications use locale strings in EN / NL / DE / FR.
- **fix** **Serialized bookmark saves** — `saveBookmarkOrder` chains on the prior in-flight POST so rapid reorders and inline edits cannot overwrite each other.
- **fix** **Tab-close reorder flush** — `flushPendingDashboardSavesOnExit` treats `pendingReorderSnapshot` / `_bookmarkOrderSaveInFlight` as pending reorder state for keepalive POSTs.
- **fix** **Inline edit page switch** — `requestPageNavigation` confirms before discarding unsaved inline edits (tabs, `1–9`, `Shift+←/→`, page overview, swipe, hash).
- **fix** **Extension reload guard** — `nextdash:bookmark-saved` skips full reload while inline edit is active.
- **fix** **Smart collection titles** — Recently opened, Stale bookmarks, and Most used use locale strings.
- **fix** **Delete toast i18n** — `dashboard.bookmarkDeleted` in EN / NL / DE / FR.
- **fix** **Inline edit guards** — config sync and tag-filter changes confirm before discarding unsaved edits; **Esc** and click-outside use the same discard prompt.
- **fix** **Inline page-move rollback** — page move no longer mutates `this.bookmarks` before API success; failed moves restore local state and remove `bookmark-move-out`.
- **fix** **Debounced reorder save** — drag reorder POSTs debounce 1s (like categories) and show a localized success toast.
- **fix** **More dashboard i18n** — move-to-page, load/save errors, stale-section info, shortcut conflicts, and preview usage lines localized.
- **fix** **Remote edit/delete errors** — settings save, move, delete, and cross-page edit failures use localized dashboard strings.
- **fix** **Preview & recent labels** — untitled preview links and missing category labels localized.
- **fix** **Fewer redundant renders** — initial load and inline page-move skip duplicate `renderDashboard()` calls.

### Keyboard & mobile

- **new** **Mouse + keyboard hybrid** — hovering bookmarks softens the stale keyboard highlight until the next keyboard move.
- **fix** **Grid navigation** — first arrow key starts navigation; switching pages with `1–9` selects the first visible bookmark automatically.
- **fix** **Skipped rows** — collapsed categories and launcher tiles dimmed by search are excluded from keyboard navigation.
- **fix** **Screen reader announcements** — `aria-live` region speaks the selected bookmark name on keyboard move.
- **fix** **Reduced motion** — keyboard `scrollIntoView` uses instant scroll when animations are disabled.
- **fix** **Row highlight transitions** — bookmark hover/selection fades smoothly (respects `no-animations`).
- **fix** **Swipe page change** — touch swipes no longer double-fire on the same gesture; pointer events on modern browsers with a short navigation lock.
- **fix** **Shift+Arrow page keys** — `Shift+←/→` no longer also moves the bookmark grid in capture-phase keyboard nav.
- **fix** **Collapsed category highlight** — `keyboard-selected` clears when the selected row leaves the navigable set.
- **fix** **Swipe guards** — horizontal swipes ignored while modal, tag cloud, or search is open; page swipes use inline-edit discard confirm.
- **fix** **Inline edit keyboard pause** — grid navigation disabled while inline editor is open; page keys `1–9` blocked during inline edit.
- **fix** **Find-hidden rows** — bookmarks hidden by find filter excluded from keyboard navigation.
- **fix** **Esc undo reorder** — cheat sheet and rotating tips document **Esc** undo for unsaved drag reorders.
- **fix** **Page overview keyboard** — arrow keys no longer move the bookmark grid behind the `,` overlay; **Shift+Tab** moves up correctly.
- **fix** **Inline edit input guards** — swipe and **Ctrl+V** paste blocked while inline editor is open.
- **fix** **Overlay stacking** — **F1** / `!` cheat sheet no longer opens on top of page overview.

### Accessibility

- **fix** **Page tab semantics** — `tablist` / `tab` roles, `aria-selected`, and `:focus-visible` ring on page tabs.
- **fix** **Page overview labels** — each page row announces name and bookmark count to screen readers.
- **fix** **Preview card image alt** — preview thumbnails use link title as `alt` text.
- **fix** **Skip link focus** — skip-to-content uses `:focus-visible` (keyboard only).

### Security

- **fix** **Safe image URLs** — custom dashboard background images and hover/link preview images only render normalized `http`/`https` URLs via `BookmarkUrlUtils.safeHttpResourceUrl` / `safeCssImageUrl` (blocks `javascript:`, `data:`, and CSS quote-breakout).
- **fix** **Recent modal links** — `*` recent-bookmark rows and bulk-open actions only use validated `http`/`https` URLs.

### Monitoring

- **fix** **Status dots on duplicate URLs** — status monitoring targets the correct row via `data-bookmark-index`, not only the first matching URL.

### Documentation

- **fix** **README & MANUAL** — page-overview keyboard, paste/swipe during inline edit, and error-toast i18n for v2026.06.16.
- **fix** **In-app Help (EN / NL / DE / FR)** — What's new recap lists v2026.06.16 overlay fixes and dashboard polish.

### Developer

- **fix** **Cache-bust** — `whats-new-v62` data version and `2026.06-dashboard-release-v56` dashboard release token; `dashboard.js`, `keyboard-navigation.js`, and `swipe-navigation.js` query strings for Docker-mounted static files.
- **fix** **Keyboard & swipe cleanup** — `KeyboardNavigation.cleanup()` and `SwipeNavigation.cleanup()` on `pagehide`.
- **fix** **Inline icon-fetch timer** — auto-favicon timers cleared on inline-edit close/abort.
- **fix** **What's new JSON tracked** — `.gitignore` exception for `static/data/whats-new/` so per-release JSON ships with the repo.

---

## v2026.06.15 — June 2026

**General config tour restore, settings search promo reliability, simplified discoverability, config save/unsaved alignment** — queue bar removed; What's new and spotlights reset individually; layout and paste replay from config; confirmed-dismiss storage for search promo auto-start; post-onboarding chain hardening; guided-flow and overlay visibility fixes; mobile config search sync both ways; snapshot dirty tracking and quieter save toasts.

### Discoverability simplify

- **refactor** **Discoverability queue removed** — drop the post-onboarding queue chain, **Tip X of Y** bar, **Later this session** coordinator, and `discoverability-queue` JS/CSS; What's new still auto-opens when unread; layout and paste spotlights reset from **Advanced → System → Tours & onboarding**.
- **fix** **Dashboard post-onboarding** — What's new → layout-nudge → paste spotlight run directly again (no queue module); hardened scheduling after queue removal.
- **fix** **Post-onboarding chain hardening** — What's new retries when blocked instead of skipping for the session; polling capped after ~30s; open-abort retries capped at 20; layout nudge reset from config runs the full chain again (not layout-only).
- **fix** **isModalOpen visibility** — post-onboarding prompts only wait for actually visible overlays (`#app-modal`, spotlights, tour/onboarding cards), not stale DOM or `guided-flow-locked` alone.

### Config guided tours

- **new** **General config tour restored** — first desktop visit to **Config → General** shows the overview guided tour again (Essentials / Advanced layers, no user input); reset from **Advanced → Tours & onboarding → General**.
- **fix** **Recoverable guided flow** — stale tour DOM teardown, scroll-lock recovery, and watchdog when the tour card stays hidden; cache-bust on tour JS/CSS; settings search promo reschedules when the tour ends or is torn down.
- **fix** **Guided flow stale tour cards** — GuidedFlowGuard ignores invisible tour DOM so `guided-flow-locked` does not stick after a tour ends.
- **fix** **Guided flow invisible overlays** — onboarding and feature-tour overlays use the same visibility check (not only config tour cards).

### Layout discoverability

- **fix** **Layout nudge replay** — reset from config queues a replay when no dashboard tab is open; dashboard init consumes the pending flag and runs the full post-onboarding chain; clears legacy `nextdash:discoverability-deferred` session keys.
- **fix** **Layout nudge reset feedback** — clearer success messages when the layout prompt shows immediately vs when you need to open or reload the dashboard (EN/NL/DE/FR).
- **fix** **Paste spotlight replay** — reset from config queues a replay when no dashboard tab is open; dashboard init consumes the pending flag and runs the post-onboarding chain.

### Config & search

- **fix** **Settings search promo auto-start** — confirmed-dismiss storage (`promo-confirmed-v1`) avoids false “seen” flags from focus-before-show; retry fallbacks at 1.5s / 3.5s / 7s; schedules after full config load and when switching to the General tab.
- **fix** **Settings search mobile resize** — re-inits listeners when widening the config window after loading on mobile.
- **fix** **Settings search desktop→mobile resize** — hides the search field and dismisses the promo when narrowing the config window.
- **fix** **Settings search promo during tours** — waits until config tours finish instead of forcing after 45s; detects open What's new via AppModal overlay.
- **new** **Reset settings search promo** — **Advanced → Tours & onboarding → Reset settings search promo** replays the pulsing field and speech balloon on desktop.

### Config save state

- **fix** **Config unsaved state** — snapshot-based dirty tracking waits for categories to load before the baseline; autosaved settings (language, layout, low-risk toggles) clear the unsaved badge when nothing else changed.
- **fix** **Conflicting save feedback** — **All saved ✓** no longer appears alongside the unsaved badge; autosave and manual Save share the same dirty baseline.
- **fix** **Quieter save toasts** — settings-only Save shows header confirmation only; the bottom-right “return to dashboard” toast stays for bookmarks, pages, categories, finders, and duplicate-URL warnings.

### Dashboard

- **fix** **Search flow hint** — only shows after onboarding is completed; hidden during first-run wizard; clears `search-flow-hint-v2` when onboarding starts so the hint can appear afterward.

### Documentation

- **fix** **MANUAL** — post-onboarding discoverability flow updated after queue removal.
- **fix** **In-app Help locales** — EN/NL/DE/FR Help pages aligned with v2026.06.15 discoverability (no queue references; General tour and search promo).

### Developer

- **fix** **Cache-bust** — `whats-new-modal.js`, `config-settings-search.js` (`settings-search-promo-v6`), `config-settings-search.css`, `guided-flow-guard.js` (`guided-flow-v3`), `feature-spotlight.js` (`paste-replay-v1`), `layout-modern-nudge.js`, and General tour assets carry version query strings for Docker-mounted static files.

---

## v2026.06.14 — June 2026

**Health badge parity, discoverability on config, Docker cache-bust** — shared `HealthBadgeUtils`, live badge refresh after config sync, queue on config and dashboard, GHCR docs aligned, MANUAL updates.

### Health discoverability

- **fix** **Shared health badge helper** — `HealthBadgeUtils` drives dashboard and config header badges (broken/warning counts, `/health?filter=broken` routing, badge DOM) from one module.
- **fix** **Config badge parity** — config header warnings include shortcut conflicts (same as dashboard); badge refreshes when the browser tab becomes visible again after visiting health or the dashboard.
- **fix** **Live config sync badge** — dashboard header health badge refreshes after live config structure sync (cross-tab bookmark edits), without switching tabs.

### Layout discoverability

- **fix** **Queue numbering** — post-onboarding discoverability shows **Tip 1 of 3** on the What's new modal (when unread), then layout-nudge and paste spotlights; **Later this session** on all three steps.
- **fix** **Config discoverability queue** — post-onboarding tips (What's new, layout-nudge) also run when users open config first; paste spotlight stays dashboard-only; layout choices from the nudge save via config when no dashboard tab is open.
- **fix** **Queue reset on config** — Advanced reset buttons for the discoverability queue and layout nudge also replay the queue on the current config page.

### Docker & deploy

- **fix** **Cache-bust** — template query strings for `whats-new-modal.js`, `discoverability-queue` JS/CSS, and `health-badge-utils.js` so Docker-mounted static files refresh without a hard reload.
- **fix** **GHCR image name** — README and MANUAL use `ghcr.io/jordibrouwer/nextdash` (lowercase), matching GHCR and the Unraid template.

### Documentation

- **fix** **MANUAL** — discoverability queue flow (Tip X of Y, Later this session) and Essentials **Health →** broken-filter routing documented.

### Developer

- **fix** **Go test stability** — tests use `t.Chdir` for temp directories so repeated `go test -count` runs no longer flake on `TempDir` cleanup.
- **chore** **`scripts/` directory** — `.gitkeep` tracks the folder; local debug scripts (e.g. Playwright) remain gitignored.

---

## v2026.06.13 — June 2026

**Security hardening, backup/import reliability, health cache fixes, config & search polish** — DNS-rebinding dial checks, expanded write-token coverage, atomic ZIP import, canonical URL keys (incl. default ports), async favicon prefetch, settings export/import, dashboard inline-edit persistence, health duplicate-merge metadata.

### Security & uploads

- **fix** **CSS injection** — color values stored via `/api/colors` are validated against an allowlist before being written into `theme.css`; theme IDs are sanitized to alphanumeric/dash characters only.
- **fix** **TLS verification** — `InsecureSkipVerify` removed from the HTTP client used for bookmark ping checks; certificate validation is enforced.
- **fix** **Security headers** — all responses include `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN` via global middleware.
- **fix** **Request body limit** — non-multipart (JSON) bodies are capped at 4 MB; upload and backup endpoints keep their own limits via `ParseMultipartForm`.
- **fix** **Write-token coverage (mutations)** — `requireWriteAccess` on `SaveBookmarks`, `AddBookmark`, `ImportBrowserBookmarks`, `DeleteBookmark`, `SaveFinders`, `SaveCategories`, `SavePages`, `SaveSettings`, `SaveColors`, and all upload handlers (`UploadFavicon`, `UploadFont`, `UploadIcon`, `UploadIconFromURL`).
- **fix** **Write-token coverage (heavy reads)** — when `NEXTDASH_WRITE_TOKEN` is set: `GET /api/backup`, `GET /api/bookmark-preview`, `POST /api/search-index`, `POST /api/health/open-broken`, `GET /api/health/auto-heal-suggest`. Dashboard, config, and health pages inject the token via meta tag; extension uses stored write token.
- **fix** **DNS-rebinding protection** — shared outbound HTTP clients validate resolved IPs at dial time; private/loopback/link-local targets are rejected unless `allowLocalBookmarks` is enabled.
- **fix** **SVG stored XSS** — uploaded and downloaded SVG icons are sanitized server-side (`<script>`, `on*` handlers, `javascript:` hrefs stripped).
- **fix** **Magic-byte uploads** — icon and favicon uploads use `detectImageType`; font uploads use `detectFontType` (WOFF/WOFF2/TTF/OTF) instead of trusting client `Content-Type` or filename.
- **fix** **Category modal XSS** — category delete/merge modal options are HTML-escaped; unsafe icon filenames are rejected on save.
- **fix** **`UploadIconFromURL`** — respects `allowLocalBookmarks` for localhost/private icon sources (same SSRF rules as other fetchers).

### Backup, import & reset

- **new** **Atomic ZIP import** — staged temp directory, orphan icon cleanup, removal of extra `bookmarks-*.json` and managed root files not in the archive; clears preview/health caches after commit.
- **fix** **Import URL order** — `settings.json` from the ZIP is read first so `allowLocalBookmarks` applies before bookmark URL validation.
- **fix** **Backup icon paths** — root-level images in `data/` export as `icons/<basename>` for stable backup → import round-trips; duplicate root/icons entries are deduplicated on import.
- **fix** **Factory reset scope** — removes `data/icons/`, custom favicon/font, preview and health caches, and recreates defaults; UI copy updated (EN/NL/DE/FR).
- **new** **Settings export/import** — export or import `settings.json` from Config → Backups; import strips migration markers and validates file size.
- **new** **Last backup date** — backups panel shows the date of the last ZIP backup (localStorage).
- **fix** **ZIP import icons** — sanitized bookmark JSON always written when URLs are skipped; icon filenames sanitized on import.

### Health, cache & analytics

- **fix** **Preview/health cache races** — atomic read-merge-write under mutex for preview and health cache files.
- **fix** **Canonical URL keys** — `CheckDuplicates`, health cache, status monitor in-memory cache, and `BookmarkURLExists` (ping gate) use `canonicalBookmarkURLKey` (`https://x` ≡ `https://x/` ≡ `https://x:443`; `http://x:80` ≡ `http://x`).
- **fix** **Health duplicate merge** — merging duplicate URL groups combines metadata (tags, shortcut, opens, notes, icons, preview fields) into the kept bookmark instead of discarding it.
- **fix** **`TrackBookmarkOpen`** — open count and `lastOpened` updated atomically in the store (no lost increments on rapid opens).
- **fix** **`UploadIcon` overwrite** — re-uploading the same icon filename replaces the existing file.
- **new** **Async favicon prefetch** — default bookmark favicons after install/reset prefetch in a background goroutine (startup no longer blocks on network).
- **fix** **Prefetch merge-safe save** — concurrent favicon prefetch merges into bookmarks only when index and canonical URL still match and icon is empty.

### Dashboard — bookmarks & editing

- **fix** **Inline edit persistence** — dashboard rename and delete save immediately (no debounced delay); pending bookmark lists flush on page hide/refresh so changes survive reload.
- **fix** **Store write failures** — bookmark/page/settings saves return HTTP 500 when disk writes fail instead of reporting success to the client.

### Config, bookmarks & search

- **fix** **Write-token gaps** — health dashboard mutations and config bookmarks-tour add/delete calls use the shared write-token fetch helpers when `NEXTDASH_WRITE_TOKEN` is set.
- **fix** **Keyboard shortcuts docs** — cheatsheet, help locales, and config tour copy aligned with dashboard bindings (`1`–`9` page tabs, category jump keys, etc.).
- **new** **Link-preview icon fetch** — bookmark detail can pull favicons from link preview with UI feedback; async generation token prevents stale overwrites.
- **new** **URL protocol hint** — detail panel hints and normalizes missing `https://` on blur.
- **new** **Config tab keyboard nav** — arrow keys move between visible config tabs.
- **new** **Drag reorder hints** — localized grip-handle hints in dashboard, categories, and tours.
- **fix** **Icon dirty state** — icon fetch, upload, clear, and undo mark config as unsaved.
- **fix** **Tag autocomplete** — improved empty-input behaviour and candidate list.
- **fix** **Bookmarks split view** — responsive grid layout tweak for narrow detail panel.
- **fix** **Drag-and-drop placeholder** — insertion marker positioning improved during reorder.

### Search & modals

- **new** **Search chip keyboard** — `←`/`→` move between recent-query chips; `Enter` applies the selected chip.
- **fix** **Duplicate-merge modal** — `ESC` dismisses the health merge picker and resolves the pending promise; modal `ESC` no longer closes the search overlay underneath.
- **fix** **Search debounce** — debounce timer cleared when search closes (no delayed actions after exit).
- **fix** **`recordSearchHistory`** — `?` finder queries are not stored as search history.
- **new** **Search/finder hints** — debounced search and improved empty-state finder hints.

### Additional fixes

_Since the initial v2026.06.13 release notes — bookmark data integrity, health races, dashboard navigation, glass layout, config bookmarks workspace, health discoverability, and layout-version polish._

#### Security & write-token

- **fix** **`/api/ping` write-token** — bookmark status pings require `X-NextDash-Token` when `NEXTDASH_WRITE_TOKEN` is set; dashboard status monitor and health UI send the token via `nextDashFetch` / `apiFetch`.

#### Health, cache & analytics

- **fix** **Health mutation races** — `UpdateBookmarkHealthStatus`, `DeleteHealthBookmark`, and `AutoHealApply` use atomic `MutateBookmarkAt` / `DeleteBookmarkAt` (read-modify-write under one store lock) instead of separate get/save calls.
- **fix** **`TrackBookmarkOpen` HTTP errors** — missing bookmark returns **404** (`ErrBookmarkNotFound`); disk/persist failures return **500** instead of being reported as not found.
- **fix** **`RetestAll` atomic save** — ping results are applied via `MutateBookmarksOnPage` under one store lock (no separate get/save race per page); only bookmarks with `checkStatus` on retested pages are updated.
- **fix** **Preview bulk operations** — `ClearAllBookmarkPreviews` and `RefreshAllBookmarkPreviews` use `MutateBookmarksOnPage` atomically per page.
- **fix** **Duplicate merge atomic save** — `MergeDuplicates` stages in-memory page snapshots and commits all updates via `SaveBookmarkPageUpdates` under one lock.

#### Backup & import

- **fix** **ZIP import categories** — `mergeImportCategoriesIntoPrepared()` embeds category data into bookmark JSON before `commitPreparedImport()`, so imported pages keep their category structure.

#### Dashboard — bookmarks & editing

- **fix** **Page load race** — fast swipe or hash changes no longer show the wrong page's bookmarks; `loadPageBookmarks()` ignores stale fetch responses via a monotonic load-id guard.
- **fix** **`DeleteBookmark` matching** — delete resolves by canonical URL; a missing bookmark returns **404** instead of **500**.
- **fix** **Open-count routing** — `/api/track-open` uses page-aware index resolution (`resolveBookmarkPageId`, `resolveBookmarkIndexOnPage`) and cross-page canonical URL matching.
- **fix** **Pending saves on navigation** — `flushPendingDashboardSaves()` runs before page loads; preview metadata can save immediately via `saveBookmarkPreviewMetadataNow()`.
- **fix** **Remote inline edit** — cross-page bookmarks persist `note` and `tags`; the page dropdown moves remote bookmarks to another page (not only current-page rows).
- **fix** **Category reorder on exit** — debounced category order (`_pendingCategorySave`) flushes on tab close via keepalive `POST /api/categories`.
- **fix** **Icon preview XSS** — inline icon preview builds `<img>` via DOM APIs instead of unsanitized `innerHTML`.
- **fix** **`SavePages` staleness** — saving page structure updates page metadata only; bookmarks already on disk are preserved (no stale snapshot overwrite).
- **fix** **Immediate reorder/preview saves** — bookmark reorder and preview metadata persist immediately (no 1s/800ms debounce); `visibilitychange` flushes pending dashboard saves when the tab is hidden.
- **fix** **Remote inline delete** — delete in the inline editor works for cross-page bookmarks (tag-filter view); removes from the source page via API.
- **fix** **Swipe page title** — swipe navigation no longer calls `updatePageTitle` separately; `loadPageBookmarks()` owns title, hash, and bookmark updates.

#### Config & search

- **new** **Settings search promo** — first desktop visit to config shows a pulsing search field, **New** badge, and animated speech balloon explaining how global settings search works (`Ctrl+Shift+K` / `Cmd+Shift+K` vs `Ctrl+K` quick actions); dismisses on focus, typing, **Try it**, or **Got it** (once per browser; hidden on mobile and during onboarding/tours).
- **fix** **Settings search promo UX** — search results render above the promo balloon; typing dismisses the promo; tour/onboarding wait capped at 30 retries.
- **fix** **Category row XSS** — config category list rows are built via DOM APIs instead of `innerHTML` with category names.
- **fix** **GitHub help links** — config Help footer GitHub URL aligned to `github.com/jordibrouwer/nextdash`.

#### Config save & settings

- **fix** **Config save order** — Config **Save** posts **settings before bookmarks**, so `allowLocalBookmarks` applies during server-side URL validation (private-network bookmarks no longer fail against a stale stored flag).
- **fix** **Settings merge on POST** — `POST /api/settings` merges partial or empty `{}` bodies with stored settings instead of overwriting missing fields; server-side `mergeSettingsFromBody()` with unit tests.
- **fix** **Private URL save hint** — when a bookmark uses a local/private host and `allowLocalBookmarks` is off, Save shows a clear message (EN/NL/DE/FR) pointing to **General → Advanced** or a URL change; the client can auto-enable the flag when private URLs are detected (`healAllowLocalBookmarksSetting`).
- **fix** **Config error parsing** — failed save responses read the response body once (no double-consumed stream on error paths).

#### Layout discoverability

- **new** **Layout-versions spotlight** — `LayoutVersionNudge` (alias `LayoutModernNudge`) offers classic-layout users **Try modern** and **Try glass**; secondary try button in the feature spotlight; copy updated across onboarding, feature tour, and discoverability queue (EN/NL/DE/FR).
- **fix** **Unified discoverability path** — one spotlight flow for classic → modern or glass; reset from **Advanced → System & tools** replays modern and glass offers.
- **new** **Discoverability queue bar** — layout-versions and paste spotlights show **Tip X of Y** and **Later this session** (`DiscoverabilityQueueBar`); defer skips remaining post-onboarding prompts for the browser session (EN/NL/DE/FR).

#### Health discoverability

- **new** **`:health` command** — open `/health` from command mode with filters (`broken`, `duplicate`, `stale`, `shortcut-conflict`, …) or `refresh` to re-scan; cheat sheet and EN/NL/DE/FR help updated (`caHealth`).
- **new** **Health URL deep links** — `/health?filter=`, `?page=`, `?sort=`, `?q=`, `?refresh=1` apply filter/sort/search/page on load; `refresh=1` triggers retest-all automatically.
- **new** **Health badge routing** — dashboard and config health links go to `/health?filter=broken` when broken issues exist (otherwise `/health`).
- **fix** **Essentials Health → link** — **Config → General → Essentials** status overview **Health →** uses the same broken-filter routing as the header badge.
- **fix** **Config health link selector** — header health anchor matches `href^="/health"` so badge href updates survive after the first refresh.
- **fix** **`:stale` overflow** — when the stale palette exceeds its cap, the overflow row opens `/health?filter=stale`.

#### Config bookmarks workspace

- **new** **Collapsible structure panel** — **Config → Bookmarks** structure workspace (pages, categories, archived pages, favicon policy) starts collapsed behind a toggle; expand when you need structural edits.
- **new** **Add bookmark menu** — **+ Bookmark** dropdown chooses **Add & edit** (detail panel, Save when ready) or **Quick add** (saves immediately).
- **new** **Detail panel tiers** — category field stays visible; shortcut, icon, tags, previews, and status move under a **More options** collapsible.
- **fix** **Bulk move toolbar** — single **Move to** row (page + category + **Apply**) replaces separate category-move and page-move groups.
- **fix** **Bookmarks split view** — responsive layout, list spacer, and glass/modern styling for workspace card, bulk toolbar, and detail panel; guided tour copy aligned with collapsed structure.

#### Layout & glass

- **new** **Glass layout version** — third layout option alongside Classic and Modern: translucent iOS-style surfaces with backdrop blur on header, tabs, toolbar, bookmark cards, search, config, and health. Set in **Config → General → Layout**, onboarding, or `:layoutversion glass` / `:layoutversion toggle` (cycles classic → modern → glass). Modern remains unchanged.
- **fix** **Layout settings save** — layout version, preset, and density are read from the config UI on Save and autosave immediately when changed (glass/modern selection survives reload).
- **fix** **Docker UI refresh** — when `static/`, `locales/`, or `templates/` exist on disk, the server prefers those over embedded files; Docker Compose mounts them so UI and locale changes apply without rebuilding the image.
- **new** **Glass design tokens** — `--layout-surface-inset` and consistent `--glass-blur-*` usage across dashboard, config, health, and overlays (modal overlay uses `--glass-blur-xs` instead of hardcoded px).
- **fix** **Preset fine-tuning** — **terminal** (transparent default, glass inset on hover/focus), **masonry** (subtle border, glass on hover), **launcher** (lighter surface, chip shadow, gentler hover lift).
- **fix** **Glass UI details** — inline-edit form panel, tag-autocomplete dropdown, and loading skeleton shimmer/cards on glass layout; config bookmarks workspace glass parity.
- **fix** **Glass cache bust** — template query strings bumped to `glass-phase6-1` / `bookmarks-phase2-1` so Docker-mounted static files refresh reliably.
- **fix** **Docker build context** — `.dockerignore` expanded to exclude `node_modules/`, local `data/`, dev scripts, docs, and binaries so image builds stay lean and reliable.

#### Repo hygiene

- **fix** **`.gitignore` merge conflict** — resolved conflict markers; consolidated Go and project ignore rules; `node_modules/` ignored.
- **fix** **`node_modules` untracked** — Playwright removed from git; `package.json` keeps Playwright as `devDependencies` only (`npm install` for local debug scripts).
- **chore** **Obsolete i18n script removed** — deleted `scripts/merge-config-info-i18n.py` (one-off migration; source file no longer exists).

---

## v2026.06.12 — June 2026

**UX polish, mobile improvements, inline edit, accessibility** — date badge, swipe hint, scroll-snap tabs, skeleton loader, spring animations, letter avatar, ESC hint in modals, focus-visible outlines.

### Dashboard — mobile & navigation

- **new** **Compact date badge** — a compact date pill (`8 jun · 14:03`) appears in the header on phone when the full date/weather line is hidden; tap to open the date/weather popover.
- **new** **Page swipe hint** — a pulsing `← →` indicator appears below the tab strip on touch devices when the dashboard has more than one page, hinting at horizontal swipe navigation.
- **new** **Page tabs scroll-snap** — the tab strip scrolls horizontally with `scroll-snap-type: x mandatory` on narrow screens; the active tab scrolls into view automatically on load and page change.
- **new** **Category name tooltip** — long category titles truncate with `text-overflow: ellipsis` and expose the full name via the native `title` attribute on hover.
- **fix** **Empty category text** — the translation key `dashboard.emptyCategoryText` was displayed raw (as the key string) when the locale entry was absent; locale key added to EN/NL/DE/FR and the fallback guard now checks `value !== key`.

### Dashboard — bookmarks & editing

- **new** **Letter avatar** — bookmarks without a favicon show a styled initial-letter tile in the icon slot instead of a blank or broken icon placeholder.
- **new** **Inline edit improvements** — the long-press inline edit form now shows field-level validation errors, dismisses on **ESC** or click-outside without saving, and warns before discarding unsaved changes.
- **new** **Note line-clamp** — bookmark preview-card notes are capped at three lines (`-webkit-line-clamp: 3`); longer notes are hidden with an ellipsis.

### Dashboard — modals & feedback

- **new** **ESC to close hint** — a subtle `[ESC] to close` micro-hint appears below modal action buttons on pointer devices (hidden on touch); text is translated in EN / NL / DE / FR.
- **new** **Skeleton loader** — the recent bookmarks modal (`*`) shows a shimmer skeleton while waiting for the bookmark list to load; content fills in on the next animation frame once data is ready.
- **new** **Deep-link notification** — navigating to a deleted or missing category anchor (`#category-slug`) now shows a user-friendly notification (`deepLinkCategoryNotFound`) instead of silently falling back to the full page.
- **new** **Paste URL hint** — when `Ctrl+V` on the dashboard cannot open the new-bookmark form (no active page or paste handler), a notification now explains what paste does instead of failing silently.

### Animations & config polish

- **new** **Spring search animation** — the search/command modal entrance uses a `cubic-bezier(0.16, 1, 0.3, 1)` spring curve; the exit is a quick `ease-in`; on slower devices the transition was previously imperceptible.
- **new** **Spring drag placeholder** — the drag-and-drop insertion marker animates in with `cubic-bezier(0.34, 1.56, 0.64, 1)` (slight overshoot) instead of stopping abruptly.
- **new** **Theme preview badge** — the "Preview" badge in the config theme editor now uses an accent-color background with a pulsing dot animation; easier to notice when a temporary theme is active.
- **new** **Font upload status icons** — `#custom-font-status` in config shows a ✓ or ✕ icon alongside the status text after a custom font upload succeeds or fails.
- **new** **Focus-visible outlines** — search mode pill buttons (Search / Commands / Finders) and history chips now show a 2 px `--accent-primary` outline on `:focus-visible`; there was previously no visible keyboard focus indicator on these controls.

### Dashboard — categories & search

- **new** **Hide empty categories** — new setting in Config → General → Bookmarks (visible in Essentials layer), enabled by default for new installs and automatically migrated to `true` for existing ones; categories with no bookmarks are omitted entirely from the dashboard render.
- **new** **Bookmark name tooltip** — truncated bookmark titles now carry a native `title` attribute so the full name appears on hover, matching the category-name tooltip added in this release.
- **new** **Search result ellipsis** — long bookmark names in the search overlay now truncate with `text-overflow: ellipsis` (added missing `min-width: 0` on the flex child) and show the full name via `title` on hover.

### Reliability & accessibility

- **new** **Notification queue** — rapid successive calls to `AppNotification.show()` are queued (max 3 pending; newest replaces oldest when full) and displayed one at a time with a 260 ms fade gap between entries; explicit `hide()` clears the queue.
- **fix** **Collapsed category persistence** — `loadCollapsedStates` and `saveCollapsedStates` now wrap localStorage calls in try/catch; collapse state is kept in-memory for the session when storage is unavailable (private browsing, quota exceeded).
- **new** **`prefers-reduced-motion`** — spring entrance curves, drag-placeholder scale, swipe-hint pulse, skeleton shimmer, category/bookmark entrance animations, and the notification slide now respect the OS reduced-motion preference; motion is replaced by opacity fades or instant transitions across `search.css`, `dashboard.css`, `responsive.css`, `modal.css`, `app-notification.css`, and `config-forms.css`.

---

## v2026.06.11 — June 2026

**Security hardening, write-token parity, search/health fixes** — optional `NEXTDASH_WRITE_TOKEN`, SSRF-safe redirects, import URL validation, XSS fixes in search, `:history` command, extension write token.

### Security & self-hosting

- **new** **Optional write token** — environment variable `NEXTDASH_WRITE_TOKEN`; protected endpoints require header `X-NextDash-Token`. Config and Health pages inject the token via meta tag (same origin).
- **new** **Allow localhost bookmarks** — `allowLocalBookmarks` in settings (Advanced → Bookmarks area); **on by default** for local dev; turn off on shared/LAN exposure to tighten SSRF boundaries for status/preview fetches.
- **fix** **ZIP import validation** — bookmarks with disallowed URLs are skipped during restore; UI reports `skippedBookmarks` count.
- **fix** **Redirect SSRF** — shared `safeRedirectCheck` on ping, bookmark preview, page-title fetch, auto-heal redirect detection, and icon-from-URL (follows only public hosts when local bookmarks are off).
- **fix** **Search XSS** — `highlightFuzzyMatch` and search `meta` escaped; icon filenames sanitized server-side and filtered client-side in search results.

### Health & reliability

- **fix** **Health write token** — `POST /api/health/auto-heal-apply`, `cache-scan`, and `update-status` gated when token is set; `health.js` sends `nextDashWriteHeaders`.
- **fix** **Reset deadlock** — `ResetAllData()` releases the store lock before `initializeDefaultFiles()` to avoid re-entrant mutex deadlock.
- **new** **Default bookmark favicons** — on first install or factory reset, the server prefetches favicons for the sample bookmarks (preview URL, then `/favicon.ico` fallback) before serving the dashboard, so icons appear before onboarding.

### Search, extension & polish

- **new** **`:history` command** — browse recent searches from command mode; `:history clear` wipes all; per-row × in empty search overlay.
- **new** **Extension write token** — optional field in extension Settings; sent on bookmark add when configured.
- **fix** **Locale parity** — DE/FR missing keys closed; empty `help` objects removed.
- **fix** **Font size normalization** — legacy values `small`/`medium`/`large` map to `s`/`m`/`l` on load and save.
- **fix** **Markup & cleanup** — dashboard duplicate `<head>` removed; obsolete `templates/colors.html` and unused static assets removed (`/colors` still redirects to `config#colors`).
- **fix** **Health UI** — back link to config; config search theming aligned with design tokens.

### Tests & docs

- **new** Go tests for URL safety, write token, reset (no deadlock), backup import sanitization, fontSize normalization, manifest.
- **new** `README.md`, `MANUAL.md` §21, `docker-compose.yml`, and extension README updated for write token and localhost bookmarks.

---

## v2026.06.10 — June 2026

**Config settings search, Classic/Modern layout, discoverability polish, status essentials** — find any setting with Ctrl+Shift+K; switch layout version in config or via `:layoutversion`; onboarding and post-setup flows simplified.

### Config — settings search & quick actions

- **new** **Search settings** — breadcrumb search field on desktop config (`Ctrl/Cmd+Shift+K`) jumps to tabs, General panels, labels, stats sections, colors groups, keyboard bindings, and Help blocks.
- **new** **Advanced while on Essentials** — the search index includes hidden Advanced panels; results switch layer and scroll to the target.
- **new** **Quick actions palette** — `Ctrl/Cmd+K` runs actions only (save, open dashboard, tour resets); settings navigation is separate from the command palette mental model.
- **fix** **Index refresh** — rebuilds after stats/colors tab open, General layer switch, language change, bookmarks render, and config init.

### Dashboard — Classic / Modern layout

- **new** **Layout version** — **Classic** keeps the original dashboard styling; **Modern** applies refreshed visuals with the same bookmark structure. Active theme still controls all colors.
- **new** **Switch in config** — **General → Layout → Layout version** dropdown with live description; searchable via **Search settings** (`Ctrl/Cmd+Shift+K`).
- **new** **Command mode** — `:layoutversion`, `:layoutversion modern`, `:layoutversion classic`, or `:layoutversion toggle` on the dashboard (separate from `:layout` presets such as launcher or compact).
- **new** **Onboarding step** — first-run wizard includes layout version with a live preview.
- **new** **Layout-modern nudge** — classic users who skip modern in onboarding may see a one-time spotlight after What's new; replay reset in **Advanced → System & tools**.

### Dashboard — onboarding & discoverability

- **new** **Shorter onboarding** — keyboard and mouse bookmark tips merged into one step; finish step covers pages and first bookmarks when you start empty.
- **new** **Chained discoverability** — after onboarding, What's new and (classic layout) a layout-modern nudge may appear one after another in the same session.
- **new** **Skip for later** — defers remaining discoverability prompts until the next session.
- **fix** **Dead code removed** — post-setup wizard, tour spotlight, recent-bookmarks spotlight, and related i18n/CSS/guard selectors.

### Config → General — status essentials

- **new** **Compact overview** — Essentials shows monitored bookmark count and enable toggle; full status tuning stays in Advanced.
- **new** **Health link** — Essentials status summary includes a Health → button when the Health dashboard is enabled.

---

## v2026.06.9 — June 2026

**Link preview cards default off** — opt-in via Config → General → Advanced → Bookmarks; rotating tip for discoverability.

### Config — bookmarks

- **new** **Off by default** — `Show link preview cards on hover` is unchecked for new installs.
- **fix** **Existing installs migrated** — one-time server migration sets the option to off (including users who previously had it on); re-enable manually if you want hover cards back.

### Dashboard — tips

- **new** **Rotating tip** — footer tips include where to turn preview cards on: Config → General → Advanced → Bookmarks (EN / NL / DE / FR).

---

## v2026.06.8 — June 2026

**Dashboard bookmark row hover and keyboard selection** — full-row highlight, theme-aware gradient, no layout shift.

### Dashboard — bookmark rows

- **fix** **No hover shift** — removed a conflicting `translateX` on bookmark hover (from status styles) that nudged rows ~1–2 px right and clipped the highlight at the row edge.
- **new** **Full-row selection** — hover and keyboard focus highlight the entire row: icon, title, pin/note/ping badges, and shortcut chip (not just the title link).
- **new** **Left-to-right gradient** — theme-aware accent gradient (`--accent-primary` mixed with `--background-primary` / `--background-secondary`); stronger tint on the left, fading to the right.
- **fix** **Layout overrides** — widgets layout no longer forces a transparent row background that hid the hover state; selection styles load last so presets cannot override them.

---

## v2026.06.7 — June 2026

**Config → General redesign** — merged bookmark panels, collapsible tour resets, accessibility fixes.

### Config → General — redesigned

- **new** **Bookmarks merged** — "Bookmarks — Display" and "Bookmarks — Behavior" are now a single section. A visual rule separates the display group from the sorting/navigation group; the Essentials layer still shows the same streamlined subset as before.
- **new** **Tours & onboarding — collapsible** — 13 individual tour-reset buttons are grouped into a single `<details>` element ("Tours & onboarding"). Reset-all, feature tour, context tips, and per-tab resets all live inside; the section is collapsed by default so the Advanced layer is no longer dominated by maintenance actions.
- **new** **Ko-fi support link moved** — relocated from the top of the General tab to the Help tab, where it sits alongside the project signature. The General tab opens directly on settings without preamble.
- **fix** **"Show all sections" button** — was an `<a href="#">` (incorrect semantics); replaced with `<button type="button">` and matching CSS button-reset styles.
- **fix** **Smart collection toggles** — `onclick="event.stopPropagation()"` removed from HTML; replaced by a JS event listener registered during `ConfigGeneralLayers.init()`.
- **fix** **General tour** — step 0 previously targeted `.general-tab-intro` (removed); now highlights `.general-layout`. `waitForGeneralReady()` no longer waits for the intro element, eliminating a ~2.4 s startup delay.
- **fix** **CSS deduplication** — removed redundant `padding-left: 0` line immediately overridden in `.checkbox-tree-child`.
- **fix** **Layer intro** — shortened from three `<span>` lines to one per layer; redundant nested-tree-hint removed.
- **new** **Favicon harmonization moved to Essentials** — "Favicon harmonization (per theme)" moved from Advanced → Appearance fine-tuning to the Essentials Appearance & Style panel so the setting is reachable without switching layers.

---

## v2026.06.6 — May 2026

**Bookmark grid accessibility**, **custom font upload**, **config → dashboard save flow**, broad **i18n**, **mobile help**, and **guided-tour polish**.

### Accessibility — bookmark grid

- **new** **`role="grid"` deepening** — category titles as `rowheader`; one primary `gridcell` per row; stable cell IDs; `aria-rowindex` / `aria-rowcount`; `aria-activedescendant` on the grid when a row is selected.
- **new** **Grid navigation keys** — `Home` / `End` (first/last bookmark in category); `Ctrl+Home` / `Ctrl+End` (first/last on page); `Page Up` / `Page Down` (~one screen); documented in the keyboard cheat sheet (`!`).

### Config & sync

- **new** **Custom font upload** — upload `.woff`, `.woff2`, `.ttf`, or `.otf` (max 5 MB) in General → Appearance; appears as **Custom font (uploaded)** in the UI font dropdown.
- **new** **Save → Open dashboard** — after **Save**, the toast offers **Open dashboard** instead of opening a preview tab; duplicate-URL warning uses the same action.
- **new** **Dashboard sync on return** — pending structure/settings updates are stored in `sessionStorage` and applied when you return to the dashboard (`pageshow` / storage events).
- **fix** **Device-specific settings** — cleaner merge of server vs. local visual prefs when device-specific mode is on.

### Localization (EN / NL / DE / FR)

- **new** Dashboard footer and search overlay — mode tab labels and ARIA (`search`, `commands`, `finders`, …).
- **new** Command palette — `:pin` / `:unpin` / `:note` labels and toasts; `page:current` / `page:all` filter hints.
- **new** Bookmark rows — drag/pin/open-count/note labels; inline edit fields aligned with config; category rename and delete confirm.

### Mobile & help

- **new** **Phone vs desktop** — MANUAL §19 table + Config → Help section (`#help-mobile`): footer limits, search overlay tabs, desktop-only tag cloud and full config.
- **new** In-app help index link for the mobile section (all four languages).

### Guided tours & defaults

- **fix** **Tour guard** — backdrop no longer steals clicks; tour cards and modals stay interactive; companion mode for quick-add demos.
- **fix** **Sticky save bar** — extra bottom padding on config main and bookmarks split-view when dirty.
- **new** Default install bookmarks include example tags (`dev`, `github`, `video`, …).

### Cleanup

- **fix** Removed unused **`GET /api/analytics`** and dead analytics UI — open counts and insights live in **Config → Stats** and **`/health`** only.
- **fix** Removed deprecated bookmark cache sync no-ops from config.

---

## v2026.06.5 — May 2026

**Dashboard tag word cloud** (`/`), **keyboard-driven tag filter**, and **`:tag` browse in the command palette** — plus help and settings updates.

### Dashboard — tag word cloud

- **new** **Tag cloud (/)** — optional `/` FAB (stacked with What's new on desktop); opens an anchored word-cloud modal of all library tags (size = usage, `#` prefix on every tag).
- **new** **`/` shortcut** — on the dashboard (search closed), `/` opens the tag cloud when the feature is enabled; with tag cloud off, `/` keeps the existing fuzzy/interleave search behaviour.
- **new** **Keyboard in the modal** — arrow keys move between tags and **Clear tag filter**; Enter applies; Escape closes; clearing the filter closes the modal and restores focus to the selected bookmark row.
- **new** **Dashboard tag filter** — picking a tag shows only matching bookmarks in an animated temporary layout (chunks of 10, equal column widths); Escape clears the filter when the modal is closed.
- **fix** **Corner FAB stack** — tag cloud sits directly above What's new; launcher moves up one slot when the tag cloud is enabled on docked button-bar corners.

### Search & commands

- **new** **`:tag` browse** — in command mode, `:tag` lists tags; `:tag work` or `:tag:work` shows matching bookmarks **inside the palette only** (full dashboard unchanged). Partial tag names supported.
- **new** **`:tag +name` / `:tag -name`** — add or remove a tag on the keyboard-selected bookmark (replaces the old “toggle tag on selection”-only flow for named tags).

### Config → General

- **new** **Tag cloud (/)** toggle under Header & Buttons — ℹ explains desktop-only behaviour and keyboard use.
- **new** **Default on** — enabled for new installs; one-time migration turns it on for existing installs (`tagCloudDefaultMigrated`).

### Help & docs

- **new** **In-app help** — Search, Tags, dashboard bookmarks, troubleshooting, config ℹ, rotating tip, and cheat sheet row updated (EN / NL / DE / FR).
- **new** **README & MANUAL** — tag cloud section, `:tag` command table, and three-way tag browse (`tag:` search, `/` dashboard, `:tag` palette).

### Mobile

- **new** **Desktop only** — tag cloud FAB and `/` handler are hidden on the mobile layout; dashboard tag filter is not offered on touch/narrow viewports.

---

## v2026.06.4 — May 2026

**Bookmark sync reliability**, **Stats tags**, **dashboard page-tab polish**, and a major **Health beta** upgrade (shortcut conflicts, page filter, smarter merge, clearer errors, config-style action toolbars).

### Config → Bookmarks & tags

- **fix** **Central bookmark store** — new `ConfigBookmarkStore` as the single source of truth for bookmark data in config; page lists and the Tags tab share the same object references. Fixes tags appearing empty or out of sync after restart or a guided tour.
- **fix** **Tag sync simplified** — duplicate cache/sync helpers removed or reduced to no-ops; tours and demos read/write through the store.

### Config → Stats

- **new** **Tags section** — tag usage overview (total tags, most-used tag, untagged bookmarks) plus a per-tag breakdown with counts. Index link and EN/NL/DE/FR strings.
- **update** **Stats tour (12 steps)** — adds a **Tag usage** step after the new Tags section (tour was 11 steps in v2026.06.3).

### Dashboard

- **fix** **Page-tab popover** — popover stays inside the viewport (clamp + reposition on scroll/resize); no more menu clipped off-screen on narrow windows.
- **fix** **Page-tab rename on mobile** — inline rename (double-click) only on desktop/tablet landscape via `allowsPageTabInlineEdit()`; avoids accidental renames on touch.
- **new** **Health badge** — shortcut conflicts count toward the warning badge alongside duplicates, unchecked, and stale items.

### Health beta

- **new** **Shortcut conflicts** — backend detects duplicate shortcuts across pages; summary card, filter pill, and `shortcut-conflict` issue status.
- **new** **Filter by page** — dropdown next to search; choice persisted in `sessionStorage`.
- **new** **Smarter duplicate merge** — keeps the best bookmark (most opens → pinned → oldest `createdAt`); **keep best** on duplicate groups; merge deletes highest indices per page safely.
- **new** **Clearer broken diagnosis** — shared `ping.go` with detailed reachability errors (HTTP status, timeout, DNS, TLS, etc.) instead of generic “ping failed”; ping and retest store the real error on the bookmark.
- **fix** **Action toolbar layout** — buttons sit below each bookmark (fixes actions clipped off-screen by horizontal overflow).
- **fix** **Auto-heal always available** — archive, detect redirect, refresh title, and 1-click fix in a second toolbar row on every issue.
- **new** **Config-style buttons** — issue actions use `btn btn-small` from config; two compact rows (standard + auto-heal) in an inset bar matching the config bulk-toolbar look.

### Backend

- **new** `HealthSummary.shortcutConflictCount`; extended `BookmarkRef` (open count, pinned, createdAt).
- **new** `ping.go` — shared `pingURLDetailed()` for health, retest, and `/api/ping`.
- **refactor** Removed duplicate `pingURL` from `handlers.go`; `status.go` delegates to shared ping logic.

---

## v2026.06.3 — June 2026

**Config guided tours** for every major tab: one-time spotlight walkthroughs on desktop-width windows, with optional hands-on demos and automatic cleanup.

### Tours (shared)

- **new** **Nine tab tours** — first visit to **General**, **Bookmarks**, **Pages**, **Categories**, **Tags**, **Collections**, **Finders**, **Stats**, or **Theme** (`#colors`) can start a guided tour until completed or skipped.
- **new** **Replay any tour** — Config → General → Advanced → System & tools → *Show … tour again* (open the matching tab first).
- **new** **Completion sync** — per-tab flags in settings (`configGeneralTourCompleted`, `configBookmarksTourCompleted`, `configPagesTourCompleted`, `configCategoriesTourCompleted`, `configTagsTourCompleted`, `configCollectionsTourCompleted`, `configFindersTourCompleted`, `configStatsTourCompleted`, `configThemeTourCompleted`) plus matching `localStorage` keys.
- **new** **Tour card placement** — on large highlights the step card docks to the bottom of the viewport; confirmation dialogs use the same bottom-docked pattern so modals stay readable.
- **new** **Desktop only** — tours do not auto-start on the mobile config layout; rotating footer tips and promo banners are also hidden on mobile.
- **fix** **Mutual exclusion** — only one config tab tour runs at a time; tours defer to each other and the dashboard feature tour.

### Config → General

- **new** **General tour (9 steps)** — Essentials vs Advanced, appearance, bookmarks, toolbar, smart collections, Advanced nav, other tabs, **Save**.

### Config → Bookmarks

- **new** **Extended Bookmarks tour** — structure, filters, optional consent for demo bookmarks in the editor, **+ Add**, quick-add **+** modal (including dashboard **+**), list search, bulk toolbar, favicon policy, cleanup of all demos, **Save**.

### Config → Pages

- **new** **Pages tour (8 steps)** — page list, add page, optional demo page, naming, dashboard handoff, remove page, demo cleanup.

### Config → Categories

- **new** **Categories tour (8 steps)** — per-page categories, add category, optional demo **news** category, name/icon, dashboard reorder hint, remove, cleanup.

### Config → Tags

- **new** **Tags tour (8 steps)** — tag cloud, rename/delete/drill-down, optional demo bookmark with tag in Bookmarks tab, tags field, result on Tags tab, cleanup.

### Config → Collections

- **new** **Collections tour (11 steps)** — list, new collection, optional demo rule editor (tag/category/shortcut rules, AND/OR), save to dashboard, preview on dashboard, cleanup.

### Config → Finders

- **new** **Finders tour (8 steps)** — concept, fields, add finder, optional **Google** example (`?g`) after consent, dashboard usage, reorder/remove, **Save**.

### Config → Stats

- **new** **Stats tour (11 steps at release)** — index, overview, cleanup score, activity, top bookmarks, pages/categories, shortcuts, rot & cleanup, conflicts (Health link), search/status settings. Extended to **12 steps** in v2026.06.4 (Tag usage step).

### Config → Theme

- **new** **Theme tour (9 steps)** — editor, dark/light/custom subtabs, add custom theme, auto **Tour demo** palette, live preview, **Save colors**, **General → Appearance** to activate, confirm removal and restore previous theme.

---

## v2026.06.2 — June 2026

Config guided tours for **General** and **Bookmarks**: one-time spotlight walkthroughs on desktop-width windows.

### Config → General

- **new** **General settings tour** — 9-step guided tour on first visit to the General tab: Essentials vs Advanced, appearance, bookmarks, toolbar, smart collections, Advanced nav, other tabs, and Save. Spotlight highlight with scroll lock; completion stored in settings and `localStorage`.
- **new** **Replay General tour** — Config → General → Advanced → System & tools → *Show General tour again*.

### Config → Bookmarks

- **new** **Bookmarks editor tour** — 10-step guided tour on first visit to the Bookmarks tab: split layout, structure workspace, page/filter/sort, quick-add vs full add, list search, reorder and selection, detail editor, bulk toolbar, favicon refresh policy, and Save.
- **new** **Replay Bookmarks tour** — same System & tools section → *Show Bookmarks tour again*.

### Tours (shared)

- **new** **Once per install** — each tour runs automatically only until completed (`configGeneralTourCompleted` / `configBookmarksTourCompleted` synced with the server).
- **fix** **Stable spotlight UX** — CSS cutout highlight (no jumping overlay panels); tours exclude each other and the dashboard feature tour.

---

## v2026.06.1 — June 2026

First June 2026 release: shortcut remap, import/health fix workflows, richer **\*** recent panel, and repo documentation.

### Bookmark shortcuts

- **new** **`+`** — opens the **full** new-bookmark modal on the dashboard; toolbar **+** tooltip shows only this key (same as `Ctrl+Shift+A` and `:new`).
- **new** **`&`** — opens the **quick-add** omnibox (`name | url | shortcut` in one line).
- **fix** **Shortcut tooltips** — lone `+` in tooltips and the cheat sheet renders correctly (`shortcut-format.js` no longer splits it as a chord separator).
- **fix** **Cheat sheet, help, empty states, and locales** — EN / NL / DE / FR aligned with the `+` / `&` mapping.

### Import & health workflows

- **new** **Browser import preview** — before confirming HTML import, see **X new, Y conflicts (skipped)**; counts update when you change target page; only new URLs are posted.
- **new** **Health → dashboard deep links** — **dashboard** link on each issue and duplicate-group row (`?page=&bookmark=&category=`); dashboard switches page, expands category, scrolls, and highlights the row.
- **new** **Duplicate group category** — `BookmarkRef` includes category so deep links from duplicate groups land in the right section.

### Recent bookmarks (`*`)

- **new** **Bulk open in `*` modal** — open shown recents or the last N opened from the panel (same 15-tab safe batch as `:open all` when the list is large).
- **new** **`:open last` hint** — panel footer points to `:open last` in command mode (command itself shipped in v2026.05.7).
- **new** **Discoverability** — one-time spotlight on the `*` button (discoverability queue); priority rotating tip for `*` and `:open last`.
- **fix** **Recent list scope documented** — `*` and `:open last` use **page-local** `lastOpened` (not global `allBookmarks`).

### Documentation

- **new** **[MANUAL.md](MANUAL.md)** — full English user manual with table of contents (install, concepts, keyboard, config, import, health, extension, workflows).
- **new** **[CHANGELOG.md](CHANGELOG.md)** — complete release history; README inline changelog removed.
- **fix** **README** — links to MANUAL and CHANGELOG at the top.

---

## v2026.05.7 — May 2026

### Search & commands

- **new** **`:open last [n]`** — open the most recently used bookmarks on the current page from command mode. Default `:open last` opens 5; `:open recent` is an alias. Same safe 15-tab batch cap as `:open all` when N is large.

### Config → General

- **new** **Visible nested settings** — parent/child checkboxes (smart collections, page tabs, status options) show a clear tree with guide lines and `├──` / `└──` symbols.
- **fix** **Status-dependent rows** — child options under Status dim and disable when the status feature is off.

### Browser extension

- **new** **Save anyway on duplicate URL** — inline warning plus *Save anyway* when the URL already exists on the page; optional setting to allow duplicates without the extra step.

### Help

- **fix** **What's new only where it belongs** — duplicate What's New block removed from Config → Help. Release notes stay on the dashboard ★ button and Config → Advanced → What's new.

---

## v2026.05.6 — May 2026

### Pages & persistence

- **fix** **Page 1 / “main” after restart** — empty page names and missing page-1 metadata are normalised on load and save.
- **new** **Auto-repair on open** — config pages tab detects stale page data and persists repairs when needed.

### Bookmarks UX

- **new** **Mobile + Bookmark** — footer *+ Bookmark* button easier to spot on phones; config empty state points to the same actions on mobile.
- **new** **Smarter empty states** — touch devices hide keyboard hints in empty libraries; desktop mentions add-bookmark shortcuts.
- **new** **Conflict hints when it matters** — duplicate URL and shortcut warnings appear only after you type a value.
- **new** **Detail panel i18n** — move, fetch favicon, tags, pinned/status toggles translated (EN / NL / DE / FR).
- **new** **Unified add-bookmark form** — quick-add, modal, and `:new` share the same form with dashboard + link preview strips.

### Shortcuts & docs

- **new** **One shortcut story everywhere** — cheat sheet, tooltips, help, and empty states aligned for add-bookmark keys (see **Unreleased** for the latest `+` / `&` mapping).
- **new** **Config → Keyboard tab** — read-only *Bookmarks* section at the top lists default add-bookmark shortcuts.

### Browser extension

- **fix** **Same page list as config** — popup normalises pages like config; page 1 is never missing from the picker.
- **new** **Duplicate URL hint** — inline warning instead of a blocking confirm dialog.
- **new** **Link preview in popup** — optional dashboard and link preview strips while saving.

---

## v2026.05.5 — May 2026

### Config → General

- **new** **ℹ info buttons** — short explanations next to setting labels (EN / NL / DE / FR).
- **new** **Essentials / Advanced layers** — everyday options under *Essentials*; power features under *Advanced* with sticky section links and *Show all sections on one page*.
- **new** **Layer intro hints** — guidance at the top of each layer.
- **new** **Layout & smart collections i18n** — preset descriptions and smart-collection UI fully translated.
- **new** **Tuning wizard** — optional one-time dashboard guide: language → theme → browser extension.

### Branding & PWA

- **new** **Dynamic web app manifest** — `/manifest.webmanifest` reads custom title and favicon from settings.
- **new** **Apple web-app meta** — touch icon and theme colour on dashboard, config, health, and colors.

### Accessibility

- **new** **Bookmark grid semantics** — `role="grid"`, categories as `rowgroup`, labelled headers.
- **new** **Focus on bookmark tiles** — roving `tabIndex`, clearer `:focus-visible`, accent outline on keyboard-selected rows (launcher included).
- **new** **Selection & labels** — `aria-selected`; shortcuts in `aria-label` when set.

### Polish & docs

- **new** **Unified toasts** — shared toast component across dashboard, config, and colors.
- **new** **Help & README for self-hosters** — Essentials vs Advanced, ℹ buttons, and branding/PWA documented.

---

## v2026.05.4 — May 2026

### UX & discoverability

- **new** **Rich keyboard tooltips** — footer buttons show action name plus `<kbd>` shortcuts on desktop (hidden on touch).
- **new** **Search-flow hint with labels** — chips plus text labels (search · commands · finders · bookmark); swipe-pages hint on mobile.
- **new** **Mobile bottom bar** — short labels under footer icons; mini status line (date · page · health).
- **new** **Post-setup wizard** — 3-step guide after onboarding: pages → first bookmark → finish.
- **new** **Tips auto-expire** — rotating footer tips turn off 7 days after onboarding (configurable).
- **new** **Skeleton loading** — shimmer placeholders on dashboard, config, health, and colors.

### Health (beta)

- **new** **Bulk open confirmation** — *Open broken links* asks for confirmation with count and per-batch limit (default 10, max 25).
- **new** **Health badge on dashboard** — text pill like *3 broken*; refreshes when you return to the tab.

### Browser extension

- **new** **Save success panel** — popup stays open with *Open in nextDash* deep link to the right page.
- **new** **Dashboard toast** — success notification and bookmark refresh when dashboard tab is open on the same server.
- **new** **Extension UI translated** — EN / NL / DE / FR; language follows server settings when configured.

### Accessibility

- **new** **Modal semantics** — `role="dialog"`, `aria-modal`, labelled titles.
- **new** **Config tab list** — `role="tablist"` / `aria-selected`.
- **new** **Skip links** — “Skip to main content” on dashboard and config.
- **new** **Custom selects** — combobox/listbox ARIA on styled selects.
- **new** **prefers-reduced-motion** — inline-edit reveal respects reduced motion.

### Config polish

- **new** **Sticky save bar** — save / unsaved / undo / discard stay visible while scrolling.
- **new** **Autosave for low-risk fields** — language, theme, and similar toggles save without Save.
- **new** **General tab intro** — short explanation; backups tab routing fixed; page `lang` matches language.
- **fix** **Ko-fi overlay removed** — floating widget removed from config (intro link in General remains).

### Translations

- **new** **DE / FR coverage** — skip link, health confirm, swipe hint, tooltips, post-setup wizard, and more.

---

## v2026.05.3 — May 2026

### Button bar position

- **new** **Corner dock mode** — button bar in bottom-left or bottom-right; compact 2-column widget (`>` `:` `?` | `!` `*` `⊞`).
- **new** **`:buttonbar` command** — `bottom` / `bottom-right` / `bottom-left` from command palette.
- **new** **Launcher in dock** — integrated `⊞` when docked; optional via *Show layout selector in dock*.

### Search

- **new** **`@` global search** — fuzzy-search all pages; each result shows page name as context.
- **new** **`:find <text>`** — hide non-matching tiles on the current page; `:find` alone clears.

### Page customisation

- **new** **Page emoji icon** — double-click tab → popover to set emoji in the tab.
- **new** **Page colour dot** — 8 accent colours (or none) per page in the same popover.

### What's new improvements

- **new** **★ FAB button** — star opposite the button bar opens release notes anytime.
- **new** **What's new group in search** — unread release notes appear in `>` empty state for 7 days.

### Cheat sheet & themes

- **new** **Cheat sheet restructured** — 6 sections including `@`, appearance commands, and `:buttonbar`.
- **new** **5 new theme families** — Terminal Amber, Dusk Horizon, Moss & Stone, Candy Pop, Midnight Ink (dark + light each).

---

## v2026.05.2 — May 2026

### Search & commands

- **new** **Fuzzy search on URL, note & tags** — `/` mode matches domain, tags, and note; secondary matches rank below name with context snippets.
- **new** **Saved searches as separate group** — *Recent* and *Saved searches* as distinct collapsed groups in `>`.
- **new** **`:open all`** — open every bookmark on the current page (safe cap + open all option).
- **new** **`:pin` / `:unpin`** — toggle pin from command palette.
- **new** **`:tag <tagname>`** — add/remove tag on selection; `:tag` alone shows current tags.
- **new** **`:stale [days]`** — custom day window (`:stale 7`, `:stale 90`, …).

### Keyboard cheat sheet

- **new** **Searchable cheat sheet** — filter input on `!` / `F1` narrows ~30 shortcut rows; empty sections hidden.

---

## v2026.05.1 — May 2026

### Launcher view

- **new** **Launcher layout preset** — large favicon tiles in horizontal category rows; toggle via ⊞ FAB.
- **new** **Launcher icon size** — Small / Normal / Large in Config → Appearance.
- **new** **Launcher tile animations** — dim while search active; scale-pulse on click.

### Date header & calendar

- **new** **Clickable date/time** — week-overview popover with ISO week and today highlighted.
- **new** **Calendar URL setting** — optional link in popover when configured.

### Keyboard shortcuts

- **new** **Shift+M — quick move** — popover to move bookmark to category or another page.
- **new** **Ctrl+C row flash** — green tint on row when copying URL.

### Search & commands

- **new** **`:goto <url-or-domain>`** — navigate directly; bare domains get `https://`.
- **new** **Recent searches in empty state** — last 5 queries as clickable chips.
- **fix** **Fuzzy search ranking** — exact → prefix → word-boundary → substring scoring.

### Dashboard polish

- **fix** **Category collapse animation** — `grid-template-rows: 1fr ↔ 0fr` instead of `max-height` hack.

### Keyboard cheat sheet expanded

- **new** **Full commands reference** — `:goto`, `:layout`, `:theme`, `:density`, `:columns`, `:sort`, `:save`, `:saved`, …
- **new** **Fuzzy mode documented** — `/` prefix and ranking described.
- **new** **Config shortcuts listed** — `Alt+↑/↓`, `Ctrl/Cmd+K`.

---

## v2026.05 — May 2026

### Glass-effect config & health

- **new** **Transparent card backgrounds** — 75% transparent panels on config and health.
- **new** **Save/Discard bar transparent** — sticky action bar transparent; tab strip stays solid.
- **fix** **What's new link removed from Help tab** — modal still on first visit and dashboard prompt.

### Button animations

- **new** **Pulsing glow on Search & Commands** — subtle animation on `>` and `:` footer buttons.

### Onboarding & feature tour

- **new** **Interactive feature tour** — 8 steps: search, commands, finders, columns, smart collections, bookmarks.
- **new** **Tour spotlight notification** — once after onboarding; restart from Config → Advanced.
- **new** **Animated search flow hint** — segment wipe-in above footer buttons; once per browser.

### Buttons & discoverability

- **new** **Finders & Commands on by default** — new installs show both without enabling in config.
- **fix** **Tips above buttons restored** — rotating tip element was missing from HTML.

### Translations (i18n)

- **new** **Feature tour fully translated** — EN / NL / DE / FR.
- **fix** **Hardcoded Dutch strings removed** — undo, backup tip, tour spotlight, config tour section.

### Stats insights dashboard

- **new** **Two-column layout with index** — sticky index + scrollspy across 10 sections.
- **new** **Per-section time periods** — week / month / 3mo / 6mo / all-time per section.
- **new** **Activity sparkline** — SVG bar chart of last-opened activity.
- **new** **Cleanup score** — 0–100 with explained penalties.
- **new** **Rot & cleanup section** — never-opened, stale, recently-added tables.
- **new** **ℹ on every stats section** — plain-English explanations.
- **new** **Fully translated stats tab** — EN / NL / DE / FR.

---

## v2026.04 — April 2026

### Dashboard buttons

- **new** **Labels removed** — footer shows key symbols only (`:` `?` `>` `*` `!`); tooltips on hover.
- **new** **Button order** — `: commands` · `? finders` · `> search` · `* recent` · `! cheatsheet`.
- **fix** **Config label toggle removed** — per-button Label column dropped from Header & Buttons.

### Search

- **new** **Mode badge** — SEARCH, CMD, FIND, or FUZZY badge in the search bar.
- **new** **Filter group** — `category:`, `status:`, `page:`, `tag:` under collapsible *Filters*.
- **new** **Empty state** — Recent, Filters, Finders groups when query is empty.
- **new** **Search mode chips** — click chips at bottom of overlay to switch mode.

### Dashboard

- **new** **Keyboard selection highlight** — accent background and left bar on selected row.
- **new** **Category collapse animation** — smooth height transition and rotating chevron.
- **new** **Smart collection accent** — tinted headers for smart groups.
- **new** **Smart collection empty state** — contextual message when no matches.
- **new** **Focus indicators** — consistent rings on bookmarks, categories, search.
- **new** **Compact bookmark rows** — inline status/pin/note chips; three-column grid.
- **new** **Column layout** — `fit-content` categories; reduced column gap.
- **new** **Status check spinner** — bottom-right corner instead of header text.
- **new** **Health badge** — superscript pill above health link.

### Layout & appearance

- **new** **Content area width** — `min(88%, 1600px)`.
- **fix** **Mobile header** — single row; date/time hidden on small screens.
- **fix** **Scrollable modals** — What's new and cheat sheet scroll on small viewports.
- **fix** **Tab bar spacing** — config tabs shrink padding when narrow.

### Quick-add & bookmarks

- **new** **Loading states** — favicon spinner; Save button loading state.
- **new** **Clear icon button** — reset favicon in quick-add without closing.
- **new** **Last opened in config** — date/time on bookmark rows.
- **new** **Show icons on by default** — new installations.

### Config

- **fix** **Tab bar spacing** — all tabs visible without overlap when window narrows.

### UI & discoverability

- **new** **Button tooltips** — shortcuts on footer hover (desktop only).
- **new** **Search-flow hint redesigned** — absolute positioning; token-aligned styling.
- **new** **Config nav link colours** — match dashboard header links.

---

## v2026.03 — March 2026

### Config — pages & general

- **new** **Archive pages** — dim row, *archived* badge; hidden from dashboard until restored.
- **new** **Delete empty pages** — remove pages with zero bookmarks (previously failed silently).
- **new** **Page dropdown refresh** — categories, bookmarks, and smart-page selectors update after save without reload.
- **new** **Per-setting reset (↺)** — restore default when value differs; dirty state marked.
- **new** **Checkbox 3-column layout** — `[checkbox] [↺] [label]` alignment in General.
- **new** **Bookmarks card split** — Display vs Behavior in General.
- **new** **Localization card** — language + date/time/weather tree fixed (weather under *Show weather*).
- **new** **Smart collections as `<details>` blocks** — one collapsible block per collection.
- **new** **Header & Buttons table** — Show column per footer button.
- **new** **Backup & Restore + Reset** — full-width sections outside card grid.
- **new** **Session card collapse** — Appearance and Layout open by default; state restored per visit.
- **new** **Unsaved amber border** — sticky toolbar border when dirty.
- **new** **Reset tooltip** — shows “Reset to 14 (was 20)”.
- **new** **Scrollable config tabs** — fade mask on narrow screens.
- **new** **Pages drag-reorder hint** — helper text on pages tab.

### Dashboard — navigation & UX

- **new** **`Tab` / `Shift+Tab`** — linear bookmark stepping when one is selected.
- **new** **`G + 1–9` / `GG`** — jump to nth category or first bookmark.
- **new** **Quick-add omnibox** — one-line `name | url | shortcut` (key mapping evolved in later releases; see **Unreleased**).
- **new** **Paste URL quick-add** — `Ctrl+V` on dashboard opens modal pre-filled (toggle in General).
- **new** **Page transition animation** — fade + slide between tabs.
- **new** **Empty / fresh install states** — terminal-style empty page; separate first-run message.
- **new** **Shortcut hover tooltip** — “Press X to open” when shortcut assigned.
- **new** **Preview card** — open count and last opened; viewport edge detection; `[` toggles on keyboard focus.
- **new** **`Ctrl+C` copy URL** — with toast.
- **new** **Category collapse per page** — `pageId:categoryId` keys (no cross-page bleed).
- **new** **Bottom padding** — last rows not hidden behind floating buttons.
- **new** **Corner `+` and `!`** — fixed corner placement (later superseded by footer bar layout).

### Search & commands

- **new** **Grouped command palette** — Bookmarks, View, Dashboard collapsible groups.
- **new** **Grouped search empty state** — Recent, Filters, Finders groups.
- **new** **`:history` / `:history clear`** — browse or wipe search history.
- **new** **Per-entry history delete** — × on hover in Recent group.
- **new** **Match highlighting** — bold + underline on matched characters.
- **new** **Status filter autocomplete** — descriptive values for `status:`.
- **new** **History cap** — 15 entries max.
- **new** **Command context** — select bookmark with arrows, then `:` opens with that bookmark as context.
- **new** **`:remove` undo toast** — 8-second undo window.
- **new** **No-match hints** — `:new <query>`, `?FINDER <query>` suggestions.

### Health & stats

- **new** **Health page (beta)** — scores, filters, bulk actions, ping, auto-heal suggestions.
- **new** **Duplicate groups — keep first** — one-click merge in health view.
- **new** **Health badge** — broken (red) / warnings (yellow) on dashboard header.
- **new** **Health state persistence** — filter, sort, query in sessionStorage.
- **new** **Health link in config header** — themed pulse + badge; reordered nav on health page.
- **new** **Stats: conflicts & duplicates** — link to health.
- **new** **Stats: category breakdown** — opens by category.
- **new** **Stats: opens filter** — time-filtered open counts.
- **new** **Favicon refresh from health** — per-bookmark action.

### Drag & drop & config bookmarks

- **new** **Smooth drop placeholder** — fade/scale when reordering.
- **new** **Empty category drop target** — dashed outline while dragging.
- **new** **Bookmarks split view** — list + detail panel; page move with → Move; delete from panel.
- **new** **Backup spinners** — Creating… / Importing… / Exporting… on buttons.

### Reset & data

- **fix** **Reset all data** — correctly wipes pages, bookmarks, categories, finders, settings, tags, and collections.
- **new** **Reset UX** — Enter in confirm field; redirect to dashboard after success.
- **new** **Reset context tips** — moved to Advanced section.

### Onboarding

- **new** **Smart collections onboarding step** — toggle Today and Most Used in wizard.
- **new** **Search flow banner default on** — for new installs.

---

## v2026.02 — February 2026

### Tags, collections & search

- **new** **Tags on bookmarks** — comma-separated; normalised on save; autocomplete in modal and config.
- **new** **`tag:` search filter** — filter bookmarks by tag in search bar.
- **new** **Tag collections** — optional dashboard group per tag with minimum count threshold.
- **new** **Custom collections** — dynamic rules (AND/OR) on tag, category, shortcut in config → collections.
- **new** **Config → tags tab** — tag cloud, rename, merge, delete.
- **new** **Shared TagAutocomplete** — dashboard and config use one component.

### Smart collections & bookmarks

- **new** **Smart collections** — Today, Recently opened, Most used, Stale with per-page scope.
- **new** **Today keyword sets** — work / evening / weekend configurable.
- **new** **Open-count badge** — usage visible on dashboard rows.
- **new** **`:note` command** — edit bookmark notes from command bar.
- **new** **Notes on dashboard** — visible in rows, previews, and config.

### Pages, categories & UI

- **new** **Double-click rename** — page tabs and category headers.
- **new** **Page overview overlay** — `,` shows all pages with counts.
- **new** **Improved config tabs** — pages, categories, finders layout refresh.
- **new** **Toast undo** — undo on destructive actions where applicable.
- **new** **Configurable toast duration** — in settings.

### Finders & stats

- **new** **Finder use count** — shown in search results and finder list.
- **new** **Stats tab foundations** — usage patterns, opens, health-style cleanup metrics (expanded in v2026.05).

### Health (early)

- **new** **Dead-link suggestions** — archive, redirect detect, title refresh, one-click fix paths.
- **new** **Health sorting** — sort issues by score, status, name, dates.
- **new** **Bulk action loading states** — spinners on retest / open broken.

### Keyboard & accessibility (early pass)

- **new** **Keyboard cheat sheet modal** — accordion layout; expanded over March–May releases.
- **new** **Delete bookmark confirmation** — confirm dialog from keyboard/config.
- **new** **Feature spotlight** — paste-URL tip and other one-time highlights.
- **new** **Fade mask on config tabs** — scroll indication.

---

## v2026.01 and earlier — Foundation

Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard); nextDash adds self-hosting, i18n, health, extension, and continuous keyboard-first polish.

### Core product

- **new** **Multi-page bookmark dashboard** — Go backend, file-based storage under `data/`.
- **new** **Categories per page** — collapsible sections on the dashboard.
- **new** **Keyboard navigation** — arrow keys, page number keys, search overlay.
- **new** **Search (`>`)** — filter bookmarks by name and URL.
- **new** **Command mode (`:`)** — layout, theme, and dashboard commands.
- **new** **Finders (`?`)** — external search templates with `%s`.
- **new** **Config UI** — manage pages, categories, bookmarks, finders, settings.
- **new** **Custom themes** — built-in palettes + `/colors` editor.
- **new** **Docker image** — `ghcr.io/jordibrouwer/nextdash` with volume-mounted data.

### Bookmarks & organisation

- **new** **Drag-and-drop reorder** — bookmarks within and across categories (left strip).
- **new** **Inline edit** — long-press row to edit on dashboard.
- **new** **Shortcuts per bookmark** — global uniqueness across pages.
- **new** **Pinned bookmarks** — stay on top within category.
- **new** **Status monitor** — optional ping per bookmark; online/offline indicators.
- **new** **Favicon & preview metadata** — fetch title, description, image on add.
- **new** **Hover preview card** — configurable delay.

### Backup & import (initial)

- **new** **ZIP backup and restore** — full instance export/import via config.
- **new** **Browser HTML import** — Netscape format; folders → categories; skip duplicates.
- **new** **CSV export** — all bookmarks for spreadsheets.

### Internationalisation

- **new** **EN / NL / DE / FR** — UI strings via locale JSON; language in settings.
- **new** **Embedded locales** — shipped inside binary for reliable deploys.
- **new** **Config → Help** — long-form translated help index.

### Browser extension (initial)

- **new** **Chrome extension** — save current tab to selected page via REST API.
- **new** **`GET /api/pages`**, **`POST /api/bookmarks/add`** — extension integration.

### Infrastructure

- **new** **`.dockerignore` and Dockerfile`** — container builds.
- **new** **CORS and static assets** — dashboard, config, health front ends.
- **new** **MIT license** — open source distribution.

---

## How releases are numbered

- **Calendar versions** — `v2026.MM.P` = year, month, patch (e.g. `v2026.05.7`).
- **In-app token** — `2026.06-dashboard-release-v45` in `whats-new-modal.js` tracks the dashboard “seen” state separately from git tags.
- **Unreleased** — work on `main` not yet tied to a numbered release; may appear in README *Unreleased* until shipped.

When you ship a release, add a dated section here, bump the What's new modal, and clear **Unreleased** items that are included.

---

*For the latest highlights only, open the dashboard **★** button or Config → Advanced → What's new.*
