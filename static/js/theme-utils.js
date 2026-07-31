/**
 * Shared theme id helpers used by theme-loader, visual-settings, and dashboard.
 * Loaded synchronously in <head> before theme-loader.js.
 */
(function initThemeUtils(global) {
    'use strict';

    /**
     * Maps a stored theme id to its dark/light counterpart when auto dark mode
     * is active. Custom themes without a -dark/-light suffix are returned as-is
     * when listed in options.customThemeIds.
     */
    function getPairedThemeVariant(themeId, wantsDark, options) {
        const opts = options || {};
        const base = String(themeId || 'dark');
        const customIds = opts.customThemeIds;
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
        getPairedThemeVariant,
        normalizeRandomThemeMode,
    };
})(typeof window !== 'undefined' ? window : globalThis);
