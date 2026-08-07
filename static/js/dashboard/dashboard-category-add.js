/**
 * Adding a category to the page you are looking at.
 *
 * A category belongs to a page, so the gesture belongs on the page rather than
 * in a header button that would have to ask "which page?" first. Two ways in,
 * one flow behind them:
 *
 *   - `c` on the dashboard, for people who know it
 *   - a `+` in the last category's header, for people who don't
 *
 * Both open the same name row the bookmark form uses, both create on the page
 * currently on screen, and both re-render the grid so the new (empty) category
 * is visible where it will live.
 *
 * The `+` used to be a dashed full-width tile below the grid. It read well but
 * cost a whole empty row — measured at 110px on a 5-column layout, of which
 * ~143px was the button and the rest was nothing — and that row was on screen
 * permanently for a gesture used rarely. Sitting beside the sort chips it costs
 * no layout at all and is next to the other per-category controls.
 */
class DashboardCategoryAdd {
    constructor(dashboard) {
        this.dash = dashboard;
    }


    /**
     * Place the `+` in the header of the category that ends the grid.
     *
     * Called after layout, not while building: which category is visually last
     * depends on how the columns pack, and the last entry in the block list is
     * routinely in the middle of the screen. Measured — on a five-category page
     * the final block sat in column two while the eye ended on column three.
     *
     * "Ends the grid" means the bottom-most header, and the right-most of those
     * when several tie. Smart collections and tag-filter chunks are skipped:
     * they are views over bookmarks, not somewhere a category can be created.
     */
    placeTrigger(container) {
        const d = this.dash;
        container?.querySelectorAll('.category-add-inline-btn').forEach((b) => b.remove());
        if (!container || !this.shouldShowPlaceholder()) {
            return;
        }

        const hosts = [...container.querySelectorAll('.category')].filter((el) => (
            el.getAttribute('data-smart-collection') !== 'true'
            && !el.classList.contains('tag-filter-chunk')
            && el.querySelector('.category-title-trailing')
        ));
        if (!hosts.length) {
            return;
        }

        const target = hosts.reduce((best, el) => {
            const r = el.getBoundingClientRect();
            const b = best.getBoundingClientRect();
            if (Math.round(r.bottom) !== Math.round(b.bottom)) {
                return r.bottom > b.bottom ? el : best;
            }
            return r.right > b.right ? el : best;
        }, hosts[0]);

        const trailingWrap = target.querySelector('.category-title-trailing');
        if (!trailingWrap) {
            return;
        }

        const label = d.formatDashboardLabel('addCategoryGroupAria', {}, 'Add a category');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-add-inline-btn';
        btn.id = 'category-add-placeholder-btn';
        btn.textContent = '+';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        // The header toggles collapse and arms a long-press rename; neither
        // should fire when the target was this button.
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.open();
        });
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('dblclick', (e) => e.stopPropagation());
        trailingWrap.appendChild(btn);
    }


    /**
     * Hidden wherever the other discoverability hints are: on touch and narrow
     * layouts an always-visible affordance is clutter, and `c` still works.
     */
    shouldShowPlaceholder() {
        const d = this.dash;
        if (d.isCoarsePointer?.()) {
            return false;
        }
        return window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false;
    }


    /**
     * Open the name row.
     *
     * It is mounted on the grid rather than in the header the `+` sits in: the
     * header is a one-line flex row sized to its chips, and a text input in it
     * would either overflow the column or squash the title. Hosting it on the
     * grid keeps one mount point for both routes — the `+` and `c` — instead of
     * two behaviours to keep in step.
     */
    open() {
        const d = this.dash;
        if (!window.InlineCreateRow) {
            return;
        }
        const existing = document.querySelector('.category-add-create');
        if (existing) {
            existing.querySelector('.bookmark-inline-create-input')?.focus({ preventScroll: true });
            return;
        }

        const mount = document.getElementById('dashboard-layout');
        if (!mount) {
            return;
        }

        const ui = window.InlineCreateRow.create({
            kind: 'category',
            placeholder: d.configLabel('newCategoryNamePlaceholder', 'Category name'),
            labels: {
                create: d.configLabel('create', 'Create'),
                cancel: d.formatDashboardLabel('cancel', {}, 'Cancel'),
                group: d.formatDashboardLabel('addCategoryGroupAria', {}, 'Add a category'),
            },
        });
        ui.box.classList.add('category-add-create');
        ui.box.hidden = false;

        const trigger = document.getElementById('category-add-placeholder-btn');
        if (trigger) {
            trigger.hidden = true;
        }
        mount.appendChild(ui.box);

        const close = () => {
            ui.box.remove();
            if (trigger && trigger.isConnected) {
                trigger.hidden = false;
                trigger.focus({ preventScroll: true });
            }
        };

        window.InlineCreateRow.wire(ui, {
            submit: async (name) => {
                const pageId = d.currentPageId;
                const created = await d.structureCreate.createCategoryFromForm(pageId, name);
                if (created.error) {
                    return created.error;
                }
                close();
                // "Hide empty categories" is on by default and a new category is
                // empty by definition, so without this it would be saved and then
                // immediately swallowed. Pinning it keeps it on screen until a
                // bookmark lands in it or the page is left — see
                // buildCategoryColumnBlocks.
                d.pinnedEmptyCategoryId = created.id;
                // Only the category list changed, but the grid is built from it, so
                // the page has to be re-read for the new header to appear.
                // createCategoryFromForm has already dropped this page's cache.
                await d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
                return null;
            },
            onCancel: close,
        });

        ui.input.focus({ preventScroll: true });
    }
}

window.DashboardCategoryAdd = DashboardCategoryAdd;
