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

    function buildVarsBlock(colors) {
        if (!colors) return '';
        const accent = colors.accentSuccess || '';
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
                --accent-primary: ${accent};
                --accent-warning: ${colors.accentWarning || ''};
                --accent-error: ${colors.accentError || ''};
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
        validateTextInput,
        contrastRatio,
    };
})();
