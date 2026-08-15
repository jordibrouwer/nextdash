/**
 * Format shortcut strings as HTML with <kbd> elements (cheatsheet, tooltips).
 */
(function (global) {
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function wrapKbd(part) {
        const trimmed = String(part).trim();
        if (!trimmed) return '';
        return `<kbd>${escapeHtml(trimmed)}</kbd>`;
    }

    function keysToHtml(keys) {
        const raw = String(keys || '').trim();
        if (!raw) return '';

        if (/\s+or\s+/i.test(raw)) {
            return raw
                .split(/\s+or\s+/i)
                .map((segment) => keysToHtml(segment))
                .join('<span class="kbd-or"> or </span>');
        }

        if (raw.includes(' / ') && !raw.includes('+')) {
            return raw
                .split(/\s+\/\s+/)
                .map((segment) => keysToHtml(segment))
                .join('<span class="kbd-or"> / </span>');
        }

        // Lone "+" is a key, not a chord separator (would split to empty otherwise).
        if (raw.length <= 4 && !/\s/.test(raw)) {
            return wrapKbd(raw);
        }

        if (/\s*\+\s*/.test(raw)) {
            return raw
                .split(/\s*\+\s*/)
                .map(wrapKbd)
                .filter(Boolean)
                .join('<span class="kbd-sep">+</span>');
        }

        return escapeHtml(raw);
    }

    /**
     * A key chip in the spelling aria-keyshortcuts wants.
     *
     * The attribute takes DOM key names joined by "+", which is close to what a
     * chip reads but not identical: Cmd is Meta there, and a lone capital
     * letter means Shift plus that letter.
     */
    function ariaKeys(keys) {
        const parts = String(keys || '').split('+').map((part) => part.trim()).filter(Boolean);
        if (!parts.length) return '';
        if (parts.length === 1 && /^[A-Z]$/.test(parts[0])) {
            return `Shift+${parts[0]}`;
        }
        return parts.map((part) => (part === 'Cmd' ? 'Meta' : part)).join('+');
    }

    /** "Cmd" or "Ctrl", whichever the keyboard in front of the user has. */
    function modifierLabel() {
        const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');
        return mac ? 'Cmd' : 'Ctrl';
    }

    global.ShortcutFormat = { keysToHtml, escapeHtml, ariaKeys, modifierLabel };
})(typeof window !== 'undefined' ? window : globalThis);
