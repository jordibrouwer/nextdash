/**
 * Preset UI fonts + optional custom upload (via same settings shape).
 * Sets --font-family-main; loads Google Fonts when needed.
 */
(function (global) {
    const PRESET_IDS = [
        'source-code-pro',
        'jetbrains-mono',
        'ibm-plex-mono',
        'inter',
        'ibm-plex-sans',
        'dm-sans',
        'system'
    ];

    const GOOGLE_QUERY = {
        'jetbrains-mono': 'family=JetBrains+Mono:wght@400;600;700',
        'ibm-plex-mono': 'family=IBM+Plex+Mono:wght@400;600;700',
        inter: 'family=Inter:wght@400;600;700',
        'ibm-plex-sans': 'family=IBM+Plex+Sans:wght@400;600;700',
        'dm-sans': 'family=DM+Sans:wght@400;600;700'
    };

    const CSS_STACK = {
        'source-code-pro': "'Source Code Pro', monospace",
        'jetbrains-mono': "'JetBrains Mono', monospace",
        'ibm-plex-mono': "'IBM Plex Mono', monospace",
        inter: "'Inter', system-ui, sans-serif",
        'ibm-plex-sans': "'IBM Plex Sans', system-ui, sans-serif",
        'dm-sans': "'DM Sans', system-ui, sans-serif",
        system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    };

    function normalizePresetId(id) {
        const k = String(id || '').toLowerCase().trim();
        return PRESET_IDS.includes(k) ? k : 'source-code-pro';
    }

    function ensureGoogleStylesheet(queryPart) {
        if (!queryPart) return;
        const href = `https://fonts.googleapis.com/css2?${queryPart}&display=swap`;
        let link = document.getElementById('font-preset-google-fonts');
        if (!link) {
            link = document.createElement('link');
            link.id = 'font-preset-google-fonts';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        if (link.getAttribute('data-href-key') !== queryPart) {
            link.setAttribute('data-href-key', queryPart);
            link.href = href;
        }
    }

    function applyCustomFontFile(fontPath) {
        if (!fontPath) return Promise.resolve();
        const fontName = 'CustomFont';
        const fontFace = new FontFace(fontName, `url(${fontPath}?t=${Date.now()})`);
        return fontFace
            .load()
            .then((loadedFace) => {
                document.fonts.add(loadedFace);
                document.documentElement.style.setProperty('--font-family-main', `'${fontName}', monospace`);
            })
            .catch((err) => {
                console.error('Error loading custom font:', err);
            });
    }

    /**
     * @param {Object} settings - enableCustomFont, customFontPath, fontPreset
     */
    function applyMainFont(settings) {
        const s = settings || {};

        if (s.enableCustomFont && s.customFontPath) {
            if (global.ConfigFont && typeof global.ConfigFont.applyFont === 'function') {
                global.ConfigFont.applyFont(s.customFontPath);
            } else {
                applyCustomFontFile(s.customFontPath);
            }
            return;
        }

        const preset = normalizePresetId(s.fontPreset);
        document.documentElement.setAttribute('data-font-preset', preset);
        const googlePart = GOOGLE_QUERY[preset];
        if (googlePart) {
            ensureGoogleStylesheet(googlePart);
        }
        const stack = CSS_STACK[preset] || CSS_STACK['source-code-pro'];
        document.documentElement.style.setProperty('--font-family-main', stack);
    }

    global.DashboardFont = {
        PRESET_IDS,
        normalizePresetId,
        applyMainFont,
        applyCustomFontFile
    };
})(typeof window !== 'undefined' ? window : this);
