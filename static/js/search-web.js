/**
 * Web results in the search panel.
 *
 * Loaded the first time a web search runs (SearchComponent.runWebSearch);
 * nothing in here runs while someone types. The server asks the engine
 * (web_search.go), so the engine sees the server and never this browser, and
 * nothing a result points at is loaded until the reader opens it -- no
 * favicons, no thumbnails.
 */
(function (global) {
    'use strict';

    let statusPromise = null;

    function loadStatus() {
        if (!statusPromise) {
            statusPromise = fetch('/api/web-search/status', { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null)
                .then((body) => body || { engine: 'off', configured: false, categories: [] });
        }
        return statusPromise;
    }

    /** Forget the status, e.g. after the engine changed in Config. */
    function resetStatus() { statusPromise = null; }

    async function fetchResults(query, category, signal) {
        const params = new URLSearchParams({ q: query, cat: category || 'web' });
        const res = await fetch(`/api/web-search?${params}`, { signal, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(body.reason || String(res.status));
            err.reason = body.reason || 'engine_unreachable';
            throw err;
        }
        return body;
    }

    function domainOf(raw) {
        try {
            const text = String(raw || '').trim();
            if (!text) return '';
            const u = new URL(text.includes('://') ? text : `https://${text}`);
            return u.hostname.toLowerCase().replace(/^www\./, '');
        } catch (_e) {
            return '';
        }
    }

    function bookmarkByDomain(bookmarks) {
        const map = new Map();
        (bookmarks || []).forEach((b) => {
            const d = domainOf(b?.url);
            if (d && !map.has(d)) map.set(d, b);
        });
        return map;
    }

    function engineLabel(settings) {
        return settings?.webSearchEngine === 'brave' ? 'Brave' : 'SearXNG';
    }

    /** The engine's own results page: the way out when the panel has nothing. */
    function fallbackUrl(settings, query) {
        const q = encodeURIComponent(query);
        if (settings?.webSearchEngine === 'searxng' && settings.webSearchSearxngUrl) {
            return `${String(settings.webSearchSearxngUrl).replace(/\/+$/, '')}/search?q=${q}`;
        }
        return `https://search.brave.com/search?q=${q}`;
    }

    /** Add a selectable row to the panel the way search.js does for its own. */
    function register(search, container, el, match) {
        const index = search.selectableMatches.length;
        el.addEventListener('click', () => search._activateWebMatch(match, {}));
        search._bindMatchKeyboardActivate(el, index);
        search.matchElements.push(el);
        search.selectableMatches.push(match);
        container.appendChild(el);
    }

    function renderSection(search, container) {
        const state = search._web;
        const t = (k, f, v) => search.dashboardLabel(k, f, v);
        const esc = (s) => search._escHtml(String(s ?? ''));

        const header = document.createElement('div');
        header.className = 'search-web-header';
        header.textContent = t('webSearchSection', 'From the web');
        container.appendChild(header);

        const cats = state.categories || [];
        if (cats.length > 1) {
            const labels = { web: t('webSearchTabWeb', 'Web'), news: t('webSearchTabNews', 'News'), video: t('webSearchTabVideo', 'Video'), it: t('webSearchTabIt', 'IT') };
            const tabs = document.createElement('div');
            tabs.className = 'search-web-tabs';
            tabs.setAttribute('role', 'tablist');
            cats.forEach((cat) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'search-web-tab';
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-selected', String(cat === state.category));
                btn.textContent = labels[cat] || cat;
                btn.addEventListener('click', (e) => { e.stopPropagation(); void search.runWebSearch(cat); });
                tabs.appendChild(btn);
            });
            container.appendChild(tabs);
        }

        if (state.status === 'loading') {
            const loading = document.createElement('div');
            loading.className = 'search-web-loading';
            loading.setAttribute('role', 'status');
            loading.innerHTML = `<span class="search-web-skeleton"></span><span class="search-web-skeleton"></span><span class="search-web-skeleton"></span>
                <span class="sr-only">${esc(t('webSearchLoading', 'Searching the web…'))}</span>`;
            container.appendChild(loading);
            return;
        }

        const results = state.response?.results || [];
        if (state.status === 'error' || results.length === 0) {
            const message = document.createElement('div');
            message.className = 'search-web-message';
            message.textContent = state.status === 'error'
                ? t(`webSearchError_${state.reason}`, t('webSearchError_engine_unreachable', 'The search engine did not answer.'))
                : t('webSearchNoResults', 'Nothing found on the web.');
            container.appendChild(message);
            const row = document.createElement('div');
            row.className = 'search-match search-web-fallback';
            row.innerHTML = `<span class="search-match-shortcut search-hint-shortcut">↗</span>
                <span class="search-match-name">${esc(t('webSearchOpenIn', 'Open in {engine}', { engine: engineLabel(search.settings) }))}</span>`;
            register(search, container, row, { type: 'web-fallback', url: fallbackUrl(search.settings, state.query) });
            return;
        }

        const box = state.response?.infobox;
        if (box && box.title) {
            const card = document.createElement('details');
            card.className = 'search-web-infobox';
            card.open = !global.MobileExperience?.isMobileLayout?.();
            card.innerHTML = `<summary>${esc(box.title)}</summary><p>${esc(box.text)}</p>
                ${box.url ? `<a href="${esc(box.url)}" target="_blank" rel="noopener noreferrer">${esc(domainOf(box.url))}</a>` : ''}`;
            container.appendChild(card);
        }

        const byDomain = bookmarkByDomain(search.allBookmarks);
        results.forEach((result) => {
            const el = document.createElement('div');
            el.className = 'search-match search-web-result';
            const bookmark = byDomain.get(result.domain) || null;
            const iconHtml = bookmark ? search.buildSearchBookmarkIconHtml({ type: 'bookmark', bookmark }) : '';
            const letter = (result.domain || '?').charAt(0).toUpperCase();
            el.innerHTML = `
                ${iconHtml || `<span class="search-web-letter" aria-hidden="true">${esc(letter)}</span>`}
                <span class="search-match-name search-web-text">
                    <span class="search-web-title">${esc(result.title || result.url)}</span>
                    <span class="search-web-domain">${esc(result.domain)}</span>
                    <span class="search-web-snippet">${esc(result.snippet)}</span>
                </span>
                ${bookmark ? `<span class="search-web-badge" title="Alt+Enter">${esc(t('webSearchAlready', 'In your bookmarks: {name}', { name: bookmark.name || result.domain }))}</span>` : ''}`;
            register(search, container, el, { type: 'web-result', result, bookmark });
        });
    }

    function closePreview(search) {
        document.getElementById('search-web-preview')?.remove();
        if (search) search._webPreviewOpen = false;
    }

    /*
     * The preview is a third column of the panel's body, beside the list.
     *
     * The panel clips what overflows it (.search-container is overflow:
     * hidden), so a card hung outside its edge was cut off, and at a laptop
     * width there is no room beside a centred panel anyway.
     */
    function showPreview(search, match) {
        if (match?.type !== 'web-result' || global.MobileExperience?.isMobileLayout?.()) return;
        const host = document.querySelector('#shortcut-search .search-body');
        if (!host) return;
        let panel = document.getElementById('search-web-preview');
        if (!panel) {
            panel = document.createElement('aside');
            panel.id = 'search-web-preview';
            panel.className = 'search-web-preview';
            panel.setAttribute('aria-live', 'polite');
            host.appendChild(panel);
        }
        const esc = (s) => search._escHtml(String(s ?? ''));
        const r = match.result;
        const when = r.published ? new Date(r.published) : null;
        panel.innerHTML = `
            <h3 class="search-web-preview-title">${esc(r.title)}</h3>
            <p class="search-web-preview-url">${esc(r.url)}</p>
            ${when && !Number.isNaN(when.getTime()) ? `<p class="search-web-preview-date">${esc(when.toLocaleDateString())}</p>` : ''}
            <p class="search-web-preview-snippet">${esc(r.snippet)}</p>`;
        search._webPreviewOpen = true;
    }

    /** Follow the selection while the preview is open. */
    function syncPreview(search) {
        if (!search._webPreviewOpen) return;
        const match = search.selectableMatches[search.selectedMatchIndex];
        if (match?.type === 'web-result') showPreview(search, match);
        else closePreview(search);
    }

    global.SearchWeb = {
        loadStatus, resetStatus, fetchResults, domainOf, bookmarkByDomain, engineLabel, fallbackUrl, renderSection,
        showPreview, syncPreview, closePreview,
    };
}(typeof window !== 'undefined' ? window : globalThis));
