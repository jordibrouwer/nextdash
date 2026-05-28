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

        if (/\s*\+\s*/.test(raw)) {
            return raw
                .split(/\s*\+\s*/)
                .map(wrapKbd)
                .filter(Boolean)
                .join('<span class="kbd-sep">+</span>');
        }

        if (raw.length <= 4 && !/\s/.test(raw)) {
            return wrapKbd(raw);
        }

        return escapeHtml(raw);
    }

    global.ShortcutFormat = { keysToHtml, escapeHtml };
})(typeof window !== 'undefined' ? window : globalThis);
