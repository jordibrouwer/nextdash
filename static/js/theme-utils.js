/**
 * Shared theme id helpers used by theme-loader, visual-settings, and dashboard.
 * Loaded synchronously in <head> before theme-loader.js.
 */
(function initThemeUtils(global) {
    'use strict';

    /**
     * User-built theme ids from SSR (data-custom-theme-ids) or after /api/colors
     * loads. Custom themes are single-palette — they must never be paired for
     * auto dark mode or favicon harmonisation keys.
     */
    function getCustomThemeIds() {
        if (Array.isArray(global.UserCustomThemeIds) && global.UserCustomThemeIds.length) {
            return global.UserCustomThemeIds;
        }
        if (Array.isArray(global.CustomThemeIds) && global.CustomThemeIds.length) {
            return global.CustomThemeIds;
        }
        const raw = global.document?.documentElement?.getAttribute('data-custom-theme-ids') || '';
        if (!raw.trim()) {
            return [];
        }
        return raw.split(',').map((id) => id.trim()).filter(Boolean);
    }

    function setCustomThemeIds(ids) {
        const list = Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
        global.UserCustomThemeIds = list;
        global.CustomThemeIds = list;
        if (global.document?.documentElement) {
            global.document.documentElement.setAttribute('data-custom-theme-ids', list.join(','));
        }
        return list;
    }

    function isCustomThemeId(themeId) {
        const id = String(themeId || '').trim();
        return id !== '' && getCustomThemeIds().includes(id);
    }

    /** User-built theme ids always start with theme-; treat as custom even before /api/colors loads. */
    function isUserCustomThemeId(themeId) {
        const id = String(themeId || '').trim();
        if (!id) return false;
        if (id.startsWith('theme-')) return true;
        return isCustomThemeId(id);
    }

    /**
     * Maps a stored theme id to its dark/light counterpart when auto dark mode
     * is active. Custom themes without a -dark/-light suffix are returned as-is
     * when listed in options.customThemeIds.
     */
    function getPairedThemeVariant(themeId, wantsDark, options) {
        const opts = options || {};
        const base = String(themeId || 'dark');
        if (isUserCustomThemeId(base)) {
            return base;
        }
        const customIds = opts.customThemeIds ?? getCustomThemeIds();
        if (Array.isArray(customIds) && customIds.includes(base)) {
            return base;
        }
        if (base === 'dark' || base === 'light') {
            return wantsDark ? 'dark' : 'light';
        }
        const match = base.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return base;
        }
        return `${match[1]}-${wantsDark ? 'dark' : 'light'}`;
    }

    /**
     * Returns off | refresh | view. Reads settings first, then html data
     * attributes, with legacy randomThemeOnRefresh support.
     */
    function normalizeRandomThemeMode(parsedSettings, options) {
        const opts = options || {};
        const root = opts.root || global.document?.documentElement;
        const fromSettings = parsedSettings?.randomThemeMode;
        if (fromSettings === 'refresh' || fromSettings === 'view' || fromSettings === 'off') {
            return fromSettings;
        }
        if (parsedSettings && parsedSettings.randomThemeOnRefresh === true) {
            return 'refresh';
        }
        if (root) {
            const fromHtml = root.getAttribute('data-random-theme-mode');
            if (fromHtml === 'refresh' || fromHtml === 'view' || fromHtml === 'off') {
                return fromHtml;
            }
            const legacyHtml = root.getAttribute('data-random-theme-on-refresh');
            if (legacyHtml === 'true') {
                return 'refresh';
            }
        }
        return 'off';
    }

    global.ThemeUtils = {
        getCustomThemeIds,
        setCustomThemeIds,
        isCustomThemeId,
        isUserCustomThemeId,
        getPairedThemeVariant,
        normalizeRandomThemeMode,
    };
})(typeof window !== 'undefined' ? window : globalThis);
