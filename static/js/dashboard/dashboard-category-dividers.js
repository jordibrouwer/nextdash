/**
 * Divider labels inside a category ("Beheer", "Media").
 *
 * A divider is not a bookmark. It lives on its category (`category.dividers`,
 * [{ id, name, index, before }]): drawn above the bookmark whose address is in
 * `before` (empty: below the last one), and at slot `index` when that bookmark
 * is no longer in the category. The anchor keeps a label with its group when a
 * bookmark above it is deleted, pinned or moved away. The bookmark list never
 * sees a divider, so no count, search, check or export can pick one up.
 *
 * The rows are drawn first and the dividers are put between them afterwards
 * (decorate), from both render paths. After a drag the slots are read back from
 * the DOM (syncFromDom): a bookmark dragged across a divider changes group.
 * Dividers show only in manual order; a sorted category hides them.
 */
(function () {
    const MAX_DIVIDERS = 50;
    const MAX_NAME = 80;
    const LIST_SELECTOR = '.bookmarks-list[data-category-id]';

    function tr(dash, key, fallback, params) {
        const out = dash?.language?.t?.(key, params);
        if (out && out !== key) {
            return params ? String(out).replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m)) : out;
        }
        return params ? String(fallback).replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m)) : fallback;
    }

    function categoryOf(dash, categoryId) {
        return (dash.categories || []).find((c) => String(c.id) === String(categoryId)) || null;
    }

    function dividersOf(dash, categoryId) {
        const cat = categoryOf(dash, categoryId);
        return cat && Array.isArray(cat.dividers) ? cat.dividers : [];
    }

    /* The list is replaced, never edited in place: the page cache holds the same array. */
    function setDividers(dash, categoryId, next) {
        const cat = categoryOf(dash, categoryId);
        if (!cat) return false;
        const list = next
            .map((d) => ({ id: String(d.id), name: String(d.name), index: Math.max(0, Number(d.index) || 0), before: String(d.before || '') }))
            .sort((a, b) => a.index - b.index);
        if (list.length) cat.dividers = list;
        else delete cat.dividers;
        dash.renderCore?.scheduleCategoryOrderSave?.();
        return true;
    }

    function isManualOrder(dash, categoryId) {
        const mode = window.DashboardCategorySort?.getCategorySortMode?.(dash, { id: categoryId }) || 'order';
        return mode === 'order';
    }

    function isEditableList(list) {
        return Boolean(list) && list.getAttribute('data-smart-collection') !== 'true';
    }

    function rowsOf(list) {
        return [...list.querySelectorAll('.bookmark-link')];
    }

    function rowKey(row) {
        return row ? String(row.getAttribute('data-bookmark-url') || '') : '';
    }

    /* Where a divider stands among the rows: by its anchor when that is still here, else by its saved slot. */
    function slotFor(rows, divider) {
        if (divider.before) {
            let best = -1;
            rows.forEach((row, i) => {
                if (rowKey(row) === divider.before && (best < 0 || Math.abs(i - divider.index) < Math.abs(best - divider.index))) best = i;
            });
            if (best >= 0) return best;
        }
        return Math.min(Math.max(0, divider.index), rows.length);
    }

    /* Below the rows but above "+ N more" and the empty-state text. */
    function endPoint(list) {
        return list.querySelector(':scope > .category-show-more, :scope > .empty-state--category, :scope > .smart-collection-empty');
    }

    function newId(existing) {
        const taken = new Set(existing.map((d) => String(d.id)));
        for (let n = 1; ; n++) {
            const id = `d${Date.now().toString(36)}${n}`;
            if (!taken.has(id)) return id;
        }
    }

    function buildElement(dash, categoryId, divider) {
        const el = document.createElement('div');
        el.className = 'category-divider';
        el.setAttribute('data-divider-id', divider.id);
        el.setAttribute('data-category-id', categoryId);
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', divider.name);
        el.tabIndex = 0;
        const label = document.createElement('span');
        label.className = 'category-divider-label';
        label.textContent = divider.name;
        el.appendChild(label);
        return el;
    }

    /** Put the dividers of every manual-order category between its rows. */
    function decorate(dash, root) {
        const scope = root || document.getElementById('dashboard-layout') || document;
        scope.querySelectorAll(LIST_SELECTOR).forEach((list) => {
            list.querySelectorAll(':scope > .category-divider').forEach((n) => n.remove());
            if (!isEditableList(list)) return;
            const categoryId = list.getAttribute('data-category-id') || '';
            if (!isManualOrder(dash, categoryId)) return;
            const dividers = dividersOf(dash, categoryId);
            if (!dividers.length) return;
            const rows = rowsOf(list);
            dividers.forEach((divider) => {
                const el = buildElement(dash, categoryId, divider);
                const at = slotFor(rows, divider);
                const anchor = rows[at];
                if (anchor && anchor.parentNode === list) {
                    list.insertBefore(el, anchor);
                    // Above a row the "+ N more" limit hides, the label goes too.
                    if (anchor.classList.contains('is-overflow-hidden')) el.classList.add('is-overflow-hidden');
                } else {
                    list.insertBefore(el, endPoint(list));
                }
            });
        });
    }

    /** Read the slots back from the screen after a drag moved rows across dividers. */
    function syncFromDom(dash) {
        let changed = false;
        document.querySelectorAll(LIST_SELECTOR).forEach((list) => {
            if (!isEditableList(list)) return;
            const categoryId = list.getAttribute('data-category-id') || '';
            if (!isManualOrder(dash, categoryId)) return;
            const stored = dividersOf(dash, categoryId);
            if (!stored.length) return;
            let rows = 0;
            const slots = new Map();
            const kids = [...list.children];
            kids.forEach((child, at) => {
                if (child.classList.contains('bookmark-link')) {
                    rows += 1;
                } else if (child.classList.contains('category-divider')) {
                    const below = kids.slice(at + 1).find((n) => n.classList.contains('bookmark-link'));
                    slots.set(child.getAttribute('data-divider-id'), { index: rows, before: rowKey(below) });
                }
            });
            const next = stored.map((d) => (slots.has(d.id) ? { ...d, ...slots.get(d.id) } : d));
            if (next.some((d, i) => d.index !== stored[i].index || (d.before || '') !== (stored[i].before || ''))) {
                setDividers(dash, categoryId, next);
                changed = true;
            }
        });
        return changed;
    }

    function redraw(dash, categoryId) {
        const list = document.querySelector(`${LIST_SELECTOR}[data-category-id="${CSS.escape(String(categoryId))}"]`);
        if (list) decorate(dash, list.parentElement || undefined);
        dash.initializeCategoryReorder?.();
    }

    function add(dash, categoryId, index) {
        if (dash.settings?.lockLayout) return null;
        const dividers = dividersOf(dash, categoryId);
        if (dividers.length >= MAX_DIVIDERS) {
            dash.showNotification?.(tr(dash, 'dashboard.dividerLimit', 'A category can hold {n} labels.', { n: MAX_DIVIDERS }), 'info');
            return null;
        }
        const list = document.querySelector(`${LIST_SELECTOR}[data-category-id="${CSS.escape(String(categoryId))}"]`);
        if (!list || !isManualOrder(dash, categoryId)) return null;
        const rows = rowsOf(list);
        const slot = index == null ? rows.length : Math.min(Math.max(0, index), rows.length);
        // A draft: on the screen only. It is stored when the name is confirmed,
        // so a re-render or a closed tab never keeps a label nobody named.
        const draft = { id: newId(dividers), name: '', index: slot, before: rowKey(rows[slot]) };
        const el = buildElement(dash, categoryId, { ...draft, name: tr(dash, 'dashboard.dividerNew', 'New label') });
        const anchor = rows[slot];
        if (anchor && anchor.parentNode === list) list.insertBefore(el, anchor);
        else list.insertBefore(el, endPoint(list));
        window.nextdashTrack?.('divider:add');
        el.scrollIntoView?.({ block: 'nearest' });
        startRename(dash, el, { draft });
        return draft.id;
    }

    function startRename(dash, el, options = {}) {
        if (dash.settings?.lockLayout || el.querySelector('input')) return;
        const categoryId = el.getAttribute('data-category-id') || '';
        const id = el.getAttribute('data-divider-id') || '';
        const current = options.draft || dividersOf(dash, categoryId).find((d) => d.id === id);
        if (!current) return;
        const label = el.querySelector('.category-divider-label');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-divider-input';
        input.maxLength = MAX_NAME;
        input.value = options.draft ? '' : current.name;
        if (options.draft) input.placeholder = tr(dash, 'dashboard.dividerNew', 'New label');
        input.setAttribute('aria-label', tr(dash, 'dashboard.dividerRename', 'Label name'));
        label.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (commit) => {
            if (done) return;
            done = true;
            const value = input.value.trim();
            const rest = dividersOf(dash, categoryId).filter((d) => d.id !== id);
            if (commit && value) {
                setDividers(dash, categoryId, [...rest, { ...current, name: value.slice(0, MAX_NAME) }]);
            }
            // A draft with no name was never stored, so there is nothing to undo.
            redraw(dash, categoryId);
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
    }

    function move(dash, el, delta) {
        if (dash.settings?.lockLayout) return;
        const categoryId = el.getAttribute('data-category-id') || '';
        const id = el.getAttribute('data-divider-id') || '';
        const list = el.parentElement;
        const total = list ? rowsOf(list).length : 0;
        const stored = dividersOf(dash, categoryId);
        const current = stored.find((d) => d.id === id);
        if (!current) return;
        const drawn = slotFor(list ? rowsOf(list) : [], current);
        const index = Math.min(total, Math.max(0, drawn + delta));
        if (index === drawn) return;
        const rows = list ? rowsOf(list) : [];
        // Rows only, in order: index counts them, the label itself is not one.
        setDividers(dash, categoryId, stored.map((d) => (d.id === id ? { ...d, index, before: rowKey(rows[index]) } : d)));
        redraw(dash, categoryId);
        document.querySelector(`.category-divider[data-divider-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    }

    function remove(dash, el) {
        if (dash.settings?.lockLayout) return;
        const categoryId = el.getAttribute('data-category-id') || '';
        const id = el.getAttribute('data-divider-id') || '';
        const pageId = String(dash.currentPageId);
        const before = dividersOf(dash, categoryId).map((d) => ({ ...d }));
        const gone = before.find((d) => d.id === id);
        if (!gone) return;
        setDividers(dash, categoryId, before.filter((d) => d.id !== id));
        window.nextdashTrack?.('divider:delete');
        redraw(dash, categoryId);
        dash.showNotification?.(tr(dash, 'dashboard.dividerDeleted', 'Label deleted.'), 'success', {
            duration: 8000,
            undoCallback: async () => {
                // Category ids repeat across pages: only put them back where they were.
                if (String(dash.currentPageId) !== pageId) return;
                setDividers(dash, categoryId, before);
                redraw(dash, categoryId);
            },
        });
    }

    function openMenu(dash, el, point) {
        if (dash.settings?.lockLayout) return;
        const menu = dash.categoryMenu;
        if (!menu?._openMenu) return;
        const name = el.querySelector('.category-divider-label')?.textContent || '';
        menu._openMenu({
            id: 'category-divider-menu',
            ariaLabel: tr(dash, 'dashboard.dividerMenuTitle', 'Label actions'),
            hint: name || '—',
            point,
            entries: [
                { id: 'rename', label: tr(dash, 'categoryMenuRename', 'Rename'), icon: '✎', key: 'F2' },
                { id: 'up', label: tr(dash, 'dashboard.dividerMoveUp', 'Move up'), icon: '↑', key: 'Alt+↑' },
                { id: 'down', label: tr(dash, 'dashboard.dividerMoveDown', 'Move down'), icon: '↓', key: 'Alt+↓' },
                { id: 'delete', label: tr(dash, 'categoryMenuDelete', 'Delete'), icon: '✕', danger: true, key: 'Delete' },
            ],
            onPick: (action) => {
                if (action === 'rename') startRename(dash, el);
                else if (action === 'up') move(dash, el, -1);
                else if (action === 'down') move(dash, el, 1);
                else if (action === 'delete') remove(dash, el);
            },
        });
    }

    /** The slot above a bookmark row, or null where a label cannot stand (smart collection, sorted category). */
    function slotAbove(dash, row) {
        if (dash.settings?.lockLayout) return null;
        const list = row?.closest?.(LIST_SELECTOR);
        if (!isEditableList(list)) return null;
        const categoryId = list.getAttribute('data-category-id') || '';
        if (!categoryOf(dash, categoryId) || !isManualOrder(dash, categoryId)) return null;
        const at = rowsOf(list).indexOf(row);
        return at < 0 ? null : { categoryId, index: at };
    }

    function bind(dash) {
        const layout = document.getElementById('dashboard-layout');
        if (!layout || layout._dividerBound) return;
        layout._dividerBound = true;
        const find = (e) => e.target?.closest?.('.category-divider');
        // "+ N more" shows or hides rows after the labels were placed.
        layout.addEventListener('click', (e) => {
            const more = e.target?.closest?.('.category-show-more');
            if (more) setTimeout(() => decorate(dash, more.closest('.category') || undefined), 0);
        });
        layout.addEventListener('click', (e) => {
            const el = find(e);
            if (el && !e.target.closest('input')) startRename(dash, el);
        });
        layout.addEventListener('contextmenu', (e) => {
            const el = find(e);
            if (!el) return;
            e.preventDefault();
            openMenu(dash, el, { x: e.clientX, y: e.clientY });
        });
        layout.addEventListener('keydown', (e) => {
            const el = find(e);
            if (!el || e.target.closest('input')) return;
            if (e.key === 'F2') { e.preventDefault(); startRename(dash, el); }
            else if (e.key === 'Delete') { e.preventDefault(); remove(dash, el); }
            else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(dash, el, -1); }
            else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(dash, el, 1); }
        });
    }

        /** Whether the category menu may offer Add label for this category. */
    function canAdd(dash, categoryId) {
        return !dash.settings?.lockLayout && Boolean(categoryOf(dash, categoryId)) && isManualOrder(dash, categoryId);
    }

    window.DashboardCategoryDividers = { decorate, syncFromDom, add, slotAbove, canAdd, bind, redraw };
})();
