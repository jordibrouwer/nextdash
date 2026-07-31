/**
 * Live favicon harmonisation for dashboard DOM.
 *
 * Icon classes are normally applied when bookmark rows are built. Config edits
 * happen while the bookmarks view is not on screen, and incremental re-renders
 * skip rows whose fingerprint did not change — so toggling harmonisation needs
 * a path that patches the existing grid in place.
 */
(function initThemeIconStyling(global) {
    'use strict';

    const STYLE_VARIANTS = ['icon-themed--muted', 'icon-themed--tinted', 'icon-themed--overlay'];

    // Random theme mode rotates the displayed theme on every view/page change
    // or reload, each with its own harmonisation entry — so a toggle set while
    // theme A is showing looked like it turned itself off the moment the pool
    // rotated to theme B, which had no entry yet. While random mode is on,
    // harmonisation is one shared setting for the whole pool instead of being
    // keyed to whichever theme happens to be on screen.
    const RANDOM_POOL_KEY = '__random-theme-pool__';

    function isRandomThemeModeActive(settings) {
        const mode = global.ThemeUtils?.normalizeRandomThemeMode?.(settings) ?? settings?.randomThemeMode ?? 'off';
        return mode !== 'off';
    }

    function normalizeEntry(entry) {
        const value = entry || {};
        return {
            enabled: value.enabled === true,
            style: value.style || 'muted',
            intensity: Number.isFinite(Number(value.intensity)) ? Number(value.intensity) : 0.5,
        };
    }

    function pairedThemeOptions() {
        return { customThemeIds: global.ThemeUtils?.getCustomThemeIds?.() || global.UserCustomThemeIds };
    }

    function isCustomThemeId(themeId) {
        if (global.ThemeUtils?.isUserCustomThemeId) {
            return global.ThemeUtils.isUserCustomThemeId(themeId);
        }
        if (global.ThemeUtils?.isCustomThemeId) {
            return global.ThemeUtils.isCustomThemeId(themeId);
        }
        const id = String(themeId || '').trim();
        if (id.startsWith('theme-')) return true;
        return Array.isArray(global.UserCustomThemeIds) && global.UserCustomThemeIds.includes(id);
    }

    /**
     * The per-theme key, ignoring random theme mode. Exposed separately so a
     * mode switch can move the harmonisation entry between this key and
     * RANDOM_POOL_KEY rather than losing it — see isRandomThemeModeActive.
     */
    function getSpecificThemeKey(settings) {
        const stored = settings?.theme;
        if (stored && isCustomThemeId(stored)) {
            return stored;
        }
        return document.documentElement.getAttribute('data-theme')
            || stored
            || 'default';
    }

    /**
     * Theme key for reading/writing harmonisation. Custom themes always use the
     * stored choice — they have no dark/light pair and must not follow a
     * resolved data-theme that auto dark mode may have paired incorrectly.
     */
    function getThemeIconStylingThemeKey(settings) {
        if (isRandomThemeModeActive(settings)) {
            return RANDOM_POOL_KEY;
        }
        return getSpecificThemeKey(settings);
    }

    /**
     * Keys for the theme currently on screen: display id + its dark/light pair
     * only. Random-theme pools store many themes — never read or write via
     * settings.theme or other pool entries or a disable on one theme looks
     * enabled again on the next rotation.
     */
    function themeIconStylingDisplayKeys(displayTheme) {
        const primary = String(displayTheme || 'default');
        if (primary === RANDOM_POOL_KEY || isCustomThemeId(primary)) {
            return [primary];
        }
        const keys = [primary];
        if (global.ThemeUtils?.getPairedThemeVariant) {
            const opts = pairedThemeOptions();
            for (const wantsDark of [true, false]) {
                const paired = global.ThemeUtils.getPairedThemeVariant(primary, wantsDark, opts);
                if (paired !== primary && !keys.includes(paired)) {
                    keys.push(paired);
                }
            }
        }
        return keys;
    }

    function getThemeIconStylingEntry(settings) {
        const map = settings?.themeIconStyling || {};
        const primary = getThemeIconStylingThemeKey(settings);
        const keys = themeIconStylingDisplayKeys(primary);

        // The resolved display theme wins when set — including enabled: false —
        // so we never inherit enabled: true from a paired or pool sibling.
        if (Object.prototype.hasOwnProperty.call(map, primary)) {
            return normalizeEntry(map[primary]);
        }
        for (let i = 1; i < keys.length; i += 1) {
            const key = keys[i];
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                return normalizeEntry(map[key]);
            }
        }
        return normalizeEntry(null);
    }

    function clearThemeIconStylingElement(el) {
        if (!el) return;
        el.classList.remove('icon-themed', ...STYLE_VARIANTS);
        el.style.removeProperty('--icon-theme-intensity');
    }

    function applyThemeIconStylingToElement(el, entry) {
        if (!el) return;
        clearThemeIconStylingElement(el);
        if (!entry.enabled) return;
        el.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`);
        el.style.setProperty('--icon-theme-intensity', String(entry.intensity));
    }

    /**
     * Patch every harmonisation target currently in the document.
     * @param {object} [settings] Dashboard settings; falls back to dashboardInstance.
     * @returns {number} Elements updated.
     */
    function applyThemeIconStylingToDocument(settings) {
        const resolvedSettings = settings
            || global.dashboardInstance?.settings
            || null;
        if (!resolvedSettings) return 0;
        const entry = getThemeIconStylingEntry(resolvedSettings);
        let count = 0;

        document.querySelectorAll('#dashboard-layout .bookmark-icon-slot').forEach((el) => {
            applyThemeIconStylingToElement(el, entry);
            count += 1;
        });

        document.querySelectorAll('#dashboard-layout .category-title .bookmark-icon').forEach((img) => {
            const host = img.parentElement;
            if (host) {
                applyThemeIconStylingToElement(host, entry);
                count += 1;
            }
        });

        document.querySelectorAll('#search-matches .search-match-favicon-slot').forEach((el) => {
            applyThemeIconStylingToElement(el, entry);
            count += 1;
        });

        return count;
    }

    global.ThemeIconStyling = {
        RANDOM_POOL_KEY,
        isRandomThemeModeActive,
        normalizeEntry,
        getSpecificThemeKey,
        getThemeIconStylingThemeKey,
        themeIconStylingDisplayKeys,
        /** @deprecated Use themeIconStylingDisplayKeys */
        themeIconStylingRelatedKeys(_settings, displayTheme) {
            return themeIconStylingDisplayKeys(displayTheme);
        },
        getThemeIconStylingEntry,
        applyThemeIconStylingToElement,
        applyThemeIconStylingToDocument,
    };
}(typeof window !== 'undefined' ? window : globalThis));
