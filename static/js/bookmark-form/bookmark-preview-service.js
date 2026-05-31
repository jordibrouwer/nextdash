/**
 * Shared favicon + link preview fetch for bookmark forms.
 */
(function (global) {
    'use strict';

    const timers = new Map();

    function apiUrl(apiBase, path) {
        const base = String(apiBase || '').replace(/\/+$/, '');
        if (!base) return path;
        return `${base}${path.startsWith('/') ? path : `/${path}`}`;
    }

    function scheduleDebounced(key, fn, delayMs = 400) {
        const existing = timers.get(key);
        if (existing) clearTimeout(existing);
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            fn();
        }, delayMs));
    }

    function cancelDebounced(key) {
        const existing = timers.get(key);
        if (existing) {
            clearTimeout(existing);
            timers.delete(key);
        }
    }

    async function uploadIconFromUrl(iconUrl, apiBase = '') {
        try {
            const response = await fetch(apiUrl(apiBase, '/api/icon/from-url'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: iconUrl }),
            });
            if (!response.ok) return '';
            const result = await response.json();
            return result.icon || '';
        } catch {
            return '';
        }
    }

    async function fetchLinkPreview(url, apiBase = '') {
        const safeUrl = global.BookmarkUrlUtils?.ensureHttpUrl(url) || String(url || '').trim();
        if (!safeUrl) throw new Error('no url');
        const response = await fetch(`${apiUrl(apiBase, '/api/bookmark-preview')}?url=${encodeURIComponent(safeUrl)}`);
        if (!response.ok) throw new Error('fetch failed');
        const data = await response.json();
        return {
            title: data.title || '',
            description: data.description || '',
            image: data.image || '',
            icon: data.icon || '',
            domain: data.domain || global.BookmarkUrlUtils?.extractDomainFromUrl(safeUrl) || '',
        };
    }

    async function fetchAndUploadFavicon(bookmarkUrl, apiBase = '') {
        const utils = global.BookmarkUrlUtils;
        const safeUrl = utils ? utils.ensureHttpUrl(bookmarkUrl) : String(bookmarkUrl || '').trim();
        if (!safeUrl) return '';

        try {
            const preview = await fetchLinkPreview(safeUrl, apiBase);
            const iconUrl = String(preview?.icon || '').trim();
            if (iconUrl) {
                const icon = await uploadIconFromUrl(iconUrl, apiBase);
                if (icon) return icon;
            }
        } catch {
            // Continue to fallback.
        }

        const fallbackUrl = utils ? utils.deriveFaviconFromBookmarkUrl(safeUrl) : '';
        if (!fallbackUrl) return '';
        return uploadIconFromUrl(fallbackUrl, apiBase);
    }

    global.BookmarkPreviewService = {
        apiUrl,
        scheduleDebounced,
        cancelDebounced,
        uploadIconFromUrl,
        fetchLinkPreview,
        fetchAndUploadFavicon,
    };
})(typeof window !== 'undefined' ? window : globalThis);
