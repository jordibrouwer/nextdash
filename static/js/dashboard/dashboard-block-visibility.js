/**
 * Where a block shows: on every screen, on desktop only, or on a phone only.
 *
 * Stored as `visibleOn` ("desktop" | "mobile" | absent) on a category, a widget
 * and a custom collection; the built-in and per-tag collections have no record
 * of their own, so theirs live in settings.collectionVisibleOn by block id.
 *
 * "Here" is the phone layout (touch, 768px or narrower). A tablet counts as a
 * desktop. Edit mode is never filtered: a block hidden on this screen stays on
 * the grid, dimmed and labelled, so nothing gets lost while editing.
 */
(function () {
    'use strict';

    const MODES = ['all', 'desktop', 'mobile'];

    function isPhone() {
        return window.MobileExperience?.isPhoneLayout?.() === true;
    }

    function normalize(value) {
        return value === 'desktop' || value === 'mobile' ? value : 'all';
    }

    function isCollectionId(id) {
        return /^(__smart_|custom:|tag:)/.test(String(id ?? ''));
    }

    /** The stored answer for a block id: 'all' | 'desktop' | 'mobile'. */
    function get(dash, id) {
        const key = String(id ?? '');
        if (key.startsWith('custom:')) {
            const col = (dash?.settings?.collections || []).find((c) => `custom:${c.id}` === key);
            return normalize(col?.visibleOn);
        }
        if (isCollectionId(key)) return normalize(dash?.settings?.collectionVisibleOn?.[key]);
        const widget = (dash?.widgets || []).find((w) => String(w?.id) === key);
        if (widget) return normalize(widget.visibleOn);
        const category = (dash?.categories || []).find((c) => String(c.id) === key);
        return normalize(category?.visibleOn);
    }

    /** Whether a stored answer shows on this screen. */
    function shownHere(mode) {
        const m = normalize(mode);
        if (m === 'all') return true;
        return m === 'mobile' ? isPhone() : !isPhone();
    }

    function editing() {
        return document.body?.getAttribute('data-edit-mode') === 'on';
    }

    /** Whether the grid draws this block: shown here, or edit mode is on. */
    function drawn(dash, id) {
        return editing() || shownHere(get(dash, id));
    }

    /** Write the data-attributes the stylesheet dims by, and the label as a real element. */
    function mark(dash, el, id) {
        const mode = get(dash, id);
        el.querySelectorAll(':scope > .visible-on-badge').forEach((node) => node.remove());
        if (mode === 'all') {
            el.removeAttribute('data-visible-on');
            el.removeAttribute('data-visible-here');
            return;
        }
        const here = shownHere(mode);
        el.setAttribute('data-visible-on', mode);
        el.setAttribute('data-visible-here', String(here));
        if (here) return;
        const t = (key, fallback) => {
            const v = dash?.language?.t?.(key);
            return v && v !== key ? v : fallback;
        };
        // A node of its own, not ::after: several themes draw their frame there.
        const badge = document.createElement('span');
        badge.className = 'visible-on-badge';
        badge.textContent = mode === 'mobile'
            ? t('editMode.hiddenOnDesktop', 'Hidden on desktop')
            : t('editMode.hiddenOnPhone', 'Hidden on phone');
        el.appendChild(badge);
    }

    /** Store a new answer for a block and save it; false when the save failed. */
    async function set(dash, id, mode) {
        const ok = await write(dash, id, mode);
        // The grid may keep its blocks (an incremental redraw reuses them): mark the live one.
        if (ok) {
            document.querySelectorAll('#dashboard-layout .category[data-category-id]').forEach((el) => {
                if (el.getAttribute('data-category-id') === String(id)) mark(dash, el, id);
            });
        }
        return ok;
    }

    async function write(dash, id, mode) {
        const key = String(id ?? '');
        const next = normalize(mode);
        const stored = next === 'all' ? undefined : next;
        const rc = dash.renderCore;
        if (key.startsWith('custom:')) {
            const col = (dash.settings.collections || []).find((c) => `custom:${c.id}` === key);
            if (!col) return false;
            const previous = col.visibleOn;
            if (stored) col.visibleOn = stored; else delete col.visibleOn;
            if (await dash.saveSettings?.() === false) {
                if (previous) col.visibleOn = previous; else delete col.visibleOn;
                return false;
            }
            return true;
        }
        if (isCollectionId(key)) {
            const before = { ...(dash.settings.collectionVisibleOn || {}) };
            const after = { ...before };
            if (stored) after[key] = stored; else delete after[key];
            dash.settings.collectionVisibleOn = after;
            if (await dash.saveSettings?.() === false) {
                dash.settings.collectionVisibleOn = before;
                return false;
            }
            return true;
        }
        const widget = (dash.widgets || []).find((w) => String(w?.id) === key);
        if (widget) {
            return (await rc?.saveWidgetPatch?.(key, { visibleOn: stored ?? '' })) === true;
        }
        const category = (dash.categories || []).find((c) => String(c.id) === key);
        if (!category) return false;
        const previous = category.visibleOn;
        if (stored) category.visibleOn = stored; else delete category.visibleOn;
        if (await rc?.saveCategoryOrder?.() === false) {
            if (previous) category.visibleOn = previous; else delete category.visibleOn;
            return false;
        }
        return true;
    }

    /** Whether any block on this page, or any collection, is limited to one kind of screen. */
    function anySet(dash) {
        if ((dash?.categories || []).some((c) => normalize(c.visibleOn) !== 'all')) return true;
        if ((dash?.widgets || []).some((w) => normalize(w.visibleOn) !== 'all')) return true;
        if ((dash?.settings?.collections || []).some((c) => normalize(c.visibleOn) !== 'all')) return true;
        return Object.keys(dash?.settings?.collectionVisibleOn || {}).length > 0;
    }

    /** Redraw the grid when what is drawn depends on a filter that just changed. */
    function refresh(dash) {
        if (typeof dash?.isBookmarksView === 'function' && !dash.isBookmarksView()) return;
        if (anySet(dash)) dash.renderDashboard?.({ animate: false });
    }

    window.DashboardBlockVisibility = { anySet, refresh, MODES, normalize, get, set, shownHere, drawn, mark, isPhone };
})();
