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
                headers: typeof global.nextDashWriteHeaders === 'function'
                    ? global.nextDashWriteHeaders({ 'Content-Type': 'application/json' })
                    : { 'Content-Type': 'application/json' },
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
        const response = await fetch(`${apiUrl(apiBase, '/api/bookmark-preview')}?url=${encodeURIComponent(safeUrl)}`, {
            headers: typeof global.nextDashWriteHeaders === 'function' ? global.nextDashWriteHeaders() : {},
        });
        if (!response.ok) throw new Error('fetch failed');
        const data = await response.json();
        return {
            title: data.title || '',
            description: data.description || '',
            image: data.image || '',
            icon: data.icon || '',
            // The page's own <link rel=icon>, remote. icon is empty on a fresh
            // fetch and a local /data/preview-images path once cached, so
            // uploading it always fell back to /favicon.ico.
            iconSource: data.iconSource || '',
            domain: data.domain || global.BookmarkUrlUtils?.extractDomainFromUrl(safeUrl) || '',
            // The app-icon sets know this address: its set icon shows, so no
            // favicon is fetched for it.
            setIcon: data.setIcon === true,
        };
    }

    async function fetchAndUploadFavicon(bookmarkUrl, apiBase = '') {
        return (await fetchFaviconOutcome(bookmarkUrl, apiBase)).icon;
    }

    /**
     * The favicon, and whether none was fetched because the app shows its set
     * icon. Read as '' alone, that counted as a failure: "No favicon found",
     * and every such row "failed" in a bulk fetch.
     */
    async function fetchFaviconOutcome(bookmarkUrl, apiBase = '') {
        const icon = await fetchFaviconInner(bookmarkUrl, apiBase);
        return typeof icon === 'object' ? icon : { icon: icon || '', setIcon: false };
    }

    async function fetchFaviconInner(bookmarkUrl, apiBase = '') {
        const utils = global.BookmarkUrlUtils;
        const safeUrl = utils ? utils.ensureHttpUrl(bookmarkUrl) : String(bookmarkUrl || '').trim();
        if (!safeUrl) return '';

        try {
            const preview = await fetchLinkPreview(safeUrl, apiBase);
            if (preview.setIcon) return { icon: '', setIcon: true };
            const iconUrl = String(preview?.iconSource || '').trim();
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
        fetchFaviconOutcome,
    };
})(typeof window !== 'undefined' ? window : globalThis);
