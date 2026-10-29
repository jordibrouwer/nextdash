/**
 * How the widgets on the dashboard are doing, as far as this session has seen.
 *
 * A widget that fetches from a service reports here each time it gets an
 * answer: a failure, an answer with nothing in it, or an answer that is fine.
 * The checkup reads the list. Nothing is stored: a widget on a page that has
 * not been shown yet has not asked yet, so it is not in the list, and what is
 * there is what the dashboard saw now, not a history.
 */
(function (global) {
    'use strict';

    const states = new Map();

    /** `meta` is what the checkup names the widget by: its title and the page it is on. */
    function set(widgetId, state, reason, meta) {
        if (!widgetId) return;
        states.set(String(widgetId), {
            state,
            reason: reason ? String(reason) : '',
            title: meta?.title ? String(meta.title) : '',
            pageId: meta?.pageId ?? null,
        });
    }

    function clear(widgetId) {
        states.delete(String(widgetId));
    }

    /** The widgets that are not fine, by id. */
    function snapshot() {
        return [...states.entries()]
            .filter(([, entry]) => entry.state === 'error' || entry.state === 'empty')
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([widgetId, entry]) => ({ widgetId, state: entry.state, reason: entry.reason, title: entry.title, pageId: entry.pageId }));
    }

    /**
     * Report from a server answer: none at all, an error, nothing in it, or
     * something. Stale items under an error are still an error: the widget is
     * showing what it had, not what is there.
     *
     * Nothing in the answer is a fault only where it means "set up wrong" (a
     * feed with no headlines, a custom widget with no values): `emptyIsError`.
     * Elsewhere it is a normal state -- nothing queued, nothing playing, no
     * events this week -- and the widget is fine.
     */
    function fromResult(widgetId, result, items, meta = {}) {
        if (!result) return set(widgetId, 'error', 'no answer', meta);
        if (result.error) return set(widgetId, 'error', result.error, meta);
        if (meta.emptyIsError && (!Array.isArray(items) || items.length === 0)) return set(widgetId, 'empty', '', meta);
        return set(widgetId, 'ok', '', meta);
    }

    /** What a widget reports about itself along with its answer. */
    function meta(widget, pageId, emptyIsError) {
        return { title: widget?.title || widget?.type || '', pageId, emptyIsError: Boolean(emptyIsError) };
    }

    global.WidgetState = { set, clear, snapshot, fromResult, meta };
})(window);
