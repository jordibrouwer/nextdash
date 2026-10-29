/**
 * Edit mode: an editing state for the dashboard.
 *
 * Switched with the pencil button in the action bar, `:edit mode`, or Shift + M
 * when no bookmark row is selected (with a row selected Shift + M keeps moving
 * the bookmark). While it is on the dashboard says so, bookmarks cannot be
 * opened, and a click on a block selects it for the panel at the right
 * (dashboard-edit-mode-panel.js). It is a state of this page, not a setting:
 * a reload ends it, and so does a mobile layout.
 *
 * What the keys mean is edit-mode-model.js's, which can be tested without a
 * browser.
 */
class DashboardEditMode {
    constructor(dashboard) {
        this.dash = dashboard;
        this.active = false;
        this.selected = null;
        this._bar = null;
        this.panel = typeof DashboardEditModePanel === 'function' ? new DashboardEditModePanel(this) : null;
        this._onKeydown = (e) => this._handleKeydown(e);
        this._onClick = (e) => this._handleClick(e);
        this._onResize = () => this._handleLayoutChange();
        // Capture, before the grid's own handlers: a click that opens a bookmark
        // and a key that moves the cursor are what this state takes over.
        document.addEventListener('keydown', this._onKeydown, true);
        document.addEventListener('click', this._onClick, true);
        document.addEventListener('auxclick', this._onClick, true);
        document.addEventListener('click', (e) => this._handlePageTab(e), true);
        document.addEventListener('click', (e) => {
            if (e.target instanceof Element && e.target.closest('#edit-mode-button')) this.toggle();
        });
        // What a panel field held when it got the focus: Esc gives that back, saved renames included.
        document.addEventListener('focusin', (e) => {
            const t = e.target;
            if (t instanceof HTMLInputElement && t.closest('#edit-mode-panel, [data-lvs-drawer="edit-mode"]')) t.dataset.editOrig = t.value;
        }, true);
        // The widget settings sheet was closed: the widget may have a new name.
        document.addEventListener('nextdash:widget-sheet-closed', () => {
            if (this.active && this.selected?.kind === 'widget') this.panel?.render(this.selected);
        });
        // A view other than the grid (Config, the inbox, the Bookmarks view) ends the mode.
        new MutationObserver(() => {
            if (this.active && document.body.getAttribute('data-active-view') !== 'bookmarks') void this.exit({ force: true });
        }).observe(document.body, { attributes: true, attributeFilter: ['data-active-view'] });
        // A redraw of the grid (a sheet save, a refresh) replaces the blocks: the ring goes back on the chosen one.
        const layout = document.getElementById('dashboard-layout');
        if (layout) {
            let frame = 0;
            new MutationObserver(() => {
                if (!this.active || !this.selected) return;
                cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => this._markSelected());
            }).observe(layout, { childList: true, subtree: true });
        }
        // Switching page by any route (the +N list, a digit key) shows that page in the panel.
        document.addEventListener('nextdash:page-switched', (e) => {
            if (!this.active || this.isMobileLayout()) return;
            const id = e.detail?.pageId;
            if (id != null && !(this.selected?.kind === 'page' && String(this.selected.id) === String(id))) this.select({ kind: 'page', id });
        });
        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onResize);
    }

    t(key, fallback) {
        const language = this.dash?.language;
        const value = language && typeof language.t === 'function' ? language.t(key) : null;
        return value && value !== key ? value : fallback;
    }

    isMobileLayout() {
        return window.MobileExperience?.isMobileLayout?.() === true;
    }

    /** Switch the mode on. False when it cannot be: a mobile layout. */
    enter() {
        if (this.active) return true;
        if (this.isMobileLayout()) return false;
        // The row cursor and the mode do not mix: no row stays selected.
        this.dash?.keyboardNavigation?.clearSelection?.();
        this.active = true;
        document.body.setAttribute('data-edit-mode', 'on');
        // A preview card that is open goes away; none opens while the mode is on.
        this.dash?.hideBookmarkPreviewCard?.();
        this._showBar();
        this._notify();
        return true;
    }

    /** Leave the mode. Resolves true when it is off. */
    async exit(options = {}) {
        if (!this.active) return true;
        if (!options.force && typeof this.beforeExit === 'function') {
            if (!(await this.beforeExit())) return false;
        }
        this.active = false;
        this.selected = null;
        this.panel?.close();
        document.body.removeAttribute('data-edit-mode');
        this._bar?.remove();
        this._bar = null;
        this._notify();
        return true;
    }

    /** Enter the mode (if needed) with this block already chosen in the panel. */
    openFor(selection) {
        if (!this.enter()) return false;
        this.select(selection);
        return true;
    }

    toggle() {
        if (this.active) void this.exit();
        else this.enter();
    }

    select(selection) {
        this.selected = selection || null;
        // The panel and the widget sheet are drawn with the views' stylesheet,
        // which loads on demand: wait for it, and draw only the latest choice.
        const token = (this._selectToken = (this._selectToken || 0) + 1);
        Promise.resolve(window.ViewStyles?.ensureViewStyles?.()).catch(() => {}).then(() => {
            if (token === this._selectToken) this.panel?.render(this.selected);
        });
        this._notify();
    }

    /** The ring on the block that is selected, and only on it. */
    _markSelected() {
        document.querySelectorAll('#dashboard-layout .category.is-edit-selected').forEach((el) => el.classList.remove('is-edit-selected'));
        const sel = this.selected;
        if (!this.active || !sel || sel.kind === 'page') return;
        const id = sel.kind === 'widget' ? sel.id : sel.id;
        document.querySelectorAll('#dashboard-layout .category[data-category-id]').forEach((el) => {
            if (el.getAttribute('data-category-id') === String(id)) el.classList.add('is-edit-selected');
        });
    }

    _notify() {
        this._markSelected();
        document.getElementById('edit-mode-button')?.setAttribute('aria-pressed', String(this.active));
        document.dispatchEvent(new CustomEvent('nextdash:edit-mode', { detail: { active: this.active, selected: this.selected } }));
    }

    _showBar() {
        const bar = document.createElement('div');
        bar.id = 'edit-mode-bar';
        bar.setAttribute('role', 'status');
        bar.textContent = this.t('editMode.bar', 'Editing · Esc or Shift + M to finish');
        document.body.appendChild(bar);
        this._bar = bar;
    }

    _handleLayoutChange() {
        if (this.active && this.isMobileLayout()) void this.exit({ force: true });
    }

    /**
     * True when the dashboard grid is what the reader is on: not Config, the
     * Bookmarks view, the inbox or any other view, and no bookmark form open.
     * Shift + M means other things there (Config's bookmark panel opens its
     * dialog with it), and the mode is for the grid.
     */
    _onGrid() {
        const d = this.dash;
        if (typeof d?.isBookmarksView === 'function' && !d.isBookmarksView()) return false;
        if (d?._leavingConfig) return false;
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) return false;
        if (document.querySelector('.bookmark-inline-editing')) return false;
        return true;
    }

    /** True when the keystroke belongs to a text field or a dialog, not to the grid. */
    _typing(e) {
        const target = e.target;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return true;
        if (this.dash?.isModalOpen?.()) return true;
        if (this.dash?.searchComponent?.isActive?.()) return true;
        return Boolean(target?.closest?.('#edit-mode-panel, [data-lvs-drawer="edit-mode"]'));
    }

    /** Whether a dialog or popover is open over the dashboard. */
    _dialogOpen() {
        return Boolean(this.dash?.isModalOpen?.())
            || Boolean(window.EscapeOwner?.current?.())
            || Boolean(document.querySelector('.bookmark-context-menu, #date-popover, #multi-select-tags-popover, #multi-select-check-popover'))
            || Boolean(document.querySelector('#app-modal.modal-overlay.active'))
            || Boolean(document.querySelector('#move-popover, #tag-popover, #delete-popover, .page-tab-popover'));
    }

    /** Keys aimed at the grid itself (or at nothing), not at a sheet or panel laid over it. */
    _onDashboardKeys(e) {
        const t = e.target instanceof Element ? e.target : null;
        return !t || t === document.body || t === document.documentElement || Boolean(t.closest('#dashboard-layout'));
    }

    _handleKeydown(e) {
        const model = window.EditModeModel;
        if (!model) return;
        const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
        // Escape goes from the inside out: a dialog first (it closes itself),
        // then a field in the panel gives the focus back, then the mode ends.
        if (this.active && this._onGrid() && e.key === 'Escape' && !e.shiftKey && plain && !this.dash?.searchComponent?.isActive?.()) {
            // Something that was open has already taken this Escape (a menu closes itself and says so).
            if (e.defaultPrevented) return;
            const target = e.target instanceof Element ? e.target : null;
            const panelFieldFocused = Boolean(target?.closest('#edit-mode-panel, [data-lvs-drawer="edit-mode"]') && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
            const action = model.esc({ dialogOpen: this._dialogOpen(), panelFieldFocused, dirtyWidgetDraft: false });
            if (action === 'let-dialog-close') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (action === 'focus-grid') {
                // Esc gives back what was typed: put the field's value back
                // before it blurs, so the blur has no change to save.
                if (/^(INPUT|TEXTAREA)$/.test(target.tagName) && target.type !== 'checkbox' && target.type !== 'radio') {
                    target.value = target.dataset.editOrig ?? target.defaultValue;
                }
                target.blur();
            }
            else void this.exit();
            return;
        }
        if (e.shiftKey && plain && e.code === 'KeyM' && !this._typing(e) && (this.active || this._onGrid())) {
            const kn = this.dash?.keyboardNavigation;
            const rowSelected = Boolean(kn && kn.currentIndex >= 0 && kn.getSelectedBookmark?.());
            const action = model.editKey({ active: this.active, rowSelected });
            // A row selected: the bookmark's own Shift + M answers, as it always did.
            if (action === 'row-action') return;
            if (this.isMobileLayout()) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (action === 'enter') this.enter();
            else void this.exit();
            return;
        }
        // While the mode is on, a bare letter would start a search or open a
        // bookmark by its shortcut: taken. Punctuation still opens the search,
        // the commands and the finders, and digits still switch the page.
        if (this.active && this._onGrid() && plain && !e.shiftKey && !this._typing(e) && this._onDashboardKeys(e) && /^[a-z]$/i.test(e.key)
            && !e.target?.closest?.('button, [role="button"], [role="menuitem"]')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        // While the mode is on the grid has no row cursor: the keys that start
        // or move it are taken, so a bookmark cannot be opened by Enter either.
        if (this.active && this._onGrid() && plain && !e.shiftKey && !this._typing(e) && this._onDashboardKeys(e)
            && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)
            && !e.target?.closest?.('button, a, [role="button"], [role="menuitem"]')) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    _handleClick(e) {
        if (!this.active || !this._onGrid()) return;
        const target = e.target instanceof Element ? e.target : null;
        if (!target || !target.closest('#dashboard-layout')) return;
        // What opens something: a bookmark, a widget row, any link. Taken, so
        // the page is edited rather than left.
        if (target.closest('.bookmark-link, .dashboard-widget-row, [data-widget-href], a[href]')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            // The click would have put the focus on the link; with it there a
            // shortcut letter or an arrow would start the row cursor again.
            target.closest('a')?.blur?.();
        }
        // A click inside a block selects it for the panel.
        const block = target.closest('.category[data-category-id]');
        if (block) this.select(this._blockSelection(block));
        // The title's own click folds the block and saves that; here it only chooses.
        if (block && target.closest('.category-title') && !target.closest('button, input, select, [data-category-menu]')) {
            e.stopImmediatePropagation();
        }
    }

    _blockSelection(block) {
        const id = block.getAttribute('data-category-id');
        if (block.classList.contains('dashboard-widget')) return { kind: 'widget', id: block.getAttribute('data-widget-id') || id };
        if (block.getAttribute('data-smart-collection') === 'true' || /^(__smart_|custom:|tag:)/.test(id)) return { kind: 'collection', id };
        return { kind: 'category', id };
    }

    /** A click on a page tab switches page as it always did; the panel shows the page too. */
    _handlePageTab(e) {
        if (!this.active) return;
        const btn = e.target instanceof Element ? e.target.closest('.page-nav-btn') : null;
        // The page tabs only: the inbox tab has the same class and sits beside them.
        const tabs = btn?.closest('[role="tablist"]');
        if (!btn || !tabs) return;
        const index = [...tabs.querySelectorAll('.page-nav-btn')].indexOf(btn);
        const page = this.dash?.pages?.[index];
        if (page) this.select({ kind: 'page', id: page.id });
    }
}

window.DashboardEditMode = DashboardEditMode;
