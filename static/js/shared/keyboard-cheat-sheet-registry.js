/**
 * The single declarative source for every cheat sheet row.
 *
 * The modal, the printable PDF, and the validation scripts all build from this
 * list, so a shortcut cannot say one thing in the app and another on the sheet
 * taped to someone's monitor. Rows for the health, inbox, and triage views are
 * not repeated here — those come from KeyboardViewLegends, which the inline
 * legends under each view render from as well.
 *
 * Shape:
 *   section := { id, titleKey, titleFallback, contextId?, when?, rows|legend }
 *   row     := { keys, cheatKey, fallback, when?, print? }
 *
 * `when(ctx)` decides whether a section or row applies; ctx is
 * { dash, activeView, isSideRail, ... } built by buildContext(). A row with
 * `print: true` is also part of the one-page printable sheet, which is a
 * deliberate curated subset rather than the full list — see
 * scripts/generate-cheatsheet.cjs.
 */
(function (global) {
    'use strict';

    /** Rows a section pulls from KeyboardViewLegends instead of listing itself. */
    const LEGEND_SOURCES = {
        HEALTH_VIEW: 'HEALTH_VIEW',
        INBOX_VIEW: 'INBOX_VIEW',
        INBOX_TRIAGE: 'INBOX_TRIAGE',
    };

    const SECTIONS = [
        {
            id: 'sectionNavigation',
            titleKey: 'sectionNavigation',
            titleFallback: 'Navigation',
            contextId: 'bookmarks',
            rows: [
                { keys: '1–9', cheatKey: 'navPageTab', fallback: 'Switch to bookmark page', print: true, printKeys: '1–9' },
                // '0' still opens the Inbox but is deliberately undocumented: Shift+I
                // replaces it, and listing both would teach a shortcut that is going away.
                {
                    keys: 'Shift + I',
                    cheatKey: 'navInboxView',
                    fallback: 'Open Inbox — links saved to read later',
                    when: (ctx) => ctx.inboxEnabled && ctx.inboxInPageTabs,
                    print: true,
                    printFallback: 'Open Inbox',
                },
                {
                    keys: 'Shift + H',
                    cheatKey: 'navHealthView',
                    fallback: 'Open Health — bookmarks that need attention',
                    when: (ctx) => ctx.healthEnabled,
                    print: true,
                    printFallback: 'Open Health',
                },
                {
                    keys: 'Shift + S',
                    cheatKey: 'navSettingsView',
                    fallback: 'Open config — settings, pages, and bookmarks',
                    when: (ctx) => ctx.configEnabled,
                    print: true,
                    printFallback: 'Open config',
                },
                { keys: 'Shift + ← / →', cheatKey: 'navPrevNextPage', fallback: 'Previous / next page', print: true },
                { keys: ',', cheatKey: 'navPageOverview', fallback: 'Page overview with bookmark counts', print: true, printFallback: 'Page overview' },
                { keys: '<', cheatKey: 'navOpenConfig', fallback: 'Open config (< is Shift+,; in config < returns here)' },
                { keys: '.', cheatKey: 'navCollapseAll', fallback: 'Collapse or expand all categories' },
                { keys: '↑ / ↓', cheatKey: 'navFocusUpDown', fallback: 'Move focus up / down through bookmarks', print: true, printKeys: '↑ ↓ ← →', printFallback: 'Move focus' },
                { keys: '← / →', cheatKey: 'navFocusLeftRight', fallback: 'Move focus left / right in grid' },
                { keys: 'Home / End', cheatKey: 'navCategoryHomeEnd', fallback: 'First / last bookmark in the focused category' },
                { keys: 'Ctrl + Home / End', cheatKey: 'navGridHomeEnd', fallback: 'First / last bookmark on the page' },
                { keys: 'Page Up / Page Down', cheatKey: 'navPageScroll', fallback: 'Jump one screen up / down through bookmarks' },
                { keys: 'Tab / Shift+Tab', cheatKey: 'navTabLinear', fallback: 'Step linearly through all bookmarks' },
                { keys: 'G + 1–9', cheatKey: 'navGotoCategory', fallback: 'Jump to first bookmark in nth category or smart collection' },
                { keys: 'G + P', cheatKey: 'navGotoPinned', fallback: 'Jump to first pinned bookmark on the page' },
                { keys: 'Enter / Space', cheatKey: 'navOpenFocused', fallback: 'Open focused bookmark', print: true },
                { keys: 'Esc', cheatKey: 'navEscClear', fallback: 'Clear selection / close overlay; undo unsaved drag reorder', print: true, printFallback: 'Clear selection / close overlay' },
            ],
        },
        {
            id: 'sectionLayout',
            titleKey: 'sectionLayout',
            titleFallback: 'Layout (side rail)',
            when: (ctx) => ctx.isSideRail,
            rows: [
                { keys: 'Tab', cheatKey: 'layoutSideRailFocus', fallback: 'Toolbar is first in tab order — then page header, then bookmark grid' },
                { keys: '← / →', cheatKey: 'layoutPageTabScroll', fallback: 'Scroll page tabs horizontally when many pages' },
                { keys: ':buttonbar bottom', cheatKey: 'layoutSideRailButtonbar', fallback: 'Return button bar to bottom — :buttonbar bottom-left / bottom-right also work' },
            ],
        },
        {
            id: 'sectionBookmarks',
            titleKey: 'sectionBookmarks',
            titleFallback: 'Bookmarks',
            contextId: 'bookmarks',
            rows: [
                { keys: '&', cheatKey: 'bmQuickAdd', fallback: 'Quick-add — type name | url | shortcut in one line' },
                { keys: 'Ctrl + V', cheatKey: 'bmPasteUrlModal', fallback: 'Paste a URL to open the new-bookmark modal pre-filled' },
                { keys: '+', cheatKey: 'bmNewBookmarkModal', fallback: 'Open full new-bookmark modal on the dashboard' },
                { keys: 'Shift + B', cheatKey: 'bmNewBookmarkModalShift', fallback: 'Open full new-bookmark modal from anywhere (skipped while typing in a field)' },
                { keys: 'Ctrl + Shift + A', cheatKey: 'bmNewBookmarkModalGlobal', fallback: 'Open full new-bookmark modal from anywhere' },
                { keys: ';', cheatKey: 'bmInlineEdit', fallback: 'Inline-edit focused bookmark' },
                { keys: 'Shift + M', cheatKey: 'bmQuickMove', fallback: 'Quick-move focused bookmark — choose category or page; Esc close restores selection on same row' },
                { keys: 'Shift + D', cheatKey: 'bmQuickDelete', fallback: 'Quick-delete focused bookmark — confirm in popover; Esc close restores selection on same row' },
                { keys: 'Shift + T', cheatKey: 'bmQuickTag', fallback: 'Quick-tag focused bookmark — ↑/↓ navigate; Enter/Space toggles tag and advances; ✓ shows tags on bookmark; Esc close restores selection on same row' },
                { keys: 'Shift + C', cheatKey: 'bmQuickCheckMode', fallback: 'Availability checking for focused bookmark — o off, p periodic, m monitor; ↑/↓ and Enter also work; Esc closes' },
                { keys: 'Ctrl + C', cheatKey: 'bmCopyUrl', fallback: 'Copy URL of focused bookmark (row flashes green)' },
                { keys: '[', cheatKey: 'bmTogglePreview', fallback: 'Toggle hover preview card on focused bookmark' },
                { keys: 'Enter on "+ N more"', cheatKey: 'bmShowMoreToggle', fallback: 'Expand or collapse a long category — selection returns to the last bookmark above the toggle' },
                { keys: 'Delete', cheatKey: 'bmDelete', fallback: 'Delete focused bookmark (confirmation dialog)' },
                { keys: 'Right-click bookmark', cheatKey: 'bmContextMenu', fallback: 'Menu with open in new tab, copy URL, edit, tags, move, checking, delete (Shift + right-click for the browser menu)' },
                { keys: 'Double-click page tab', cheatKey: 'bmRenamePageTab', fallback: 'Rename page tab — also set emoji icon and colour dot' },
                { keys: 'Long-press category (~500 ms)', cheatKey: 'bmRenameCategory', fallback: 'Rename category header (not on sort buttons)' },
                { keys: 'Drag left strip', cheatKey: 'bmDragReorder', fallback: 'Reorder a bookmark within or across categories' },
                { keys: 'Drag // in category title', cheatKey: 'bmDragCategory', fallback: 'Reorder categories (grab the // prefix in the header)' },
            ],
        },
        // Only when the view exists, matching the Shift+H entry above: teaching row
        // shortcuts for a view someone cannot open is noise. These mirror the legend
        // under the health list, which is the same set in context.
        {
            id: 'sectionHealthView',
            titleKey: 'sectionHealthView',
            titleFallback: 'Health view',
            contextId: 'health',
            when: (ctx) => ctx.healthEnabled,
            legend: LEGEND_SOURCES.HEALTH_VIEW,
            print: true,
        },
        {
            id: 'sectionInboxView',
            titleKey: 'sectionInboxView',
            titleFallback: 'Inbox view',
            contextId: 'inbox',
            when: (ctx) => ctx.inboxEnabled,
            legend: LEGEND_SOURCES.INBOX_VIEW,
            print: true,
            // The inline legend under the feed also shows a `dblclick` row, which
            // is a mouse gesture rather than a shortcut. It stays out of the cheat
            // sheet, matching what the modal has always listed.
        },
        {
            id: 'sectionInboxTriage',
            titleKey: 'sectionInboxTriage',
            titleFallback: 'Inbox triage',
            contextId: 'inbox-triage',
            when: (ctx) => ctx.inboxEnabled,
            legend: LEGEND_SOURCES.INBOX_TRIAGE,
            print: true,
        },
        {
            id: 'sectionConfigView',
            titleKey: 'sectionConfigView',
            titleFallback: 'Config view',
            contextId: 'config',
            when: (ctx) => ctx.configEnabled,
            rows: [
                { keys: '0–9', cheatKey: 'cvSectionJump', fallback: 'Switch to Inbox (0) or a bookmark page (1–9)' },
                { keys: 'j / k', cheatKey: 'cvSectionJk', fallback: 'Previous / next section in the left rail', print: true, printFallback: 'Previous / next section' },
                { keys: 'g / G', cheatKey: 'cvSectionFirstLast', fallback: 'Jump to the first / last section' },
                { keys: '← / → (section rail)', cheatKey: 'cvSectionRail', fallback: 'Move between sections when the section rail is focused (↑ / ↓ on desktop)' },
                { keys: 'Alt + ← / →', cheatKey: 'cvSubTab', fallback: 'Previous / next sub-tab in the current section' },
                { keys: '[ / ]', cheatKey: 'cvSubTabBrackets', fallback: 'Previous / next sub-tab in the current section', print: true, printFallback: 'Previous / next sub-tab' },
                { keys: '← / → (sub-tabs)', cheatKey: 'cvSubTabRail', fallback: 'Move between sub-tabs when a sub-tab strip is focused' },
                { keys: '← / → (choice row)', cheatKey: 'cvChoiceRow', fallback: 'Move between options in a choice group; Space selects' },
                { keys: 'Home / End (slider)', cheatKey: 'cvRangeHomeEnd', fallback: 'Jump to min or max on a focused opacity or intensity slider' },
                { keys: '↑ / ↓ (Pages & tags lists)', cheatKey: 'cvListMove', fallback: 'Move between rows when focus is in the list panel' },
                { keys: 'Enter / Space (list row)', cheatKey: 'cvListEdit', fallback: 'Focus the first field in the selected list row' },
                { keys: 'g / G (list row)', cheatKey: 'cvListFirstLast', fallback: 'Jump to the first / last row in a Pages & tags list' },
                { keys: '/ (Tags tab)', cheatKey: 'cvListFilter', fallback: 'Focus the tag filter while on the Tags sub-tab' },
                { keys: 'j / k (Bookmarks list)', cheatKey: 'cvBmMove', fallback: 'Move between bookmark rows when focus is in the list panel' },
                { keys: 'Enter / Space (bookmark row)', cheatKey: 'cvBmEdit', fallback: 'Open the inline editor for the selected bookmark' },
                { keys: 'g / G (Bookmarks list)', cheatKey: 'cvBmFirstLast', fallback: 'Jump to the first / last bookmark row' },
                { keys: '/ (Bookmarks)', cheatKey: 'cvBmFilter', fallback: 'Focus the bookmark search field' },
                { keys: 'Ctrl/Cmd + Shift + K', cheatKey: 'cvSettingsJump', fallback: 'Find a setting, section, or help topic', print: true, printFallback: 'Find a setting' },
                { keys: '< / Shift + S', cheatKey: 'cvClose', fallback: 'Return to the dashboard from config', print: true, printKeys: 'Shift + S / <', printFallback: 'Return to dashboard' },
                { keys: 'Esc', cheatKey: 'cvEsc', fallback: 'Close bookmark editor, clear list selection, or exit config', print: true, printFallback: 'Close editor or exit config' },
            ],
        },
        {
            id: 'sectionSearchModes',
            titleKey: 'sectionSearchModes',
            titleFallback: 'Search modes',
            rows: [
                { keys: '>', cheatKey: 'smRegularSearch', fallback: 'Regular search — filter bookmarks on current page by name', print: true, printFallback: 'Search' },
                {
                    keys: '/',
                    cheatKey: 'smTagCloudSlash',
                    fallback: 'Open tag word cloud (desktop); arrow keys select tag or clear filter, Enter apply, Esc close; with interleave search on and modal closed, / can start fuzzy search',
                    when: (ctx) => ctx.tagCloudShortcutVisible,
                },
                { keys: '@', cheatKey: 'smGlobalSearch', fallback: 'Global search — fuzzy search across all pages at once; result shows page name as context' },
                { keys: ':', cheatKey: 'smCommandPalette', fallback: 'Command palette — 5 collapsible groups at lone : ; recent commands at top; toggles stay open after Enter', print: true, printFallback: 'Commands' },
                { keys: '?', cheatKey: 'smFinders', fallback: 'Finders — e.g. ?g query to search Google', print: true, printFallback: 'Finders' },
                { keys: '*', cheatKey: 'smRecentPanel', fallback: 'Recent bookmarks panel', print: true, printFallback: 'Recent bookmarks' },
                { keys: 'mode chips', cheatKey: 'smModeChips', fallback: 'Click › search · : commands · ? finders at the top of the overlay to switch mode instantly' },
                { keys: '← / → (chip row)', cheatKey: 'smEmptyStateChips', fallback: 'Empty overlay — with a recent-search or recent-command chip row highlighted, cycle chips and Enter applies' },
                { keys: 'category: / tag: / page: / status:', cheatKey: 'smFieldFilters', fallback: 'Filter results by field directly in the search bar' },
            ],
        },
        {
            id: 'sectionCommandsBookmarks',
            titleKey: 'sectionCommandsBookmarks',
            titleFallback: 'Commands — bookmarks',
            rows: [
                { keys: ':new / :add', cheatKey: 'cbNew', fallback: 'Open new-bookmark modal (+ / Shift+B / Ctrl+Shift+A) or quick-add omnibox (&)' },
                { keys: ':note', cheatKey: 'cbNote', fallback: 'Edit note on the focused bookmark' },
                { keys: ':move / :edit / :copy', cheatKey: 'cbMoveEditCopy', fallback: 'Move, inline-edit, or copy URL of the keyboard-selected bookmark' },
                { keys: ':pin / :unpin', cheatKey: 'cbPin', fallback: 'Toggle pin flag on the focused bookmark' },
                { keys: ':tag', cheatKey: 'cbTagList', fallback: 'List all tags in the command palette (dashboard layout unchanged)' },
                { keys: ':tag <name>', cheatKey: 'cbTagBrowse', fallback: 'Browse bookmarks by tag in the palette — :tag work or :tag:work' },
                { keys: ':tag +name / :tag -name', cheatKey: 'cbTagMutate', fallback: 'Add or remove a tag on the focused bookmark — :tag +name / :tag -name' },
                { keys: ':category / :cat', cheatKey: 'cbCategory', fallback: 'Jump to a category or smart collection by number or name' },
                { keys: ':filter <tag> / :filter clear', cheatKey: 'cbFilter', fallback: 'Apply or clear dashboard tag filter (OR logic, same as tag cloud)' },
                { keys: ':remove', cheatKey: 'cbRemove', fallback: 'Delete the focused bookmark' },
                { keys: ':find <text> / :find clear', cheatKey: 'cbFind', fallback: 'Filter bookmark tiles on the current page — :find clear removes the filter' },
                { keys: ':open all / :open pinned', cheatKey: 'cbOpenAll', fallback: 'Open every bookmark or pinned bookmarks on the current page (capped at 15)' },
                { keys: ':open tag <name> / :open category <name>', cheatKey: 'cbOpenTagCat', fallback: 'Open bookmarks matching a tag or category on the current page' },
                { keys: ':open last [n]', cheatKey: 'cbOpenLast', fallback: 'Open the N most recently opened bookmarks on this page (default 5, max 50; tab batch capped at 15; :open recent is an alias)' },
                { keys: ':goto <url or domain>', cheatKey: 'cbGoto', fallback: 'Navigate directly — full URLs open as-is, bare domains get https:// prepended' },
                { keys: ':goto config / stats / health', cheatKey: 'cbGotoNav', fallback: 'Quick navigation to config, stats, or health view' },
                { keys: ':duplicate / :duplicates', cheatKey: 'cbDuplicates', fallback: 'Find bookmarks with duplicate URLs across all pages (opens Health duplicates view)' },
                { keys: ':history / :history clear', cheatKey: 'cbHistory', fallback: 'Browse recent searches from the command bar / wipe all search history' },
                { keys: ':stale <days>', cheatKey: 'cbStale', fallback: 'Show bookmarks not opened in <days> days (default 30)' },
                { keys: ':health [filter]', cheatKey: 'caHealth', fallback: 'Open health view — broken / duplicate / stale / refresh' },
                { keys: ':health page [n]', cheatKey: 'cbHealthPage', fallback: 'Open health view with a specific page context' },
                { keys: ':save / :saved', cheatKey: 'cbSave', fallback: 'Save the current search query / show saved searches' },
            ],
        },
        {
            id: 'sectionCommandsNavigation',
            titleKey: 'sectionCommandsNavigation',
            titleFallback: 'Commands — navigation',
            rows: [
                { keys: ':page', cheatKey: 'cnPage', fallback: 'Switch page by name or number — palette stays open, ✓ on current page' },
                { keys: ':inbox', cheatKey: 'cnInbox', fallback: 'Open Inbox (Shift + I)', print: true },
                { keys: ':inbox triage', cheatKey: 'cnInboxTriage', fallback: 'Triage inbox items one by one' },
                { keys: ':recent', cheatKey: 'cnRecent', fallback: 'Open recent bookmarks modal (same as *)' },
                { keys: ':overview', cheatKey: 'cnOverview', fallback: 'Open page overview with bookmark counts (same as ,)' },
                { keys: ':cheat / :help', cheatKey: 'cnCheat', fallback: 'Open keyboard cheat sheet (same as ! or F1)', print: true, printFallback: 'Open cheat sheet' },
                { keys: ':whatsnew', cheatKey: 'cnWhatsnew', fallback: "Open what's new release notes" },
                { keys: ':reload', cheatKey: 'cnReload', fallback: 'Reload the dashboard' },
                { keys: ':config [section]', cheatKey: 'cnConfig', fallback: 'Open config or a tab — bookmarks, backups, stats, …', print: true, printKeys: ':config', printFallback: 'Open config' },
            ],
        },
        {
            id: 'sectionCommandsAppearance',
            titleKey: 'sectionCommandsAppearance',
            titleFallback: 'Commands — appearance',
            rows: [
                { keys: ':layout <preset>', cheatKey: 'caLayout', fallback: 'Switch layout — default / compact / cards / masonry / list / launcher' },
                { keys: ':layoutversion <mode>', cheatKey: 'caLayoutversion', fallback: 'Switch layout version — classic / modern / toggle (not the same as :layout presets)' },
                { keys: ':theme <name>', cheatKey: 'caTheme', fallback: 'Switch colour theme' },
                { keys: ':density <mode>', cheatKey: 'caDensity', fallback: 'Change density — comfortable / compact / dense' },
                { keys: ':columns <n>', cheatKey: 'caColumns', fallback: 'Set number of columns (1–6)' },
                { keys: ':fontsize <size>', cheatKey: 'caFontsize', fallback: 'Change font size' },
                { keys: ':favicons on/off', cheatKey: 'caFavicons', fallback: 'Toggle favicons on/off' },
                { keys: ':favicons fetch', cheatKey: 'caFaviconsFetch', fallback: 'Re-download every bookmark icon across all pages (replaces existing icons)' },
                { keys: ':preview on/off', cheatKey: 'caPreview', fallback: 'Toggle hover preview cards' },
                { keys: ':packed on/off', cheatKey: 'caPacked', fallback: 'Toggle packed (variable-width) columns' },
                { keys: ':buttonbar <position>', cheatKey: 'caButtonbar', fallback: 'Move the button bar — bottom (default) / bottom-left / bottom-right / side-left' },
                { keys: ':sort <method>', cheatKey: 'caSort', fallback: 'Sort focused category (shows category name) — order / az / recent' },
                { keys: ':dark / :title / :lang', cheatKey: 'caDisplayToggles', fallback: 'Toggle dark mode, dashboard title visibility, or UI language' },
                { keys: ':animations / :status / :opacity', cheatKey: 'caDisplayMore', fallback: 'Toggle animations, status monitor, or background opacity' },
                { keys: ':collections', cheatKey: 'caCollections', fallback: 'Toggle smart collections (today, recent, stale, most used)' },
            ],
        },
        {
            id: 'sectionCommandsTools',
            titleKey: 'sectionCommandsTools',
            titleFallback: 'Commands — tools',
            rows: [
                { keys: ':backup / :export', cheatKey: 'ctBackup', fallback: 'Open config backups or download a ZIP backup immediately' },
                { keys: ':metadata', cheatKey: 'ctMetadata', fallback: 'Open health missing previews or config bookmarks metadata view' },
                { keys: ':monitor off', cheatKey: 'ctMonitor', fallback: 'Turn availability checking off for every bookmark at once (asks for confirmation first)' },
                { keys: ':telemetry on / off', cheatKey: 'ctTelemetry', fallback: 'Turn privacy-friendly analytics on or off (same as Config → General → Advanced → Privacy; reloads the page)' },
            ],
        },
        {
            id: 'sectionOther',
            titleKey: 'sectionOther',
            titleFallback: 'Other',
            rows: [
                { keys: '! or F1', cheatKey: 'otCheatSheet', fallback: 'This cheat sheet', print: true, printKeys: '! / F1', printFallback: 'Keyboard cheat sheet', printSection: 'sectionNavigation', printAt: 6 },
                { keys: '★ (corner button)', cheatKey: 'otWhatsNew', fallback: "Open what's new release notes" },
                { keys: 'Ctrl + V (dashboard)', cheatKey: 'otPasteUrlDashboard', fallback: 'Paste URL anywhere on the dashboard to quick-add a bookmark' },
                { keys: 'config → Help → Keyboard', cheatKey: 'otConfigKeyboard', fallback: 'Open the keyboard cheat sheet — all shortcuts use fixed defaults' },
            ],
        },
    ];

    /**
     * Flatten the dashboard's feature flags once, so `when` guards stay pure
     * data-in/boolean-out and can be evaluated without a live dashboard.
     */
    function buildContext(dash) {
        const d = dash || {};
        return {
            dash: d,
            activeView: d.activeView || 'bookmarks',
            isSideRail: d.settings?.buttonBarPosition === 'side-left',
            inboxEnabled: Boolean(d.inbox?.isEnabled?.()),
            inboxInPageTabs: d.settings?.inboxShowInPageTabs !== false,
            healthEnabled: Boolean(d.health?.isEnabled?.()),
            configEnabled: Boolean(d.config?.isEnabled?.()),
            tagCloudShortcutVisible: Boolean(d.isTagCloudDesktopShortcutVisible?.()),
            triageOpen: Boolean(d.inbox?.triage?.isOpen?.()),
        };
    }

    /** Which section a cheat sheet opened from this view should lead with. */
    function activeContextId(ctx) {
        if (ctx.triageOpen) return 'inbox-triage';
        if (ctx.activeView === 'health') return 'health';
        if (ctx.activeView === 'inbox') return 'inbox';
        if (ctx.activeView === 'config') return 'config';
        return 'bookmarks';
    }

    function legendRowsFor(name) {
        const legends = global.KeyboardViewLegends;
        return (legends && legends[name]) || [];
    }

    /**
     * Build the visible sections for a dashboard.
     *
     * @param {object} dash live dashboard instance (or a mock in tests)
     * @param {(cheatKey: string, fallback: string) => string} labelFor
     * @returns {{ id: string, title: string, contextId?: string, items: {keys: string, description: string}[] }[]}
     */
    function buildSections(dash, labelFor) {
        const ctx = buildContext(dash);
        const label = typeof labelFor === 'function' ? labelFor : (_key, fallback) => fallback;
        const out = [];

        for (const section of SECTIONS) {
            if (typeof section.when === 'function' && !section.when(ctx)) {
                continue;
            }

            let items;
            if (section.legend) {
                const rows = legendRowsFor(section.legend);
                if (!rows.length) continue;
                items = rows.map((row) => ({
                    keys: row.keys,
                    description: label(row.cheatKey, row.fallback),
                }));
                for (const extra of section.extraRows || []) {
                    items.splice(extra.at, 0, {
                        keys: extra.keys,
                        description: label(extra.cheatKey, extra.fallback, { flatKey: extra.flatKey }),
                    });
                }
            } else {
                items = section.rows
                    .filter((row) => typeof row.when !== 'function' || row.when(ctx))
                    .map((row) => ({
                        keys: row.keys,
                        description: label(row.cheatKey, row.fallback),
                    }));
            }

            if (!items.length) continue;
            out.push({
                id: section.id,
                title: label(section.titleKey, section.titleFallback),
                contextId: section.contextId,
                items,
            });
        }

        return out;
    }

    /**
     * Rows marked for the printable one-pager, which stays a curated subset:
     * the PDF is A4 and meant to be readable at a glance, so it carries short
     * labels (printFallback) rather than the modal's full sentences.
     */
    function buildPrintSections(labelFor) {
        const label = typeof labelFor === 'function' ? labelFor : (_key, fallback) => fallback;
        const out = [];

        for (const section of SECTIONS) {
            let items = [];
            if (section.legend) {
                if (!section.print) continue;
                items = legendRowsFor(section.legend).map((row) => ({
                    keys: row.keys,
                    description: label(row.cheatKey, row.fallback),
                }));
            } else {
                items = (section.rows || [])
                    .filter((row) => row.print && !row.printSection)
                    .map((row) => ({
                        keys: row.printKeys || row.keys,
                        description: label(row.cheatKey, row.printFallback || row.fallback),
                    }));
            }
            if (!items.length) continue;
            out.push({ id: section.id, title: label(section.titleKey, section.titleFallback), items });
        }

        // A few rows print under a different heading than they live in — the cheat
        // sheet key belongs with Navigation on a one-pager even though the modal
        // files it under Other. `printAt` keeps it in its usual reading position
        // rather than stranding it at the end of the section.
        for (const section of SECTIONS) {
            for (const row of section.rows || []) {
                if (!row.print || !row.printSection) continue;
                const target = out.find((s) => s.id === row.printSection);
                if (!target) continue;
                const item = {
                    keys: row.printKeys || row.keys,
                    description: label(row.cheatKey, row.printFallback || row.fallback),
                };
                if (Number.isInteger(row.printAt)) {
                    target.items.splice(row.printAt, 0, item);
                } else {
                    target.items.push(item);
                }
            }
        }

        return out;
    }

    /**
     * Every locale key the registry can ask for, split by where it lives.
     * `cheatsheet` keys sit under dashboard.cheatsheet.*; `flat` keys are read
     * straight off dashboard.* because they are shared with the inline legends.
     */
    function collectLocaleKeys() {
        const cheatsheet = new Set();
        const flat = new Set();
        for (const section of SECTIONS) {
            cheatsheet.add(section.titleKey);
            for (const row of section.rows || []) cheatsheet.add(row.cheatKey);
            for (const extra of section.extraRows || []) {
                (extra.flatKey ? flat : cheatsheet).add(extra.cheatKey);
            }
        }
        return { cheatsheet: [...cheatsheet], flat: [...flat] };
    }

    global.KeyboardCheatSheetRegistry = {
        SECTIONS,
        buildContext,
        activeContextId,
        buildSections,
        buildPrintSections,
        collectLocaleKeys,
    };
}(typeof window !== 'undefined' ? window : globalThis));
