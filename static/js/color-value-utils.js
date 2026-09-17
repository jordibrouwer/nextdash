/**
 * CSS color validation and theme preview variable blocks.
 */
(function () {
    'use strict';

    const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const RGB_RE = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/;

    function isValidCSSValue(value) {
        if (value == null) return false;
        const v = String(value).trim();
        if (!v) return false;
        return HEX_RE.test(v) || RGB_RE.test(v);
    }

    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    /**
     * The character a theme declares, as the variables theme.css would write.
     *
     * Only what is declared: an unset field is derived from the palette on the
     * server, and the /api/theme.css block for the same selector already
     * carries that answer, so leaving it out lets the derived value show.
     */
    function buildCharacterVars(colors) {
        const out = [];
        const add = (name, value) => out.push(`--${name}: ${value};`);
        const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
        if (colors.accentInfo && isValidCSSValue(colors.accentInfo)) add('accent-info', colors.accentInfo);
        if (num(colors.surfaceStep) > 0) add('theme-surface-step', clamp(colors.surfaceStep, 0.6, 1.8));
        if (num(colors.surfaceAlpha) < 0) add('theme-surface-alpha', 1);
        else if (num(colors.surfaceAlpha) > 0) add('theme-surface-alpha', clamp(colors.surfaceAlpha, 0.3, 1));
        if (num(colors.surfaceBlur) > 0) add('theme-surface-blur', `${clamp(colors.surfaceBlur, 0, 32)}px`);
        if (num(colors.surfaceGlow) < 0) add('theme-surface-glow', 0);
        else if (num(colors.surfaceGlow) > 0) add('theme-surface-glow', clamp(colors.surfaceGlow, 0, 1));
        if (num(colors.radiusScale) > 0) add('theme-radius-scale', clamp(colors.radiusScale, 0.05, 1.6));
        if (['none', 'uppercase', 'lowercase'].includes(colors.labelTransform)) {
            add('theme-label-transform', colors.labelTransform);
        }
        if (/^-?\d*\.?\d+em$/.test(String(colors.labelSpacing || ''))) {
            add('theme-label-spacing', `${clamp(parseFloat(colors.labelSpacing), -0.05, 0.25)}em`);
        }
        if (num(colors.labelWeight) >= 400 && num(colors.labelWeight) <= 800) {
            add('theme-label-weight', colors.labelWeight - (colors.labelWeight % 100));
        }
        return out.join('\n                ');
    }

    function buildVarsBlock(colors) {
        if (!colors) return '';
        // The theme's own colour, or the success colour when it has none --
        // the same answer renderThemeCSSBlock gives on the server.
        const accent = colors.accentSuccess || '';
        const primary = colors.accentPrimary || accent;
        return `
                --text-primary: ${colors.textPrimary || ''};
                --text-secondary: ${colors.textSecondary || ''};
                --text-tertiary: ${colors.textTertiary || ''};
                --background-primary: ${colors.backgroundPrimary || ''};
                --background-secondary: ${colors.backgroundSecondary || ''};
                --background-dots: ${colors.backgroundDots || ''};
                --background-modal: ${colors.backgroundModal || ''};
                --border-primary: ${colors.borderPrimary || ''};
                --border-secondary: ${colors.borderSecondary || ''};
                --accent-success: ${accent};
                --accent-primary: ${primary};
                --accent-warning: ${colors.accentWarning || ''};
                --accent-error: ${colors.accentError || ''};
                ${buildCharacterVars(colors)}
        `;
    }

    function validateTextInput(input) {
        if (!input) return true;
        const value = String(input.value || '').trim();
        if (!value) {
            input.classList.remove('color-input-invalid');
            input.removeAttribute('aria-invalid');
            return true;
        }
        const ok = isValidCSSValue(value);
        input.classList.toggle('color-input-invalid', !ok);
        input.setAttribute('aria-invalid', ok ? 'false' : 'true');
        return ok;
    }

    function relativeLuminance(hex) {
        const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
        if (!m) return null;
        const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
        const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }

    function contrastRatio(fg, bg) {
        const L1 = relativeLuminance(fg);
        const L2 = relativeLuminance(bg);
        if (L1 == null || L2 == null) return null;
        const lighter = Math.max(L1, L2);
        const darker = Math.min(L1, L2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    window.ColorValueUtils = {
        isValidCSSValue,
        buildVarsBlock,
        buildCharacterVars,
        validateTextInput,
        relativeLuminance,
        contrastRatio,
    };
})();
