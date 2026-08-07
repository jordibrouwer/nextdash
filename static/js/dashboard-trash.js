/**
 * Client side of the bookmark trash.
 *
 * The dashboard deletes a bookmark by splicing it out of its in-memory array
 * and rewriting the whole page through saveBookmarkOrder(), never through
 * DELETE /api/bookmarks. The server therefore never sees an individual delete
 * and cannot capture the trash entry on its own — the client has to report what
 * it removed, which is what record() does.
 *
 * Recording is deliberately best-effort and always runs after the page save has
 * succeeded: a failed trash write must never block or undo a delete the user
 * asked for, and a delete that did not persist should not leave a phantom entry
 * in the trash.
 */
(function initDashboardTrash(global) {
    const ENDPOINT = '/api/trash';

    // write-api.js reads the token from its meta tag; going through it keeps the
    // trash on the same path as every other write.
    function writeHeaders() {
        const base = { 'Content-Type': 'application/json' };
        return global.nextDashWriteHeaders ? global.nextDashWriteHeaders(base) : base;
    }

    /**
     * Record deleted bookmarks.
     *
     * @param {Array<{pageId:number,index:number,bookmark:object}>} entries
     * @param {string} source  Where the delete came from, for the trash list.
     */
    async function record(entries, source = '') {
        const items = (entries || [])
            .filter((entry) => entry && entry.bookmark && (entry.bookmark.url || entry.bookmark.name))
            .map((entry) => ({
                pageId: Number(entry.pageId) || 0,
                index: Number.isFinite(entry.index) && entry.index >= 0 ? entry.index : 0,
                bookmark: entry.bookmark,
            }));
        if (!items.length) {
            return false;
        }
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: writeHeaders(),
                body: JSON.stringify({ source, items }),
            });
            return res.ok;
        } catch (_error) {
            // Offline or blocked: the delete itself already succeeded, so this
            // costs the user the undo window, not their action.
            return false;
        }
    }

    /** Record exactly one deleted bookmark. */
    function recordOne(bookmark, pageId, index, source = '') {
        return record([{ pageId, index, bookmark }], source);
    }

    /**
     * Record a deleted category.
     *
     * Its bookmarks stay on the page, so only the definition is stored. Pages go
     * through the server instead: DELETE /api/pages removes the file, so the
     * handler captures that snapshot itself rather than trusting the client to
     * send back a page it is about to lose.
     *
     * Best-effort like record(): a failed write costs the trash entry, not the
     * delete.
     */
    async function recordCategory(category, pageId, index, source = '') {
        if (!category || !category.id) {
            return false;
        }
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: writeHeaders(),
                body: JSON.stringify({
                    source,
                    items: [{
                        kind: 'category',
                        pageId: Number(pageId) || 0,
                        trashedCategory: {
                            category,
                            index: Number.isFinite(index) && index >= 0 ? index : 0,
                        },
                    }],
                }),
            });
            return res.ok;
        } catch (_error) {
            return false;
        }
    }

    async function list() {
        const res = await fetch(ENDPOINT);
        if (!res.ok) {
            throw new Error(`trash list failed: ${res.status}`);
        }
        return res.json();
    }

    async function restore(id) {
        const res = await fetch(`${ENDPOINT}/restore`, {
            method: 'POST',
            headers: writeHeaders(),
            body: JSON.stringify({ id }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `restore failed: ${res.status}`);
        }
        return res.json();
    }

    async function remove(id) {
        const res = await fetch(ENDPOINT, {
            method: 'DELETE',
            headers: writeHeaders(),
            body: JSON.stringify({ id }),
        });
        if (!res.ok) {
            throw new Error(`delete failed: ${res.status}`);
        }
        return res.json();
    }

    async function empty() {
        const res = await fetch(ENDPOINT, {
            method: 'DELETE',
            headers: writeHeaders(),
            body: JSON.stringify({ all: true }),
        });
        if (!res.ok) {
            throw new Error(`empty failed: ${res.status}`);
        }
        return res.json();
    }

    global.DashboardTrash = { record, recordOne, recordCategory, list, restore, remove, empty };
}(typeof window !== 'undefined' ? window : globalThis));
