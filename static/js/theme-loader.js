// Theme Loader - Prevents FOUC (Flash of Unstyled Content)
// This script must be loaded synchronously in the <head> before CSS files
(function() {
    'use strict';

    const LEGACY_THEME_MAP = {
        aurora: 'aurora-borealis',
        cyberpunk: 'neon-grid',
        ember: 'desert-ember',
        forest: 'forest-moss',
        lavender: 'lavender-mist',
        matcha: 'forest-moss',
        midnight: 'midnight-terminal',
        mint: 'iceberg',
        nerd: 'midnight-terminal',
        ocean: 'iceberg',
        paper: 'paper-ink',
        peach: 'desert-ember',
        sunset: 'sunset-pulse',
        synthwave: 'neon-grid',
        void: 'void-mono'
    };

    function normalizeTheme(theme) {
        if (!theme) return 'dark';
        return LEGACY_THEME_MAP[theme] || theme;
    }
    
    /**
     * Gets the current theme based on device-specific settings or server default
     * @returns {string} The theme name ('dark' or 'light')
     */
    function getTheme() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let theme = 'dark'; // default
        
        if (deviceSpecific) {
            const settings = localStorage.getItem('dashboardSettings');
            if (settings) {
                try {
                    const parsedSettings = JSON.parse(settings);
                    const normalizedTheme = normalizeTheme(parsedSettings.theme || 'dark');
                    theme = normalizedTheme;

                    // Persist migrated theme for device-specific users.
                    if (parsedSettings.theme !== normalizedTheme) {
                        parsedSettings.theme = normalizedTheme;
                        if (window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                            window.DeviceSettingsMerge.saveDeviceLocalSettings(parsedSettings);
                        } else {
                            localStorage.setItem('dashboardSettings', JSON.stringify(parsedSettings));
                        }
                    }
                } catch (e) {
                    console.error('Error parsing dashboard settings:', e);
                    theme = 'dark';
                }
            }
        } else {
            // Use server-side theme from html element data attribute
            const htmlTheme = document.documentElement.getAttribute('data-theme');
            if (htmlTheme) {
                theme = normalizeTheme(htmlTheme);
            }
        }
        
        return normalizeTheme(theme);
    }
    
    /**
     * Gets the showBackgroundDots setting
     * @returns {boolean} Whether to show background dots
     */
    function getShowBackgroundDots() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let showBackgroundDots = true; // default
        
        if (deviceSpecific) {
            const settings = localStorage.getItem('dashboardSettings');
            if (settings) {
                try {
                    const parsed = JSON.parse(settings);
                    showBackgroundDots = parsed.showBackgroundDots !== false;
                } catch (e) {
                    console.error('Error parsing dashboard settings:', e);
                }
            }
        } else {
            // Use server-side setting from html element data attribute
            const htmlAttr = document.documentElement.getAttribute('data-show-background-dots');
            if (htmlAttr !== null) {
                showBackgroundDots = htmlAttr === 'true';
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
            const settings = localStorage.getItem('dashboardSettings');
            if (settings) {
                try {
                    const parsed = JSON.parse(settings);
                    fontSize = parsed.fontSize || 'm';
                } catch (e) {
                    console.error('Error parsing dashboard settings:', e);
                }
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
        return normalized === 'modern' ? 'modern' : 'classic';
    }

    /**
     * Gets the layoutVersion setting
     * @returns {string} The layout version ('classic' or 'modern')
     */
    function getLayoutVersion() {
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
        let layoutVersion = 'classic';

        if (deviceSpecific) {
            const settings = localStorage.getItem('dashboardSettings');
            if (settings) {
                try {
                    const parsed = JSON.parse(settings);
                    layoutVersion = parsed.layoutVersion || 'classic';
                } catch (e) {
                    console.error('Error parsing dashboard settings:', e);
                }
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
     * Applies critical theme styles to prevent FOUC
     * @param {string} theme - The theme to apply ('dark' or 'light')
     * @param {boolean} showBackgroundDots - Whether to show background dots
     * @param {string} fontSize - The font size to apply ('xs', 's', 'sm', 'm', 'lg', 'l', 'xl')
     */
    function applyTheme(theme, showBackgroundDots = true, fontSize = 'm') {
        // Remove existing FOUC prevention style if present
        const existingStyle = document.head.querySelector('style[data-fouc-prevention]');
        if (existingStyle) {
            existingStyle.remove();
        }
        
        // Set data-theme on html element
        document.documentElement.setAttribute('data-theme', theme);

        // Create and inject critical CSS using CSS variables
        const style = document.createElement('style');
        style.setAttribute('data-fouc-prevention', 'true');
        
        const backgroundImage = showBackgroundDots
            ? 'background-image: radial-gradient(var(--background-dots) 1px, transparent 1px) !important; background-size: 15px 15px !important;'
            : 'background-image: none !important;';

        style.textContent = `
            body {
                background-color: var(--background-primary) !important;
                color: var(--text-primary) !important;
                ${backgroundImage}
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
                    bottom: 1.5rem !important;
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
                    bottom: 1.25rem !important;
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
                    bottom: 1rem !important;
                    padding: 0.8rem 1rem !important;
                }
            }
        `;
        
        document.head.appendChild(style);

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
            if (!showBackgroundDots) {
                document.body.classList.add('no-background-dots');
            } else {
                document.body.classList.remove('no-background-dots');
            }
            
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
        getTheme: getTheme,
        getShowBackgroundDots: getShowBackgroundDots,
        getFontSize: getFontSize,
        getLayoutVersion: getLayoutVersion,
        applyTheme: applyTheme,
        applyLayoutVersion: applyLayoutVersion,
        onThemeChange: function(cb) {
            if (typeof cb !== 'function') return function() {};
            const handler = (e) => cb(e?.detail?.theme);
            document.addEventListener('theme-changed', handler);
            return () => document.removeEventListener('theme-changed', handler);
        }
    };
})();

