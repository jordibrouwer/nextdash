/**
 * Adding a category to the page you are looking at.
 *
 * A category belongs to a page, so the gesture belongs on the page rather than
 * in a header button that would have to ask "which page?" first. Two ways in,
 * one flow behind them:
 *
 *   - `c` on the dashboard, for people who know it
 *   - a dashed "+ category" tile after the last category, for people who don't
 *
 * Both open the same name row the bookmark form uses, both create on the page
 * currently on screen, and both re-render the grid so the new (empty) category
 * is visible where it will live.
 */
class DashboardCategoryAdd {
    constructor(dashboard) {
        this.dash = dashboard;
    }


    /**
     * The tile is not a `.category`: the drag-reorder instances select
     * `.category:not([data-smart-collection="true"])`, and a placeholder that
     * matched would be draggable and could be dropped between real categories.
     */
    appendPlaceholder(container) {
        const d = this.dash;
        if (!container || !this.shouldShowPlaceholder()) {
            return;
        }

        const label = d.formatDashboardLabel('addCategoryPlaceholder', {}, '+ category');
        const tile = document.createElement('div');
        tile.className = 'category-add-placeholder';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-add-placeholder-btn';
        btn.id = 'category-add-placeholder-btn';
        btn.textContent = label;
        tile.appendChild(btn);

        btn.addEventListener('click', () => this.open(tile));
        container.appendChild(tile);
    }


    /**
     * Hidden wherever the other discoverability hints are: on touch and narrow
     * layouts an always-visible dashed tile is clutter, and `c` still works.
     */
    shouldShowPlaceholder() {
        const d = this.dash;
        if (d.isCoarsePointer?.()) {
            return false;
        }
        return window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false;
    }


    /**
     * Open the name row. `host` is the placeholder tile when the click came from
     * it; the `c` key passes nothing and the tile is found on screen. With no
     * tile (touch, or a hidden placeholder) the row is hosted by the grid itself
     * so the keyboard route still works.
     */
    open(host = null) {
        const d = this.dash;
        if (!window.InlineCreateRow) {
            return;
        }
        const existing = document.querySelector('.category-add-create');
        if (existing) {
            existing.querySelector('.bookmark-inline-create-input')?.focus({ preventScroll: true });
            return;
        }

        const tile = host || document.getElementById('category-add-placeholder-btn')?.closest('.category-add-placeholder');
        const grid = document.getElementById('dashboard-layout');
        const mount = tile || grid;
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

        const trigger = tile?.querySelector('.category-add-placeholder-btn') || null;
        if (trigger) {
            trigger.hidden = true;
        }
        mount.appendChild(ui.box);

        const close = () => {
            ui.box.remove();
            if (trigger) {
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
