// Theme Loader - Prevents FOUC (Flash of Unstyled Content)
// This script must be loaded synchronously in the <head> before CSS files
(function() {
    'use strict';

    /*
     * The theme a dashboard falls back to when nothing has said otherwise.
     *
     * The same id as defaultThemeID in models.go, and it has to be: this file
     * runs synchronously in <head> to decide the first paint, so whenever it
     * disagrees with the server the app has two defaults and shows whichever
     * one got there first. It disagreed until now -- six places here reached
     * for a bare 'dark', which is a real theme of its own and not the one a
     * fresh install is given, so "the default is Retro CRT" was true of the
     * server and false of the page in every case where the stored choice was
     * missing: a device with device-specific settings on and no theme in them,
     * or a shell served without the data-theme attribute filled in.
     */
    const DEFAULT_THEME = 'retro-crt-dark';

    const LEGACY_THEME_MAP = {
        aurora: 'midnight-neon-dark',
        cyberpunk: 'neon-grid-dark',
        ember: 'desert-sand-dark',
        forest: 'forest-moss-dark',
        lavender: 'lavender-mist-dark',
        matcha: 'forest-moss-dark',
        midnight: 'midnight-neon-dark',
        mint: 'glacier-mint-dark',
        nerd: 'retro-crt-dark',
        ocean: 'ocean-depth-dark',
        paper: 'paper-ink-dark',
        peach: 'desert-sand-dark',
        sunset: 'solar-ember-dark',
        synthwave: 'neon-grid-dark',
        void: 'monochrome-mist-dark',
        // Intermediate ids emitted by an older client-side map
        'aurora-borealis': 'midnight-neon-dark',
        'desert-ember': 'desert-sand-dark',
        'forest-moss': 'forest-moss-dark',
        'lavender-mist': 'lavender-mist-dark',
        'midnight-terminal': 'midnight-neon-dark',
        iceberg: 'glacier-mint-dark',
        'neon-grid': 'neon-grid-dark',
        'paper-ink': 'paper-ink-dark',
        'sunset-pulse': 'solar-ember-dark',
        'void-mono': 'monochrome-mist-dark',
    };

    /** Picked once per page load when random theme on refresh is enabled. */
    let sessionRandomTheme = null;

    function normalizeTheme(theme) {
        if (!theme) return DEFAULT_THEME;
        return LEGACY_THEME_MAP[theme] || theme;
    }

    const themeUtils = () => window.ThemeUtils;

    function shouldUseAutoDarkMode(parsedSettings) {
        if (parsedSettings && typeof parsedSettings.autoDarkMode === 'boolean') {
            return parsedSettings.autoDarkMode;
        }
        return document.documentElement.getAttribute('data-auto-dark-mode') === 'true';
    }

    function getThemePool() {
        const raw = document.documentElement.getAttribute('data-theme-pool') || '';
        if (!raw.trim()) {
            return [];
        }
        return raw.split(',').map((id) => id.trim()).filter(Boolean);
    }

    function filterPoolForAutoDark(pool, autoDarkMode) {
        if (!autoDarkMode || !window.matchMedia) {
            return pool;
        }
        const wantsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const filtered = pool.filter((id) => {
            if (id === 'dark') return wantsDark;
            if (id === 'light') return !wantsDark;
            if (id.endsWith('-dark')) return wantsDark;
            if (id.endsWith('-light')) return !wantsDark;
            return false;
        });
        if (filtered.length) {
            return filtered;
        }
        return wantsDark ? ['dark'] : ['light'];
    }

    function pickRandomFromPool(pool, exclude) {
        if (!pool.length) {
            return null;
        }
        if (exclude) {
            const remaining = pool.filter((id) => id !== exclude);
            if (remaining.length) {
                return remaining[Math.floor(Math.random() * remaining.length)];
            }
        }
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function pickSessionRandomTheme(pool, autoDarkMode) {
        if (sessionRandomTheme) {
            return sessionRandomTheme;
        }
        const effectivePool = filterPoolForAutoDark(pool, autoDarkMode);
        sessionRandomTheme = pickRandomFromPool(effectivePool) || DEFAULT_THEME;
        return sessionRandomTheme;
    }

    function clearSessionRandomTheme() {
        sessionRandomTheme = null;
    }

    /** Force a new random pick (used when randomThemeMode is "view"). */
    function rotateSessionRandomTheme(parsedSettings) {
        const previous = sessionRandomTheme;
        clearSessionRandomTheme();
        const pool = getThemePool();
        const autoDarkMode = shouldUseAutoDarkMode(parsedSettings);
        const effectivePool = filterPoolForAutoDark(pool, autoDarkMode);
        sessionRandomTheme = pickRandomFromPool(effectivePool, previous)
            || pickRandomFromPool(effectivePool)
            || DEFAULT_THEME;
        return sessionRandomTheme;
    }

    function resolveDisplayTheme(baseTheme, autoDarkMode) {
        const normalized = normalizeTheme(baseTheme);
        if (!autoDarkMode || !window.matchMedia) {
            return normalized;
        }
        return themeUtils().getPairedThemeVariant(
            normalized,
            window.matchMedia('(prefers-color-scheme: dark)').matches
        );
    }

    /**
     * Returns the stored theme choice, or the session-random base when random
     * on refresh is enabled. Does not apply auto-dark pairing.
     */
    function getEffectiveBaseTheme(parsedSettings, storedTheme) {
        const normalizedStored = normalizeTheme(storedTheme || DEFAULT_THEME);
        const mode = themeUtils().normalizeRandomThemeMode(parsedSettings);
        if (mode === 'off') {
            return normalizedStored;
        }
        if (sessionRandomTheme) {
            return sessionRandomTheme;
        }
        if (mode === 'refresh' || mode === 'view') {
            const pool = getThemePool();
            const autoDarkMode = shouldUseAutoDarkMode(parsedSettings);
            return pickSessionRandomTheme(pool, autoDarkMode);
        }
        return normalizedStored;
    }
    
    function readDeviceLocalSettings() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        if (!deviceSpecific) {
            return null;
        }
        const settings = localStorage.getItem('dashboardSettings');
        if (!settings) {
            return null;
        }
        try {
            return JSON.parse(settings);
        } catch (e) {
            console.error('Error parsing dashboard settings:', e);
            return null;
        }
    }

    /**
     * Gets the current theme based on device-specific settings or server default
     * @returns {string} The theme name ('dark' or 'light')
     */
    function getTheme() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let storedTheme = DEFAULT_THEME;
        let parsedSettings = null;
        let autoDarkMode = document.documentElement.getAttribute('data-auto-dark-mode') === 'true';
        
        if (deviceSpecific) {
            parsedSettings = readDeviceLocalSettings();
            if (parsedSettings) {
                const normalizedTheme = normalizeTheme(parsedSettings.theme || DEFAULT_THEME);
                storedTheme = normalizedTheme;
                autoDarkMode = shouldUseAutoDarkMode(parsedSettings);

                // Persist migrated theme for device-specific users.
                if (parsedSettings.theme !== normalizedTheme) {
                    parsedSettings.theme = normalizedTheme;
                    if (window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                        window.DeviceSettingsMerge.saveDeviceLocalSettings(parsedSettings);
                    } else {
                        localStorage.setItem('dashboardSettings', JSON.stringify(parsedSettings));
                    }
                }
            }
        } else {
            const htmlTheme = document.documentElement.getAttribute('data-theme');
            if (htmlTheme) {
                storedTheme = normalizeTheme(htmlTheme);
            }
        }

        const baseTheme = getEffectiveBaseTheme(parsedSettings, storedTheme);
        return resolveDisplayTheme(baseTheme, autoDarkMode);
    }
    
    /**
     * Gets the showBackgroundDots setting
     * @returns {boolean} Whether to show background dots
     */
    function getShowBackgroundDots() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let showBackgroundDots = true; // default
        
        if (deviceSpecific) {
            const parsed = readDeviceLocalSettings();
            if (parsed) {
                showBackgroundDots = parsed.showBackgroundDots !== false;
            }
        } else {
            // Use server-side setting from html element data attribute
            const htmlAttr = document.documentElement.getAttribute('data-show-background-dots');
            if (htmlAttr !== null) {
                showBackgroundDots = htmlAttr !== 'false';
            }
        }
        
        return showBackgroundDots;
    }
    
    /**
     * Gets the fontSize setting
     * @returns {string} The font size ('xs', 's', 'sm', 'm', 'lg', 'l', 'xl')
     */
    function getFontSize() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let fontSize = 'm'; // default

        if (deviceSpecific) {
            const parsed = readDeviceLocalSettings();
            if (parsed) {
                fontSize = parsed.fontSize || 'm';
            }
        } else {
            // Use server-side fontSize from html element data attribute
            const htmlAttr = document.documentElement.getAttribute('data-font-size');
            if (htmlAttr) {
                fontSize = htmlAttr;
            }
        }

        return fontSize;
    }
    
    function normalizeLayoutVersion(value) {
        const normalized = (value || '').toLowerCase().trim();
        if (normalized === 'modern') {
            return normalized;
        }
        return 'classic';
    }

    /**
     * Gets the layoutVersion setting
     * @returns {string} The layout version ('classic' or 'modern')
     */
    function getLayoutVersion() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let layoutVersion = 'classic';

        if (deviceSpecific) {
            const parsed = readDeviceLocalSettings();
            if (parsed) {
                layoutVersion = parsed.layoutVersion || 'classic';
            }
        } else {
            const htmlAttr = document.documentElement.getAttribute('data-layout-version');
            if (htmlAttr) {
                layoutVersion = htmlAttr;
            }
        }

        return normalizeLayoutVersion(layoutVersion);
    }

    function applyLayoutVersion(layoutVersion = 'classic') {
        const version = normalizeLayoutVersion(layoutVersion);
        document.documentElement.setAttribute('data-layout-version', version);
        if (document.body) {
            document.body.setAttribute('data-layout-version', version);
        }
        return version;
    }

    /**
     * Syncs the <meta name="theme-color"> tag to the active theme's resolved
     * background color so the mobile browser / PWA chrome matches every theme
     * (light, dark, built-in, and custom), not just the two hardcoded defaults.
     */
    function syncThemeColorMeta() {
        try {
            const meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) return;
            const styles = getComputedStyle(document.documentElement);
            const bg = (styles.getPropertyValue('--background-primary') || '').trim();
            // Only overwrite once the theme CSS variables have actually resolved;
            // an empty value means /api/theme.css hasn't applied yet, so keep the
            // server-rendered fallback until a later sync (DOMContentLoaded/theme-changed).
            if (bg) {
                meta.setAttribute('content', bg);
            }
        } catch (e) {
            // ignore - theme-color is a progressive enhancement
        }
    }

    /**
     * Mirrors the depth choice onto <html> and <body>.
     *
     * The server writes it on both for the first paint, so this exists for the
     * moment it changes and for the device-specific path, where the server's
     * copy is not the one that counts.
     */
    function applyThemeDepth(depth) {
        const value = ['flat', 'soft', 'rich'].includes(depth) ? depth : 'rich';
        document.documentElement.setAttribute('data-depth', value);
        if (document.body) {
            document.body.setAttribute('data-depth', value);
        }
        return value;
    }

    /**
     * Mirrors the backdrop pattern onto <html> and <body>.
     *
     * Unknown values fall back to auto rather than to nothing: an install that
     * has never heard of this setting should get whatever its theme asks for,
     * and a typo should not be the thing that takes the backdrop away.
     */
    function applyBackgroundPattern(pattern) {
        const value = ['auto', 'dots', 'grid', 'lines', 'hatch', 'none'].includes(pattern) ? pattern : 'auto';
        document.documentElement.setAttribute('data-pattern', value);
        if (document.body) {
            document.body.setAttribute('data-pattern', value);
        }
        return value;
    }

    function syncBackgroundDots(showBackgroundDots) {
        const show = showBackgroundDots !== false;
        document.documentElement.setAttribute('data-show-background-dots', show ? 'true' : 'false');
        if (document.body) {
            document.body.setAttribute('data-show-background-dots', show ? 'true' : 'false');
            document.body.classList.toggle('no-background-dots', !show);
        }
    }

    /**
     * Applies critical theme styles to prevent FOUC
     * @param {string} theme - The theme to apply ('dark' or 'light')
     * @param {boolean} showBackgroundDots - Whether to show background dots
     * @param {string} fontSize - The font size to apply ('xs', 's', 'sm', 'm', 'lg', 'l', 'xl')
     */
    function preserveBodyBackgroundDuringThemeSwitch() {
        const body = document.body;
        if (!body) {
            return;
        }
        const bg = getComputedStyle(body).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
            return;
        }
        body.style.setProperty('background-color', bg, 'important');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                body.style.removeProperty('background-color');
                syncThemeColorMeta();
            });
        });
    }

    function applyTheme(theme, showBackgroundDots = true, fontSize = 'm') {
        // Remove existing FOUC prevention style if present
        const existingStyle = document.head.querySelector('style[data-fouc-prevention]');
        if (existingStyle) {
            existingStyle.remove();
        }

        preserveBodyBackgroundDuringThemeSwitch();

        // Set data-theme on html element
        document.documentElement.setAttribute('data-theme', theme);
        syncBackgroundDots(showBackgroundDots);

        // Create and inject critical CSS using CSS variables
        const style = document.createElement('style');
        style.setAttribute('data-fouc-prevention', 'true');

        style.textContent = `
            body {
                background-color: var(--background-primary) !important;
                color: var(--text-primary) !important;
            }

            /* Critical responsive styles to prevent FOUC on mobile */
            @media (max-width: 760px) {
                .button-container {
                    width: calc(100% - 2rem) !important;
                    justify-content: center !important;
                    gap: 0.5rem !important;
                }
                
                .search-button,
                .finders-button,
                .commands-button {
                    flex: none !important;
                }

                .search-container {
                    max-width: 320px !important;
                    width: 95% !important;
                    padding: 1rem 1.25rem 0.75rem 2rem !important;
                }
                
                .search-button {
                    padding: 0.8rem 1rem !important;
                }
            }
            
            @media (max-width: 575px) {
                .search-container {
                    max-width: 80% !important;
                    width: 100% !important;
                    margin: 0 auto !important;
                    padding: 0.875rem 1rem 0.625rem 2rem !important;
                }
                
                .search-button {
                    padding: 0.8rem 1rem !important;
                }
            }
            
            @media (max-width: 479px) {
                .search-container {
                    max-width: 80% !important;
                    width: 100% !important;
                    margin: 0 auto !important;
                    padding: 0.75rem 0.875rem 0.5rem 2rem !important;
                }
                
                .search-button {
                    padding: 0.8rem 1rem !important;
                }
            }
        `;
        
        document.head.appendChild(style);

        // Keep the mobile/PWA chrome color in sync with the resolved theme background
        syncThemeColorMeta();

        // Notify listeners that theme has changed
        try {
            document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
        } catch (e) {
            // ignore
        }
        
        // Also set body class if body exists (for config page theme switching)
        if (document.body) {
            // Use classList to preserve other classes like font-size
            // Remove all possible theme classes (dark, light, and any custom themes)
            // Remove default theme classes
            document.body.classList.remove('dark', 'light');

            /*
             * The theme that was applied last, taken off by name.
             *
             * The two sweeps below do not cover a plain built-in: the custom
             * list holds only custom ids, and the fallback that would have
             * caught the rest sits in its else, so the moment an install has
             * one custom theme the fallback stops running for everybody.
             * Switching between two built-ins then left both classes on the
             * body -- "retro-crt-dark moss-stone-dark" -- and every rule
             * written against the old theme kept matching.
             *
             * Read off the element rather than from a list, because the
             * element is the one place that always knows what was applied,
             * and a list has to be kept in step with the themes.
             */
            const applied = document.body.getAttribute('data-theme')
                || document.documentElement.getAttribute('data-theme');
            if (applied && applied !== theme) {
                try { document.body.classList.remove(applied); } catch (e) {}
            }

            // Remove any known custom theme classes if provided by config
            if (window.CustomThemeIds && Array.isArray(window.CustomThemeIds)) {
                window.CustomThemeIds.forEach(id => {
                    try { document.body.classList.remove(id); } catch (e) {}
                });
            } else {
                // Fallback: remove any class that looks like a theme (not font-size or system)
                Array.from(document.body.classList).forEach(cls => {
                    if (!cls.startsWith('font-size-') && !cls.startsWith('no-')) {
                        if (cls !== 'dark' && cls !== 'light') {
                            document.body.classList.remove(cls);
                        }
                    }
                });
            }
            
            // Add the new theme class
            document.body.classList.add(theme);
            document.body.setAttribute('data-theme', theme);
            
            // Apply background dots class
            syncBackgroundDots(showBackgroundDots);
            
            // Apply font size class
            document.body.classList.remove('font-size-xs', 'font-size-s', 'font-size-sm', 'font-size-m', 'font-size-lg', 'font-size-l', 'font-size-xl');
            document.body.classList.add(`font-size-${fontSize}`);
            
        }
    }

    // Apply theme, fontSize, and layout version immediately
    const theme = getTheme();
    const showBackgroundDots = getShowBackgroundDots();
    const fontSize = getFontSize();
    const layoutVersion = getLayoutVersion();
    applyTheme(theme, showBackgroundDots, fontSize);
    applyLayoutVersion(layoutVersion);
    
    document.addEventListener('DOMContentLoaded', function() {
        applyLayoutVersion(getLayoutVersion());
        // theme.css is guaranteed parsed by now; correct the meta if the early
        // synchronous applyTheme() ran before the theme variables resolved.
        syncThemeColorMeta();

        if (!window.DashboardFont || typeof window.DashboardFont.applyMainFont !== 'function') {
            return;
        }
        const root = document.documentElement;
        window.DashboardFont.applyMainFont({
            enableCustomFont: root.getAttribute('data-enable-custom-font') === 'true',
            customFontPath: root.getAttribute('data-custom-font-path') || '',
            fontPreset: root.getAttribute('data-font-preset') || 'source-code-pro'
        });
    });
    
    // Export functions for use by other scripts (e.g., config.js)
    window.ThemeLoader = {
        normalizeTheme,
        normalizeRandomThemeMode: (parsedSettings) =>
            themeUtils().normalizeRandomThemeMode(parsedSettings),
        getTheme: getTheme,
        getEffectiveBaseTheme,
        getThemePool,
        filterPoolForAutoDark,
        pickSessionRandomTheme,
        rotateSessionRandomTheme,
        clearSessionRandomTheme,
        getPairedThemeVariant: (themeId, wantsDark) =>
            themeUtils().getPairedThemeVariant(themeId, wantsDark),
        resolveDisplayTheme: resolveDisplayTheme,
        getShowBackgroundDots: getShowBackgroundDots,
        getFontSize: getFontSize,
        getLayoutVersion: getLayoutVersion,
        applyTheme: applyTheme,
        applyLayoutVersion: applyLayoutVersion,
        applyThemeDepth: applyThemeDepth,
        applyBackgroundPattern: applyBackgroundPattern,
        syncBackgroundDots: syncBackgroundDots,
        syncThemeColorMeta: syncThemeColorMeta,
        onThemeChange: function(cb) {
            if (typeof cb !== 'function') return function() {};
            const handler = (e) => cb(e?.detail?.theme);
            document.addEventListener('theme-changed', handler);
            return () => document.removeEventListener('theme-changed', handler);
        }
    };
})();
