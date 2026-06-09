/**
 * Shared URL helpers for bookmark add/edit flows.
 */
(function (global) {
    'use strict';

    function ensureHttpUrl(raw) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }

    /** Same rules as server canonicalBookmarkURLKey (handlers.go). */
    function canonicalBookmarkURLKey(raw) {
        const s = String(raw || '').trim();
        try {
            const u = new URL(ensureHttpUrl(s));
            const scheme = u.protocol.replace(/:$/, '').toLowerCase();
            const host = u.host.toLowerCase();
            let path = u.pathname;
            if (path === '/') {
                path = '';
            } else {
                path = path.replace(/\/+$/, '');
            }
            return `${scheme}://${host}${path}${u.search}`;
        } catch {
            let t = s.toLowerCase();
            const hash = t.indexOf('#');
            if (hash >= 0) t = t.slice(0, hash);
            return t.replace(/\/+$/, '');
        }
    }

    function deriveFaviconFromBookmarkUrl(bookmarkUrl) {
        const safeUrl = ensureHttpUrl(bookmarkUrl);
        if (!safeUrl) return '';
        try {
            const parsed = new URL(safeUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return `${parsed.protocol}//${parsed.host}/favicon.ico`;
        } catch {
            return '';
        }
    }

    function extractDomainFromUrl(raw) {
        try {
            return new URL(ensureHttpUrl(raw)).hostname;
        } catch {
            return '';
        }
    }

    function isHttpUrl(raw) {
        try {
            const u = new URL(ensureHttpUrl(raw));
            return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
            return false;
        }
    }

    global.BookmarkUrlUtils = {
        ensureHttpUrl,
        canonicalBookmarkURLKey,
        deriveFaviconFromBookmarkUrl,
        extractDomainFromUrl,
        isHttpUrl,
    };
})(typeof window !== 'undefined' ? window : globalThis);
