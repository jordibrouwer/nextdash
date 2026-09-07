'use strict';

/**
 * The chrome shared by the list views: a sticky header, a rail carrying summary
 * figures and filters, one toolbar row, and a body the view repaints.
 *
 * The split matters more than the markup. A view rebuilding its whole container
 * on every keystroke has to put the caret back by hand; a view that repaints
 * only `handle.body` does not.
 */
const TONE_CLASS = { good: 'lvs-tone-good', warn: 'lvs-tone-warn', bad: 'lvs-tone-bad' };

/**
 * The one breakpoint every view folds at, matching config-view.css:83.
 * Below it the rail is a horizontal strip and the summary moves into the
 * header, so the strip carries filters only.
 */
const NARROW = '(max-width: 720px)';

/** Group headings need ids for aria-labelledby, and two shells can coexist. */
let groupSeq = 0;

function toneClass(tone) {
    return TONE_CLASS[tone] || '';
}

function buildSummary(entries) {
    const wrap = document.createElement('div');
    wrap.className = 'lvs-summary';
    (entries || []).forEach((entry) => {
        const row = document.createElement('div');
        row.className = ['lvs-summary-row', toneClass(entry.tone)].filter(Boolean).join(' ');
        row.dataset.lvsSummaryKey = String(entry.key);
        const label = document.createElement('span');
        label.className = 'lvs-summary-label';
        label.textContent = String(entry.label);
        const value = document.createElement('span');
        value.className = 'lvs-summary-value';
        value.textContent = String(entry.value);
        row.append(label, value);
        wrap.appendChild(row);
    });
    return wrap;
}

function buildFilter(entry, isActive, classes = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = ['lvs-filter', classes.filterClass, toneClass(entry.tone),
        isActive ? 'is-active' : ''].filter(Boolean).join(' ');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(isActive));
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
    btn.dataset.lvsFilterKey = String(entry.key);
    Object.entries(entry.dataAttrs || {}).forEach(([name, value]) => {
        btn.setAttribute(name, String(value));
    });
    const label = document.createElement('span');
    label.className = 'lvs-filter-label';
    label.textContent = String(entry.label);
    const count = document.createElement('span');
    count.className = ['lvs-filter-count', classes.filterCountClass].filter(Boolean).join(' ');
    count.textContent = String(entry.count ?? '');
    btn.append(label, count);
    return btn;
}

class ListViewShell {
    static mount(container, config = {}) {
        if (!container) {
            throw new Error('ListViewShell.mount needs a container');
        }
        const id = String(config.id || 'view');
        const t = typeof config.t === 'function'
            ? config.t
            : (key, fallback) => fallback;

        const root = document.createElement('div');
        root.className = 'lvs';

        const header = document.createElement('div');
        header.className = 'lvs-header';
        const headerText = document.createElement('div');
        headerText.className = 'lvs-header-text';
        const title = document.createElement('h2');
        title.className = 'lvs-title';
        title.textContent = String(config.title || '');
        const description = document.createElement('p');
        description.className = 'lvs-description';
        description.textContent = String(config.description || '');
        headerText.append(title, description);
        const crumb = document.createElement('span');
        crumb.className = 'lvs-crumb';
        crumb.textContent = '';
        headerText.appendChild(crumb);

        const headerActions = document.createElement('div');
        headerActions.className = 'lvs-header-actions';
        (config.actions || []).forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            // `overflow` marks the ⋯ trigger. It is not a secondary action —
            // it is where the secondary actions go when the header narrows, so
            // it is the one thing besides the primary that must stay put.
            const kindClass = { primary: 'lvs-action--primary', overflow: 'lvs-action--overflow' };
            btn.className = ['lvs-action', kindClass[action.kind] || ''].filter(Boolean).join(' ');
            btn.dataset.lvsActionKey = String(action.key);
            btn.textContent = String(action.label);
            Object.entries(action.dataAttrs || {}).forEach(([name, value]) => {
                btn.setAttribute(name, String(value));
            });
            if (typeof action.onClick === 'function') {
                btn.addEventListener('click', action.onClick);
            }
            headerActions.appendChild(btn);
        });
        header.append(headerText, headerActions);

        const rail = document.createElement('div');
        rail.className = 'lvs-rail';

        const summaryHost = buildSummary(config.summary);
        rail.appendChild(summaryHost);

        // The heading is a sibling of the tablist, not a child of it: a
        // `role="tablist"` accepts only `tab` children, and a plain div in
        // there makes the whole strip invalid to a screen reader. The heading
        // names the strip through aria-labelledby instead.
        const filterGroup = document.createElement('div');
        filterGroup.className = 'lvs-group lvs-group--filters';
        let activeKey = String(config.activeFilter || (config.filters?.[0]?.key ?? ''));
        const filterClasses = {
            filterClass: config.filterClass,
            filterCountClass: config.filterCountClass,
        };
        const filterTitle = document.createElement('div');
        filterTitle.className = 'lvs-group-title';
        filterTitle.id = `lvs-filters-title-${++groupSeq}`;
        filterTitle.textContent = t('dashboard.listFilterHeading', 'Filter');
        const filterList = document.createElement('div');
        filterList.className = 'lvs-group-list lvs-filter-list';
        filterList.setAttribute('role', 'tablist');
        filterList.setAttribute('aria-labelledby', filterTitle.id);
        filterGroup.append(filterTitle, filterList);
        (config.filters || []).forEach((entry) => {
            filterList.appendChild(
                buildFilter(entry, String(entry.key) === activeKey, filterClasses));
        });
        rail.appendChild(filterGroup);

        if ((config.sections || []).length) {
            const sectionGroup = document.createElement('div');
            sectionGroup.className = 'lvs-group lvs-group--sections';
            const sectionTitle = document.createElement('div');
            sectionTitle.className = 'lvs-group-title';
            sectionTitle.textContent = t('dashboard.listSectionHeading', 'Sections');
            const sectionList = document.createElement('div');
            sectionList.className = 'lvs-group-list lvs-section-list';
            sectionGroup.append(sectionTitle, sectionList);
            (config.sections || []).forEach((entry) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'lvs-section';
                item.dataset.lvsSectionKey = String(entry.key);
                item.textContent = entry.count == null
                    ? String(entry.label)
                    : `${entry.label} ${entry.count}`;
                sectionList.appendChild(item);
            });
            rail.appendChild(sectionGroup);
        }

        const filterButtons = () => [...filterGroup.querySelectorAll('.lvs-filter')];

        /**
         * The rows the arrow keys may land on.
         *
         * A view hides a filter nothing is in (inbox's Snoozed at zero count,
         * and eleven of health's are about to work the same way). Rotating over
         * the hidden ones let ArrowRight select a row the mouse cannot see,
         * which then unhid itself — the keyboard reaching past the filter.
         */
        const visibleFilterButtons = () => {
            const shown = filterButtons().filter((btn) => !btn.hidden);
            return shown.length ? shown : filterButtons();
        };

        const setActive = (key) => {
            activeKey = String(key);
            filterButtons().forEach((btn) => {
                const on = btn.dataset.lvsFilterKey === activeKey;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', String(on));
                btn.setAttribute('tabindex', on ? '0' : '-1');
            });
        };

        const report = (key, via) => {
            if (typeof config.onFilter === 'function') {
                config.onFilter(key, via);
            }
        };

        filterGroup.addEventListener('click', (event) => {
            const btn = event.target.closest('.lvs-filter');
            if (btn && filterGroup.contains(btn)) {
                report(btn.dataset.lvsFilterKey, 'click');
            }
        });

        filterGroup.addEventListener('keydown', (event) => {
            const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            const buttons = visibleFilterButtons();
            const current = buttons.indexOf(event.target.closest('.lvs-filter'));
            if (current < 0) return;
            event.preventDefault();
            let next = current;
            if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
            if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            const targetKey = buttons[next].dataset.lvsFilterKey;
            report(targetKey, 'keyboard');
            // setActive() and setCounts() mutate the existing filter buttons in
            // place rather than replacing them, so the node picked above is
            // still the right one after the view's onFilter handler re-renders.
            // Re-query by key anyway in case that ever stops being true — a
            // stale, disconnected node must never eat the focus.
            let target = buttons[next];
            if (!target.isConnected) {
                target = filterButtons().find((btn) => btn.dataset.lvsFilterKey === targetKey);
            }
            target?.focus();
        });

        const main = document.createElement('div');
        main.className = 'lvs-main';
        const toolbar = document.createElement('div');
        toolbar.className = 'lvs-toolbar';
        // The view owns the slot, not the row: it fills its slot with
        // innerHTML, and shell-owned controls beside it must survive that.
        const toolbarSlot = document.createElement('div');
        toolbarSlot.className = 'lvs-toolbar-slot';
        toolbar.appendChild(toolbarSlot);
        const body = document.createElement('div');
        body.className = 'lvs-body';
        main.append(toolbar, body);

        // Appended to the row, not the slot: a view clears its slot with
        // innerHTML and must not be able to wipe a shell-owned control.
        if (config.density && window.ListDensity) {
            const group = document.createElement('div');
            group.className = 'lvs-density';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', t('dashboard.listDensityGroup', 'Row density'));
            const current = () => window.ListDensity.get();
            const buttons = ['compact', 'comfortable'].map((value) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lvs-density-btn';
                btn.setAttribute('data-lvs-density', value);
                btn.setAttribute('aria-pressed', String(current() === value));
                btn.setAttribute('aria-label', value === 'compact'
                    ? t('dashboard.listDensityCompact', 'Compact rows')
                    : t('dashboard.listDensityComfortable', 'Comfortable rows'));
                btn.textContent = value === 'compact' ? '≡' : '☰';
                btn.addEventListener('click', () => {
                    window.ListDensity.set(value);
                    buttons.forEach((b) => b.setAttribute(
                        'aria-pressed', String(b.getAttribute('data-lvs-density') === value)));
                });
                group.appendChild(btn);
                return btn;
            });
            toolbar.appendChild(group);
        }

        root.append(header, rail, main);
        container.appendChild(root);
        container.classList.add('lvs-host');
        container.setAttribute('data-lvs-id', id);

        // The rail sticks below the header rather than under it, so the header's
        // measured height is published as a custom property the CSS reads. It
        // only changes when the header collapses, which is where it is refreshed.
        const syncHeaderHeight = () => {
            root.style.setProperty('--lvs-header-height', `${Math.round(header.offsetHeight)}px`);
        };

        let collapsed = false;
        const syncCollapse = () => {
            const should = window.scrollY > header.offsetHeight;
            if (should === collapsed) return;
            collapsed = should;
            header.classList.toggle('is-collapsed', collapsed);
            syncHeaderHeight();
        };
        window.addEventListener('scroll', syncCollapse, { passive: true });
        syncCollapse();
        syncHeaderHeight();

        /**
         * Below 720px the rail is a horizontal strip, and a strip has no room
         * for the summary block — so the summary folds into the header, under
         * the description, exactly as the design describes. CSS cannot reparent,
         * so the move is made here and undone on the way back up.
         */
        const narrow = window.matchMedia(NARROW);
        const placeSummary = () => {
            if (narrow.matches) {
                if (summaryHost.parentNode !== headerText) headerText.appendChild(summaryHost);
            } else if (summaryHost.parentNode !== rail) {
                rail.insertBefore(summaryHost, rail.firstChild);
            }
            syncHeaderHeight();
        };
        narrow.addEventListener('change', placeSummary);
        // And on resize as well: under Chromium's viewport emulation — which is
        // what Playwright's setViewportSize and the browser devtools both use —
        // the media query re-evaluates but its `change` event does not always
        // fire, and the summary would then be left on the wrong side of the
        // breakpoint. placeSummary is idempotent, so running it twice costs
        // nothing.
        window.addEventListener('resize', placeSummary);
        placeSummary();

        return {
            id,
            root,
            header,
            headerActions,
            rail,
            toolbarRow: toolbar,
            toolbar: toolbarSlot,
            body,
            setSummary(entries) {
                summaryHost.replaceChildren(...buildSummary(entries).childNodes);
            },
            setCounts(counts) {
                filterButtons().forEach((btn) => {
                    const key = btn.dataset.lvsFilterKey;
                    if (Object.prototype.hasOwnProperty.call(counts || {}, key)) {
                        btn.querySelector('.lvs-filter-count').textContent = String(counts[key]);
                    }
                });
            },
            setActive,
            setBreadcrumb(text) { crumb.textContent = String(text || ''); },
            get railScrollTop() { return rail.scrollTop; },
            destroy() {
                window.removeEventListener('scroll', syncCollapse);
                narrow.removeEventListener('change', placeSummary);
                window.removeEventListener('resize', placeSummary);
                root.remove();
                container.classList.remove('lvs-host');
                container.removeAttribute('data-lvs-id');
            },
        };
    }
}

window.ListViewShell = ListViewShell;
