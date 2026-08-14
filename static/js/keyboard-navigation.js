// Keyboard Navigation Component for Dashboard
const G_CHORD_HOLD_MS = 300;
// c is a letter people type into the shortcut search all the time, so it must
// not act on a plain tap. It waits out the same hold as the g chord: a tap
// releases the letter into search, holding adds a category. Shift+C is a
// separate shortcut and still fires immediately.
const C_HOLD_MS = G_CHORD_HOLD_MS;

class KeyboardNavigation {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.currentIndex = -1; // -1 means no element selected
        this.navigableElements = [];
        this.isEnabled = true;
        this.observer = null; // Store observer for cleanup
        this._gPressed = false;
        this._gAwaitingRelease = false;
        this._gHoldTimer = null;
        this._gTimeout = null;
        // Held-c state: set on keydown, cleared by whichever comes first — the
        // hold firing or the key being released.
        this._cAwaitingRelease = false;
        this._cHoldTimer = null;
        this._keydownHandler = null;
        this._keyupHandler = null;
        this._focusInHandler = null;
        this._focusInLayout = null;
        this._pointerOverLayout = null;
        this._pointerOverHandler = null;
        this._kbdSelectionDimmed = false;
        this._kbdLiveRegion = null;
        // True only while the current selection was reached with the keyboard.
        // A pointer click focuses a row and moves currentIndex too, so the index
        // alone cannot tell the two routes apart.
        this._selectionFromKeyboard = false;

        this.init();
    }

    init() {
        this.setupEventListeners();
        // Update navigable elements when dashboard renders
        this.scheduleUpdate();
    }

    setupEventListeners() {
        // Capture phase so we can intercept '[' before the search handler sees it.
        this._keydownHandler = (e) => {
            if (!this.isEnabled) {
                return;
            }

            if (document.body.classList.contains('bookmark-inline-edit-active')) {
                return;
            }

            const inbox = this.dashboard.inbox;
            const layoutEl = document.getElementById('dashboard-layout');
            const inboxDomActive = layoutEl?.classList.contains('inbox-layout');
            if (inboxDomActive && inbox?.isEnabled?.()) {
                if (this.dashboard.activeView !== 'inbox') {
                    this.dashboard.setActiveView('inbox', { silent: true });
                }
                if (inbox.handleKeyboardNavigation?.(e)) {
                    return;
                }
                return;
            }

            const health = this.dashboard.health;
            const healthDomActive = layoutEl?.classList.contains('health-layout');
            if (healthDomActive && health?.isEnabled?.()) {
                if (this.dashboard.activeView !== 'health') {
                    this.dashboard.setActiveView('health', { silent: true });
                }
                health.handleKeyboardNavigation?.(e);
                // Return either way: the bookmark grid is not on screen, so its
                // shortcuts must not fire against health rows.
                return;
            }

            const config = this.dashboard.config;
            const configDomActive = layoutEl?.classList.contains('config-layout');
            if (configDomActive && config?.isEnabled?.()) {
                if (this.dashboard.activeView !== 'config') {
                    this.dashboard.setActiveView('config', { silent: true });
                }
                config.handleKeyboardNavigation?.(e);
                // Return either way: the bookmark grid is not on screen.
                return;
            }

            // Don't handle if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }
            if (e.target.isContentEditable) {
                return;
            }

            // Don't handle if a modal overlay is open
            if (document.querySelector('.modal-overlay.show')) {
                return;
            }

            if (window.DashboardTagCloud?.modalOpen) {
                return;
            }

            if (window.dashboardInstance?.uiHelpers?.isPageOverviewModalOpen?.()) {
                return;
            }

            if (document.getElementById('omnibox-overlay')) {
                return;
            }

            // Action popovers manage their own keyboard — never let the grid intercept arrows/Enter
            if (
                document.getElementById('tag-popover')
                || document.getElementById('move-popover')
                || document.getElementById('delete-popover')
                || document.getElementById('bookmark-context-menu')
                || document.getElementById('bookmark-check-mode-menu')
            ) {
                return;
            }

            if (typeof this.dashboard.isModalOpen === 'function' && this.dashboard.isModalOpen()) {
                return;
            }

            // Don't handle if search is active
            if (this.dashboard.searchComponent && this.dashboard.searchComponent.isActive()) {
                return;
            }

            // Ctrl/Cmd+C — copy URL of selected bookmark
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyC' && this.currentIndex >= 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.copyUrlForCurrent();
                return;
            }

            // Shift+M / Shift+D / Shift+T / Shift+C — quick action popovers (use e.code for layout reliability)
            if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (e.code === 'KeyM') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.openMovePopoverForCurrent();
                    return;
                }
                if (e.code === 'KeyD') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.openDeletePopoverForCurrent();
                    return;
                }
                if (e.code === 'KeyT') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.openTagPopoverForCurrent();
                    return;
                }
                if (e.code === 'KeyC') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.openCheckModePopoverForCurrent();
                    return;
                }
                // Pin was the odd one out in this family: it existed as :pin and
                // in the inline editor, but had no key and no control on the row
                // at all — for a one-bit, daily action.
                if (e.code === 'KeyP') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.togglePinForCurrent();
                    return;
                }
                // Share/copy "name — URL" was right-click only: no command, no
                // key, not even in the cheat sheet.
                if (e.code === 'KeyS') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.shareCurrent();
                    return;
                }
                // Shift+H opens Health but loses the row; only the context menu
                // could reveal this particular bookmark there.
                if (e.code === 'KeyR') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    this.revealCurrentInHealth();
                    return;
                }
            }

            // Filter to the tag on the focused row. The row already carries its
            // tags as a data attribute, but acting on the tag you can see meant
            // opening the tag cloud and finding it among all the others.
            // Text fields are already filtered out at the top of this handler.
            if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                if (this.filterByCurrentTag()) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    return;
                }
            }

            // Plain c — add a category. Acts only on a hold, so a quick tap still
            // types the letter into the shortcut search. Shift+C above is
            // unaffected: it fires immediately, as it always has.
            if (e.code === 'KeyC' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                e.stopPropagation();
                if (e.repeat) {
                    return;
                }
                if (!this._cAwaitingRelease) {
                    this._cAwaitingRelease = true;
                    this._cHoldTimer = setTimeout(() => this._fireCHoldAction(), C_HOLD_MS);
                }
                return;
            }

            // WAI-ARIA grid: Ctrl/Cmd+Home / Ctrl/Cmd+End — first / last bookmark
            if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'Home' || e.key === 'End')) {
                if (this.navigableElements.length === 0) {
                    return;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.key === 'Home') {
                    this.navigateCtrlHome();
                } else {
                    this.navigateCtrlEnd();
                }
                return;
            }

            // Ctrl/Cmd+A — select every visible bookmark. Handled here rather
            // than in handleKeyPress, which the modifier guard below never
            // reaches. Only while the grid has the cursor, so it keeps its
            // browser meaning everywhere else.
            if (
                (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
                && (e.key === 'a' || e.key === 'A')
                && this._gridNavActive()
                && this.dashboard?.multiSelect
            ) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.dashboard.multiSelect.selectAllVisible();
                return;
            }

            // Don't handle if modifier keys are pressed (except Shift)
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }

            // '[' — toggle preview card (only when a row is selected)
            if (e.key === '[' && this.currentIndex >= 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.togglePreviewCardForCurrent();
                return;
            }

            this.handleKeyPress(e);
        };
        document.addEventListener('keydown', this._keydownHandler, true);

        this._keyupHandler = (e) => {
            if (!this.isEnabled) {
                return;
            }

            if (document.body.classList.contains('bookmark-inline-edit-active')) {
                return;
            }

            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }
            if (e.target.isContentEditable) {
                return;
            }

            if (document.querySelector('.modal-overlay.show')) {
                return;
            }

            if (window.DashboardTagCloud?.modalOpen) {
                return;
            }

            if (window.dashboardInstance?.uiHelpers?.isPageOverviewModalOpen?.()) {
                return;
            }

            if (document.getElementById('omnibox-overlay')) {
                return;
            }

            if (typeof this.dashboard.isModalOpen === 'function' && this.dashboard.isModalOpen()) {
                return;
            }

            if (this.dashboard.searchComponent && this.dashboard.searchComponent.isActive()) {
                return;
            }

            // Released before the hold elapsed — the letter was a keystroke, not a
            // command, so it goes to the shortcut search like any other letter.
            // Once the hold fires it clears _cAwaitingRelease itself, so reaching
            // here always means the tap was short.
            if (e.code === 'KeyC' && this._cAwaitingRelease) {
                this._cancelCHoldTimer();
                this._cAwaitingRelease = false;
                this.dashboard?.searchComponent?.addShortcutLetter?.('C');
                return;
            }

            const key = e.key;
            if (key !== 'g' && key !== 'G') {
                return;
            }

            if (!this._gAwaitingRelease) {
                return;
            }

            this._cancelGHoldTimer();
            this._gAwaitingRelease = false;

            if (!this._gPressed) {
                const search = this.dashboard?.searchComponent;
                if (search && typeof search.addShortcutLetter === 'function') {
                    search.addShortcutLetter('G');
                }
            }
        };
        document.addEventListener('keyup', this._keyupHandler, true);

        // Update navigable elements when dashboard changes
        this.observer = new MutationObserver(() => {
            this.scheduleUpdate();
        });

        const dashboardLayout = document.getElementById('dashboard-layout');
        if (dashboardLayout) {
            this.observer.observe(dashboardLayout, {
                childList: true,
                subtree: true
            });

            this._focusInLayout = dashboardLayout;
            this._focusInHandler = (e) => {
                const link = e.target.closest?.('a.bookmark-open');
                if (!link) {
                    return;
                }
                const row = link.closest('.bookmark-link');
                if (!row) {
                    return;
                }
                this.updateNavigableElements();
                const idx = this.navigableElements.indexOf(row);
                if (idx >= 0 && idx !== this.currentIndex) {
                    this.currentIndex = idx;
                    // Focus moved here by pointer or script, not by an arrow key.
                    this._selectionFromKeyboard = false;
                    this.highlightCurrentElement({ focus: false });
                }
            };
            dashboardLayout.addEventListener('focusin', this._focusInHandler);

            this._pointerOverLayout = dashboardLayout;
            this._pointerOverHandler = (e) => {
                if (e.pointerType && e.pointerType !== 'mouse') {
                    return;
                }
                const overRow = e.target.closest?.('.bookmark-link:not(.bookmark-inline-editing)');
                if (!overRow) {
                    return;
                }
                // Hovering the selected row is not a reason to soften it.
                if (overRow.classList.contains('keyboard-selected')) {
                    return;
                }
                this.dimKbdSelection();
            };
            dashboardLayout.addEventListener('pointerover', this._pointerOverHandler, true);
        }
    }

    dimKbdSelection() {
        if (this._kbdSelectionDimmed || this.currentIndex < 0) {
            return;
        }
        this._kbdSelectionDimmed = true;
        document.body.classList.add('bookmark-kbd-selection-dimmed');
    }

    restoreKbdSelection() {
        if (!this._kbdSelectionDimmed) {
            return;
        }
        this._kbdSelectionDimmed = false;
        document.body.classList.remove('bookmark-kbd-selection-dimmed');
    }


    _gridNavActive() {
        return this.currentIndex >= 0;
    }

    _scrollBehavior() {
        return document.body?.classList.contains('no-animations') ? 'instant' : 'smooth';
    }

    _isNavigableRow(row) {
        if (!row || row.classList.contains('bookmark-inline-editing')) {
            return false;
        }
        if (row.classList.contains('recent-bookmark-link') || row.classList.contains('launcher-dim') || row.classList.contains('find-hidden')) {
            return false;
        }
        // Rows past the category item limit are display:none; selecting one would
        // move the highlight somewhere invisible. The "+ N more" button that reveals
        // them is navigable instead (see updateNavigableElements).
        if (row.classList.contains('is-overflow-hidden')) {
            return false;
        }
        const category = row.closest('.category');
        if (category && category.getAttribute('data-collapsed') === 'true') {
            return false;
        }
        return true;
    }

    /** The "+ N more" / "show less" toggle, navigable unless its category is collapsed. */
    _isNavigableShowMore(btn) {
        if (!btn) return false;
        const category = btn.closest('.category');
        if (category && category.getAttribute('data-collapsed') === 'true') {
            return false;
        }
        return true;
    }

    _isShowMoreElement(el) {
        return !!el && el.classList?.contains('category-show-more');
    }

    _ensureKbdLiveRegion() {
        if (this._kbdLiveRegion && document.body.contains(this._kbdLiveRegion)) {
            return this._kbdLiveRegion;
        }
        let live = document.getElementById('dashboard-kbd-selection-live');
        if (!live) {
            live = document.createElement('div');
            live.id = 'dashboard-kbd-selection-live';
            live.className = 'sr-only';
            live.setAttribute('aria-live', 'polite');
            live.setAttribute('aria-atomic', 'true');
            document.body.appendChild(live);
        }
        this._kbdLiveRegion = live;
        return live;
    }

    _announceKeyboardSelection(row) {
        if (!row) {
            return;
        }
        const name = this._isShowMoreElement(row)
            ? row.textContent?.trim()
            : (row.querySelector('.bookmark-text')?.textContent?.trim()
                || row.querySelector('a.bookmark-open')?.textContent?.trim()
                || row.getAttribute('data-bookmark-url')
                || '');
        if (!name) {
            return;
        }
        const live = this._ensureKbdLiveRegion();
        const t = this.dashboard?.language?.t?.bind(this.dashboard.language);
        const template = t ? t('dashboard.keyboardSelectionAnnounce') : null;
        const msg = template && template !== 'dashboard.keyboardSelectionAnnounce'
            ? template.replace('{name}', name)
            : `${name} selected`;
        live.textContent = '';
        requestAnimationFrame(() => {
            live.textContent = msg;
        });
    }

    _handleGridArrowKey() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return false;
        }
        if (this._gridNavActive()) {
            return true;
        }
        // No bookmark selected yet: first arrow key starts grid navigation.
        this.restoreKbdSelection();
        return true;
    }

    getGridElement() {
        if (this.dashboard && typeof this.dashboard.getBookmarkGridElement === 'function') {
            return this.dashboard.getBookmarkGridElement();
        }
        const root = document.getElementById('dashboard-layout');
        if (!root) {
            return null;
        }
        return root.querySelector('.tag-filter-view-body[role="grid"]') || root;
    }

    syncGridActiveDescendant() {
        const grid = this.getGridElement();
        if (!grid || grid.getAttribute('role') !== 'grid') {
            return;
        }
        if (this.currentIndex >= 0 && this.currentIndex < this.navigableElements.length) {
            const openLink = this.navigableElements[this.currentIndex].querySelector?.('a.bookmark-open');
            if (openLink?.id) {
                grid.setAttribute('aria-activedescendant', openLink.id);
                return;
            }
        }
        grid.removeAttribute('aria-activedescendant');
    }

    // Cleanup method to prevent memory leaks
    cleanup() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler, true);
            this._keydownHandler = null;
        }
        if (this._keyupHandler) {
            document.removeEventListener('keyup', this._keyupHandler, true);
            this._keyupHandler = null;
        }
        if (this._focusInLayout && this._focusInHandler) {
            this._focusInLayout.removeEventListener('focusin', this._focusInHandler);
        }
        if (this._pointerOverLayout && this._pointerOverHandler) {
            this._pointerOverLayout.removeEventListener('pointerover', this._pointerOverHandler, true);
        }
        this._focusInLayout = null;
        this._focusInHandler = null;
        this._pointerOverLayout = null;
        this._pointerOverHandler = null;
        this._kbdLiveRegion = null;
        this.restoreKbdSelection();
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }
        this._clearGState();
    }

    scheduleUpdate() {
        // Debounce updates to avoid excessive recalculations
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        
        this.updateTimeout = setTimeout(() => {
            this.updateNavigableElements();
        }, 100);
    }

    /**
     * Bookmark rows of a category. Excludes the show-more toggle so Home/End keep
     * meaning "first/last bookmark" rather than landing on the trailing button.
     */
    getCategoryRows(categoryElement) {
        if (!categoryElement) {
            return [];
        }
        return this.navigableElements.filter((row) => categoryElement.contains(row)
            && !this._isShowMoreElement(row));
    }

    getCurrentCategoryElement() {
        if (this.currentIndex < 0 || this.currentIndex >= this.navigableElements.length) {
            return null;
        }
        return this.navigableElements[this.currentIndex].closest?.('.category[role="rowgroup"]') || null;
    }

    navigateCategoryHome() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return;
        }
        const category = this.getCurrentCategoryElement();
        const rows = category ? this.getCategoryRows(category) : [];
        const target = rows[0] || this.navigableElements[0];
        this.currentIndex = Math.max(0, this.navigableElements.indexOf(target));
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigateCategoryEnd() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return;
        }
        const category = this.getCurrentCategoryElement();
        const rows = category ? this.getCategoryRows(category) : [];
        const target = rows.length ? rows[rows.length - 1] : this.navigableElements[this.navigableElements.length - 1];
        this.currentIndex = Math.max(0, this.navigableElements.indexOf(target));
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigateCtrlHome() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return;
        }
        this.currentIndex = 0;
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigateCtrlEnd() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return;
        }
        this.currentIndex = this.navigableElements.length - 1;
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigatePageUp() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return;
        }
        if (this.currentIndex < 0) {
            this.currentIndex = 0;
            this.highlightCurrentElement({ keyboardNav: true });
            return;
        }
        const current = this.navigableElements[this.currentIndex];
        const rowTop = current.getBoundingClientRect().top;
        const page = Math.max(window.innerHeight * 0.85, 240);
        let targetIndex = 0;
        for (let i = this.currentIndex - 1; i >= 0; i -= 1) {
            targetIndex = i;
            const top = this.navigableElements[i].getBoundingClientRect().top;
            if (rowTop - top >= page) {
                break;
            }
        }
        this.currentIndex = targetIndex;
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigatePageDown() {
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            return;
        }
        if (this.currentIndex < 0) {
            this.currentIndex = this.navigableElements.length - 1;
            this.highlightCurrentElement({ keyboardNav: true });
            return;
        }
        const current = this.navigableElements[this.currentIndex];
        const rowBottom = current.getBoundingClientRect().bottom;
        const page = Math.max(window.innerHeight * 0.85, 240);
        let targetIndex = this.navigableElements.length - 1;
        for (let i = this.currentIndex + 1; i < this.navigableElements.length; i += 1) {
            targetIndex = i;
            const bottom = this.navigableElements[i].getBoundingClientRect().bottom;
            if (bottom - rowBottom >= page) {
                break;
            }
        }
        this.currentIndex = targetIndex;
        this.highlightCurrentElement({ keyboardNav: true });
    }

    syncRovingTabStops(options = {}) {
        const doFocus = options.focus !== false;
        this.navigableElements.forEach((row, i) => {
            // The show-more toggle is itself the focusable element; bookmark rows
            // delegate their tab stop to the inner open link.
            const focusTarget = this._isShowMoreElement(row)
                ? row
                : (row.querySelector && row.querySelector('a.bookmark-open'));
            if (!focusTarget) {
                return;
            }
            focusTarget.tabIndex = this.currentIndex >= 0
                ? (i === this.currentIndex ? 0 : -1)
                : (i === 0 ? 0 : -1);
        });
        if (
            doFocus &&
            this.currentIndex >= 0 &&
            this.currentIndex < this.navigableElements.length
        ) {
            const current = this.navigableElements[this.currentIndex];
            const focusTarget = this._isShowMoreElement(current)
                ? current
                : current.querySelector('a.bookmark-open');
            if (focusTarget && typeof focusTarget.focus === 'function') {
                try {
                    focusTarget.focus({ preventScroll: true });
                } catch {
                    focusTarget.focus();
                }
            }
        }
    }

    updateNavigableElements() {
        const previousRow = this.currentIndex >= 0 && this.currentIndex < this.navigableElements.length
            ? this.navigableElements[this.currentIndex]
            : null;
        // Include the "+ N more" / "show less" toggles so long categories can be
        // expanded from the keyboard. Querying both in one pass keeps them in DOM
        // order, which is what arrow navigation follows.
        const bookmarkElements = document.querySelectorAll(
            '.bookmark-link:not(.recent-bookmark-link), .category-show-more'
        );
        this.navigableElements = Array.from(bookmarkElements)
            .filter((el) => el.classList.contains('category-show-more')
                ? this._isNavigableShowMore(el)
                : this._isNavigableRow(el));

        if (previousRow) {
            const nextIndex = this.navigableElements.indexOf(previousRow);
            if (nextIndex === -1) {
                previousRow.classList.remove('keyboard-selected');
                previousRow.removeAttribute('aria-current');
                previousRow.setAttribute('aria-selected', 'false');
                this.restoreKbdSelection();
            }
            this.currentIndex = nextIndex;
        }
        if (this.currentIndex >= this.navigableElements.length) {
            this.currentIndex = -1;
        }
        if (this.dashboard && typeof this.dashboard.syncBookmarkGridA11y === 'function') {
            this.dashboard.syncBookmarkGridA11y();
        }
        this.syncRovingTabStops({ focus: false });
        this.syncGridActiveDescendant();
    }

    handleKeyPress(e) {
        const key = e.key;

        const isGChordFollowUp = (key >= '1' && key <= '9') || key === 'p' || key === 'P';
        if (this._gAwaitingRelease && isGChordFollowUp) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._activateGChordMode();
            if (key === 'p' || key === 'P') {
                this._clearGState();
                this.jumpToPinned();
                return;
            }
            this._clearGState();
            this.jumpToCategory(parseInt(key, 10));
            return;
        }

        // G + P: jump to first pinned bookmark on the page
        if (this._gPressed && (key === 'p' || key === 'P')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._clearGState();
            this.jumpToPinned();
            return;
        }

        // G + 1–9: jump to nth category (includes smart collections)
        if (this._gPressed && key >= '1' && key <= '9') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._clearGState();
            this.jumpToCategory(parseInt(key, 10));
            return;
        }

        // Shift+Arrow — page navigation (dashboard.js); skip grid moves
        if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
            return;
        }

        // Shift+↑/↓ — extend the multi-selection while moving the cursor.
        // Left/right are page navigation above, so only the vertical pair is
        // free to mean "extend".
        const multi = this.dashboard?.multiSelect;
        if (multi && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown') && this._gridNavActive()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            // Anchor on the row the cursor sits on, so the first Shift+Arrow
            // grows a range from here rather than from wherever a stray earlier
            // toggle happened to leave the anchor.
            const startRow = this.navigableElements[this.currentIndex];
            if (startRow && !multi.isActive()) {
                multi.toggleRow(startRow);
            }
            if (key === 'ArrowDown') {
                this.navigateDown();
            } else {
                this.navigateUp();
            }
            const endRow = this.navigableElements[this.currentIndex];
            if (endRow) {
                multi.selectRange(endRow);
            }
            return;
        }


        // Tab / Shift+Tab: linear bookmark navigation (only when a bookmark is selected)
        if (key === 'Tab' && this.currentIndex >= 0) {
            if (this.navigableElements.length === 0) {
                return;
            }
            const atLast = this.currentIndex === this.navigableElements.length - 1;
            const atFirst = this.currentIndex === 0;
            if ((!e.shiftKey && atLast) || (e.shiftKey && atFirst)) {
                this.clearSelection();
                return;
            }
            e.preventDefault();
            if (e.shiftKey) {
                this.currentIndex = (this.currentIndex - 1 + this.navigableElements.length) % this.navigableElements.length;
            } else {
                this.currentIndex = (this.currentIndex + 1) % this.navigableElements.length;
            }
            this.highlightCurrentElement({ keyboardNav: true });
            return;
        }

        switch(key) {
            case 'ArrowDown':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigateDown();
                break;

            case 'ArrowUp':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigateUp();
                break;

            case 'ArrowRight':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigateRight();
                break;

            case 'ArrowLeft':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigateLeft();
                break;

            case 'Home':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigateCategoryHome();
                break;

            case 'End':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigateCategoryEnd();
                break;

            case 'PageUp':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigatePageUp();
                break;

            case 'PageDown':
                if (!this._handleGridArrowKey()) {
                    break;
                }
                e.preventDefault();
                this.navigatePageDown();
                break;

            case 'Enter':
            case ' ': // Space key
                if (!this._gridNavActive()) {
                    break;
                }
                e.preventDefault();
                this.selectCurrentElement();
                break;

            case ';':
                if (!this._gridNavActive()) {
                    break;
                }
                if (this.dashboard && typeof this.dashboard.tryOpenInlineBookmarkEdit === 'function') {
                    if (this.dashboard.tryOpenInlineBookmarkEdit()) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        e.stopPropagation();
                    }
                }
                break;

            // x toggles the row under the cursor; X takes the whole category.
            case 'x':
            case 'X':
                if (!this._gridNavActive() || !this.dashboard?.multiSelect) {
                    break;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                {
                    const row = this.navigableElements[this.currentIndex];
                    if (!row) {
                        break;
                    }
                    if (key === 'X') {
                        this.dashboard.multiSelect.selectCategory(row);
                    } else {
                        this.dashboard.multiSelect.toggleRow(row);
                        // Advance so ticking a run of rows is x-x-x rather than
                        // x-down-x-down, matching how the inbox tick behaves.
                        if (this.currentIndex < this.navigableElements.length - 1) {
                            this.navigateDown();
                        }
                    }
                }
                break;

            case 'Delete':
                if (this.dashboard?.multiSelect?.isActive()) {
                    e.preventDefault();
                    void this.dashboard.multiSelect.deleteSelected();
                    break;
                }
                if (this.currentIndex >= 0) {
                    e.preventDefault();
                    this.deleteCurrentBookmark();
                }
                break;

            case 'Escape':
                this._clearGState();
                e.preventDefault();
                // Escape drops the selection before it drops the cursor, so one
                // press does not lose both at once.
                if (this.dashboard?.multiSelect?.isActive()) {
                    this.dashboard.multiSelect.clear();
                    break;
                }
                this.clearSelection();
                break;

            case 'g':
            case 'G':
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.repeat) {
                    break;
                }
                if (this._gPressed || this._gAwaitingRelease) {
                    this._performGgJump();
                } else {
                    this._gAwaitingRelease = true;
                    this._gHoldTimer = setTimeout(() => this._activateGChordMode(), G_CHORD_HOLD_MS);
                }
                break;
        }
    }

    _cancelGHoldTimer() {
        if (this._gHoldTimer) {
            clearTimeout(this._gHoldTimer);
            this._gHoldTimer = null;
        }
    }

    _cancelCHoldTimer() {
        if (this._cHoldTimer) {
            clearTimeout(this._cHoldTimer);
            this._cHoldTimer = null;
        }
    }

    /**
     * The c key was held past the threshold — open the category name row.
     */
    _fireCHoldAction() {
        this._cancelCHoldTimer();
        // Cleared here rather than on keyup: opening the row moves focus into its
        // input, and the keyup handler bails on INPUT targets before it reaches
        // the c branch. Left set, every later hold would be skipped as "already
        // awaiting release" — the shortcut would work exactly once per page load.
        this._cAwaitingRelease = false;
        const dash = this.dashboard;
        if (!dash || dash.isBookmarksView?.() === false || dash.isInlineEditActive?.()) {
            return;
        }
        // Re-checked here, not just on keydown: the hold spans 300ms, and search
        // or a modal may have opened in between. Firing into those would put the
        // name row behind whatever is now on top.
        if (dash.searchComponent?.isActive?.() || dash.isModalOpen?.()) {
            return;
        }
        dash.categoryAdd?.open();
    }

    _armGChordTimeout(ms) {
        if (this._gTimeout) {
            clearTimeout(this._gTimeout);
        }
        this._gTimeout = setTimeout(() => this._clearGState(), ms);
    }

    _activateGChordMode() {
        this._cancelGHoldTimer();
        this._gAwaitingRelease = false;
        this._gPressed = true;
        this._armGChordTimeout(3000);
    }

    _performGgJump() {
        this._clearGState();
        this.currentIndex = 0;
        this.highlightCurrentElement({ keyboardNav: true });
    }

    _clearGState() {
        this._gPressed = false;
        this._gAwaitingRelease = false;
        this._cancelGHoldTimer();
        if (this._gTimeout) {
            clearTimeout(this._gTimeout);
            this._gTimeout = null;
        }
    }

    isGChordActive() {
        return this._gPressed === true;
    }

    jumpToPinned() {
        this.updateNavigableElements();
        const pinnedRow = this.navigableElements.find((row) => {
            const idx = parseInt(row.getAttribute('data-bookmark-index'), 10);
            if (!Number.isFinite(idx) || idx < 0) return false;
            const bookmark = this.dashboard?.bookmarks?.[idx];
            return Boolean(bookmark?.pinned);
        });
        if (!pinnedRow) return;

        const idx = this.navigableElements.indexOf(pinnedRow);
        if (idx === -1) return;

        this.currentIndex = idx;
        this.highlightCurrentElement({ keyboardNav: true });
    }

    jumpToCategory(n) {
        this.updateNavigableElements();
        const categories = Array.from(
            document.querySelectorAll('.category[data-category-id]')
        ).filter(el => el.getAttribute('data-collapsed') !== 'true');

        const target = categories[n - 1];
        if (!target) return;

        const isSmartCollection = target.getAttribute('data-smart-collection') === 'true';
        const firstRow = target.querySelector('.bookmark-link[data-bookmark-index]');

        if (firstRow) {
            const idx = this.navigableElements.indexOf(firstRow);
            if (idx === -1) return;

            this.currentIndex = idx;
            this.highlightCurrentElement({ keyboardNav: true });
        } else if (isSmartCollection) {
            this.clearSelection();
            target.scrollIntoView({ block: 'nearest', behavior: this._scrollBehavior() });
            const title = target.querySelector('.category-title');
            if (title && typeof title.focus === 'function') {
                title.focus({ preventScroll: true });
            }
        } else {
            return;
        }
    }

    navigateDown() {
        this.updateNavigableElements();
        
        if (this.navigableElements.length === 0) return;


        // Get current element position
        const currentElement = this.navigableElements[this.currentIndex];
        
        if (this.currentIndex === -1) {
            // No element selected, select the first one
            this.currentIndex = 0;
        } else {
            // Find the element below the current one
            const nextIndex = this.findElementBelow(currentElement);
            
            if (nextIndex !== -1) {
                this.currentIndex = nextIndex;
            } else {
                // If no element below, go to first element
                this.currentIndex = 0;
            }
        }
        
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigateUp() {
        this.updateNavigableElements();
        
        if (this.navigableElements.length === 0) return;


        // Get current element position
        const currentElement = this.navigableElements[this.currentIndex];
        
        if (this.currentIndex === -1) {
            // No element selected, select the last one
            this.currentIndex = this.navigableElements.length - 1;
        } else {
            // Find the element above the current one
            const prevIndex = this.findElementAbove(currentElement);
            
            if (prevIndex !== -1) {
                this.currentIndex = prevIndex;
            } else {
                // If no element above, go to last element
                this.currentIndex = this.navigableElements.length - 1;
            }
        }
        
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigateRight() {
        this.updateNavigableElements();
        
        if (this.navigableElements.length === 0) return;

        if (this.currentIndex === -1) {
            // No element selected, select the first one
            this.currentIndex = 0;
        } else {
            // Find the next element to the right on the same row
            const currentElement = this.navigableElements[this.currentIndex];
            const nextIndex = this.findElementRight(currentElement);
            
            if (nextIndex !== -1) {
                this.currentIndex = nextIndex;
            } else {
                // If no element to the right, wrap to beginning of next row or first element
                this.currentIndex = (this.currentIndex + 1) % this.navigableElements.length;
            }
        }
        
        this.highlightCurrentElement({ keyboardNav: true });
    }

    navigateLeft() {
        this.updateNavigableElements();
        
        if (this.navigableElements.length === 0) return;

        if (this.currentIndex === -1) {
            // No element selected, select the last one
            this.currentIndex = this.navigableElements.length - 1;
        } else {
            // Find the previous element to the left on the same row
            const currentElement = this.navigableElements[this.currentIndex];
            const prevIndex = this.findElementLeft(currentElement);
            
            if (prevIndex !== -1) {
                this.currentIndex = prevIndex;
            } else {
                // If no element to the left, wrap to end
                this.currentIndex = (this.currentIndex - 1 + this.navigableElements.length) % this.navigableElements.length;
            }
        }
        
        this.highlightCurrentElement({ keyboardNav: true });
    }

    findElementBelow(currentElement) {
        if (!currentElement) return 0;
        
        const currentRect = currentElement.getBoundingClientRect();
        const currentCenterX = currentRect.left + currentRect.width / 2;
        
        let bestMatch = -1;
        let minDistance = Infinity;
        
        this.navigableElements.forEach((element, index) => {
            if (index === this.currentIndex) return;
            
            const rect = element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            
            // Only consider elements below the current one
            if (rect.top > currentRect.bottom - 10) {
                const verticalDistance = rect.top - currentRect.bottom;
                const horizontalDistance = Math.abs(centerX - currentCenterX);
                
                // Prioritize vertical proximity, but consider horizontal alignment
                const distance = verticalDistance + (horizontalDistance * 0.5);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = index;
                }
            }
        });
        
        return bestMatch;
    }

    findElementAbove(currentElement) {
        if (!currentElement) return this.navigableElements.length - 1;
        
        const currentRect = currentElement.getBoundingClientRect();
        const currentCenterX = currentRect.left + currentRect.width / 2;
        
        let bestMatch = -1;
        let minDistance = Infinity;
        
        this.navigableElements.forEach((element, index) => {
            if (index === this.currentIndex) return;
            
            const rect = element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            
            // Only consider elements above the current one
            if (rect.bottom < currentRect.top + 10) {
                const verticalDistance = currentRect.top - rect.bottom;
                const horizontalDistance = Math.abs(centerX - currentCenterX);
                
                // Prioritize vertical proximity, but consider horizontal alignment
                const distance = verticalDistance + (horizontalDistance * 0.5);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = index;
                }
            }
        });
        
        return bestMatch;
    }

    findElementRight(currentElement) {
        if (!currentElement) return 0;
        
        const currentRect = currentElement.getBoundingClientRect();
        const currentCenterY = currentRect.top + currentRect.height / 2;
        
        let bestMatch = -1;
        let minDistance = Infinity;
        
        this.navigableElements.forEach((element, index) => {
            if (index === this.currentIndex) return;
            
            const rect = element.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            
            // Only consider elements to the right on approximately the same row
            if (rect.left > currentRect.right - 10) {
                const horizontalDistance = rect.left - currentRect.right;
                const verticalDistance = Math.abs(centerY - currentCenterY);
                
                // Only consider if roughly on the same row (within element height)
                if (verticalDistance < currentRect.height) {
                    if (horizontalDistance < minDistance) {
                        minDistance = horizontalDistance;
                        bestMatch = index;
                    }
                }
            }
        });
        
        return bestMatch;
    }

    findElementLeft(currentElement) {
        if (!currentElement) return this.navigableElements.length - 1;
        
        const currentRect = currentElement.getBoundingClientRect();
        const currentCenterY = currentRect.top + currentRect.height / 2;
        
        let bestMatch = -1;
        let minDistance = Infinity;
        
        this.navigableElements.forEach((element, index) => {
            if (index === this.currentIndex) return;
            
            const rect = element.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            
            // Only consider elements to the left on approximately the same row
            if (rect.right < currentRect.left + 10) {
                const horizontalDistance = currentRect.left - rect.right;
                const verticalDistance = Math.abs(centerY - currentCenterY);
                
                // Only consider if roughly on the same row (within element height)
                if (verticalDistance < currentRect.height) {
                    if (horizontalDistance < minDistance) {
                        minDistance = horizontalDistance;
                        bestMatch = index;
                    }
                }
            }
        });
        
        return bestMatch;
    }

    highlightCurrentElement(options = {}) {
        const doFocus = options.focus !== false;
        if (this.currentIndex >= 0) {
            this.restoreKbdSelection();
        }
        // Dismiss any open keyboard-triggered preview card when moving to a new row
        if (this.dashboard && typeof this.dashboard.hideBookmarkPreviewCard === 'function') {
            this.dashboard.hideBookmarkPreviewCard();
        }

        // Remove previous highlights
        this.navigableElements.forEach(element => {
            element.classList.remove('keyboard-selected');
            element.removeAttribute('aria-current');
            element.setAttribute('aria-selected', 'false');
        });

        // Highlight current element
        if (this.currentIndex >= 0 && this.currentIndex < this.navigableElements.length) {
            const currentElement = this.navigableElements[this.currentIndex];
            currentElement.classList.add('keyboard-selected');
            currentElement.setAttribute('aria-current', 'true');
            currentElement.setAttribute('aria-selected', 'true');

            // Scroll into view if needed
            currentElement.scrollIntoView({
                behavior: this._scrollBehavior(),
                block: 'nearest',
                inline: 'nearest'
            });
            if (options.keyboardNav) {
                // Records that the cursor got here by key, not by a mouse click
                // that focused the row. Consumers that restore a selection need
                // to tell those apart — see restoreInlineEditRow().
                this._selectionFromKeyboard = true;
                this._announceKeyboardSelection(currentElement);
            }
            this.syncRovingTabStops({ focus: doFocus });
        } else {
            this.syncRovingTabStops({ focus: false });
        }
        this.syncGridActiveDescendant();
    }

    togglePreviewCardForCurrent() {
        if (this.currentIndex < 0 || this.currentIndex >= this.navigableElements.length) return;
        const dash = this.dashboard;
        if (!dash || typeof dash.showBookmarkPreviewCard !== 'function') return;

        // If card is already visible for this row, dismiss it
        if (dash.previewCardElement && dash.previewCardElement.classList.contains('is-visible')) {
            dash.hideBookmarkPreviewCard();
            return;
        }

        if (dash.settings && dash.settings.showLinkPreviewCards !== true) return;

        const row = this.navigableElements[this.currentIndex];
        const openLink = row && row.querySelector('a.bookmark-open');
        if (!openLink) return;

        // Derive bookmark — prefer data-bookmark-index, fall back to URL match
        const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
        let bookmark = (Number.isFinite(bookmarkIndex) && bookmarkIndex >= 0)
            ? (dash.bookmarks || [])[bookmarkIndex]
            : null;
        if (!bookmark) {
            const url = row.dataset.bookmarkUrl || openLink.href || '';
            if (url) {
                bookmark = (dash.bookmarks || []).find(b => b.url === url)
                    || (dash.allBookmarks || []).find(b => b.url === url)
                    || null;
            }
        }
        if (!bookmark) return;

        // Use cached preview data if available, otherwise fetch
        const rect = row.getBoundingClientRect();
        const fakeX = rect.right + 16;
        const fakeY = rect.top + rect.height / 2;

        if (openLink._previewData) {
            const preview = { ...openLink._previewData, note: bookmark.note || '', tags: bookmark.tags || [], openCount: bookmark.openCount || 0, lastOpened: bookmark.lastOpened || null };
            dash.showBookmarkPreviewCard(preview, { clientX: fakeX, clientY: fakeY }, { openLink, bookmark, promoSource: 'keyboard' });
        } else {
            dash.fetchBookmarkPreviewData(openLink, bookmark).then(preview => {
                if (!preview) return;
                const enriched = { ...preview, note: bookmark.note || '', tags: bookmark.tags || [], openCount: bookmark.openCount || 0, lastOpened: bookmark.lastOpened || null };
                // Only show if the same row is still selected
                if (this.currentIndex >= 0 && this.navigableElements[this.currentIndex] === row) {
                    const r = row.getBoundingClientRect();
                    dash.showBookmarkPreviewCard(enriched, { clientX: r.right + 16, clientY: r.top + r.height / 2 }, { openLink, bookmark, promoSource: 'keyboard' });
                }
            });
        }
    }

    copyUrlForCurrent() {
        if (this.currentIndex < 0 || this.currentIndex >= this.navigableElements.length) return;
        const row = this.navigableElements[this.currentIndex];
        const openLink = row && row.querySelector('a.bookmark-open');
        const url = (openLink && openLink.href) || row.dataset.bookmarkUrl || '';
        if (!url) return;

        const flashRow = () => {
            row.classList.remove('bookmark-copy-flash');
            void row.offsetWidth; // force reflow to restart animation
            row.classList.add('bookmark-copy-flash');
            row.addEventListener('animationend', () => row.classList.remove('bookmark-copy-flash'), { once: true });
        };

        const notify = () => {
            flashRow();
            if (this.dashboard && typeof this.dashboard.showNotification === 'function') {
                const _v = (this.dashboard.language && typeof this.dashboard.language.t === 'function')
                    ? this.dashboard.language.t('dashboard.urlCopied') : null;
                const msg = (_v && _v !== 'dashboard.urlCopied') ? _v : 'URL copied';
                this.dashboard.showNotification(msg, 'success', { duration: 2000 });
            }
        };
        navigator.clipboard.writeText(url).then(notify).catch(() => {
            // Fallback for browsers without clipboard API permission
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* ignore */ }
            document.body.removeChild(ta);
            notify();
        });
    }

    deleteCurrentBookmark() {
        if (this.currentIndex < 0 || this.currentIndex >= this.navigableElements.length) return;
        const dash = this.dashboard;
        if (!dash) return;
        const row = this.navigableElements[this.currentIndex];
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) {
            return;
        }
        const bookmarkRef = typeof dash.resolveBookmarkReference === 'function'
            ? dash.resolveBookmarkReference(bookmark)
            : null;
        if (!bookmarkRef) {
            return;
        }
        if (typeof dash.deleteBookmarkInline === 'function') {
            void dash.deleteBookmarkInline(bookmarkRef);
            return;
        }
        if (bookmarkRef.scope === 'current' && typeof dash.deleteBookmarkAtIndexInline === 'function') {
            void dash.deleteBookmarkAtIndexInline(bookmarkRef);
        }
    }

    getSelectedBookmark() {
        if (this.currentIndex < 0 || this.currentIndex >= this.navigableElements.length) return null;
        const dash = this.dashboard;
        if (!dash) return null;
        const row = this.navigableElements[this.currentIndex];
        const openLink = row && row.querySelector('a.bookmark-open');
        const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
        let bookmark = (Number.isFinite(bookmarkIndex) && bookmarkIndex >= 0)
            ? (dash.bookmarks || [])[bookmarkIndex]
            : null;
        if (!bookmark) {
            const url = (openLink && openLink.href) || row.dataset.bookmarkUrl || '';
            if (url) {
                // The same URL may appear more than once, so prefer the copy whose
                // name matches the row being acted on — matching on URL alone
                // resolved every copy to the first one, and Delete then removed a
                // bookmark other than the selected row.
                const label = (row.querySelector('.bookmark-text')?.textContent || '').trim();
                const pick = (list) => {
                    const hits = (list || []).filter((b) => b.url === url);
                    if (hits.length <= 1) return hits[0] || null;
                    return hits.find((b) => String(b.name || '').trim() === label) || hits[0];
                };
                bookmark = pick(dash.bookmarks) || pick(dash.allBookmarks) || null;
            }
        }
        return bookmark || null;
    }

    selectCurrentElement() {
        if (this.currentIndex >= 0 && this.currentIndex < this.navigableElements.length) {
            const currentElement = this.navigableElements[this.currentIndex];
            if (this._isShowMoreElement(currentElement)) {
                this.toggleShowMoreForCurrent(currentElement);
                return;
            }
            const openLink = currentElement.querySelector && currentElement.querySelector('a.bookmark-open');
            if (openLink) {
                openLink.click();
            } else {
                currentElement.click();
            }
        }
    }

    /**
     * Expand/collapse a category from the keyboard and land the selection on the
     * last bookmark before the toggle, so arrowing down continues into the rows
     * that were just revealed instead of restarting somewhere else.
     */
    toggleShowMoreForCurrent(btn) {
        const category = btn.closest('.category');
        btn.click();
        this.updateNavigableElements();

        // The button survives the toggle (its label flips), so anchor on it and
        // step back one to reach the last bookmark above it.
        let index = this.navigableElements.indexOf(btn);
        if (index < 0 && category) {
            const rebuilt = category.querySelector('.category-show-more');
            index = rebuilt ? this.navigableElements.indexOf(rebuilt) : -1;
        }
        if (index > 0) {
            this.currentIndex = index - 1;
        } else if (index === 0) {
            this.currentIndex = 0;
        }
        this.highlightCurrentElement({ keyboardNav: true });
    }

    clearSelection(options = {}) {
        const restoreFocus = options.restoreFocus !== false;
        const hadSelection = this.currentIndex >= 0;
        if (document.body.classList.contains('bookmark-inline-edit-active')) {
            return;
        }
        this.restoreKbdSelection();
        this.navigableElements.forEach(element => {
            element.classList.remove('keyboard-selected');
            element.removeAttribute('aria-current');
            element.setAttribute('aria-selected', 'false');
        });
        
        this.currentIndex = -1;
        this._selectionFromKeyboard = false;
        this.syncRovingTabStops({ focus: false });
        this.syncGridActiveDescendant();

        if (hadSelection && restoreFocus) {
            const firstLink = this.navigableElements[0]?.querySelector?.('a.bookmark-open');
            if (firstLink && typeof firstLink.focus === 'function') {
                firstLink.focus({ preventScroll: true });
            }
        }
    }

    /** Restore keyboard grid selection to a bookmark row (e.g. after closing action popovers). */
    selectBookmarkRow(row, options = {}) {
        if (!row) {
            return false;
        }
        this.updateNavigableElements();
        const idx = this.navigableElements.indexOf(row);
        if (idx < 0) {
            return false;
        }
        this.currentIndex = idx;
        // A selection restored on purpose is not the stale highlight the dimming
        // is for, so it must be drawn at full strength. Rebuilding a row can fire
        // a pointerover the user never caused, which would otherwise soften the
        // row that was just selected.
        this.restoreKbdSelection();
        requestAnimationFrame(() => {
            if (this.navigableElements[this.currentIndex] === row) {
                this.restoreKbdSelection();
            }
        });
        this.highlightCurrentElement({
            focus: options.focus !== false,
            keyboardNav: false,
        });
        return true;
    }

    // Public methods
    _resolveActionPopoverRow() {
        if (this.currentIndex >= 0 && this.currentIndex < this.navigableElements.length) {
            return this.navigableElements[this.currentIndex];
        }
        const active = document.activeElement;
        const row = active?.closest?.('.bookmark-link:not(.bookmark-inline-editing)');
        if (!row) {
            return null;
        }
        this.updateNavigableElements();
        const idx = this.navigableElements.indexOf(row);
        if (idx >= 0) {
            this.currentIndex = idx;
            this.highlightCurrentElement({ focus: false });
        }
        return idx >= 0 ? row : null;
    }

    openMovePopoverForCurrent() {
        const row = this._resolveActionPopoverRow();
        if (!row) return;
        const dash = this.dashboard;
        if (!dash || typeof dash.showMovePopover !== 'function') return;
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) return;
        const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
        dash.showMovePopover(row, bookmark, bookmarkIndex);
    }

    openDeletePopoverForCurrent() {
        const row = this._resolveActionPopoverRow();
        if (!row) return;
        const dash = this.dashboard;
        if (!dash || typeof dash.showDeletePopover !== 'function') return;
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) return;
        const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
        dash.showDeletePopover(row, bookmark, bookmarkIndex);
    }

    openTagPopoverForCurrent() {
        const row = this._resolveActionPopoverRow();
        if (!row) return;
        const dash = this.dashboard;
        if (!dash || typeof dash.showTagPopover !== 'function') return;
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) return;
        const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
        dash.showTagPopover(row, bookmark, bookmarkIndex);
    }

    /**
     * Shift+P — pin or unpin the selected bookmark.
     *
     * Through the same command the palette's :pin uses, so the write, the toast
     * and the re-render stay one implementation.
     */
    togglePinForCurrent() {
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) return;
        const commands = this.dashboard?.searchComponent?.commandsComponent;
        if (typeof commands?._persistBookmarkField !== 'function') return;
        const willPin = !bookmark.pinned;
        bookmark.pinned = willPin;
        // Same write the palette's :pin performs, so there is one persistence
        // path rather than a second one that could drift.
        commands._persistBookmarkField(bookmark, { pinned: willPin });
    }

    /**
     * Shift+S — share, or copy "name — URL" where no share sheet exists.
     *
     * Was right-click only: no command, no key, and absent from the cheat sheet,
     * even though it is the only path that copies the name with the address.
     */
    shareCurrent() {
        const row = this._resolveActionPopoverRow();
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) return;
        void this.dashboard?.contextMenu?.shareBookmark?.(bookmark, row);
    }

    /**
     * Shift+R — open the selected bookmark's row in Health.
     *
     * Shift+H and :health open the view but carry no bookmark, so landing on
     * this particular row was a right-click-only route.
     */
    revealCurrentInHealth() {
        const row = this._resolveActionPopoverRow();
        const bookmark = this.getSelectedBookmark();
        if (!bookmark) return;
        const pageId = Number(this.dashboard?.currentPageId);
        const index = parseInt(row?.dataset?.bookmarkIndex ?? '-1', 10);
        void this.dashboard?.contextMenu?.revealInHealth?.({
            pageId, index, bookmark, scope: index >= 0 ? 'current' : 'all',
        });
    }

    /**
     * t — filter the grid to the tag on the focused row.
     *
     * Returns whether it acted, so the caller only swallows the key when there
     * was a tag to filter by. The row already carries its tags; acting on the
     * one you can see meant opening the tag cloud and hunting for it.
     */
    filterByCurrentTag() {
        const row = this._resolveActionPopoverRow();
        const raw = row?.getAttribute?.('data-bookmark-tags') || '';
        const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
        if (!tags.length) return false;
        const dash = this.dashboard;
        if (tags.length === 1 && typeof dash?.toggleTagFilter === 'function') {
            dash.toggleTagFilter(tags[0]);
            return true;
        }
        // More than one: let the user pick, through the popover that already
        // knows how to render a bookmark's tags.
        const bookmark = this.getSelectedBookmark();
        if (bookmark && typeof dash?.showTagPopover === 'function') {
            dash.showTagPopover(row, bookmark, parseInt(row.dataset.bookmarkIndex ?? '-1', 10));
            return true;
        }
        return false;
    }

    /**
     * Shift+C — availability checking for the selected bookmark.
     *
     * Delegates to the context menu rather than building a second popover: the
     * right-click route and this one open the same menu, so the options, the
     * wording and the write stay one implementation.
     */
    openCheckModePopoverForCurrent() {
        const row = this._resolveActionPopoverRow();
        if (!row) return;
        this.dashboard?.contextMenu?.openCheckModeForRow?.(row);
    }

    enable() {
        this.isEnabled = true;
    }

    disable() {
        this.isEnabled = false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) {
            return;
        }
        this.clearSelection();
    }

    isNavigating() {
        return this.currentIndex !== -1;
    }

    // Select first visible bookmark after page change (no focus steal).
    resetToFirst() {
        this.restoreKbdSelection();
        this.updateNavigableElements();
        if (this.navigableElements.length === 0) {
            this.clearSelection();
            return;
        }
        this.navigableElements.forEach((element) => {
            element.classList.remove('keyboard-selected');
            element.removeAttribute('aria-current');
            element.setAttribute('aria-selected', 'false');
        });
        this.currentIndex = 0;
        const currentElement = this.navigableElements[0];
        currentElement.classList.add('keyboard-selected');
        currentElement.setAttribute('aria-current', 'true');
        currentElement.setAttribute('aria-selected', 'true');
        this.syncRovingTabStops({ focus: false });
        this.syncGridActiveDescendant();
    }
}

// Export for use in other modules
window.KeyboardNavigation = KeyboardNavigation;
