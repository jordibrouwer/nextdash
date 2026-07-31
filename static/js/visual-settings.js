/**
 * Shared visual settings helpers for dashboard, config, and secondary pages (health).
 */
(function initVisualSettings(global) {
    'use strict';

    const MIN_BACKGROUND_OPACITY = 0.65;

    const BACKGROUND_PRESETS = {
        sunset: 'linear-gradient(135deg, #c94b4b 0%, #4b134f 100%)',
        ocean: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        aurora: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        forest: 'linear-gradient(135deg, #0a3d0c 0%, #1a5e1f 50%, #0d2d0e 100%)',
        ember: 'linear-gradient(135deg, #3a1500 0%, #8b3800 60%, #ff6600 100%)',
        lavender: 'linear-gradient(135deg, #3d2b6b 0%, #7b5ea7 50%, #c2a0e0 100%)',
        nordic: 'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
        rose: 'linear-gradient(135deg, #b91d73 0%, #f953c6 100%)',
        morning: 'linear-gradient(135deg, #fff1eb 0%, #ace0f9 100%)',
        meadow: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
        blush: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
        mist: 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
        petal: 'linear-gradient(135deg, #ffd6e7 0%, #ffafcc 100%)'
    };

    const THEME_BACKGROUND_MAP = {
        'cherry-graphite-dark': 'rose',
        'desert-sand-dark': 'ember',
        'forest-moss-dark': 'forest',
        'lavender-mist-dark': 'lavender',
        'midnight-neon-dark': 'aurora',
        'neon-grid-dark': 'aurora',
        'glacier-mint-dark': 'nordic',
        'kelp-drift-dark': 'ocean',
        'mulberry-silk-dark': 'rose',
        'rusted-rail-dark': 'ember',
        'steel-dawn-dark': 'nordic',
        'nordic-frost-dark': 'nordic',
        'ocean-depth-dark': 'ocean',
        'paper-ink-dark': 'nordic',
        'retro-crt-dark': 'ember',
        'arctic-cyan-dark': 'ocean',
        'copper-circuit-dark': 'ember',
        'coral-reef-dark': 'sunset',
        'emerald-matrix-dark': 'forest',
        'monochrome-mist-dark': 'nordic',
        'obsidian-gold-dark': 'aurora',
        'royal-amethyst-dark': 'lavender',
        'sakura-night-dark': 'rose',
        'solar-ember-dark': 'sunset',
        'sunflower-ink-dark': 'sunset',
        'volcanic-ash-dark': 'ember',
        'cherry-graphite-light': 'blush',
        'desert-sand-light': 'morning',
        'forest-moss-light': 'meadow',
        'lavender-mist-light': 'petal',
        'midnight-neon-light': 'mist',
        'neon-grid-light': 'mist',
        'glacier-mint-light': 'mist',
        'kelp-drift-light': 'meadow',
        'mulberry-silk-light': 'petal',
        'rusted-rail-light': 'morning',
        'steel-dawn-light': 'mist',
        'nordic-frost-light': 'mist',
        'ocean-depth-light': 'mist',
        'paper-ink-light': 'morning',
        'retro-crt-light': 'morning',
        'arctic-cyan-light': 'mist',
        'copper-circuit-light': 'morning',
        'coral-reef-light': 'blush',
        'emerald-matrix-light': 'meadow',
        'monochrome-mist-light': 'mist',
        'obsidian-gold-light': 'morning',
        'royal-amethyst-light': 'petal',
        'sakura-night-light': 'petal',
        'solar-ember-light': 'morning',
        'sunflower-ink-light': 'morning',
        'volcanic-ash-light': 'morning',
        'patina-verdigris-dark': 'ocean',
        'patina-verdigris-light': 'mist',
        'rhubarb-tart-dark': 'rose',
        'rhubarb-tart-light': 'blush',
        'bio-abyss-dark': 'aurora',
        'bio-abyss-light': 'mist',
        'sumi-ink-dark': 'nordic',
        'sumi-ink-light': 'morning',
        'denim-fade-dark': 'nordic',
        'denim-fade-light': 'mist',
        'pistachio-cream-dark': 'meadow',
        'pistachio-cream-light': 'meadow',
        'thunderhead-dark': 'lavender',
        'thunderhead-light': 'mist',
        'desert-rose-dark': 'blush',
        'desert-rose-light': 'blush',
        'library-mahogany-dark': 'ember',
        'library-mahogany-light': 'morning',
        'wheat-field-dark': 'morning',
        'wheat-field-light': 'morning',
        'cerulean-skylark-dark': 'nordic',
        'cerulean-skylark-light': 'mist',
        'smoked-plum-dark': 'lavender',
        'smoked-plum-light': 'petal',
        'licorice-layer-dark': 'aurora',
        'licorice-layer-light': 'mist',
        'terracotta-studio-dark': 'ember',
        'terracotta-studio-light': 'morning',
        'frosted-juniper-dark': 'nordic',
        'frosted-juniper-light': 'mist',
        'candlelit-study-dark': 'ember',
        'candlelit-study-light': 'morning',
        'electric-orchid-dark': 'aurora',
        'electric-orchid-light': 'petal',
        'sea-glass-dark': 'ocean',
        'sea-glass-light': 'mist',
        'graphite-prism-dark': 'nordic',
        'graphite-prism-light': 'mist',
        'midnight-firefly-dark': 'forest',
        'midnight-firefly-light': 'meadow',
        'moss-stone-dark': 'meadow',
        'moss-stone-light': 'morning',
        'terminal-amber-dark': 'ember',
        'terminal-amber-light': 'morning',
        'dusk-horizon-dark': 'sunset',
        'dusk-horizon-light': 'mist',
        'candy-pop-dark': 'petal',
        'candy-pop-light': 'petal',
        'midnight-ink-dark': 'aurora',
        'midnight-ink-light': 'mist',
        dark: 'aurora',
        light: 'mist'
    };

    let autoDarkModeListenerAttached = false;
    let autoDarkSettingsRef = null;
    let autoDarkOnApply = null;

    function getPairedThemeVariant(themeId, wantsDark) {
        const base = String(themeId || 'dark');
        if (base === 'dark' || base === 'light') {
            return wantsDark ? 'dark' : 'light';
        }
        const match = base.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return base;
        }
        return `${match[1]}-${wantsDark ? 'dark' : 'light'}`;
    }

    function effectiveBaseTheme(settings) {
        const stored = settings?.theme || 'dark';
        const mode = global.ThemeLoader?.normalizeRandomThemeMode?.(settings)
            ?? (settings?.randomThemeMode === 'refresh' || settings?.randomThemeMode === 'view'
                || settings?.randomThemeOnRefresh ? 'refresh' : 'off');
        if (mode === 'off') {
            return stored;
        }
        if (global.ThemeLoader?.getEffectiveBaseTheme) {
            return global.ThemeLoader.getEffectiveBaseTheme(settings, stored);
        }
        const current = document.documentElement.getAttribute('data-theme');
        return current || stored;
    }

    function resolveTheme(settings) {
        const baseTheme = effectiveBaseTheme(settings);
        if (!settings?.autoDarkMode || !global.matchMedia) {
            return baseTheme;
        }
        const media = global.matchMedia('(prefers-color-scheme: dark)');
        return getPairedThemeVariant(baseTheme, media.matches);
    }

    function applyDisplayTheme(settings) {
        const displayTheme = resolveTheme(settings);
        const showDots = settings?.showBackgroundDots !== false;
        const fontSize = settings?.fontSize || 'm';
        if (global.ThemeLoader?.applyTheme) {
            global.ThemeLoader.applyTheme(displayTheme, showDots, fontSize);
        } else {
            document.documentElement.setAttribute('data-theme', displayTheme);
            if (document.body) {
                document.body.setAttribute('data-theme', displayTheme);
                document.body.classList.remove('dark', 'light');
                document.body.classList.add(displayTheme);
            }
        }
        return displayTheme;
    }

    function applyBackground(settings) {
        const type = (settings && settings.backgroundType) || 'none';
        const body = document.body;
        body.classList.remove('has-custom-background', 'bg-gradient', 'bg-image');
        document.documentElement.style.removeProperty('--custom-background-image');

        const showDots = settings ? settings.showBackgroundDots !== false : true;

        if (type === 'none') {
            body.classList.toggle('no-background-dots', !showDots);
            global.ThemeLoader?.syncBackgroundDots?.(showDots);
            return;
        }

        const forceNoDots = type === 'image';
        body.classList.toggle('no-background-dots', forceNoDots || !showDots);

        let presetName = '';
        if (type === 'auto') {
            presetName = THEME_BACKGROUND_MAP[resolveTheme(settings)] || '';
        } else if (type === 'gradient') {
            presetName = (settings && settings.backgroundGradient) || '';
        }

        let customBackground = '';
        if (presetName) {
            customBackground = BACKGROUND_PRESETS[presetName] || '';
        } else if (type === 'image') {
            customBackground = global.BookmarkUrlUtils?.safeCssImageUrl?.(settings?.backgroundImageUrl) || '';
        }

        if (!customBackground) {
            global.ThemeLoader?.syncBackgroundDots?.(showDots);
            return;
        }

        document.documentElement.style.setProperty('--custom-background-image', customBackground);
        body.classList.add('has-custom-background');
        body.classList.add(presetName ? 'bg-gradient' : 'bg-image');
        global.ThemeLoader?.syncBackgroundDots?.(!forceNoDots && showDots);
    }

    function clampBackgroundOpacity(value) {
        const opacity = Number(value ?? 1);
        return Number.isFinite(opacity) ? Math.min(1, Math.max(MIN_BACKGROUND_OPACITY, opacity)) : 1;
    }

    function applyBackgroundOpacity(value) {
        const clamped = clampBackgroundOpacity(value);
        document.documentElement.style.setProperty('--dashboard-bg-opacity', String(clamped));
    }

    function applyFontWeight(value) {
        const fontWeight = value || 'normal';
        document.documentElement.style.setProperty('--dashboard-font-weight', fontWeight);
        document.body.style.fontWeight = fontWeight;
    }

    function applyAnimations(enabled) {
        document.body.classList.toggle('no-animations', enabled === false);
    }

    function reloadThemeCSS() {
        const link = document.querySelector('link[href^="/api/theme.css"]');
        if (!link || !link.parentNode) {
            return;
        }
        const newLink = link.cloneNode(true);
        newLink.href = `/api/theme.css?t=${Date.now()}`;
        link.parentNode.replaceChild(newLink, link);
    }

    function runAutoDarkApply() {
        if (!autoDarkSettingsRef) {
            return;
        }
        const settings = autoDarkSettingsRef;
        const randomMode = global.ThemeLoader?.normalizeRandomThemeMode?.(settings)
            ?? (settings.randomThemeMode || (settings.randomThemeOnRefresh ? 'refresh' : 'off'));
        // When the OS preference changes under random theme, re-pair the session
        // pick instead of reverting to the stored theme.
        if (randomMode !== 'off' && global.ThemeLoader?.resolveDisplayTheme) {
            const base = effectiveBaseTheme(settings);
            const displayTheme = global.ThemeLoader.resolveDisplayTheme(
                base,
                settings.autoDarkMode === true
            );
            const showDots = settings.showBackgroundDots !== false;
            const fontSize = settings.fontSize || 'm';
            global.ThemeLoader.applyTheme(displayTheme, showDots, fontSize);
            autoDarkOnApply?.(displayTheme, settings);
            return;
        }
        const displayTheme = applyDisplayTheme(settings);
        autoDarkOnApply?.(displayTheme, settings);
    }

    function applyAutoDarkMode(settings, onApply) {
        autoDarkSettingsRef = settings;
        autoDarkOnApply = onApply;
        runAutoDarkApply();

        if (!settings?.autoDarkMode || !global.matchMedia) {
            return;
        }

        const query = global.matchMedia('(prefers-color-scheme: dark)');
        if (!autoDarkModeListenerAttached && typeof query.addEventListener === 'function') {
            query.addEventListener('change', runAutoDarkApply);
            autoDarkModeListenerAttached = true;
        }
    }

    global.VisualSettings = {
        BACKGROUND_PRESETS,
        MIN_BACKGROUND_OPACITY,
        clampBackgroundOpacity,
        THEME_BACKGROUND_MAP,
        getPairedThemeVariant,
        effectiveBaseTheme,
        resolveTheme,
        applyDisplayTheme,
        applyBackground,
        applyBackgroundOpacity,
        applyFontWeight,
        applyAnimations,
        applyAutoDarkMode,
        reloadThemeCSS
    };
})(window);
