/**
 * Rename (to = a tag) or remove (to = null) a tag across every bookmark.
 *
 * Lifted out of Config's tags tab so the tag view can rename, merge and
 * remove the tag it shows without config being open. Merging is a rename onto
 * a tag that already exists: the server drops the duplicate it makes.
 *
 * On the server, on only the rows that carry it. The answer names the rows and
 * the tags they had, which is the undo.
 */
(function () {
    'use strict';

    const fetcher = () => (typeof nextDashFetch === 'function' ? nextDashFetch : fetch);

    function t(dash, key, fallback) {
        const v = dash?.language?.t?.(key);
        return v && v !== key ? v : fallback;
    }

    async function patchRows(pageId, updates) {
        if (!updates.length) return;
        const res = await fetcher()('/api/bookmarks', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: Number(pageId), updates }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    /**
     * @returns {Promise<boolean>} true when any bookmark changed.
     * onDone({ from, to }) runs after the change and again after an undo, so
     * the caller can reload whatever it shows.
     */
    async function rewrite(dash, from, to, { onDone = null } = {}) {
        const notify = (message, type, options = {}) => dash?.showNotification?.(message, type, { duration: 3500, ...options });
        const done = async (detail) => {
            try { await onDone?.(detail); } catch { /* the caller's reload reports its own failures */ }
        };
        try {
            const res = await fetcher()('/api/tags/rewrite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from, to: to || '' }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            const changed = Array.isArray(body.changed) ? body.changed : [];
            if (!changed.length) return false;
            const undo = new Map();
            changed.forEach((row) => {
                const pid = String(row.pageId);
                if (!undo.has(pid)) undo.set(pid, []);
                undo.get(pid).push({ url: row.url, fields: { tags: Array.isArray(row.tags) ? row.tags : [] } });
            });
            notify(to
                ? t(dash, 'config.tagRenamed', 'Tag renamed.')
                : t(dash, 'config.tagDeleted', 'Tag deleted.'), 'success', {
                duration: 8000,
                undoCallback: async () => {
                    try {
                        for (const [pageId, updates] of undo) await patchRows(pageId, updates);
                        await done({ from, to, undone: true });
                        notify(t(dash, 'config.tagRewriteUndone', 'Tags put back.'), 'success');
                    } catch {
                        notify(t(dash, 'config.bulkUndoFailed', 'Could not undo that.'), 'error');
                    }
                },
            });
            await done({ from, to, undone: false });
            return true;
        } catch {
            notify(t(dash, 'config.tagsSaveError', 'Could not update the tag.'), 'error');
            return false;
        }
    }

    window.TagRewrite = { rewrite };
})();
