/**
 * What a selection of bookmarks can do, named once.
 *
 * The dashboard's selection bar and the Bookmarks view's act on the same
 * stored bookmarks, and they had grown apart: one could fetch icons and the
 * other could not open a link, and the same action had three names. Each
 * action is listed here with its label and the bars that offer it; each bar
 * draws its buttons from this list, in this order, and wires the ids to its
 * own handlers. A bar that leaves an action out is a decision made here, not
 * a gap nobody noticed (bulk-actions-parity.spec.js holds both bars to it).
 *
 * Inbox and Kept are not here: their rows are links waiting for a decision,
 * not bookmarks, and pinning or checking means nothing to them.
 */
(function () {
    'use strict';

    const DASHBOARD = 'dashboard';
    const BOOKMARKS = 'bookmarks';

    /**
     * id, label key and English, and the bars that offer it. `popup` marks the
     * actions whose button opens a popover rather than acting at once.
     */
    const ACTIONS = [
        { id: 'edit', key: 'config.bmSelEdit', label: 'Edit…', surfaces: [BOOKMARKS] },
        { id: 'move', key: 'dashboard.multiSelectMove', label: 'Move', surfaces: [DASHBOARD], popup: true },
        { id: 'tags', key: 'dashboard.multiSelectTags', label: 'Tags', surfaces: [DASHBOARD], popup: true },
        { id: 'pin', key: 'dashboard.multiSelectPin', label: 'Pin', surfaces: [DASHBOARD, BOOKMARKS] },
        { id: 'checking', key: 'dashboard.multiSelectChecking', label: 'Checking', surfaces: [DASHBOARD], popup: true },
        { id: 'open', key: 'dashboard.multiSelectOpen', label: 'Open', surfaces: [DASHBOARD, BOOKMARKS] },
        { id: 'copy', key: 'dashboard.multiSelectCopy', label: 'Copy links', surfaces: [DASHBOARD, BOOKMARKS] },
        { id: 'recheck', key: 'dashboard.healthBulkRecheck', label: 'Re-check', surfaces: [DASHBOARD, BOOKMARKS] },
        { id: 'mute', key: 'dashboard.healthBulkMute', label: 'Mute alerts', surfaces: [BOOKMARKS] },
        { id: 'icons', key: 'dashboard.bulkFetchIcons', label: 'Fetch icons', surfaces: [DASHBOARD] },
        { id: 'previews', key: 'dashboard.bulkFetchPreviews', label: 'Fetch previews', surfaces: [DASHBOARD] },
        { id: 'export', key: 'config.bulkExportCsv', label: 'Export CSV', surfaces: [DASHBOARD, BOOKMARKS] },
        { id: 'delete', key: 'config.bmDeleteN', label: 'Delete {n}', surfaces: [DASHBOARD, BOOKMARKS], danger: true },
        { id: 'clear', key: 'config.bulkClearSelection', label: 'Clear selection', surfaces: [DASHBOARD, BOOKMARKS] },
    ];

    /** The actions one bar offers, in bar order. */
    function forSurface(surface) {
        return ACTIONS.filter((a) => a.surfaces.includes(surface));
    }

    /**
     * An action's label, through the caller's translator.
     * `alt` swaps in a second wording (Unpin for Pin on a pinned selection).
     */
    function label(id, t, vars = {}, alt = null) {
        const action = ACTIONS.find((a) => a.id === id);
        if (!action) return id;
        const [key, fallback] = alt || [action.key, action.label];
        const text = typeof t === 'function' ? t(key, fallback) : fallback;
        return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), String(text || fallback));
    }

    window.BulkActions = { ACTIONS, forSurface, label, DASHBOARD, BOOKMARKS };
})();
