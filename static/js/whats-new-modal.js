/**
 * Shared "What's new" modal (dashboard auto-prompt + Config → Advanced link).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.05-dashboard-release-v32';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    const SEARCH_PROMO_START_KEY = 'nextdash:whats-new-search-promo-start';
    const SEARCH_PROMO_RELEASE_KEY = 'nextdash:whats-new-search-promo-release';
    const SEARCH_PROMO_MS = 7 * 24 * 60 * 60 * 1000;
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
        if (!isReleaseUnread()) return false;
        return Date.now() - getSearchPromoStart() < SEARCH_PROMO_MS;
    };

    function release(tag, date, sections) {
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
        return `
            <div class="wn-release">
                <div class="wn-release-header">
                    <span class="wn-release-tag">${tag}</span>
                    <span class="wn-release-date">${date}</span>
                </div>
                ${sectionsHtml}
            </div>
        `;
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
        return `<div class="wn-content">` + buildIntroHtml() + [

            release('v2026.05.5', 'May 2026', [
                {
                    title: 'Config → General',
                    items: [
                        { badge: 'new', text: '<strong>ℹ info buttons</strong> — click ℹ next to any setting label in General for a short explanation in your current language (EN / NL / DE / FR). Essentials and Advanced each have dozens of covered options.' },
                        { badge: 'new', text: '<strong>Essentials / Advanced layers</strong> — everyday options (language, appearance, layout, bookmarks) under <em>Essentials</em>; power features (smart collections, status, branding, backups) under <em>Advanced</em>. Sticky section links at the top of Advanced; <em>Show all sections on one page</em> reveals everything at once.' },
                        { badge: 'new', text: '<strong>Layer intro hints</strong> — short guidance at the top of Essentials and Advanced explains what lives in each layer and points you to ℹ for detail.' },
                        { badge: 'new', text: '<strong>Layout &amp; smart collections i18n</strong> — layout preset descriptions and smart-collection UI strings are fully translated (no more hardcoded Dutch in the template).' },
                        { badge: 'new', text: '<strong>Tuning wizard</strong> — after first-run onboarding, an optional one-time 3-step guide on the dashboard: <strong>language</strong> → <strong>theme</strong> → <strong>browser extension</strong>. Choices save immediately; skip anytime.' },
                    ]
                },
                {
                    title: 'Branding & PWA',
                    items: [
                        { badge: 'new', text: '<strong>Dynamic web app manifest</strong> — <code>/manifest.webmanifest</code> reads your custom title and favicon from settings, so “Add to Home Screen” / installed PWAs match your branding — not only the browser tab.' },
                        { badge: 'new', text: '<strong>Apple web-app meta</strong> — matching <code>apple-mobile-web-app-title</code>, touch icon, and theme colour on dashboard, config, health, and colors.' },
                    ]
                },
                {
                    title: 'Accessibility',
                    items: [
                        { badge: 'new', text: '<strong>Bookmark grid semantics</strong> — the dashboard bookmark area uses <code>role="grid"</code> with <code>row</code> / <code>gridcell</code> on each tile; categories are <code>rowgroup</code> with labelled headers.' },
                        { badge: 'new', text: '<strong>Focus on bookmark tiles</strong> — roving <code>tabIndex</code> on the open link now pairs with clearer <code>:focus-visible</code> rings; keyboard-selected rows show an accent outline on the link (launcher layout included).' },
                        { badge: 'new', text: '<strong>Selection &amp; labels</strong> — arrow-key selection sets <code>aria-selected</code>; open links include the shortcut in <code>aria-label</code> when one is set.' },
                    ]
                },
                {
                    title: 'Polish & docs',
                    items: [
                        { badge: 'new', text: '<strong>Unified toasts</strong> — dashboard, config, and colors share the same toast component for success, errors, and undo — consistent placement and styling.' },
                        { badge: 'new', text: '<strong>Help &amp; README for self-hosters</strong> — Config → Help → <em>General settings</em> and the README now document Essentials vs Advanced, ℹ buttons, and branding/PWA in plain language.' },
                    ]
                },
            ]),

            release('v2026.05.4', 'May 2026', [
                {
                    title: 'UX & discoverability',
                    items: [
                        { badge: 'new', text: '<strong>Rich keyboard tooltips</strong> — on desktop, hovering footer buttons shows the action name plus shortcuts (e.g. <kbd>&gt;</kbd> search, <kbd>Ctrl+Shift+A</kbd> for quick-add). Hidden on touch devices.' },
                        { badge: 'new', text: '<strong>Search-flow hint with labels</strong> — the first-run hint above the button bar shows key chips plus text labels (search · commands · finders · bookmark); includes a swipe-between-pages hint on mobile.' },
                        { badge: 'new', text: '<strong>Mobile bottom bar</strong> — short text labels under footer icon buttons; a mini status line on small screens shows date · current page · health summary.' },
                        { badge: 'new', text: '<strong>Post-setup wizard</strong> — after onboarding, empty libraries get a 3-step guide: open <em>config → pages</em>, add your first bookmark (quick-add or <em>config → bookmarks</em>), then finish.' },
                        { badge: 'new', text: '<strong>Tips auto-expire</strong> — rotating footer tips turn off automatically 7 days after onboarding (still configurable in General).' },
                        { badge: 'new', text: '<strong>Skeleton loading</strong> — dashboard, config, health, and colors show shimmer placeholders while data loads instead of a blank flash.' },
                    ]
                },
                {
                    title: 'Health (beta)',
                    items: [
                        { badge: 'new', text: '<strong>Bulk open confirmation</strong> — <em>Open broken links</em> asks for confirmation with the total broken count and a per-batch limit (default 10, max 25).' },
                        { badge: 'new', text: '<strong>Health badge on dashboard</strong> — the health link shows a text pill like <em>3 broken</em> (or a warning count), not only a number; refreshes when you return to the tab.' },
                    ]
                },
                {
                    title: 'Browser extension',
                    items: [
                        { badge: 'new', text: '<strong>Save success panel</strong> — the popup stays open after save with an <em>Open in nextDash</em> deep link to the right page (<code>#tab</code>).' },
                        { badge: 'new', text: '<strong>Dashboard toast</strong> — if the dashboard tab is open on the same server, a success notification appears and bookmarks refresh.' },
                        { badge: 'new', text: '<strong>Extension UI translated</strong> — popup strings in EN / NL / DE / FR; language follows nextDash server settings when configured.' },
                    ]
                },
                {
                    title: 'Accessibility',
                    items: [
                        { badge: 'new', text: '<strong>Modal semantics</strong> — global confirm/delete modals use <code>role="dialog"</code>, <code>aria-modal</code>, and labelled titles (aligned with quick-add).' },
                        { badge: 'new', text: '<strong>Config tab list</strong> — <code>role="tablist"</code> / <code>aria-selected</code> on config tabs.' },
                        { badge: 'new', text: '<strong>Skip links</strong> — “Skip to main content” on dashboard and config.' },
                        { badge: 'new', text: '<strong>Custom selects</strong> — combobox/listbox ARIA on styled <code>&lt;select&gt;</code> widgets.' },
                        { badge: 'new', text: '<strong>prefers-reduced-motion</strong> — inline-edit reveal animation respects reduced motion.' },
                    ]
                },
                {
                    title: 'Config polish',
                    items: [
                        { badge: 'new', text: '<strong>Sticky save bar</strong> — save / unsaved / undo / discard stay visible while scrolling config.' },
                        { badge: 'new', text: '<strong>Autosave for low-risk fields</strong> — language, theme, and similar toggles save without a full Save click.' },
                        { badge: 'new', text: '<strong>General tab intro</strong> — short explanation at the top of General; <em>backups</em> tab routing fixed; page <code>lang</code> matches your language.' },
                        { badge: 'fix', text: '<strong>Ko-fi overlay removed</strong> — floating support button removed from the config page (intro link in General remains).' },
                    ]
                },
                {
                    title: 'Translations',
                    items: [
                        { badge: 'new', text: '<strong>DE / FR coverage</strong> — new dashboard strings (skip link, health confirm, swipe hint, tooltips, post-setup wizard, and more) added for German and French.' },
                    ]
                },
            ]),

            release('v2026.05.3', 'May 2026', [
                {
                    title: 'Button bar position',
                    items: [
                        { badge: 'new', text: '<strong>Corner dock mode</strong> — move the button bar to the bottom-left or bottom-right corner via Config → General → Header & Buttons. In dock mode the buttons become a compact 2-column widget: primary actions (<code>&gt;</code> <code>:</code> <code>?</code>) in one column, secondary actions (<code>!</code> <code>*</code> <code>⊞</code>) in the other.' },
                        { badge: 'new', text: '<strong>:buttonbar command</strong> — switch button bar position from the command palette: <code>:buttonbar bottom</code> / <code>:buttonbar bottom-right</code> / <code>:buttonbar bottom-left</code>. Current position is marked with ✓.' },
                        { badge: 'new', text: '<strong>Launcher selector in dock</strong> — in corner dock mode the standalone launcher FAB (⊞) is replaced by an integrated button inside the dock. Toggle via Config → General → Show layout selector in dock.' },
                    ]
                },
                {
                    title: 'Search',
                    items: [
                        { badge: 'new', text: '<strong>@ global search</strong> — type <code>@</code> to fuzzy-search across <em>all pages at once</em>. Each result shows the page name as context so you can tell at a glance where the bookmark lives.' },
                        { badge: 'new', text: '<strong>:find &lt;text&gt;</strong> — filter bookmark tiles on the current page directly from the command palette. Tiles whose name or URL don\'t match are hidden; clear the filter by running <code>:find</code> with no argument.' },
                    ]
                },
                {
                    title: 'Page customisation',
                    items: [
                        { badge: 'new', text: '<strong>Page emoji icon</strong> — double-click any page tab on the dashboard to open a popover where you can set an emoji icon for that page. The icon appears inside the tab alongside the page name.' },
                        { badge: 'new', text: '<strong>Page colour dot</strong> — choose one of 8 accent colours (or none) for each page in the same popover. A small colour dot appears in the page tab for quick visual identification.' },
                    ]
                },
                {
                    title: 'What\'s new star button',
                    items: [
                        { badge: 'new', text: '<strong>★ FAB button</strong> — a star button appears in the corner opposite the button bar (bottom-left by default; bottom-right when the bar is docked left). Click it at any time to open these release notes.' },
                        { badge: 'new', text: '<strong>What\'s new group in search</strong> — when new release notes are unread, a <em>What\'s New</em> group appears in the <code>&gt;</code> search empty state. Clicking the item opens this modal and the group disappears (also hides after 7 days).' },
                    ]
                },
                {
                    title: 'Cheat sheet & themes',
                    items: [
                        { badge: 'new', text: '<strong>Cheat sheet restructured</strong> — the keyboard cheat sheet now has 6 sections: navigation, bookmarks, search modes (including <code>@</code>), commands — bookmarks, commands — appearance (with <code>:buttonbar</code> <code>:fontsize</code> <code>:favicons</code> <code>:preview</code> <code>:packed</code>), and other.' },
                        { badge: 'new', text: '<strong>5 new themes</strong> — Terminal Amber (phosphor-amber terminal look), Dusk Horizon (muted indigo-navy), Moss & Stone (desaturated earthy olive-grey), Candy Pop (vivid bubblegum pink + electric cyan), Midnight Ink (near-pure black with icy silver-blue). Each available in dark and light variants.' },
                    ]
                },
            ]),

            release('v2026.05.2', 'May 2026', [
                {
                    title: 'Search & commands',
                    items: [
                        { badge: 'new', text: '<strong>Fuzzy search on URL, note & tags</strong> — the <code>/</code> fuzzy mode now also matches against a bookmark\'s URL domain, tags, and note text when the name doesn\'t match. Secondary-field matches rank below name matches and show a small context snippet.' },
                        { badge: 'new', text: '<strong>Saved searches as separate group</strong> — opening the <code>&gt;</code> search bar now shows <em>Recent</em> (last 5 queries) and <em>Saved searches</em> as two distinct collapsed groups. Saved searches are collapsed by default so they don\'t obscure recent history.' },
                        { badge: 'new', text: '<strong>:open all</strong> — new command that opens every bookmark on the current page in new tabs. Shows a safe cap (first 15) and an "open all" option when the page has more.' },
                        { badge: 'new', text: '<strong>:pin / :unpin</strong> — toggle the pin flag on the keyboard-selected bookmark directly from the command palette, without opening Config.' },
                        { badge: 'new', text: '<strong>:tag &lt;tagname&gt;</strong> — add or remove a tag on the selected bookmark from the command palette. Typing <code>:tag</code> without a name shows the bookmark\'s current tags.' },
                        { badge: 'new', text: '<strong>:stale &lt;days&gt;</strong> — the stale command now accepts a custom day window: <code>:stale 7</code>, <code>:stale 90</code> etc. Default remains 30 days when called without an argument.' },
                    ]
                },
                {
                    title: 'Keyboard cheat sheet',
                    items: [
                        { badge: 'new', text: '<strong>Searchable cheat sheet</strong> — a filter input at the top of the cheat sheet (<kbd>!</kbd> / <kbd>F1</kbd>) lets you type to instantly narrow down the ~30 shortcut rows. Matching sections expand automatically; sections with no matches are hidden.' },
                    ]
                },
            ]),

            release('v2026.05.1', 'May 2026', [
                {
                    title: 'Launcher view',
                    items: [
                        { badge: 'new', text: '<strong>Launcher layout preset</strong> — a new <em>Launcher</em> layout shows large favicon tiles (48 px icons) grouped in horizontal category rows, inspired by app launchers. Toggle instantly via the FAB button (⊞) in the bottom-right corner.' },
                        { badge: 'new', text: '<strong>Launcher icon size</strong> — choose Small / Normal / Large icon size for launcher tiles in Config → Appearance.' },
                        { badge: 'new', text: '<strong>Launcher tile animations</strong> — tiles dim to 15 % while search is active so matches stand out; clicking a tile plays a brief scale-pulse animation.' },
                    ]
                },
                {
                    title: 'Date header & calendar',
                    items: [
                        { badge: 'new', text: '<strong>Clickable date/time</strong> — click the date/time in the header to open a mini week-overview popover showing ISO week number, all 7 days with today highlighted, and an optional calendar link.' },
                        { badge: 'new', text: '<strong>Calendar URL setting</strong> — set your calendar URL in Config → Appearance. The link only appears in the popover when a URL is configured (hidden by default).' },
                    ]
                },
                {
                    title: 'Keyboard shortcuts',
                    items: [
                        { badge: 'new', text: '<strong>Shift+M — quick move</strong> — press Shift+M on a keyboard-selected bookmark to open a <em>Move to…</em> popover listing all categories on the current page and all other pages. Arrow keys navigate the list, Enter confirms, Escape cancels.' },
                        { badge: 'new', text: '<strong>Ctrl+C row flash</strong> — copying a bookmark URL (Ctrl+C) now flashes the bookmark row with a green tint in addition to showing the toast, so the action is visible even in dense or launcher views.' },
                    ]
                },
                {
                    title: 'Search & commands',
                    items: [
                        { badge: 'new', text: '<strong>:goto command</strong> — type <code>:goto &lt;url-or-domain&gt;</code> to navigate directly. Full URLs (<code>https://…</code>) open as-is; bare domains like <code>github.com</code> get <code>https://</code> prepended automatically.' },
                        { badge: 'new', text: '<strong>Recent searches in empty state</strong> — opening the <code>&gt;</code> search without typing shows your last 5 searches as clickable chips. Collapsed by default; click the group header to expand.' },
                        { badge: 'fix', text: '<strong>Fuzzy search ranking</strong> — results are now scored and sorted: exact match → name-prefix match → word-boundary prefix → substring. Searching "yt" now puts "YT" and "YouTube" above bookmarks that merely contain "yt" somewhere in the middle.' },
                    ]
                },
                {
                    title: 'Dashboard polish',
                    items: [
                        { badge: 'fix', text: '<strong>Category collapse animation</strong> — replaced the <code>max-height</code> transition (which was instant-open / slow-close on large categories) with a <code>grid-template-rows: 1fr ↔ 0fr</code> technique — smooth and proportional regardless of content height.' },
                    ]
                },
                {
                    title: 'Keyboard cheat sheet expanded',
                    items: [
                        { badge: 'new', text: '<strong>Full commands reference</strong> — the cheat sheet (<kbd>!</kbd> / <kbd>F1</kbd>) now lists all search commands: <code>:goto</code> <code>:layout</code> <code>:theme</code> <code>:density</code> <code>:columns</code> <code>:sort</code> <code>:remove</code> <code>:save</code> <code>:saved</code> and more.' },
                        { badge: 'new', text: '<strong>Fuzzy mode documented</strong> — the <code>/</code> search prefix and its ranked scoring (prefix → word-boundary → substring) are now described in the cheat sheet.' },
                        { badge: 'new', text: '<strong>Config shortcuts listed</strong> — <kbd>Alt+↑/↓</kbd> to reorder and <kbd>Ctrl/Cmd+K</kbd> for the config command palette are now included.' },
                    ]
                },
            ]),

            release('v2026.05', 'May 2026', [
                {
                    title: 'Glass-effect config & health',
                    items: [
                        { badge: 'new', text: '<strong>Transparent card backgrounds</strong> — all panels, cards, toolbars and list containers on the Config and Health pages now use a 75 % transparent background so the dot pattern shows through, matching the dashboard look.' },
                        { badge: 'new', text: '<strong>Save/Discard bar transparent</strong> — the sticky action bar above the tab strip (Save, Undo, Discard buttons) is now fully transparent; the tab strip itself keeps its solid background.' },
                        { badge: 'fix', text: '<strong>What\'s new link removed from Help tab</strong> — the "Show what\'s new" button in Config → Help has been removed; the modal still auto-opens on first visit and can be reached from the dashboard prompt.' },
                    ]
                },
                {
                    title: 'Button animations',
                    items: [
                        { badge: 'new', text: '<strong>Pulsing glow on Search & Commands icons</strong> — the search (<code>&gt;</code>) and commands (<code>:</code>) footer buttons have a subtle repeating glow animation to help new users discover them faster.' },
                    ]
                },
                {
                    title: 'Onboarding & feature tour',
                    items: [
                        { badge: 'new', text: '<strong>Interactive feature tour</strong> — 8-step guided tour covering search, commands, finders, columns, smart collections and bookmark management. Launched via the spotlight notification after onboarding, or from Config → Advanced.' },
                        { badge: 'new', text: '<strong>Tour spotlight notification</strong> — appears once, 2 seconds after onboarding completes, inviting new users to start the tour. Dismissible; restart any time via Config → Advanced.' },
                        { badge: 'new', text: '<strong>Animated search flow hint</strong> — on first load the <code>&gt;</code> <code>:</code> <code>?</code> <code>!</code> hint above the footer buttons wipes in segment by segment with a spring pop on the accent characters, then auto-dismisses. Shown only once.' },
                    ]
                },
                {
                    title: 'Buttons & discoverability',
                    items: [
                        { badge: 'new', text: '<strong>Finders & Commands buttons on by default</strong> — new installations now show both buttons immediately, without needing to enable them in config.' },
                        { badge: 'fix', text: '<strong>Tips above buttons restored</strong> — the rotating tip element was missing from the HTML, preventing tips from ever rendering even when enabled in config.' },
                    ]
                },
                {
                    title: 'Translations (i18n)',
                    items: [
                        { badge: 'new', text: '<strong>Feature tour fully translated</strong> — all 8 step titles, body text, field labels, options and navigation buttons are translated into EN / NL / DE / FR with English as the fallback.' },
                        { badge: 'fix', text: '<strong>Hardcoded Dutch strings removed</strong> — undo button label, backup tip, tour spotlight and config tour section are now resolved from translation keys for all supported languages.' },
                    ]
                },
                {
                    title: 'Stats insights dashboard',
                    items: [
                        { badge: 'new', text: '<strong>Two-column layout with index navigation</strong> — the Stats tab is now a full insights dashboard. A sticky index on the left lets you jump to any of the 10 sections; a scrollspy keeps the active link highlighted as you scroll.' },
                        { badge: 'new', text: '<strong>Per-section time period buttons</strong> — activity, top bookmarks, pages, categories, and rot & cleanup each have their own week / month / 3 months / 6 months / all-time period selector that re-renders only that section.' },
                        { badge: 'new', text: '<strong>Activity sparkline</strong> — an SVG bar chart shows when bookmarks were last opened, bucketed to fit the chosen period.' },
                        { badge: 'new', text: '<strong>Cleanup score</strong> — a 0–100 health score with a colour bar. Penalties are explained line-by-line: never-opened, stale 90+ days, duplicate URLs, and shortcut conflicts.' },
                        { badge: 'new', text: '<strong>Rot & cleanup section</strong> — summary cards for never-opened, stale, and recently-added counts, plus full tables for deeper review.' },
                        { badge: 'new', text: '<strong>Info buttons on every section</strong> — click the <em>ℹ</em> next to any section title for a plain-English explanation of what the data shows and how it is calculated.' },
                        { badge: 'new', text: '<strong>Intro text block</strong> — a brief description at the top of the tab explains the read-only nature of the data and how to refresh it.' },
                        { badge: 'new', text: '<strong>Fully translated</strong> — all text on the Stats tab (section titles, table headers, labels, period buttons, score messages, info modals) is now resolved from i18n keys in EN / NL / DE / FR.' },
                    ]
                },
            ]),

            release('v2026.04', 'April 2026', [
                {
                    title: 'Dashboard buttons',
                    items: [
                        { badge: 'new', text: '<strong>Labels removed</strong> — footer buttons now show only their key symbol (<code>:</code> <code>?</code> <code>&gt;</code> <code>*</code> <code>!</code>). Hover to see the name as a tooltip.' },
                        { badge: 'new', text: '<strong>Button order</strong> — bar is now: <em>: commands</em> · <em>? finders</em> · <em>&gt; search</em> · <em>* recent</em> · <em>! cheatsheet</em>.' },
                        { badge: 'fix', text: '<strong>Config label toggle removed</strong> — the per-button "Label" column in config → Header & Buttons has been removed.' },
                    ]
                },
                {
                    title: 'Search',
                    items: [
                        { badge: 'new', text: '<strong>Mode badge</strong> — the search bar shows a coloured badge for the active input mode: SEARCH, CMD, FIND, or FUZZY.' },
                        { badge: 'new', text: '<strong>Filter group</strong> — autocomplete suggestions (<code>category:</code>, <code>status:</code>, <code>page:</code>, <code>tag:</code>) are grouped under a collapsible "Filters" header.' },
                        { badge: 'new', text: '<strong>Empty state</strong> — opening search with an empty query shows helpful groups (Recent, Filters, Finders) immediately.' },
                        { badge: 'new', text: '<strong>Search mode chips</strong> — the search overlay shows <em>&gt; search</em> · <em>: commands</em> · <em>? finders</em> chips. Click any chip to switch mode.' },
                    ]
                },
                {
                    title: 'Dashboard',
                    items: [
                        { badge: 'new', text: '<strong>Category collapse animation</strong> — categories fold and unfold with a smooth height transition and a rotating chevron.' },
                        { badge: 'new', text: '<strong>Smart collection accent</strong> — smart collection headers are tinted with the accent colour to stand out from regular categories.' },
                        { badge: 'new', text: '<strong>Focus indicators</strong> — keyboard focus rings are consistently styled across bookmarks, category headers, and search items.' },
                        { badge: 'new', text: '<strong>Compact bookmark rows</strong> — status, pin and note badges are inline chips; grid uses three columns so names are never truncated.' },
                        { badge: 'new', text: '<strong>Health badge</strong> — broken/warning count is now a superscript pill badge above the health link.' },
                    ]
                },
                {
                    title: 'Layout & appearance',
                    items: [
                        { badge: 'new', text: '<strong>Content area width</strong> — switched to <code>min(88%, 1600px)</code>, giving more grid space on laptop screens and capping neatly on ultra-wide monitors.' },
                        { badge: 'fix', text: '<strong>Mobile header</strong> — on small screens the header stays as a single horizontal row; date/time is hidden to free vertical space.' },
                        { badge: 'fix', text: '<strong>Scrollable modals</strong> — What\'s new and Keyboard cheatsheet modals now scroll correctly on small screens.' },
                        { badge: 'fix', text: '<strong>Tab bar spacing</strong> — config tab buttons reduce padding as the window narrows so all tabs stay visible without overlapping.' },
                    ]
                },
                {
                    title: 'Quick-add & bookmarks',
                    items: [
                        { badge: 'new', text: '<strong>Loading states</strong> — spinner on icon preview during favicon fetch; Save button shows a loading state while saving.' },
                        { badge: 'new', text: '<strong>Clear icon button</strong> — a × button next to the icon preview resets to the default favicon without closing the form.' },
                        { badge: 'new', text: '<strong>Last opened date/time</strong> — each bookmark row in config → bookmarks now shows the date and time it was last opened.' },
                        { badge: 'new', text: '<strong>Show icons on by default</strong> — bookmark icons are enabled by default for new installations.' },
                    ]
                },
            ]),

        ].join('') + `</div>`;
    }

    /**
     * @param {Object} [options]
     * @param {boolean} [options.force] - If true, always show (skip version gate and modal-open guard).
     * @param {function(): boolean} [options.ifBlockingModalOpen] - When not forcing: return true to abort.
     */
    window.openWhatsNewModal = function openWhatsNewModal(options) {
        options = options || {};
        const force = options.force === true;
        const markSeenOnConfirm = options.markSeenOnConfirm !== false;
        const queueMeta = options.queueMeta || null;
        const onDefer = typeof options.onDefer === 'function' ? options.onDefer : null;
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

        let htmlMessage = buildHtml();
        if (queueMeta && window.DiscoverabilityQueueBar?.inject) {
            const wrap = document.createElement('div');
            wrap.innerHTML = htmlMessage;
            window.DiscoverabilityQueueBar.inject(wrap, queueMeta, () => {
                window.AppModal.hide();
                onDefer?.();
                onClose?.();
            }, window.dashboardInstance || window.configManager);
            htmlMessage = wrap.innerHTML;
        }

        const skipLaterText = options.skipLaterText || 'Skip for later';

        window.AppModal.show({
            title: "what's new",
            htmlMessage,
            confirmText: 'close',
            cancelText: onDefer ? skipLaterText : 'Cancel',
            showCancel: Boolean(onDefer),
            modalMaxWidth: '640px',
            modalWidth: '96vw',
            modalClass: 'whats-new-modal',
            onConfirm: () => {
                if (markSeenOnConfirm) {
                    try {
                        localStorage.setItem(STORAGE_KEY, DASHBOARD_RELEASE);
                    } catch (error) {
                        // Ignore localStorage failures.
                    }
                }
                onClose?.();
            },
            onCancel: () => {
                onDefer?.();
                onClose?.();
            },
        });
    };
})();
