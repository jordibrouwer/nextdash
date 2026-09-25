/**
 * Where a bookmark goes, in one field.
 *
 * A category belongs to exactly one page, so two selects asked one question
 * twice and let the answers disagree. The field opens the same popover as
 * Move to… on the dashboard (Shift+M): the categories under each page, the
 * current one ticked, arrows and Enter to choose. Its first two rows make
 * somewhere new, and hand off to the form's own create row -- the one the
 * two selects always had -- so creating works exactly as it did.
 *
 * The page list is read when the popover opens, not when the form does: every
 * page's categories is a request per page, and most bookmarks are filed
 * where the form already put them.
 */
(function (global) {
    'use strict';

    function mount(host, options) {
        const t = typeof options.t === 'function' ? options.t : (_k, fallback) => fallback;
        host.classList.add('bookmark-form-place-field');
        host.replaceChildren();

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'bookmark-inline-input bookmark-form-place-value';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        const triggerText = document.createElement('span');
        triggerText.className = 'bookmark-form-place-text';
        const caret = document.createElement('span');
        caret.className = 'bookmark-form-place-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '▾';
        trigger.append(triggerText, caret);
        host.appendChild(trigger);

        let pop = null;
        let cleanup = null;

        const showValue = () => {
            triggerText.textContent = options.getLabel();
        };

        const close = ({ focus = true } = {}) => {
            cleanup?.();
            cleanup = null;
            pop?.remove();
            pop = null;
            trigger.setAttribute('aria-expanded', 'false');
            if (focus && !trigger.hidden) trigger.focus({ preventScroll: true });
        };

        const item = (label, { current = false, mark = '', attrs = {} } = {}) => {
            const el = document.createElement('div');
            el.className = `move-popover-item${current ? ' is-current' : ''}`;
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', String(current));
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = current ? '✓' : mark;
            const text = document.createElement('span');
            text.textContent = label;
            el.append(check, text);
            return el;
        };

        const open = async () => {
            if (pop) return;
            const groups = await options.getGroups();
            if (pop) return;
            const value = options.getValue();
            const currentPage = groups.find((g) => String(g.pageId) === String(value.pageId));

            pop = document.createElement('div');
            pop.className = 'move-popover bookmark-form-place-pop';
            pop.setAttribute('role', 'listbox');
            pop.setAttribute('aria-label', t('config.bookmarkPlaceLabel', 'Page › category'));
            // The form's Escape handler runs first, in the capture phase; it
            // closes this through the hook rather than the whole form.
            pop.__close = () => close();

            const header = document.createElement('div');
            header.className = 'move-popover-header';
            header.textContent = t('config.bookmarkPlaceLabel', 'Page › category');
            const hint = document.createElement('div');
            hint.className = 'move-popover-current-hint';
            hint.textContent = options.getLabel();
            pop.append(header, hint);

            // Many pages, many categories: a filter at the top, the way the
            // search panel narrows a list. Arrows and Enter work from it.
            const filter = document.createElement('input');
            filter.type = 'text';
            filter.className = 'bookmark-form-place-filter';
            filter.placeholder = t('config.bookmarkPlaceFilter', 'Find a page or category…');
            filter.setAttribute('aria-label', t('config.bookmarkPlaceFilter', 'Find a page or category…'));
            pop.appendChild(filter);
            const list = document.createElement('div');
            list.className = 'bookmark-form-place-items';
            pop.appendChild(list);

            let items = [];
            let actions = [];
            let focused = -1;

            const setFocus = (idx) => {
                if (!items.length) { focused = -1; return; }
                focused = (idx + items.length) % items.length;
                items.forEach((el, n) => el.classList.toggle('is-focused', n === focused));
                items[focused].scrollIntoView({ block: 'nearest' });
            };

            const createRows = (query) => {
                const rows = [];
                const catLabel = query
                    ? t('config.bookmarkPlaceNewCategoryNamed', 'New category "{name}" on {page}…')
                        .replace('{name}', query).replace('{page}', currentPage?.pageName || '')
                    : t('config.bookmarkPlaceNewCategory', 'New category on {page}…')
                        .replace('{page}', currentPage?.pageName || '');
                const newCat = item(catLabel, { mark: '+', attrs: { 'data-place-create': 'category' } });
                newCat.classList.add('bookmark-form-place-create');
                rows.push([newCat, () => { close({ focus: false }); options.onNewCategory(query); }]);
                const newPage = item(t('config.bookmarkPlaceNewPage', 'New page…'),
                    { mark: '+', attrs: { 'data-place-create': 'page' } });
                newPage.classList.add('bookmark-form-place-create');
                rows.push([newPage, () => { close({ focus: false }); options.onNewPage(); }]);
                return rows;
            };

            const render = () => {
                const q = filter.value.trim();
                const ql = q.toLowerCase();
                list.replaceChildren();
                items = [];
                actions = [];
                const add = (el, action) => { list.appendChild(el); items.push(el); actions.push(action); };

                // Without a query the ways to make somewhere new come first, as
                // the two selects had them; with one, the matches do.
                if (!q) createRows('').forEach(([el, action]) => add(el, action));

                let exact = false;
                groups.forEach((g) => {
                    const pageHit = String(g.pageName).toLowerCase().includes(ql);
                    const cats = g.categories.filter((c) => !ql || pageHit || String(c.name).toLowerCase().includes(ql));
                    g.categories.forEach((c) => { if (ql && String(c.name).toLowerCase() === ql) exact = true; });
                    if (!cats.length) return;
                    const divider = document.createElement('div');
                    divider.className = 'move-popover-divider';
                    const label = document.createElement('div');
                    label.className = 'move-popover-section-label';
                    label.textContent = g.pageName;
                    list.append(divider, label);
                    cats.forEach((c) => {
                        const current = String(g.pageId) === String(value.pageId)
                            && String(c.id) === String(value.categoryId);
                        const el = item(c.name, { current, attrs: { 'data-page-id': String(g.pageId), 'data-category-id': String(c.id) } });
                        el.classList.add('bookmark-form-place-option');
                        add(el, async () => {
                            await options.onPick(g.pageId, c.id);
                            showValue();
                            close();
                        });
                    });
                });

                if (q) {
                    const divider = document.createElement('div');
                    divider.className = 'move-popover-divider';
                    list.appendChild(divider);
                    createRows(exact ? '' : q).forEach(([el, action]) => add(el, action));
                }

                items.forEach((el, n) => {
                    el.addEventListener('mouseenter', () => setFocus(n));
                    el.addEventListener('mousedown', (e) => e.preventDefault());
                    el.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void actions[n]();
                    });
                });
                focused = q ? -1 : items.findIndex((el) => el.classList.contains('is-current'));
                if (focused >= 0) setFocus(focused);
            };
            filter.addEventListener('input', render);
            render();

            document.body.appendChild(pop);
            const rect = trigger.getBoundingClientRect();
            pop.style.minWidth = `${Math.round(rect.width)}px`;
            pop.style.left = `${Math.round(rect.left)}px`;
            const below = window.innerHeight - rect.bottom;
            if (below < 240 && rect.top > below) {
                pop.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
            } else {
                pop.style.top = `${Math.round(rect.bottom + 4)}px`;
            }
            trigger.setAttribute('aria-expanded', 'true');

            filter.focus({ preventScroll: true });
            const onKey = (e) => {
                if (!pop) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focused + 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focused - 1); }
                else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    // Nothing highlighted and one match: that is the one meant.
                    const options = items.filter((el) => el.classList.contains('bookmark-form-place-option'));
                    const idx = focused >= 0 ? focused : (options.length === 1 ? items.indexOf(options[0]) : -1);
                    if (idx >= 0) void actions[idx]();
                }
                else if (e.key === 'Tab') { close({ focus: false }); }
            };
            const onOutside = (e) => {
                if (pop?.contains(e.target) || trigger.contains(e.target)) return;
                close({ focus: false });
            };
            document.addEventListener('keydown', onKey, true);
            setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
            cleanup = () => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('pointerdown', onOutside, true);
            };
        };

        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            if (pop) close();
            else void open();
        });
        trigger.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !pop) {
                e.preventDefault();
                void open();
            }
        });

        showValue();
        return {
            open: () => { void open(); },
            refresh: showValue,
            close: () => close({ focus: false }),
            isOpen: () => Boolean(pop),
            hideTrigger: () => { trigger.hidden = true; },
            showTrigger: ({ focus = true } = {}) => {
                trigger.hidden = false;
                showValue();
                if (focus) trigger.focus({ preventScroll: true });
            },
        };
    }

    global.BookmarkFormPlace = { mount };
}(window));
