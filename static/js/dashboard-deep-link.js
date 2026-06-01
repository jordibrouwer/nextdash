/**
 * Dashboard deep links: ?page=1&bookmark=3&category=work (& optional &url= for fallback).
 */
(function (global) {
    'use strict';

    const PARAM_PAGE = 'page';
    const PARAM_BOOKMARK = 'bookmark';
    const PARAM_CATEGORY = 'category';
    const PARAM_URL = 'url';

    function parseDashboardDeepLink(location = global.location) {
        const params = new URLSearchParams(location.search || '');
        const bookmarkRaw = params.get(PARAM_BOOKMARK) ?? params.get('b');
        const categoryRaw = params.get(PARAM_CATEGORY) ?? params.get('c');
        const urlRaw = params.get(PARAM_URL);
        const pageRaw = params.get(PARAM_PAGE);
        const pageId = pageRaw != null && pageRaw !== '' ? parseInt(pageRaw, 10) : null;
        const bookmarkIndex =
            bookmarkRaw != null && bookmarkRaw !== '' ? parseInt(bookmarkRaw, 10) : null;
        return {
            pageId: Number.isFinite(pageId) ? pageId : null,
            bookmarkIndex: Number.isFinite(bookmarkIndex) ? bookmarkIndex : null,
            categoryId: categoryRaw || null,
            url: urlRaw ? decodeURIComponent(urlRaw) : null,
        };
    }

    function hasDeepLinkTarget(link) {
        if (!link) return false;
        return (
            link.bookmarkIndex != null ||
            Boolean(link.categoryId) ||
            Boolean(link.url)
        );
    }

    function buildDashboardDeepLink({ pageId, bookmarkIndex, categoryId, url }, basePath = '/') {
        const params = new URLSearchParams();
        if (pageId != null) params.set(PARAM_PAGE, String(pageId));
        if (bookmarkIndex != null) params.set(PARAM_BOOKMARK, String(bookmarkIndex));
        if (categoryId) params.set(PARAM_CATEGORY, categoryId);
        if (url) params.set(PARAM_URL, url);
        const qs = params.toString();
        return qs ? `${basePath}?${qs}` : basePath;
    }

    function stripDeepLinkParams(location = global.location) {
        const params = new URLSearchParams(location.search || '');
        let changed = false;
        for (const key of [PARAM_PAGE, PARAM_BOOKMARK, 'b', PARAM_CATEGORY, 'c', PARAM_URL]) {
            if (params.has(key)) {
                params.delete(key);
                changed = true;
            }
        }
        if (!changed) return;
        const qs = params.toString();
        const next = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash || ''}`;
        global.history.replaceState(null, '', next);
    }

    global.DashboardDeepLink = {
        parseDashboardDeepLink,
        hasDeepLinkTarget,
        buildDashboardDeepLink,
        stripDeepLinkParams,
    };
})(typeof window !== 'undefined' ? window : globalThis);
