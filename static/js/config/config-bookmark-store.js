/**
 * Single source of truth for config bookmark data.
 * Page lists and the tags tab read the same object references from _byPage.
 */

class ConfigBookmarkStore {
    constructor(dataApi) {
        this._data = dataApi;
        /** @type {Map<number, object[]>} */
        this._byPage = new Map();
    }

    clear() {
        this._byPage.clear();
    }

    hasPage(pageId) {
        const pid = Number(pageId);
        return Number.isFinite(pid) && pid >= 1 && this._byPage.has(pid);
    }

    getPage(pageId) {
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || pid < 1) return [];
        if (!this._byPage.has(pid)) {
            this._byPage.set(pid, []);
        }
        return this._byPage.get(pid);
    }

    setPage(pageId, bookmarks) {
        const pid = Number(pageId);
        const list = Array.isArray(bookmarks) ? bookmarks : [];
        list.forEach((bm) => this._ensureBookmarkShape(bm, pid));
        this._byPage.set(pid, list);
        return list;
    }

    /** Flat list for tags tab, stats, and cross-page views (same bookmark objects as per-page arrays). */
    getAll() {
        const out = [];
        const ids = [...this._byPage.keys()].sort((a, b) => a - b);
        for (const pid of ids) {
            for (const bm of this.getPage(pid)) {
                if (Number(bm.pageId) !== pid) {
                    bm.pageId = pid;
                }
                out.push(bm);
            }
        }
        return out;
    }

    replaceAll(flatBookmarks) {
        this._byPage.clear();
        const list = Array.isArray(flatBookmarks) ? flatBookmarks : [];
        for (const bm of list) {
            const pid = Number(bm?.pageId) || 1;
            this.getPage(pid).push(bm);
            this._ensureBookmarkShape(bm, pid);
        }
        return this.getAll();
    }

    removeWhere(predicate) {
        for (const [pid, list] of this._byPage) {
            this._byPage.set(
                pid,
                list.filter((bm) => !predicate(bm, pid))
            );
        }
    }

    findByUrl(bookmark, pageId = null) {
        const pid = Number(pageId ?? bookmark?.pageId);
        const urlKey = String(bookmark?.url || '').trim().toLowerCase();
        if (!Number.isFinite(pid) || pid < 1 || !urlKey) return null;
        return (
            this.getPage(pid).find(
                (b) => String(b.url || '').trim().toLowerCase() === urlKey
            ) || null
        );
    }

    _ensureBookmarkShape(bm, pageId) {
        if (!bm || typeof bm !== 'object') return bm;
        const pid = Number(pageId ?? bm.pageId) || 1;
        bm.pageId = pid;
        if (!Array.isArray(bm.tags)) {
            bm.tags = [];
        }
        return bm;
    }

    preparePageForSave(pageId) {
        const pid = Number(pageId);
        return this.getPage(pid).map((bm) => ({
            ...bm,
            pageId: pid,
            tags: Array.isArray(bm.tags) ? [...bm.tags] : [],
        }));
    }

    async loadAll() {
        try {
            const res = await fetch('/api/bookmarks?all=true');
            const data = res.ok ? await res.json() : [];
            return this.replaceAll(Array.isArray(data) ? data : []);
        } catch (error) {
            console.warn('Could not load all bookmarks', error);
            this.clear();
            return [];
        }
    }

    async loadPage(pageId) {
        const pid = Number(pageId);
        const list = await this._data.loadBookmarksByPage(pageId);
        return this.setPage(pid, list);
    }

    async persistPage(pageId, retryFn) {
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || pid < 1) return;
        const prepared = this.preparePageForSave(pid);
        await retryFn(() => this._data.saveBookmarks(prepared, pid));
    }

    async persistAllPages(retryFn) {
        const pageIds = [...this._byPage.keys()]
            .filter((id) => Number.isFinite(id) && id >= 1)
            .sort((a, b) => a - b);
        for (const pageId of pageIds) {
            await this.persistPage(pageId, retryFn);
        }
    }
}

window.ConfigBookmarkStore = ConfigBookmarkStore;
