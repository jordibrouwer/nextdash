/**
 * Shared catalog for dashboard footer tips (rotation + Help overview).
 */
(function () {
    'use strict';

    const PRIORITY_ENTRIES = [
        ['tipRecentStarShort', 'Tip: <code>*</code> recent'],
        ['tipOpenLastRecent', 'Tip: <code>*</code> shows recent bookmarks — <code>:open last 5</code> in command mode opens them in tabs'],
        ['tipCheatsheetBang', 'Tip: <code>!</code> cheatsheet'],
        ['tipNavigateArrows', 'Tip: <code>↑/↓</code> navigate bookmarks'],
        ['tipEditSemicolon', 'Tip: <code>;</code> edit bookmark (highlighted row or focused link)'],
        ['tipQuickDelete', 'Tip: <code>Shift+D</code> quick-delete — confirm in the popover; undo in the toast'],
        ['tipQuickMove', 'Tip: <code>Shift+M</code> quick-move — choose category or page in the popover'],
        ['tipQuickTag', 'Tip: <code>Shift+T</code> quick-tag — toggle tags on the selected bookmark; ✓ shows tags already applied'],
        ['tipCheatsheetCtrlSlash', 'Tip: <code>F1</code> cheatsheet'],
        ['tipPreviewBracket', 'Tip: <code>[</code> preview card on keyboard-selected bookmark'],
        ['tipCopyUrlCtrlC', 'Tip: <code>Ctrl+C</code> copy URL of keyboard-selected bookmark'],
        ['tipDragStripInlineEdit', 'Tip: left strip = drag reorder; long-press row (not strip) = inline edit'],
        ['tipNewBookmarkAmpersand', 'Tip: <code>+</code> opens the full new-bookmark modal — or paste a URL anywhere on the dashboard'],
    ];

    const NORMAL_ENTRIES = [
        ['tipSearchCommandFinder', 'Tip: <code>&gt;</code> search, <code>:</code> commands, <code>?</code> finders'],
        ['tipOpenSearch', 'Tip: <code>&gt;</code> open search'],
        ['tipOpenFinders', 'Tip: <code>?</code> open finders'],
        ['tipOpenCommands', 'Tip: <code>:</code> open commands'],
        ['tipJumpToPage', 'Tip: <code>1-9</code> jump to page'],
        ['tipPageOverview', 'Tip: <code>,</code> page overview — see all pages with bookmark counts'],
        ['tipQuickAddAmpersand', 'Tip: <code>&amp;</code> quick-add — name | url | shortcut in one field'],
        ['tipSwitchPage', 'Tip: <code>Shift+←/→</code> switch page'],
        ['tipEnterOpenBookmark', 'Tip: <code>Enter</code> open selected bookmark'],
        ['tipSpaceOpenBookmark', 'Tip: <code>Space</code> open selected bookmark'],
        ['tipInlineEditSemicolon', 'Tip: <code>;</code> inline-edit selected bookmark'],
        ['tipHoverPreview', 'Tip: hover bookmark (name/icon area) to load preview when enabled'],
        ['tipEnableLinkPreview', 'Tip: enable link preview cards in config → general → advanced → bookmarks'],
        ['tipEscCancel', 'Tip: <code>Esc</code> cancel current state'],
        ['tipAltReorderConfig', 'Tip: <code>Alt+↑/↓</code> reorder in config'],
        ['tipSearchCategory', 'Tip: use <code>category:work</code> in search'],
        ['tipSearchTag', 'Tip: use <code>tag:work</code> in search to filter by tag'],
        ['tipSearchStatus', 'Tip: use <code>status:online</code> in search'],
        ['tipSearchPage', 'Tip: use <code>page:2</code> in search'],
        ['tipFinderShortcut', 'Tip: use <code>?g term</code> finder shortcut'],
        ['tipAddTagsConfig', 'Tip: add tags to bookmarks in <code>config</code> → bookmarks'],
        ['tipDynamicCollections', 'Tip: create dynamic collections in <code>config</code> → collections'],
        ['tipTagCollections', 'Tip: enable tag collections in <code>config</code> → general → Smart Collections'],
        ['tipBackupsConfig', 'Tip: backups under <code>config</code> → backups'],
        ['tipCollapseCategory', 'Tip: click a category header to collapse or expand it'],
        ['tipGlobalShortcuts', 'Tip: global shortcuts from all pages in <code>config</code> → general → Dashboard'],
        ['tipLayoutPreset', 'Tip: layout preset & density in <code>config</code> → general → Basics'],
        ['tipLongPressInlineEdit', 'Tip: long-press a bookmark row (not the drag strip) to edit inline'],
        ['tipLongPressCategoryRename', 'Tip: long-press a category header (not sort buttons) to rename it'],
        ['tipRenamePageTab', 'Tip: double-click a page tab to rename the page'],
        ['tipHealthPage', 'Tip: visit <code>health</code> page to find broken links and duplicates'],
        ['tipHealthFilters', 'Tip: use filters in <code>health</code> page to focus on specific issues'],
        ['tipHealthRefresh', 'Tip: <code>refresh</code> in health page re-scans all bookmarks'],
        ['tipHealthStale', 'Tip: check health page <code>stale</code> bookmarks you haven\'t used recently'],
        ['tipHealthMerge', 'Tip: merge duplicate bookmarks in health page bulk actions'],
        ['tipCommandNote', 'Tip: use <code>:note</code> in the command palette to edit a bookmark\'s note instantly'],
        ['tipPreviewCopyUrl', 'Tip: hover a preview card and click the clipboard icon to copy the URL'],
        ['tipCompactBadge', 'Tip: compact/dense mode shows an open-count badge on each bookmark'],
        ['tipConfigSearchBar', 'Tip: use the search bar in config → bookmarks to filter by name, URL, tag, or note'],
        ['tipThemeToggle', 'Tip: the dark/light toggle button in the header flips the theme variant instantly'],
        ['tipHealthFavicon', 'Tip: use <code>favicon</code> button in health view to refresh a bookmark\'s icon'],
        ['tipNewBookmarkTags', 'Tip: add tags when creating a bookmark via <code>:new</code> — autocomplete suggests existing tags'],
        ['tipTagCloudSlash', 'Tip: press <code>/</code> for the tag word cloud (desktop) — pick a tag to filter bookmarks on the dashboard'],
        ['tipUndoDelete', 'Tip: delete a bookmark and click <code>Undo</code> in the toast to undo within 5s'],
        ['tipFaviconToggle', 'Tip: use <code>:favicons on</code> or <code>:favicons off</code> to toggle favicons live'],
        ['tipPackedColumns', 'Tip: tight columns off in <code>config</code> → general'],
        ['tipHideShortcutPin', 'Tip: hide shortcut pins in config → general → bookmarks'],
        ['tipKeyboardTab', 'Tip: <code>Tab</code> moves focus between bookmark rows'],
        ['tipDisableTips', 'Tip: turn off rotating tips in config → general → Dashboard'],
        ['tipDisableTipsAlt', 'Tip: <code>:tips off</code> hides footer tips instantly'],
        ['tipNewBookmarkAmpersandShort', 'Tip: <code>+</code> full new-bookmark modal — page, category, preview, and more options'],
    ];

    function resolveTip(language, key, fallback) {
        const fullKey = `dashboard.${key}`;
        const translated = language?.t?.(fullKey);
        if (translated && translated !== fullKey) {
            return translated;
        }
        return fallback || null;
    }

    function resolveEntries(language, entries) {
        return entries
            .map(([key, fallback]) => resolveTip(language, key, fallback))
            .filter(Boolean);
    }

    function buildLists({ language, includeTagCloud = true } = {}) {
        const priorityTips = resolveEntries(language, PRIORITY_ENTRIES);
        const normalEntries = NORMAL_ENTRIES.filter(([key]) => {
            if (key === 'tipTagCloudSlash') {
                return includeTagCloud;
            }
            return true;
        });
        const normalTips = resolveEntries(language, normalEntries);
        return { priorityTips, normalTips };
    }

    window.DashboardTipsCatalog = {
        buildLists,
    };
}());
