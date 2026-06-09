/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.06-dashboard-release-v50';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    const SEARCH_PROMO_START_KEY = 'nextdash:whats-new-search-promo-start';
    const SEARCH_PROMO_RELEASE_KEY = 'nextdash:whats-new-search-promo-release';
    const SEARCH_PROMO_MS = 7 * 24 * 60 * 60 * 1000;
    /** Release notes older than this are hidden in the modal (full history stays in CHANGELOG.md). */
    const RELEASE_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
    window.NEXTDASH_WHATS_NEW_RELEASE = DASHBOARD_RELEASE;

    function isReleaseUnread() {
        try {
            return localStorage.getItem(STORAGE_KEY) !== DASHBOARD_RELEASE;
        } catch {
            return false;
        }
    }

    function getSearchPromoStart() {
        try {
            const storedRelease = localStorage.getItem(SEARCH_PROMO_RELEASE_KEY);
            if (storedRelease === DASHBOARD_RELEASE) {
                const start = Number(localStorage.getItem(SEARCH_PROMO_START_KEY) || 0);
                if (start > 0) return start;
            }
            const now = Date.now();
            localStorage.setItem(SEARCH_PROMO_START_KEY, String(now));
            localStorage.setItem(SEARCH_PROMO_RELEASE_KEY, DASHBOARD_RELEASE);
            return now;
        } catch {
            return Date.now();
        }
    }

    /** Unread release notes within the 7-day search empty-state promo window. */
    window.shouldShowWhatsNewInSearch = function shouldShowWhatsNewInSearch() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (!isReleaseUnread()) return false;
        return Date.now() - getSearchPromoStart() < SEARCH_PROMO_MS;
    };

    function release(tag, date, releasedAt, sections) {
        const releasedAtMs = Date.parse(`${releasedAt}T12:00:00Z`);
        const sectionsHtml = sections.map(({ title, items }) => `
            <div class="wn-section">
                <h4 class="wn-section-title">${title}</h4>
                <ul class="wn-list">
                    ${items.map(({ badge, text }) => `
                        <li class="wn-item">
                            <span class="wn-badge ${badge === 'new' ? 'wn-badge-new' : 'wn-badge-fix'}">${badge}</span>
                            <span class="wn-item-text">${text}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `).join('');
        return {
            releasedAtMs,
            html: `
            <div class="wn-release">
                <div class="wn-release-header">
                    <span class="wn-release-tag">${tag}</span>
                    <span class="wn-release-date">${date}</span>
                </div>
                ${sectionsHtml}
            </div>
        `,
        };
    }

    function buildIntroHtml() {
        return `
            <div class="wn-intro">
                <p class="wn-intro-text">nextDash is a personal project I build and maintain in my spare time. Every release takes many hours of design, coding and testing — if you enjoy using it, a small contribution means a lot and helps keep the project going.</p>
                <a class="wn-kofi-btn" href="https://ko-fi.com/Z8Z81Z2KIP" target="_blank" rel="noopener">
                    <svg class="wn-kofi-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 5.702 0 8.732c.483 4.918 3.919 5.023 6.782 5.139 2.81.114 3.325.12 3.325.12s.747.468 1.5.654a7.5 7.5 0 0 0 3.56-.468s5.698-1.094 7.035-5.7c.222-.778.35-1.574.35-2.373 0-.888-.098-1.83-.715-2.309zm-3.585 2.39c-.583 2.4-3.11 2.947-3.11 2.947l-1.8-.434c-.016-.003-.033.003-.043.016l-.847 1.067a.15.15 0 0 1-.265-.046l-.522-1.947a.15.15 0 0 0-.102-.107l-1.956-.517a.15.15 0 0 1-.046-.267l3.184-2.304c.016-.011.026-.03.024-.049l-.098-.832a2.617 2.617 0 0 1 2.602-2.944c1.444 0 2.618 1.174 2.618 2.618 0 .295-.049.582-.14.854l.501-.068s.564 1.006-.0 2.013z"/></svg>
                    Support me on Ko-fi
                </a>
            </div>
        `;
    }

    function buildHtml() {
        const cutoff = Date.now() - RELEASE_HISTORY_MS;
        const releases = [

            release('v2026.06.13', 'June 2026', '2026-06-09', [
                {
                    title: 'Security &amp; uploads',
                    items: [
                        { badge: 'fix', text: '<strong>DNS-rebinding protection</strong> — outbound fetches (preview, ping, icons, auto-heal) validate resolved IPs at dial time; private/loopback targets are blocked unless localhost bookmarks are allowed.' },
                        { badge: 'fix', text: '<strong>Write-token coverage</strong> — when <code>NEXTDASH_WRITE_TOKEN</code> is set, backup download, bookmark preview, search-index build, open-broken, and auto-heal suggest also require <code>X-NextDash-Token</code>. Dashboard, config, and health inject the token automatically.' },
                        { badge: 'fix', text: '<strong>Font magic bytes</strong> — custom font uploads are validated by file signature (WOFF/WOFF2/TTF/OTF), not client <code>Content-Type</code> or filename.' },
                        { badge: 'fix', text: '<strong>SVG &amp; icon hardening</strong> — downloaded SVG icons are sanitized server-side; uploaded icons/favicons use magic-byte detection; category modals escape HTML safely.' },
                    ]
                },
                {
                    title: 'Backup, import &amp; reset',
                    items: [
                        { badge: 'new', text: '<strong>Atomic ZIP import</strong> — restore stages to a temp directory, removes orphan icons and stale JSON, then commits; invalid bookmark URLs are skipped with a count in the UI.' },
                        { badge: 'fix', text: '<strong>Backup round-trip icons</strong> — legacy root-level images in <code>data/</code> export as <code>icons/&lt;name&gt;</code> so bookmark icon references survive backup → import.' },
                        { badge: 'fix', text: '<strong>Factory reset scope</strong> — reset clears <code>data/icons/</code>, custom favicon/font, and preview/health caches; sample favicons prefetch in the background after startup.' },
                        { badge: 'new', text: '<strong>Settings export/import</strong> — export or import <code>settings.json</code> alone from Config → Backups, with file-size validation and migration-safe cleanup.' },
                        { badge: 'new', text: '<strong>Last backup date</strong> — the backups panel shows when you last created a ZIP backup.' },
                    ]
                },
                {
                    title: 'Health, cache &amp; analytics',
                    items: [
                        { badge: 'fix', text: '<strong>Cache merge safety</strong> — preview and health caches use atomic read-merge-write so parallel requests no longer overwrite each other\'s entries.' },
                        { badge: 'fix', text: '<strong>Canonical URL keys</strong> — duplicate detection, health cache, status monitor, and ping validation treat <code>https://x</code>, <code>https://x/</code>, and <code>https://x:443</code> as the same URL (same for <code>http://x:80</code>).' },
                        { badge: 'fix', text: '<strong>Duplicate merge metadata</strong> — health merge keeps the best bookmark and combines tags, shortcut, opens, notes, and icons from the removed duplicates.' },
                        { badge: 'fix', text: '<strong>Open-count tracking</strong> — <code>/api/track-open</code> increments atomically under lock (no lost opens on rapid clicks).' },
                        { badge: 'fix', text: '<strong>Icon upload overwrite</strong> — re-uploading a bookmark icon with the same filename replaces the file on disk.' },
                    ]
                },
                {
                    title: 'Dashboard — bookmarks &amp; editing',
                    items: [
                        { badge: 'fix', text: '<strong>Inline edit saves immediately</strong> — rename and delete on the dashboard persist right away (no debounce); pending edits flush when you refresh or close the tab.' },
                        { badge: 'fix', text: '<strong>Disk write errors</strong> — bookmark and settings saves return an error when the server cannot write data, instead of silently failing.' },
                    ]
                },
                {
                    title: 'Config, bookmarks &amp; search',
                    items: [
                        { badge: 'fix', text: '<strong>Write-token gaps</strong> — health mutations and the bookmarks guided tour use the shared write-token fetch helpers when <code>NEXTDASH_WRITE_TOKEN</code> is set.' },
                        { badge: 'fix', text: '<strong>Shortcut docs sync</strong> — cheatsheet, help text, and config tour match dashboard keys (<kbd>1</kbd>–<kbd>9</kbd> page tabs, category jump, etc.).' },
                        { badge: 'new', text: '<strong>Link-preview icons</strong> — bookmark detail can fetch favicons via link preview with generation guards so stale async responses are ignored.' },
                        { badge: 'new', text: '<strong>URL protocol hint</strong> — missing <code>https://</code> on blur is normalized; inline hint when the protocol is absent.' },
                        { badge: 'new', text: '<strong>Config tab keys</strong> — arrow keys move between visible config tabs on desktop.' },
                        { badge: 'new', text: '<strong>Search chip keys</strong> — <kbd>←</kbd>/<kbd>→</kbd> select a recent query chip; <kbd>Enter</kbd> applies it.' },
                        { badge: 'fix', text: '<strong>Duplicate-merge modal</strong> — <kbd>ESC</kbd> cancels the health merge picker without leaving a pending promise.' },
                        { badge: 'fix', text: '<strong>Unsaved icon edits</strong> — icon fetch, upload, clear, and undo mark the bookmark detail as dirty so Save is required.' },
                    ]
                },
            ]),

            release('v2026.06.12', 'June 2026', '2026-06-08', [
                {
                    title: 'Dashboard — mobile &amp; navigation',
                    items: [
                        { badge: 'new', text: '<strong>Compact date badge</strong> — a date pill (<code>8 jun · 14:03</code>) appears in the header on phone when the full date line is hidden; tap to open the date/weather popover.' },
                        { badge: 'new', text: '<strong>Page swipe hint</strong> — a pulsing <code>← →</code> indicator below the tab strip hints at horizontal swipe when you have multiple pages on touch.' },
                        { badge: 'new', text: '<strong>Scroll-snap tabs</strong> — page tabs scroll horizontally with snap on narrow screens; the active tab scrolls into view automatically.' },
                        { badge: 'new', text: '<strong>Category name tooltip</strong> — long category titles truncate with an ellipsis; hover reveals the full name.' },
                        { badge: 'fix', text: '<strong>Empty category text</strong> — the raw locale key was shown instead of the translated "no bookmarks yet" text when the key was missing.' },
                    ]
                },
                {
                    title: 'Dashboard — bookmarks &amp; editing',
                    items: [
                        { badge: 'new', text: '<strong>Letter avatar</strong> — bookmarks without a favicon show a styled initial-letter tile instead of a blank icon.' },
                        { badge: 'new', text: '<strong>Inline edit improvements</strong> — long-press inline edit shows field-level validation errors, dismisses on <kbd>ESC</kbd> or click-outside, and warns before discarding unsaved changes.' },
                        { badge: 'new', text: '<strong>Note line-clamp</strong> — bookmark preview-card notes are capped at three lines; longer notes are hidden with an ellipsis.' },
                    ]
                },
                {
                    title: 'Modals, feedback &amp; polish',
                    items: [
                        { badge: 'new', text: '<strong>ESC hint in modals</strong> — a subtle <kbd>ESC</kbd> to close hint appears below modal buttons on pointer devices.' },
                        { badge: 'new', text: '<strong>Skeleton loader</strong> — the recent bookmarks modal (<code>*</code>) shows a shimmer skeleton while data loads.' },
                        { badge: 'new', text: '<strong>Spring animations</strong> — search entrance and drag-and-drop placeholder use spring <code>cubic-bezier</code> curves for a smoother feel.' },
                        { badge: 'new', text: '<strong>Theme preview badge</strong> — the "Preview" badge in the theme editor now uses an accent-color background with a pulsing dot.' },
                        { badge: 'new', text: '<strong>Font upload icons</strong> — custom font status shows ✓ or ✕ after upload.' },
                        { badge: 'new', text: '<strong>Focus-visible outlines</strong> — search pill buttons and history chips now show a visible focus ring on keyboard navigation.' },
                    ]
                },
                {
                    title: 'Categories &amp; search',
                    items: [
                        { badge: 'new', text: '<strong>Hide empty categories</strong> — Config → General → Bookmarks; on by default. Categories with no bookmarks are hidden from the dashboard. Existing installs are migrated automatically.' },
                        { badge: 'new', text: '<strong>Bookmark name tooltip</strong> — truncated bookmark titles show the full name on hover via the native tooltip.' },
                        { badge: 'new', text: '<strong>Search result ellipsis</strong> — long names in the search overlay now truncate cleanly with an ellipsis and tooltip.' },
                    ]
                },
                {
                    title: 'Reliability &amp; accessibility',
                    items: [
                        { badge: 'new', text: '<strong>Notification queue</strong> — rapid notifications are queued and shown one at a time with a fade gap; no more simultaneous toasts.' },
                        { badge: 'new', text: '<strong><code>prefers-reduced-motion</code></strong> — spring curves, pulse animations, and entrance effects respect the OS reduced-motion setting across the whole UI.' },
                        { badge: 'fix', text: '<strong>Collapsed category state</strong> — localStorage errors (private browsing, quota) no longer break collapse persistence; state is kept in-memory for the session.' },
                    ]
                },
            ]),

            release('v2026.06.11', 'June 2026', '2026-06-10', [
                {
                    title: 'Security &amp; self-hosting',
                    items: [
                        { badge: 'new', text: '<strong>Optional write token</strong> — set <code>NEXTDASH_WRITE_TOKEN</code> on the server; destructive and health write APIs then require <code>X-NextDash-Token</code>. Config and Health pages send it automatically in the browser.' },
                        { badge: 'new', text: '<strong>Localhost bookmarks</strong> — Config → General → Advanced → <em>Allow localhost &amp; private-network bookmarks</em> (on by default for dev). Turn off if nextDash is reachable on a shared network.' },
                        { badge: 'fix', text: '<strong>Import hardening</strong> — ZIP restore skips bookmarks with invalid URLs and reports how many were skipped.' },
                        { badge: 'fix', text: '<strong>SSRF redirects</strong> — pings, link previews, and auto-heal only follow redirects to allowed hosts.' },
                        { badge: 'fix', text: '<strong>Search XSS</strong> — fuzzy match highlights and search metadata are escaped; bookmark icon filenames are validated on save.' },
                    ]
                },
                {
                    title: 'Health &amp; reliability',
                    items: [
                        { badge: 'fix', text: '<strong>Health write APIs</strong> — auto-heal apply, cache scan, and status persistence respect the write token when set.' },
                        { badge: 'fix', text: '<strong>Factory reset</strong> — reset all data no longer deadlocks while rebuilding default files.' },
                        { badge: 'new', text: '<strong>Default bookmark favicons</strong> — on first install or factory reset, the server downloads favicons for the sample bookmarks before the dashboard loads, so icons are visible before onboarding starts.' },
                    ]
                },
                {
                    title: 'Search, extension &amp; polish',
                    items: [
                        { badge: 'new', text: '<strong>:history</strong> — command mode lists recent searches; <code>:history clear</code> wipes all. Empty search also shows history with a × per row.' },
                        { badge: 'new', text: '<strong>Extension write token</strong> — optional field in extension Settings when your server uses <code>NEXTDASH_WRITE_TOKEN</code>.' },
                        { badge: 'fix', text: '<strong>Locales &amp; font size</strong> — DE/FR parity restored; legacy <code>small</code>/<code>medium</code>/<code>large</code> font sizes normalize to <code>s</code>/<code>m</code>/<code>l</code>.' },
                        { badge: 'fix', text: '<strong>Cleanup</strong> — removed obsolete standalone colors page template and other unused static assets.' },
                    ]
                },
            ]),

            release('v2026.06.10', 'June 2026', '2026-06-09', [
                {
                    title: 'Config — find settings &amp; quick actions',
                    items: [
                        { badge: 'new', text: '<strong>Search settings</strong> — <kbd>Ctrl+Shift+K</kbd> / <kbd>Cmd+Shift+K</kbd> in the breadcrumb bar finds tabs, General panels (including Advanced while on Essentials), stats sections, colors groups, keyboard bindings, and Help blocks.' },
                        { badge: 'new', text: '<strong>Quick actions palette</strong> — <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> runs save, open dashboard, and tour resets only — settings navigation lives in search.' },
                        { badge: 'fix', text: '<strong>Search index stays fresh</strong> — rebuilds after tab opens, layer switches, language changes, and bookmark list renders.' },
                    ]
                },
                {
                    title: 'Dashboard — Classic / Modern layout',
                    items: [
                        { badge: 'new', text: '<strong>Layout version</strong> — choose <em>Classic</em> (original look) or <em>Modern</em> (refreshed visuals, same structure). Themes still control all colors.' },
                        { badge: 'new', text: '<strong>Switch anytime</strong> — Config → General → Layout → <em>Layout version</em>, or command mode <code>:layoutversion modern</code> / <code>:layoutversion classic</code> / <code>:layoutversion toggle</code> on the dashboard.' },
                        { badge: 'new', text: '<strong>Onboarding preview</strong> — first-run wizard includes a layout step with a live preview while you choose.' },
                        { badge: 'new', text: '<strong>Layout tip</strong> — classic users who skip modern in onboarding may see a one-time spotlight after <em>What\'s new</em>; try it or keep classic — switch later in config anytime.' },
                    ]
                },
                {
                    title: 'Onboarding &amp; discoverability',
                    items: [
                        { badge: 'new', text: '<strong>Shorter onboarding</strong> — keyboard and mouse bookmark tips merged into one step; the finish step covers pages and first bookmarks (no separate post-setup wizard).' },
                        { badge: 'new', text: '<strong>Chained prompts</strong> — after onboarding, <em>What\'s new</em> and (classic layout) a layout tip may appear one after another in the same session. <em>Skip for later</em> defers the rest until next session.' },
                        { badge: 'fix', text: '<strong>Cleanup</strong> — removed dead post-setup wizard, tour spotlight, and recent-bookmarks spotlight code.' },
                    ]
                },
                {
                    title: 'Config → General — status',
                    items: [
                        { badge: 'new', text: '<strong>Status essentials</strong> — compact monitoring overview under Essentials (monitored count + toggle); full tuning stays in Advanced.' },
                        { badge: 'new', text: '<strong>Health link</strong> — opens from the Essentials status summary when the Health dashboard is enabled.' },
                    ]
                },
            ]),

            release('v2026.06.9', 'June 2026', '2026-06-08', [
                {
                    title: 'Config &amp; tips',
                    items: [
                        { badge: 'new', text: '<strong>Link preview cards off by default</strong> — hover preview cards are disabled for new installs; existing installs are migrated to off on server start (opt-in again anytime).' },
                        { badge: 'new', text: '<strong>Where to enable</strong> — Config → General → Advanced → Bookmarks → <em>Show link preview cards on hover</em>.' },
                        { badge: 'new', text: '<strong>Rotating tip</strong> — footer tips mention the config path when preview cards are off.' },
                    ]
                },
            ]),

            release('v2026.06.8', 'June 2026', '2026-06-07', [
                {
                    title: 'Dashboard — bookmark rows',
                    items: [
                        { badge: 'fix', text: '<strong>No hover shift</strong> — bookmarks no longer jump ~1 px right on hover; the row highlight stays aligned edge to edge.' },
                        { badge: 'new', text: '<strong>Full-row selection</strong> — hover and keyboard focus light up the whole row: icon, title, pin/note/ping badges, and shortcut.' },
                        { badge: 'new', text: '<strong>Theme gradient</strong> — left-to-right accent tint using your active theme colors; fades smoothly toward the right.' },
                    ]
                },
            ]),

            release('v2026.06.7', 'June 2026', '2026-06-06', [
                {
                    title: 'Config → General — redesigned',
                    items: [
                        { badge: 'new', text: '<strong>Bookmarks merged</strong> — "Display" and "Behavior" are now one section; a divider separates the two groups. Essentials still shows the same lightweight subset.' },
                        { badge: 'new', text: '<strong>Tours & onboarding — collapsible</strong> — 13 tour-reset buttons grouped into a single expandable <em>Tours &amp; onboarding</em> block. Advanced tab no longer dominated by maintenance actions.' },
                        { badge: 'fix', text: '<strong>Accessibility</strong> — "Show all sections" is now a <code>&lt;button&gt;</code>; smart-collection toggles use a JS event listener instead of inline <code>onclick</code>.' },
                        { badge: 'new', text: '<strong>Favicon harmonization in Essentials</strong> — moved from Advanced to the Essentials Appearance &amp; Style panel so it\'s reachable without switching layers.' },
                    ]
                },
            ]),

            release('v2026.06.6', 'May 2026', '2026-06-05', [
                {
                    title: 'Accessibility — bookmark grid',
                    items: [
                        { badge: 'new', text: '<strong>Grid semantics</strong> — category row headers, one focusable cell per row, <code>aria-activedescendant</code>, and row/column counts for screen readers.' },
                        { badge: 'new', text: '<strong>Navigation keys</strong> — <kbd>Home</kbd>/<kbd>End</kbd> (category), <kbd>Ctrl+Home</kbd>/<kbd>Ctrl+End</kbd> (page), <kbd>Page Up</kbd>/<kbd>Page Down</kbd>; listed in the cheat sheet (<kbd>!</kbd>).' },
                    ]
                },
                {
                    title: 'Config &amp; fonts',
                    items: [
                        { badge: 'new', text: '<strong>Custom font upload</strong> — upload <code>.woff</code>/<code>.woff2</code>/<code>.ttf</code>/<code>.otf</code> in General → Appearance; pick <em>Custom font (uploaded)</em> from the UI font dropdown.' },
                        { badge: 'new', text: '<strong>Save → Open dashboard</strong> — after Save, the toast offers <em>Open dashboard</em>; returning applies pending settings via session sync.' },
                        { badge: 'fix', text: '<strong>Device-specific settings</strong> — cleaner merge of server vs. local visual preferences.' },
                    ]
                },
                {
                    title: 'Localization &amp; mobile help',
                    items: [
                        { badge: 'new', text: '<strong>Dashboard i18n</strong> — footer/search ARIA, command labels (<code>:pin</code>, <code>:note</code>, …), bookmark row and inline-edit strings (EN / NL / DE / FR).' },
                        { badge: 'new', text: '<strong>Phone vs desktop</strong> — new Help section and MANUAL table: search overlay tabs on phone; tag cloud, cheat sheet, and full config on desktop.' },
                    ]
                },
                {
                    title: 'Polish',
                    items: [
                        { badge: 'fix', text: '<strong>Guided tours</strong> — tour backdrop no longer blocks clicks; sticky save bar padding; default bookmarks ship with example tags.' },
                        { badge: 'fix', text: '<strong>Analytics cleanup</strong> — removed unused <code>/api/analytics</code>; use Config → Stats and <code>/health</code> for insights.' },
                    ]
                },
            ]),

            release('v2026.06.5', 'May 2026', '2026-06-03', [
                {
                    title: 'Dashboard — tag word cloud',
                    items: [
                        { badge: 'new', text: '<strong>Tag cloud (/)</strong> — optional FAB on desktop opens a word cloud of all tags (size = usage, <code>#</code> on every tag). Toggle under Config → General → Header &amp; Buttons; on by default.' },
                        { badge: 'new', text: '<strong>/ shortcut</strong> — on the dashboard (search closed), <kbd>/</kbd> opens the tag cloud when enabled; otherwise <kbd>/</kbd> keeps fuzzy/interleave search.' },
                        { badge: 'new', text: '<strong>Keyboard in the modal</strong> — arrows move between tags and <em>Clear tag filter</em>; Enter applies; Escape closes; clearing restores focus to the selected bookmark.' },
                        { badge: 'new', text: '<strong>Tag filter view</strong> — pick a tag to see only matching bookmarks in an animated temporary layout; Escape clears when the modal is closed.' },
                        { badge: 'fix', text: '<strong>Corner FAB stack</strong> — tag cloud sits directly above What\'s new; launcher moves up when the tag cloud is on.' },
                    ]
                },
                {
                    title: 'Search &amp; commands',
                    items: [
                        { badge: 'new', text: '<strong>:tag browse</strong> — <code>:tag</code> lists tags; <code>:tag work</code> or <code>:tag:work</code> shows matching bookmarks in the palette only (dashboard unchanged).' },
                        { badge: 'new', text: '<strong>:tag +name / :tag -name</strong> — add or remove a tag on the keyboard-selected bookmark.' },
                    ]
                },
            ]),

        ];
        return `<div class="wn-content">` + buildIntroHtml() + releases
            .filter((entry) => entry.releasedAtMs >= cutoff)
            .map((entry) => entry.html)
            .join('') + `</div>`;
    }

    /**
     * @param {Object} [options]
     * @param {boolean} [options.force] - If true, always show (skip version gate and modal-open guard).
     * @param {boolean} [options.markSeenOnConfirm] - When true (default), closing marks the release as seen.
     * @param {function(): boolean} [options.ifBlockingModalOpen] - When not forcing: return true to abort.
     * @param {function(): void} [options.onClose] - Called when the modal closes.
     */
    window.openWhatsNewModal = function openWhatsNewModal(options) {
        options = options || {};
        const force = options.force === true;
        const markSeenOnConfirm = options.markSeenOnConfirm !== false;
        const onClose = typeof options.onClose === 'function' ? options.onClose : null;

        if (!window.AppModal) {
            onClose?.();
            return;
        }
        if (!force) {
            try {
                const lastSeen = localStorage.getItem(STORAGE_KEY);
                if (lastSeen === DASHBOARD_RELEASE) {
                    onClose?.();
                    return;
                }
            } catch (error) {
                // Ignore localStorage failures.
            }
            if (typeof options.ifBlockingModalOpen === 'function' && options.ifBlockingModalOpen()) {
                onClose?.();
                return;
            }
        }

        const finish = () => {
            if (markSeenOnConfirm) {
                try {
                    localStorage.setItem(STORAGE_KEY, DASHBOARD_RELEASE);
                } catch (error) {
                    // Ignore localStorage failures.
                }
            }
            onClose?.();
        };

        window.AppModal.show({
            title: "what's new",
            htmlMessage: buildHtml(),
            confirmText: 'close',
            showCancel: false,
            modalMaxWidth: '640px',
            modalWidth: '96vw',
            modalClass: 'whats-new-modal',
            onConfirm: finish,
            onCancel: finish,
        });
    };
})();
