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

    function canonicalURLHost(u) {
        let host = u.hostname.toLowerCase();
        const port = u.port;
        if (!port) {
            return host;
        }
        if (host.includes(':')) {
            return `[${host}]:${port}`;
        }
        return `${host}:${port}`;
    }

    /** Same rules as server canonicalBookmarkURLKey (handlers.go). */
    function canonicalBookmarkURLKey(raw) {
        const s = String(raw || '').trim();
        try {
            const u = new URL(ensureHttpUrl(s));
            const scheme = u.protocol.replace(/:$/, '').toLowerCase();
            const host = canonicalURLHost(u);
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

    function isPrivateOrLocalHost(hostname) {
        const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (!host || host === 'localhost') return true;
        if (host.endsWith('.local')) return true;
        if (host === '::1') return true;
        if (/^127\./.test(host)) return true;
        if (/^10\./.test(host)) return true;
        if (/^192\.168\./.test(host)) return true;
        const match = /^172\.(\d+)\./.exec(host);
        if (match) {
            const second = Number(match[1]);
            if (second >= 16 && second <= 31) return true;
        }
        return false;
    }

    function requiresAllowLocalBookmarks(raw) {
        try {
            const u = new URL(ensureHttpUrl(raw));
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
            return isPrivateOrLocalHost(u.hostname);
        } catch {
            return false;
        }
    }

    /** Re-enable allowLocalBookmarks when stored settings block existing private-network bookmarks. */
    function healAllowLocalBookmarksSetting(settings, bookmarks) {
        if (!settings || settings.allowLocalBookmarks !== false) return false;
        const list = Array.isArray(bookmarks) ? bookmarks : [];
        const needsAllow = list.some((bm) => requiresAllowLocalBookmarks(bm?.url));
        if (!needsAllow) return false;
        settings.allowLocalBookmarks = true;
        return true;
    }

    global.BookmarkUrlUtils = {
        ensureHttpUrl,
        canonicalBookmarkURLKey,
        deriveFaviconFromBookmarkUrl,
        extractDomainFromUrl,
        isHttpUrl,
        requiresAllowLocalBookmarks,
        healAllowLocalBookmarksSetting,
    };
})(typeof window !== 'undefined' ? window : globalThis);
