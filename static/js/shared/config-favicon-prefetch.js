/**
 * Batch favicon prefetch after bookmark import (browser HTML or ZIP restore).
 */
class ConfigFaviconPrefetch {
    static SESSION_KEY = 'nextdash-prefetch-icons-after-import';

    constructor(t) {
        this.t = t;
        this._running = false;
    }

    markForZipImport() {
        sessionStorage.setItem(ConfigFaviconPrefetch.SESSION_KEY, '1');
    }

    async consumePendingAfterLoad() {
        if (!sessionStorage.getItem(ConfigFaviconPrefetch.SESSION_KEY)) {
            return;
        }
        sessionStorage.removeItem(ConfigFaviconPrefetch.SESSION_KEY);
        await this.run();
    }

    /**
     * @param {number[]|null} pageIds — pages to process; null means every page.
     * @param {{refreshAll?: boolean}} [options] — refreshAll re-fetches icons for
     *   every bookmark, not only the ones missing one.
     */
    async run(pageIds = null, options = {}) {
        if (this._running) {
            return;
        }
        const refreshAll = options.refreshAll === true;
        this._running = true;
        const overlay = this._showOverlay();
        try {
            const ids = await this._resolvePageIds(pageIds);
            const totalMissing = await this._countMissingAcrossPages(ids, refreshAll);
            if (totalMissing === 0) {
                return;
            }

            let done = 0;
            this._updateOverlay(overlay, done, totalMissing, false);

            for (const pageId of ids) {
                let pageTotal = null;
                let attempts = 0;
                // refreshAll does not shrink the candidate list, so walk it by offset.
                let offset = 0;
                while (true) {
                    const batch = await this._postBatch(pageId, refreshAll ? { refreshAll: true, offset } : {});
                    if (pageTotal === null) {
                        pageTotal = batch.total || 0;
                        if (pageTotal === 0) {
                            break;
                        }
                    }
                    if ((batch.attempted || 0) === 0) {
                        break;
                    }
                    attempts += batch.attempted || 0;
                    offset += batch.attempted || 0;
                    done = Math.min(totalMissing, done + (batch.attempted || 0));
                    this._updateOverlay(overlay, done, totalMissing, false);
                    if (batch.done || batch.remaining === 0 || attempts >= pageTotal) {
                        break;
                    }
                }
            }

            this._updateOverlay(overlay, totalMissing, totalMissing, true);
            await this._delay(900);

            if (typeof configManager !== 'undefined') {
                const refreshIds = pageIds?.length ? pageIds : ids;
                for (const pageId of refreshIds) {
                    await configManager.loadPageBookmarks(pageId);
                }
            }
        } catch (err) {
            console.warn('Favicon prefetch after import failed:', err);
        } finally {
            this._hideOverlay(overlay);
            this._running = false;
        }
    }

    async _resolvePageIds(pageIds) {
        if (Array.isArray(pageIds) && pageIds.length > 0) {
            return pageIds.map((id) => Number(id)).filter((id) => id > 0);
        }
        const res = await fetch('/api/pages');
        if (!res.ok) {
            return [1];
        }
        const pages = await res.json();
        if (!Array.isArray(pages) || pages.length === 0) {
            return [1];
        }
        return pages.map((p) => Number(p.id)).filter((id) => id > 0);
    }

    async _countMissingAcrossPages(pageIds, refreshAll = false) {
        let total = 0;
        for (const pageId of pageIds) {
            const batch = await this._postBatch(pageId, { countOnly: true, refreshAll });
            total += batch.total || 0;
        }
        return total;
    }

    async _postBatch(pageId, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') {
            Object.assign(headers, nextDashWriteHeaders());
        }
        const body = { pageId, limit: 4, ...options };
        const fetchFn = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetchFn('/api/bookmarks/prefetch-icons', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(errText || `HTTP ${res.status}`);
        }
        return res.json();
    }

    _showOverlay() {
        let overlay = document.getElementById('favicon-prefetch-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'favicon-prefetch-overlay';
            overlay.className = 'favicon-prefetch-overlay';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.innerHTML = `
                <div class="favicon-prefetch-panel">
                    <p class="favicon-prefetch-title" id="favicon-prefetch-title"></p>
                    <div class="favicon-prefetch-bar-track" id="favicon-prefetch-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="favicon-prefetch-bar-fill" id="favicon-prefetch-bar-fill"></div>
                    </div>
                    <p class="favicon-prefetch-status" id="favicon-prefetch-status"></p>
                </div>`;
            document.body.appendChild(overlay);
        }
        const title = overlay.querySelector('#favicon-prefetch-title');
        if (title) {
            title.textContent = this.t('config.faviconPrefetchTitle') || 'Fetching bookmark icons…';
        }
        overlay.hidden = false;
        return overlay;
    }

    _updateOverlay(overlay, done, total, complete) {
        if (!overlay) return;
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
        const fill = overlay.querySelector('#favicon-prefetch-bar-fill');
        const track = overlay.querySelector('#favicon-prefetch-bar-track');
        const status = overlay.querySelector('#favicon-prefetch-status');
        const title = overlay.querySelector('#favicon-prefetch-title');

        if (fill) fill.style.width = `${pct}%`;
        if (track) {
            track.setAttribute('aria-valuenow', String(pct));
            track.setAttribute('aria-valuetext', `${pct}%`);
        }
        if (status) {
            const template = complete
                ? (this.t('config.faviconPrefetchComplete') || 'Icons updated')
                : (this.t('config.faviconPrefetchStatus') || '{{done}} of {{total}}');
            status.textContent = complete
                ? template
                : template.replace('{{done}}', String(done)).replace('{{total}}', String(total));
        }
        if (title && complete) {
            title.textContent = this.t('config.faviconPrefetchComplete') || 'Icons updated';
        }
    }

    _hideOverlay(overlay) {
        if (overlay) {
            overlay.hidden = true;
        }
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Explicit global: config relies on classic-script scope, but the dashboard
// loads this deferred and looks it up on window for `:favicons fetch`.
if (typeof window !== 'undefined') {
    window.ConfigFaviconPrefetch = ConfigFaviconPrefetch;
}
