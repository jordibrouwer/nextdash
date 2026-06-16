/**
 * Apply dashboard layout settings (version, preset, density, opacity, etc.)
 * on secondary pages such as health that do not run dashboard/config setupDOM.
 */
(function initPageLayoutSync(global) {
    'use strict';

    const SETTINGS_SYNC_KEY = 'nextdash:config-settings-sync';
    const PENDING_SETTINGS_KEY = 'nextdash:pending-dashboard-settings-sync';
    const visual = () => global.VisualSettings || {};

    function normalizeDensity(mode) {
        return ['comfortable', 'compact', 'dense', 'auto'].includes(mode) ? mode : 'compact';
    }

    function mergeSettings(serverSettings) {
        if (global.DeviceSettingsMerge?.mergeServerAndDeviceSettings) {
            return global.DeviceSettingsMerge.mergeServerAndDeviceSettings(serverSettings);
        }
        return serverSettings || {};
    }

    function applyBackgroundDots(show) {
        if (global.ThemeLoader?.syncBackgroundDots) {
            global.ThemeLoader.syncBackgroundDots(show !== false);
        } else {
            document.body.classList.toggle('no-background-dots', show === false);
        }
        document.documentElement.setAttribute(
            'data-show-background-dots',
            show === false ? 'false' : 'true'
        );
    }

    function applyFontSize(fontSize) {
        const size = fontSize || 'm';
        document.documentElement.setAttribute('data-font-size', size);
        document.body.classList.remove(
            'font-size-xs',
            'font-size-s',
            'font-size-sm',
            'font-size-m',
            'font-size-lg',
            'font-size-l',
            'font-size-xl'
        );
        document.body.classList.add(`font-size-${size}`);
    }

    function applyTheme(theme, settings) {
        const nextTheme = theme || 'dark';
        if (global.ThemeLoader?.applyTheme) {
            global.ThemeLoader.applyTheme(
                nextTheme,
                settings?.showBackgroundDots !== false,
                settings?.fontSize || 'm'
            );
            return;
        }

        document.documentElement.setAttribute('data-theme', nextTheme);
        document.body.setAttribute('data-theme', nextTheme);
        document.body.classList.remove('dark', 'light');
        document.body.classList.add(nextTheme);
        applyBackgroundDots(settings?.showBackgroundDots !== false);
        applyFontSize(settings?.fontSize);
    }

    function applyFromSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            return settings;
        }

        const preserveLoading = document.body.classList.contains('loading');
        const merged = mergeSettings(settings);
        const resolvedTheme = visual().resolveTheme?.(merged) || merged.theme || 'dark';
        const themeChanged = resolvedTheme !== document.documentElement.getAttribute('data-theme');

        if (global.LayoutVersionUtils) {
            global.LayoutVersionUtils.applyLayoutVersionToDOM(merged.layoutVersion || 'classic');
        }

        if (global.LayoutUtils) {
            global.LayoutUtils.applyLayoutPreset(merged, merged.layoutPreset || 'default');
        } else {
            document.body.setAttribute('data-layout-preset', merged.layoutPreset || 'default');
        }

        document.body.setAttribute('data-density-mode', normalizeDensity(merged.densityMode));
        visual().applyBackgroundOpacity?.(merged.backgroundOpacity);
        visual().applyFontWeight?.(merged.fontWeight);
        visual().applyAnimations?.(merged.animationsEnabled);

        if (global.ThemeLoader?.applyLayoutVersion) {
            global.ThemeLoader.applyLayoutVersion(merged.layoutVersion || 'classic');
        }

        visual().applyAutoDarkMode?.(merged, () => {
            visual().applyBackground?.(merged);
            if (themeChanged) {
                visual().reloadThemeCSS?.();
            }
        });

        if (global.DashboardFont?.applyMainFont) {
            global.DashboardFont.applyMainFont(merged);
        }

        if (preserveLoading) {
            document.body.classList.add('loading');
        }

        return merged;
    }

    async function fetchAndApply() {
        try {
            const response = await fetch('/api/settings');
            if (!response.ok) {
                return null;
            }
            const settings = await response.json();
            return applyFromSettings(settings);
        } catch {
            return null;
        }
    }

    function readPendingSettingsSync() {
        try {
            const raw = sessionStorage.getItem(PENDING_SETTINGS_KEY);
            if (!raw) {
                return null;
            }
            const payload = JSON.parse(raw);
            return payload && Number(payload.timestamp) > 0 ? payload : null;
        } catch {
            return null;
        }
    }

    function setupListeners(options = {}) {
        const tabId = options.tabId || `page-${Date.now()}`;

        window.addEventListener('storage', (event) => {
            if (event.key !== SETTINGS_SYNC_KEY || !event.newValue) {
                return;
            }
            try {
                const payload = JSON.parse(event.newValue);
                if (payload?.sourceTabId && payload.sourceTabId === tabId) {
                    return;
                }
            } catch {
                void fetchAndApply();
                return;
            }
            void fetchAndApply();
        });

        window.addEventListener('pageshow', (event) => {
            if (!event.persisted && !readPendingSettingsSync()) {
                return;
            }
            void fetchAndApply().then(() => {
                try {
                    sessionStorage.removeItem(PENDING_SETTINGS_KEY);
                } catch {
                    // ignore
                }
            });
        });
    }

    async function init(options = {}) {
        setupListeners(options);
        return fetchAndApply();
    }

    global.PageLayoutSync = {
        applyFromSettings,
        fetchAndApply,
        setupListeners,
        init
    };
})(window);
