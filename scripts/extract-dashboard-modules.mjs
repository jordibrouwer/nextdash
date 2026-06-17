#!/usr/bin/env node
/**
 * Extract Dashboard methods into composable modules (Config-style).
 * Usage: node scripts/extract-dashboard-modules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(root, 'static/js/dashboard.js');
const outDir = path.join(root, 'static/js/dashboard');

const MODULES = {
    'dashboard-config-sync.js': {
        className: 'DashboardConfigSync',
        prop: 'configSync',
        comment: 'Config tab sync listeners and refresh after structure/settings changes.',
        methods: [
            'setupConfigStructureReloadListener', 'setupConfigReturnRefreshListener',
            'restoreDashboardInteractionAfterBfcache', 'readPendingConfigSync',
            'markPendingConfigSyncAsAppliedAfterLoad', 'reconcilePendingConfigSyncAfterLoad',
            'maybeRefreshAfterConfigReturn', 'showSyncToast',
            'refreshAfterConfigStructureUpdate', 'refreshAfterConfigSettingsUpdate',
        ],
    },
    'dashboard-page-nav.js': {
        className: 'DashboardPageNav',
        prop: 'pageNav',
        comment: 'Page tabs, navigation, rename, deep links.',
        methods: [
            'requestPageNavigation', 'updatePageTitle', 'updateDocumentTitle',
            'allowsPageTabInlineEdit', 'setActivePageNavButton', 'renderPageNavigation',
            '_renderPageTabContent', '_positionPageTabPopover', '_startPageTabRename',
            'consumeDashboardDeepLink', 'expandCategoryForDeepLink',
            'findBookmarkRowForDeepLink', 'focusDashboardDeepLinkTarget',
        ],
    },
    'dashboard-tag-filter.js': {
        className: 'DashboardTagFilter',
        prop: 'tagFilter',
        comment: 'Tag filter view, banner, bulk actions.',
        methods: [
            'normalizeTagFilters', 'tagFiltersKey', 'tagFiltersEqual', 'hasActiveTagFilters',
            'formatTagFilterTagsLabel', 'formatTagFilterTagsListForMessage', '_syncTagFilterDomAttributes',
            'setTagFilters', 'toggleTagFilter', 'removeTagFilter', 'clearTagFilter',
            'getBookmarksForTagFilters', 'getBookmarksForTagFilter', 'renderTagFilterDashboard',
            'setupTagFilterEscapeShortcut', 'setupTagFilterIndicator', 'formatTagFilterCountLabel',
            'getTagFilterMatchedBookmarksWithUrls', 'buildTagFilterOpenPlans', 'copyTagFilterLinksToClipboard',
            'getTagFilterBookmarkRefs', 'bulkDeleteTagFilterBookmarks', 'bulkMoveTagFilterToCategory',
            'bulkMoveTagFilterToPage', 'showTagFilterBulkMovePopover', '_appendTagFilterToolbarButton',
            'renderTagFilterBanner', 'updateTagFilterIndicator', '_distributeTagFilterColumnBlocks',
        ],
    },
    'dashboard-inline-edit.js': {
        className: 'DashboardInlineEdit',
        prop: 'inlineEdit',
        comment: 'Inline bookmark editor and related guards.',
        methods: [
            'isInlineEditActive', 'hasInlineEditUnsavedChanges', 'dismissInlineEditForNavigation',
            'confirmInlineEditBeforeNavigation', '_abortInlineEditForRender', 'confirmDiscardInlineEdit',
            'tryOpenInlineBookmarkEdit', 'openBookmarkInlineEditor', 'commitBookmarkInlineEdit',
            'cancelBookmarkInlineEdit', 'enterBookmarkInlineEditFocusMode', 'leaveBookmarkInlineEditFocusMode',
            'hasShortcutConflict', 'uploadBookmarkIconFromUrl', 'uploadBookmarkIconFile',
            'deriveFaviconFromBookmarkUrl', 'fetchAndAssignFaviconForUrl', 'ensureBookmarkMutationSnapshot',
            '_shouldSyncBookmarkMutation', '_applyBookmarkMutationFields', 'confirmDeleteBookmarkInline',
            'deleteBookmarkInline', 'deleteBookmarkAtIndexInline', 'deleteRemoteBookmarkInline',
            'saveRemoteBookmarkEdit', '_moveBookmarkToPage', 'attachBookmarkRowLongPress',
            'syncInlineEditCategoryAfterMove',
        ],
    },
    'dashboard-toolbar.js': {
        className: 'DashboardToolbar',
        prop: 'toolbar',
        comment: 'Toolbar actions, tooltips, header enhancements.',
        methods: [
            'setupToolbarActions', 'setupToolbarKbdTooltips', 'setupHeaderEnhancements',
            'syncTagCloudButtonPlacement', 'refreshAddBookmarkToolbarLabel', 'setupReorderUndoShortcut',
            'setupPasteToQuickAdd', 'openEmptyStateAdd', 'openEmptyStateCommand',
            'shouldShowEmptyStateKeyboardActions', 'buildEmptyStateAddLabel', 'buildEmptyStateAddHint',
            'updateMiniStatusLine', 'isTagCloudDesktopShortcutVisible', 'isTagCloudTipRelevant',
        ],
    },
    'dashboard-smart-collections.js': {
        className: 'DashboardSmartCollections',
        prop: 'smartCollections',
        comment: 'Smart collection evaluation and refresh.',
        methods: [
            'smartCollectionsNeedRefreshAfterOpen', '_sortSmartCollectionBookmarks',
            'refreshSmartCollectionSections', 'getSmartCollections', '_smartWhyT',
            '_getCurrentPageDisplayName', '_formatSmartWhyLimitSuffix', 'getSmartCollectionWhyHint',
            '_evaluateCollection', 'getSmartStartTodayBookmarks', 'getSmartStartKeywordBoosts',
            'parseSmartKeywordList', 'isCurrentPageBookmark', 'getSmartCollectionSourceBookmarks',
            'getStaleBookmarksList', 'scrollToStaleCollection', '_isSmartCollectionPageAllowed',
            'refreshSmartCollectionsAfterOpen',
        ],
    },
    'dashboard-bookmark-rows.js': {
        className: 'DashboardBookmarkRows',
        prop: 'bookmarkRows',
        comment: 'Bookmark row DOM, moves, popovers, metadata sync.',
        methods: [
            'applyBookmarkCategoryMove', 'updateBookmarkRowsCategoryInDom', 'collectBookmarkCategoryIds',
            'formatMovePopoverCurrentCategoriesHint', 'canonicalBookmarkURLKey', 'resolveBookmarkPageId',
            'bookmarkMatchesCanonicalUrl', 'resolveBookmarkIndex', 'resolveBookmarkIndexOnPage',
            'populateBookmarkRowView', 'restoreBookmarkRowStatus', 'resolveBookmarkReference',
            'isSameBookmarkReference', 'syncEditedBookmarkAcrossCollections', 'removeBookmarkFromAllBookmarks',
            'restoreBookmarkInAllBookmarks', 'findBookmarkIndexByReference', 'createBookmarkElement',
            'createRecentBookmarkElement', 'syncBookmarkMetadataAcrossViews', 'syncAllBookmarksMetadata',
            'syncBookmarkGridA11y', 'bookmarkCellId', '_hashForA11yId', 'getBookmarkGridElement',
            'showMovePopover', 'showDeletePopover', '_quickMoveToCategory',
            '_closeMovePopover', '_closeDeletePopover', '_closeActionPopovers',
            '_positionActionPopoverBeside', '_attachActionPopoverPositioning',
            '_focusActionPopoverItem', '_restoreActionPopoverFocus',
        ],
    },
    'dashboard-render-core.js': {
        className: 'DashboardRenderCore',
        prop: 'renderCore',
        comment: 'Dashboard grid render, categories, reorder.',
        methods: [
            'shouldStackDashboardCategories', 'getEffectiveColumnsPerRow', 'shouldPackDashboardColumns',
            'getNormalizedColumnsPerRow', 'syncDashboardGridLayout', '_distributeDashboardColumnBlocks',
            '_copyDashboardGridLayoutToElement', 'renderDashboard', 'groupBookmarksByCategory',
            'sortBookmarks', 'initializeCategoryReorder', 'ensureBookmarkDragOverRelay',
            'initializeDashboardCategoryReorder', 'ensureCategoryDragOverRelay',
            'destroyCategoryReorderInstances', 'destroyDashboardCategoryReorderInstances',
            '_getCategoryLists', 'syncBookmarksFromDom', 'syncCategoriesFromDom',
            'scheduleCategoryOrderSave', 'saveCategoryOrder', '_startCategoryRename',
            'scheduleBookmarkOrderSave', 'flushPendingBookmarkSave', 'flushPendingCategorySave',
            'undoPendingReorder', 'createCategoryElement', 'isUploadedCategoryIcon',
        ],
    },
};

const DASH_PROPS = [
    'bookmarks', 'allBookmarks', 'finders', 'categories', 'collapsedCategories', 'pages',
    'currentPageId', 'settings', 'language', 'searchComponent', 'keyboardNavigation', 'swipeNavigation',
    '_pageBookmarksLoadId', '_bookmarksReady', '_pendingRecentModalRefresh', '_deferredAllBookmarksLoadInFlight',
    'inlineEditingBookmarkIndex', '_tagFilters', '_inlineEditContext', '_categoryListsCache',
    'structureSyncEventKey', 'settingsSyncEventKey', 'pendingStructureSyncKey', 'pendingSettingsSyncKey',
    'tabId', 'lastSyncToastAt', 'lastAppliedStructureSyncAt', 'lastAppliedSettingsSyncAt',
    '_configRefreshReady', '_configReturnRefreshInFlight', 'statusMonitor', 'categoryReorderInstances',
    'dashboardCategoryReorderInstances', '_categoryDragRelayHandler', '_categoryDropHandler',
    '_pendingCategoryOrderFromDrop', '_pendingCategorySave', '_categoryOrderSaveInFlight',
    'pendingReorderSave', 'pendingReorderSnapshot', '_bookmarkOrderSaveInFlight', 'pendingPreviewSave',
    '_movePopoverCleanup', '_deletePopoverCleanup', 'analytics', 'quickAddWidget', 'weatherService',
    'weatherData', 'weatherLastError', 'onboardingStartedInSession', '_renderAnimationsEnabled',
    '_recentModalKeyHandler', '_pageNavKeyHandler',
];

function parseMethods(lines) {
    const methods = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^    (async )?([a-zA-Z_][\w$]*)\(/);
        if (!m || m[2] === 'constructor') continue;
        methods.push({ line: i, name: m[2], async: !!m[1] });
    }
    const map = new Map();
    for (let i = 0; i < methods.length; i++) {
        const start = methods[i].line;
        const end = (i + 1 < methods.length ? methods[i + 1].line : lines.length) - 1;
        map.set(methods[i].name, { start, end, async: methods[i].async });
    }
    return map;
}

function extractChunk(lines, start, end) {
    return lines.slice(start, end + 1).join('\n');
}

function transformChunk(chunk, methodNames) {
    let body = chunk.replace(/\bthis\.dash\b/g, '__DASH__');
    const placeholders = [];
    for (const name of methodNames) {
        body = body.replace(new RegExp(`\\bthis\\.${name}\\b`, 'g'), () => {
            const token = `__SELF_${placeholders.length}__`;
            placeholders.push({ token, name });
            return token;
        });
    }
    body = body.replace(/^    (async )?([a-zA-Z_][\w$]*)\([^)]*\) \{/, (m) => `${m}\n        const d = __DASH__;`);
    for (const p of DASH_PROPS) {
        body = body.replace(new RegExp(`\\bthis\\.${p}\\b`, 'g'), `d.${p}`);
    }
    body = body.replace(/\bthis\.([a-zA-Z_][\w$]*)\b/g, 'd.$1');
    for (const { token, name } of placeholders) {
        body = body.replaceAll(token, `this.${name}`);
    }
    body = body.replaceAll('__DASH__', 'this.dash');
    return body;
}

function matchParamsFromChunk(chunk) {
    const m = chunk.match(/^    (?:async )?[a-zA-Z_][\w$]*\(([^)]*)\)/);
    return m ? m[1] : '';
}

function forwardArgs(sig) {
    if (!sig.trim()) return '';
    return sig.split(',').map((p) => p.trim().split('=')[0].trim()).filter(Boolean).join(', ');
}

const originalLines = fs.readFileSync(srcPath, 'utf8').split('\n');
const methodMap = parseMethods(originalLines);

for (const mod of Object.values(MODULES)) {
    for (const m of mod.methods) {
        if (!methodMap.has(m)) {
            console.error(`Missing method: ${m}`);
            process.exit(1);
        }
    }
}

fs.mkdirSync(outDir, { recursive: true });

for (const [fileName, mod] of Object.entries(MODULES)) {
    const chunks = mod.methods.map((name) => {
        const { start, end } = methodMap.get(name);
        return transformChunk(extractChunk(originalLines, start, end), mod.methods);
    });
    const content = `/**
 * ${mod.comment}
 */
class ${mod.className} {
    constructor(dashboard) {
        this.dash = dashboard;
    }

${chunks.join('\n\n')}
}
`;
    fs.writeFileSync(path.join(outDir, fileName), content);
    console.log(`Wrote ${fileName} (${mod.methods.length} methods)`);
}

const toRemove = new Set();
for (const mod of Object.values(MODULES)) {
    for (const m of mod.methods) toRemove.add(m);
}

let lines = [...originalLines];
const removeRanges = [...toRemove]
    .map((m) => methodMap.get(m))
    .map(({ start, end }) => [start, end])
    .sort((a, b) => b[0] - a[0]);

for (const [start, end] of removeRanges) {
    lines.splice(start, end - start + 1);
}

const delegations = [];
for (const mod of Object.values(MODULES)) {
    for (const name of mod.methods) {
        const { start, end, async: isAsync } = methodMap.get(name);
        const chunk = extractChunk(originalLines, start, end);
        const params = matchParamsFromChunk(chunk);
        const args = forwardArgs(params);
        delegations.push(
            isAsync
                ? `    async ${name}(${params}) {\n        return this.${mod.prop}.${name}(${args});\n    }`
                : `    ${name}(${params}) {\n        return this.${mod.prop}.${name}(${args});\n    }`
        );
    }
}

const insertIdx = lines.findIndex((l) => l === '    setupExtensionBookmarkSavedListener() {');
if (insertIdx < 0) throw new Error('insert point not found');
lines.splice(insertIdx, 0, delegations.join('\n\n'));

const dataLine = lines.findIndex((l) => l.includes('this.data = new DashboardData'));
const inits = Object.values(MODULES).map(
    (mod) => `        this.${mod.prop} = new ${mod.className}(this);`
);
lines.splice(dataLine + 1, 0, ...inits);

fs.writeFileSync(srcPath, lines.join('\n'));
console.log('dashboard.js lines:', lines.length);
