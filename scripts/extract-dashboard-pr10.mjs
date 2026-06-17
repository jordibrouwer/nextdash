#!/usr/bin/env node
/**
 * Extract PR10 dashboard modules from dashboard.js (orchestrator cleanup).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(root, 'static/js/dashboard.js');
const outDir = path.join(root, 'static/js/dashboard');

const MODULES = {
    'dashboard-notifications.js': {
        className: 'DashboardNotifications',
        prop: 'notifications',
        comment: 'Toast notifications and i18n notify helpers.',
        methods: [
            'showNotification', 'showGroupedNotification', 'showErrorNotification',
            'tDashboard', 'tConfig', 'notifyDashboard', 'notifyConfig',
        ],
    },
    'dashboard-visual.js': {
        className: 'DashboardVisual',
        prop: 'visual',
        comment: 'Theme, layout chrome, visibility toggles.',
        methods: [
            'applyVisualSettings', 'applyBackground', 'initializeAutoDarkMode', 'getPairedThemeVariant',
            'applyFontSize', 'applyBackgroundDots', 'applyAnimations', 'updateTitleVisibility',
            'updateConfigButtonVisibility', 'updateHealthDashboardVisibility', 'updateHealthBadge',
            'updatePageTabsVisibility', 'updateDateVisibility', 'shouldRenderDateBlock',
        ],
    },
    'dashboard-date-weather.js': {
        className: 'DashboardDateWeather',
        prop: 'dateWeather',
        comment: 'Date/time line and weather widget.',
        methods: [
            'clearDateTimeRefreshTimer', 'scheduleDateTimeRefresh', 'clearWeatherRefreshTimer',
            'scheduleWeatherRefresh', 'formatDateLine', 'formatTimeLine', 'renderDateWeatherLine',
            'showDatePopover', 'formatWeatherText', 'getWeatherIconMarkup', 'getWeatherConditionLabel',
            'refreshWeather',
        ],
    },
    'dashboard-preview.js': {
        className: 'DashboardPreview',
        prop: 'preview',
        comment: 'Bookmark link preview cards.',
        methods: [
            'attachBookmarkPreviewBehavior', 'scheduleHideBookmarkPreviewCard', 'fetchBookmarkPreviewData',
            'persistBookmarkPreviewMetadata', 'refreshVisibleBookmarkPreview', 'extractDomainFromUrl',
            'formatPreviewLastOpened', 'formatPreviewUsageText', 'ensureBookmarkPreviewCard',
            'showBookmarkPreviewCard', 'positionBookmarkPreviewCard', 'hideBookmarkPreviewCard',
            'dismissBookmarkPreviewInteractions',
        ],
    },
    'dashboard-recent.js': {
        className: 'DashboardRecent',
        prop: 'recent',
        comment: 'Recent bookmarks modal and open-tabs helpers.',
        methods: [
            'getRecentBookmarksWithUrls', 'sameBookmarkList', 'buildOpenTabsPlans', 'openBookmarksInNewTabs',
            'safeHttpBookmarkHref', 'isRecentBookmarksModalOpen', 'toggleRecentBookmarksModal',
            '_fillRecentBookmarksModal', '_setupRecentModalKeyboardNav', '_cleanupRecentModalKeyHandler',
            'getRecentBookmarks', 'buildBookmarkTooltip', 'recordBookmarkOpened',
        ],
    },
    'dashboard-promos.js': {
        className: 'DashboardPromos',
        prop: 'promos',
        comment: 'Onboarding, feature tours, post-onboarding prompts.',
        methods: [
            'canShowPostOnboardingPrompts', 'shouldShowWhatsNewPrompt', 'shouldShowLayoutNudgePrompt',
            'shouldShowPasteSpotlightPrompt', 'schedulePostOnboardingPrompts', 'runPostOnboardingPrompts',
            'shouldShowPreviewCardSpotlightPrompt', 'maybeShowPreviewCardSpotlight', 'maybeShowPasteSpotlight',
            'maybeShowLayoutModernNudge', 'maybeShowWhatsNew', 'showWhatsNewModal',
            'initializeOnboarding', 'initializeFeatureTour', 'initializeConfigBookmarksTour', 'startFeatureTour',
        ],
    },
    'dashboard-ui-helpers.js': {
        className: 'DashboardUiHelpers',
        prop: 'uiHelpers',
        comment: 'Labels, modals, modal-open guards.',
        methods: [
            'formatDashboardLabel', 'configLabel', 'bookmarkFallbackName', 'escapeHtml', 'setTipHtml',
            'sanitizeTipHtml', 'isVisibleBlockingOverlay', 'isModalOpen', 'getKeyboardCheatSheetItems',
            'showKeyboardCheatSheet', 'showPageOverlay', 'showOmnibox',
        ],
    },
    'dashboard-setup.js': {
        className: 'DashboardSetup',
        prop: 'setup',
        comment: 'DOM setup, search/status/nav wiring, tips, tracking.',
        methods: [
            'setupDOM', 'getHeaderContainer', 'initializeSearchComponent', 'updateSearchComponent',
            'applyFindFilter', 'initializeStatusMonitor', 'initializeKeyboardNavigation',
            'initializeSwipeNavigation', '_updatePageSwipeHint', 'initializeHyprMode', 'updateStatusMonitor',
            'setupPageShortcuts', 'setupExtensionBookmarkSavedListener', 'initializeButtonTipsRotation',
            'scheduleBackupTip', 'initializeSearchFlowHint', 'getInlineTipUsageState', 'getCurrentPageTipUsage',
            'markInlineTipUsed', 'getInlineContextTipsForCurrentPage', 'setupBookmarkTracking', 'buildSearchIndex',
        ],
    },
    'dashboard-persistence.js': {
        className: 'DashboardPersistence',
        prop: 'persistence',
        comment: 'Pending bookmark/category saves and order flush.',
        methods: [
            'flushPendingDashboardSaves', 'flushPendingPreviewSave', 'flushPendingDashboardSavesOnExit',
            'saveBookmarkPreviewMetadataNow', 'saveBookmarkOrder',
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
    '_recentModalKeyHandler', '_pageNavKeyHandler', 'notificationTimeout', 'tipRotationTimer',
    'backupTipTimer', 'backupTipShown', 'tipRotationIndex', 'tipPriorityIndex', 'contextTipRotationIndex',
    'inlineTipUsageStorageKey', '_postOnboardingPromptsTimer', '_postOnboardingPromptsAttempts',
    '_postOnboardingWhatsNewAbortAttempts', 'dateTimeRefreshTimer', 'weatherRefreshTimer',
    '_findFilter', '_previewCardState', '_previewHideTimer', '_previewFetchController',
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

function isDelegationChunk(chunk) {
    const lines = chunk.trim().split('\n').filter(Boolean);
    if (lines.length > 4) return false;
    return /return this\.\w+\.\w+\(\.\.\.arguments\)/.test(chunk);
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

const originalLines = fs.readFileSync(srcPath, 'utf8').split('\n');
const methodMap = parseMethods(originalLines);

for (const mod of Object.values(MODULES)) {
    for (const m of mod.methods) {
        if (!methodMap.has(m)) {
            console.error('Missing:', m);
            process.exit(1);
        }
        const chunk = extractChunk(originalLines, methodMap.get(m).start, methodMap.get(m).end);
        if (isDelegationChunk(chunk)) {
            console.error('Already delegated, skip:', m);
            process.exit(1);
        }
    }
}

for (const [fileName, mod] of Object.entries(MODULES)) {
    const chunks = mod.methods.map((name) => {
        const { start, end } = methodMap.get(name);
        return transformChunk(extractChunk(originalLines, start, end), mod.methods);
    });
    fs.writeFileSync(path.join(outDir, fileName), `/**
 * ${mod.comment}
 */
class ${mod.className} {
    constructor(dashboard) {
        this.dash = dashboard;
    }

${chunks.join('\n\n')}
}
`);
    console.log('Wrote', fileName, mod.methods.length);
}

const toRemove = new Set(Object.values(MODULES).flatMap((m) => m.methods));
let lines = [...originalLines];
const removeRanges = [...toRemove].map((m) => methodMap.get(m)).sort((a, b) => b.start - a.start);
for (const { start, end } of removeRanges) {
    lines.splice(start, end - start + 1);
}

const delegations = [];
for (const mod of Object.values(MODULES)) {
    for (const name of mod.methods) {
        const { start, end, async: isAsync } = methodMap.get(name);
        const params = matchParamsFromChunk(extractChunk(originalLines, start, end));
        delegations.push(
            isAsync
                ? `    async ${name}(${params}) {\n        return this.${mod.prop}.${name}(...arguments);\n    }`
                : `    ${name}(${params}) {\n        return this.${mod.prop}.${name}(...arguments);\n    }`
        );
    }
}

const insertIdx = lines.findIndex((l) => l === '    safeBookmarkOpenHref(url) {');
if (insertIdx < 0) {
    console.error('Could not find safeBookmarkOpenHref delegation anchor');
    process.exit(1);
}
lines.splice(insertIdx, 0, delegations.join('\n\n'));

const ctorProps = Object.values(MODULES).map((mod) => `        this.${mod.prop} = new ${mod.className}(this);`);
const lastInit = lines.findIndex((l) => l.includes('this.renderCore = new DashboardRenderCore'));
lines.splice(lastInit + 1, 0, ...ctorProps);

fs.writeFileSync(srcPath, lines.join('\n'));
console.log('dashboard.js lines:', lines.length);
