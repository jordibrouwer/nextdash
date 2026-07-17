/**
 * Apply missing/default fields after settings are merged from server + device storage.
 */
class ConfigSettingsDefaults {
    static apply(settingsData) {
        if (!settingsData || typeof settingsData !== 'object') {
            return;
        }
        if (!settingsData.language || settingsData.language === '') {
            settingsData.language = 'en';
        }
        if (typeof settingsData.interleaveMode === 'undefined') {
            settingsData.interleaveMode = false;
        }
        if (typeof settingsData.showPageTabs === 'undefined') {
            settingsData.showPageTabs = true;
        }
        if (typeof settingsData.showSmartRecentCollection === 'undefined') {
            settingsData.showSmartRecentCollection = false;
        }
        if (typeof settingsData.showSmartTodayCollection === 'undefined') {
            settingsData.showSmartTodayCollection = true;
        }
        if (typeof settingsData.showSmartStaleCollection === 'undefined') {
            settingsData.showSmartStaleCollection = false;
        }
        if (typeof settingsData.showRecentButton === 'undefined') {
            settingsData.showRecentButton = true;
        }
        if (typeof settingsData.showCheatSheetButton === 'undefined') {
            settingsData.showCheatSheetButton = true;
        }
        if (typeof settingsData.showHealthDashboard === 'undefined') {
            settingsData.showHealthDashboard = true;
        }
        if (typeof settingsData.showSearchFlowBanner === 'undefined') {
            settingsData.showSearchFlowBanner = true;
        }
        if (typeof settingsData.showStatus === 'undefined') {
            settingsData.showStatus = true;
        }
        if (typeof settingsData.colorizeStatus === 'undefined') {
            settingsData.colorizeStatus = true;
        }
        if (typeof settingsData.showPing === 'undefined') {
            settingsData.showPing = true;
        }
        if (typeof settingsData.showStatusLoading === 'undefined') {
            settingsData.showStatusLoading = false;
        }
        if (typeof settingsData.showLinkPreviewCards === 'undefined') {
            settingsData.showLinkPreviewCards = false;
        }
        if (![100, 150, 250].includes(Number(settingsData.linkPreviewHoverDelayMs))) {
            settingsData.linkPreviewHoverDelayMs = 150;
        }
        if (typeof window.normalizeStatusOfflineRetries === 'function') {
            settingsData.statusOfflineRetries = window.normalizeStatusOfflineRetries(settingsData.statusOfflineRetries);
        } else {
            settingsData.statusOfflineRetries = 3;
        }
        if (typeof window.normalizeStatusOfflineRetryDelayMs === 'function') {
            settingsData.statusOfflineRetryDelayMs = window.normalizeStatusOfflineRetryDelayMs(settingsData.statusOfflineRetryDelayMs);
        } else {
            settingsData.statusOfflineRetryDelayMs = 450;
        }
        if (typeof window.normalizeStatusRecheckIntervalMinutes === 'function') {
            settingsData.statusRecheckIntervalMinutes = window.normalizeStatusRecheckIntervalMinutes(settingsData.statusRecheckIntervalMinutes);
        } else {
            settingsData.statusRecheckIntervalMinutes = 5;
        }
        if (typeof settingsData.showSyncToasts === 'undefined') {
            settingsData.showSyncToasts = false;
        }
        if (typeof settingsData.onboardingCompleted === 'undefined') {
            settingsData.onboardingCompleted = true;
        }
        if (typeof settingsData.configGeneralTourCompleted === 'undefined') {
            settingsData.configGeneralTourCompleted = false;
        }
        if (typeof settingsData.configBookmarksTourCompleted === 'undefined') {
            settingsData.configBookmarksTourCompleted = false;
        }
        if (typeof settingsData.configFindersTourCompleted === 'undefined') {
            settingsData.configFindersTourCompleted = false;
        }
        if (typeof settingsData.configStatsTourCompleted === 'undefined') {
            settingsData.configStatsTourCompleted = false;
        }
        if (typeof settingsData.configCategoriesTourCompleted === 'undefined') {
            settingsData.configCategoriesTourCompleted = false;
        }
        if (typeof settingsData.configTagsTourCompleted === 'undefined') {
            settingsData.configTagsTourCompleted = false;
        }
        if (typeof settingsData.configPagesTourCompleted === 'undefined') {
            settingsData.configPagesTourCompleted = false;
        }
        if (typeof settingsData.configCollectionsTourCompleted === 'undefined') {
            settingsData.configCollectionsTourCompleted = false;
        }
        if (typeof settingsData.configThemeTourCompleted === 'undefined') {
            settingsData.configThemeTourCompleted = false;
        }
        if (typeof settingsData.packedColumns === 'undefined') {
            settingsData.packedColumns = true;
        }
        if (typeof settingsData.pasteUrlQuickAdd === 'undefined') {
            settingsData.pasteUrlQuickAdd = true;
        }
        if (typeof settingsData.inboxEnabled === 'undefined') {
            settingsData.inboxEnabled = true;
        }
        if (settingsData.inboxEnabled !== false) {
            settingsData.pasteUrlQuickAdd = true;
        }
        if (settingsData.inboxEnabled === false && String(settingsData.pasteDestination || '').toLowerCase() === 'inbox') {
            settingsData.pasteDestination = 'ask';
        }
        if (!settingsData.pasteDestination) {
            settingsData.pasteDestination = 'ask';
        }
        if (!settingsData.dateFormat) {
            settingsData.dateFormat = 'short-slash';
        }
        if (typeof settingsData.showTime === 'undefined') {
            settingsData.showTime = true;
        }
        if (!['24h', '12h'].includes(String(settingsData.timeFormat || ''))) {
            settingsData.timeFormat = '24h';
        }
        if (typeof settingsData.showWeatherWithDate === 'undefined') {
            settingsData.showWeatherWithDate = false;
        }
        if (!settingsData.weatherSource) {
            settingsData.weatherSource = 'manual';
        }
        if (!settingsData.weatherUnit) {
            settingsData.weatherUnit = 'celsius';
        }
        if (!Number.isFinite(Number(settingsData.weatherRefreshMinutes)) || Number(settingsData.weatherRefreshMinutes) <= 0) {
            settingsData.weatherRefreshMinutes = 30;
        } else {
            settingsData.weatherRefreshMinutes = Number(settingsData.weatherRefreshMinutes);
        }
        if (!Number.isFinite(Number(settingsData.smartRecentLimit)) || Number(settingsData.smartRecentLimit) < 0) {
            settingsData.smartRecentLimit = 50;
        } else {
            settingsData.smartRecentLimit = Number(settingsData.smartRecentLimit);
        }
        if (!Number.isFinite(Number(settingsData.smartTodayLimit)) || Number(settingsData.smartTodayLimit) < 0) {
            settingsData.smartTodayLimit = 8;
        } else {
            settingsData.smartTodayLimit = Number(settingsData.smartTodayLimit);
        }
        if (!Number.isFinite(Number(settingsData.smartStaleLimit)) || Number(settingsData.smartStaleLimit) < 0) {
            settingsData.smartStaleLimit = 50;
        } else {
            settingsData.smartStaleLimit = Number(settingsData.smartStaleLimit);
        }
        if (typeof settingsData.smartTodayWorkKeywords !== 'string' || settingsData.smartTodayWorkKeywords.trim() === '') {
            settingsData.smartTodayWorkKeywords = 'calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams';
        }
        if (typeof settingsData.smartTodayEveningKeywords !== 'string' || settingsData.smartTodayEveningKeywords.trim() === '') {
            settingsData.smartTodayEveningKeywords = 'youtube,spotify,netflix,reddit';
        }
        if (typeof settingsData.smartTodayWeekendKeywords !== 'string' || settingsData.smartTodayWeekendKeywords.trim() === '') {
            settingsData.smartTodayWeekendKeywords = 'news,weather,maps';
        }
        if (!Array.isArray(settingsData.smartRecentPageIds)) {
            settingsData.smartRecentPageIds = [];
        }
        if (!Array.isArray(settingsData.smartTodayPageIds)) {
            settingsData.smartTodayPageIds = [];
        }
        if (!Array.isArray(settingsData.smartStalePageIds)) {
            settingsData.smartStalePageIds = [];
        }
        if (!Array.isArray(settingsData.smartMostUsedPageIds)) {
            settingsData.smartMostUsedPageIds = [];
        }
        if (typeof settingsData.showSmartMostUsedCollection === 'undefined') {
            settingsData.showSmartMostUsedCollection = false;
        }
        if (!Array.isArray(settingsData.archivedPageIds)) {
            settingsData.archivedPageIds = [];
        }
        if (!['manual', 'on-save'].includes(String(settingsData.faviconRefreshPolicy || ''))) {
            settingsData.faviconRefreshPolicy = 'on-save';
        }
        if (!Number.isFinite(Number(settingsData.smartMostUsedLimit)) || Number(settingsData.smartMostUsedLimit) < 0) {
            settingsData.smartMostUsedLimit = 25;
        } else {
            settingsData.smartMostUsedLimit = Number(settingsData.smartMostUsedLimit);
        }
        if (window.DashboardFont) {
            window.DashboardFont.normalizeFontSettings(settingsData);
        } else if (!settingsData.fontPreset) {
            settingsData.fontPreset = 'source-code-pro';
        }
    }
}

window.ConfigSettingsDefaults = ConfigSettingsDefaults;
