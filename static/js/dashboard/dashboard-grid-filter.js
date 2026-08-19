/**
 * Narrow the page you are looking at, without leaving it.
 *
 * Search is an overlay over everything and answers "where is that bookmark".
 * This answers the other question — "show me the rows on this page that mention
 * docker" — and keeps the categories around them, which is what makes it useful
 * for tidying up rather than for jumping. Rows are hidden with a class rather
 * than re-rendered: the grid keeps its layout, its keyboard cursor and its
 * selection, and clearing the filter is one class removal rather than a rebuild.
 */
(function (global) {
    'use strict';

    const ROW_HIDDEN = 'grid-filter-hidden';
    const BLOCK_HIDDEN = 'grid-filter-empty';

    class DashboardGridFilter {
        constructor(dashboard) {
            this.dash = dashboard;
            this.query = '';
            this.open = false;
        }

        t(key, fallback, params) {
            return this.dash?.formatDashboardLabel?.(key, params || {}, fallback) || fallback;
        }

        /** Shift+F, and the × on the bar. */
        toggle() {
            if (this.open) {
                this.close();
                return false;
            }
            this.show();
            return true;
        }

        show() {
            const container = document.getElementById('dashboard-layout');
            if (!container || this.dash?.activeView !== 'bookmarks') return false;
            this.open = true;
            const bar = this.ensureBar(container);
            bar.querySelector('.grid-filter-input')?.focus({ preventScroll: true });
            return true;
        }

        close() {
            this.open = false;
            this.query = '';
            this.apply();
            document.getElementById('grid-filter-bar')?.remove();
            this.dash?.keyboardNavigation?.restoreKbdSelection?.();
        }

        ensureBar(container) {
            let bar = document.getElementById('grid-filter-bar');
            if (bar) return bar;

            bar = document.createElement('div');
            bar.id = 'grid-filter-bar';
            bar.className = 'grid-filter-bar';

            const input = document.createElement('input');
            input.type = 'search';
            input.className = 'grid-filter-input';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.placeholder = this.t('gridFilterPlaceholder', 'Filter this page…');
            input.setAttribute('aria-label', this.t('gridFilterPlaceholder', 'Filter this page…'));
            input.value = this.query;

            const count = document.createElement('span');
            count.className = 'grid-filter-count';

            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'grid-filter-clear';
            clear.textContent = '×';
            clear.setAttribute('aria-label', this.t('gridFilterClear', 'Clear the filter'));

            input.addEventListener('input', () => {
                this.query = input.value;
                this.apply();
            });
            // Escape clears first and closes on the second press, so a typo does
            // not cost you the bar as well as the query.
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                    e.preventDefault();
                    if (this.query) {
                        this.query = '';
                        input.value = '';
                        this.apply();
                        return;
                    }
                    this.close();
                }
            });
            clear.addEventListener('click', () => this.close());

            bar.appendChild(input);
            bar.appendChild(count);
            bar.appendChild(clear);
            // Above the layout, not inside it.
            //
            // It used to be the layout's first child, which is fine while the
            // layout is a grid — and wrong in every other mode. Packed columns
            // make it `display: flex; flex-wrap: nowrap; justify-content: center`,
            // so the bar became a column of its own in that row: squeezed to a
            // fraction of its width and pushed off the left edge of the window
            // (measured at x = -21 on a three-column page). Masonry reads the
            // layout's own children, and the layout is `role="grid"`, where a
            // search field is not a row.
            //
            // As the layout's previous sibling it spans the same container the
            // grid does, sits under the page title where the eye already is, and
            // survives a re-render of the grid without being rebuilt.
            const host = container.parentElement || container;
            host.insertBefore(bar, container);
            return bar;
        }

        /** The text a row is matched against: what you can see, plus its tags. */
        haystack(row) {
            // The row's own text — name, shortcut, whatever else it prints — plus
            // the address and the tags it carries as attributes. Read from the
            // DOM rather than from the bookmark object so what you can see is
            // what you can filter on, whichever layout preset is in use.
            const text = row.textContent || '';
            const url = row.getAttribute('href') || '';
            const tags = row.getAttribute('data-tags') || row.dataset?.tags || '';
            return `${text} ${url} ${tags}`.toLowerCase();
        }

        /**
         * Hide what does not match, and any category left with nothing in it.
         *
         * Re-applied after a render by the caller, since the grid rebuilds its
         * rows and would otherwise come back unfiltered while the bar still says
         * it is filtering.
         */
        apply() {
            const container = document.getElementById('dashboard-layout');
            if (!container) return 0;
            const query = String(this.query || '').trim().toLowerCase();
            const rows = [...container.querySelectorAll('.bookmark-link')];

            let shown = 0;
            rows.forEach((row) => {
                const hit = !query || this.haystack(row).includes(query);
                row.classList.toggle(ROW_HIDDEN, !hit);
                if (hit) shown += 1;
            });

            container.querySelectorAll('.category').forEach((block) => {
                const visible = [...block.querySelectorAll('.bookmark-link')]
                    .some((row) => !row.classList.contains(ROW_HIDDEN));
                block.classList.toggle(BLOCK_HIDDEN, Boolean(query) && !visible);
            });

            const label = document.querySelector('#grid-filter-bar .grid-filter-count');
            if (label) {
                label.textContent = query
                    ? this.t('gridFilterCount', '{count} of {total}', { count: shown, total: rows.length })
                        .replace('{count}', String(shown)).replace('{total}', String(rows.length))
                    : '';
            }
            // The cursor must not sit on a row nobody can see.
            this.dash?.keyboardNavigation?.updateNavigableElements?.();
            return shown;
        }

        /** Called after a dashboard render, so a filter survives one. */
        reapply() {
            if (!this.open) return;
            if (this.dash?.activeView !== 'bookmarks') {
                this.close();
                return;
            }
            const container = document.getElementById('dashboard-layout');
            if (container) this.ensureBar(container);
            this.apply();
        }
    }

    global.DashboardGridFilter = DashboardGridFilter;
}(typeof window !== 'undefined' ? window : globalThis));
