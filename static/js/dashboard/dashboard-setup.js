/**
 * DOM setup, search/status/nav wiring, tips, tracking.
 */
class DashboardSetup {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    /**
     * Says whether the page has been scrolled away from the top.
     *
     * The view header is a sticky band drawn at 55% of the surface, which reads
     * as part of the page while the page starts under it -- and as a smear once
     * rows are passing behind it. This is the one fact the CSS needs to paint it
     * solid while that is true, and it is a fact about the window rather than
     * about the inbox, health or config in particular, so it is answered once
     * here instead of three times over there.
     *
     * Bound once and never removed: the handler is a comparison and an attribute
     * write, and the page it is bound to outlives every view.
     */
    bindScrolledState() {
        if (this._scrolledStateBound) return;
        this._scrolledStateBound = true;
        const sync = () => {
            const y = window.scrollY || document.documentElement.scrollTop || 0;
            document.body.setAttribute('data-scrolled', y > 4 ? 'true' : 'false');
        };
        window.addEventListener('scroll', sync, { passive: true });
        // A reload starts at the top, and so does the back/forward cache after
        // the browser restores the scroll position -- hence both.
        window.addEventListener('pageshow', sync);
        this._syncScrolledState = sync;
        sync();
    }


    setupDOM() {
        const d = this.dash;
        d.updateDateVisibility();
        this.bindScrolledState();
        // Opening a view scrolls the page back to the top, and that happens
        // without a scroll event to hear about it.
        this._syncScrolledState?.();

        document.body.setAttribute('data-show-title', d.settings.showTitle);
        // How far a row's accent carries when it lights up. Written here as
        // well as by the server, so changing it in config lands without a
        // reload; the CSS reads the attribute, see dashboard-bookmark-row.css.
        document.body.setAttribute('data-row-highlight',
            d.settings.rowHighlight === 'strong' ? 'strong' : 'subtle');
        document.body.setAttribute('data-show-date', d.settings.showDate);
        document.body.setAttribute('data-show-config-button', d.settings.showConfigButton !== false);
        document.body.setAttribute('data-show-health-dashboard', d.settings.showHealthDashboard === true);
        document.body.setAttribute('data-show-pages-button', d.settings.showPagesButton !== false);
        document.body.setAttribute('data-show-inbox-button', d.settings.showInboxButton !== false);
        document.body.setAttribute('data-show-dashboard-button', d.settings.showDashboardButton !== false);
        document.body.setAttribute('data-show-cheatsheet-button', d.settings.showCheatSheetButton !== false);
        document.body.setAttribute('data-show-collapse-all-button', d.settings.showCollapseAllButton !== false);
        document.body.setAttribute('data-show-add-bookmark-button', d.settings.showAddBookmarkButton !== false);
        document.body.setAttribute('data-show-search-button', d.settings.showSearchButton);
        document.body.setAttribute('data-show-finders-button', d.settings.showFindersButton);
        document.body.setAttribute('data-show-commands-button', d.settings.showCommandsButton);
        document.body.setAttribute('data-show-recent-button', d.settings.showRecentButton !== false);
        document.body.setAttribute(
            'data-show-tag-cloud-button',
            d.settings.showTagCloudButton === true ? 'true' : 'false'
        );
        // Where the clock and the weather are drawn: beside the name, or in a
        // zone of their own between the name and the pages. CSS reads it off
        // <body>, so switching it is a repaint rather than a re-render.
        document.body.setAttribute(
            'data-header-clock',
            ['own-zone', 'classic'].includes(d.settings.headerClockPlacement)
                ? d.settings.headerClockPlacement
                : 'beside-name'
        );
        // How much room the pages take in the middle of the band: one segmented
        // control, plain text with an underline, or a single button naming the
        // page you are on. CSS reads it off <body>; the compact one also takes
        // a cap of one tab, which dashboard-page-nav.js reads from the setting.
        // Plain glyphs with a rule under the current one, or a plate around
        // every control: one answer for the tabs, the actions and the
        // destinations alike. CSS reads it off <body>.
        // Where the action buttons stand. CSS moves the one group that already
        // holds them, so the buttons, their keys and their handlers stay put.
        document.body.setAttribute(
            'data-action-bar',
            ['bottom', 'left', 'right', 'menu'].includes(d.settings.actionBarPosition)
                ? d.settings.actionBarPosition
                : 'header'
        );
        // Off draws no action buttons anywhere; their keys keep working. The
        // seconds are what the dock waits before sliding into its edge.
        document.body.setAttribute('data-action-bar-enabled',
            d.settings.actionBarEnabled === false ? 'off' : 'on');
        document.body.setAttribute('data-action-keys',
            d.settings.showActionKeys === false ? 'off' : 'on');
        window.ActionBarAutoHide?.sync();
        document.body.setAttribute(
            'data-header-buttons',
            d.settings.headerButtonStyle === 'plated' ? 'plated' : 'plain'
        );
        const switcher = d.settings.pageSwitcherStyle;
        document.body.setAttribute(
            'data-page-switcher',
            ['text', 'segmented', 'compact'].includes(switcher) ? switcher : 'classic'
        );

        d.publishButtonBarHeight?.();

        d.syncTagCloudButtonPlacement();
        // After the data-show-* attributes above: which actions are on the bar
        // at all is their answer, and the fold takes what is left.
        d.syncHeaderActionOverflow?.();

        // One attribute, three answers. The row always builds the label when the
        // bookmark has one; whether it is on screen, and whether it stands in
        // the row's flow, is decided from here in CSS -- so changing the setting
        // is a repaint rather than a re-render, the same bargain data-check-mode
        // makes in dashboard-bookmark-rows.js.
        //
        // No normalising here: the store does it on read and on save, so the
        // only value that can arrive unrecognised is an absent one, and that
        // reads as "always" for the same reason it does server-side -- see
        // normalizeShortcutDisplay in models.go.
        document.body.setAttribute('data-shortcut-display', d.settings.shortcutDisplay || 'always');
        const showPinIcon = d.settings.showPinIcon === true;
        const showNoteIcon = d.settings.showNoteIcon !== false;
        document.body.setAttribute('data-pin-notes-disabled', (!showPinIcon && !showNoteIcon) ? 'true' : 'false');
        document.body.setAttribute('data-show-pin-icon', showPinIcon ? 'true' : 'false');
        document.body.setAttribute('data-show-note-icon', showNoteIcon ? 'true' : 'false');
        document.body.setAttribute('data-layout-preset', d.settings.layoutPreset || 'default');
        document.body.setAttribute('data-density-mode', d.settings.densityMode || 'compact');
        /*
         * A density kept in localStorage by the old list-row setting is carried
         * into this one, once. Here rather than at module load: the push needs
         * the settings object, and it needs the value above already stamped so
         * it can tell whether there is anything to carry.
         */
        window.ListDensity?.migrate?.();
        // Vertical gap between category rows. Separate from density, which sizes
        // the bookmark rows themselves — see dashboard.css.
        document.body.setAttribute('data-category-spacing', d.settings.categorySpacing || 'balanced');
        // The left/right band beside the grid.
        document.body.setAttribute('data-side-margin', d.settings.sideMargin || 'balanced');
        // How loudly a monitored bookmark announces itself. CSS keys off this,
        // so the rows carry their monitor state either way and only the styling
        // changes — see status.css.
        document.body.setAttribute('data-monitor-emphasis', d.settings.monitorEmphasis || 'problems');

        // Apply font size
        d.applyFontSize();

        if (window.DashboardFont) {
            window.DashboardFont.applyMainFont(d.settings);
        }

        // Apply animations
        d.applyAnimations();

        // Control title visibility dynamically
        d.updateTitleVisibility();
        
        // Control config button visibility dynamically  
        d.updateConfigButtonVisibility();

        // Control health beta link visibility dynamically
        d.updateHealthDashboardVisibility();

        // Control unsorted link visibility dynamically
        d.updateUnsortedVisibility();

        // Control page tabs visibility dynamically
        d.updatePageTabsVisibility();
        // After the three above: each of them decides whether one side of the
        // band draws anything, and the rule between them follows that.
        d.visual?.syncHeaderZoneDividers?.();
        this.initializeButtonTipsRotation();

        // Apply columns setting
        d.syncDashboardGridLayout();
    }

    // Helper to find the header container used across different templates/layouts

    getHeaderContainer() {
        const d = this.dash;
        // Prefer an explicit .header if present, fall back to known header-top / header-actions
        const header = document.querySelector('.header') || document.querySelector('.header-top') || document.querySelector('.header-actions') || document.querySelector('.dashboard-section.section-controls .container');
        // Final fallback to body so insert/append operations don't throw
        return header || document.body;
    }


    initializeSearchComponent() {
        const d = this.dash;
        // Initialize search component with current data
        // Use all bookmarks if global shortcuts is enabled, otherwise just current page.
        // Either source can still be null this early on a fresh/empty dashboard, so default to [].
        const bookmarksForSearch = (d.settings.globalShortcuts ? d.allBookmarks : d.bookmarks) || [];

        if (window.SearchComponent) {
            d.searchComponent = new window.SearchComponent(
                this.searchBookmarkPool(bookmarksForSearch), d.bookmarks, d.allBookmarks,
                d.settings, d.language, d.finders, d.pages);
        }
        // No else: search lives in its own bundle now and is fetched by the key
        // that opens it (see search-loader.js), so arriving here without it is
        // the ordinary case on first paint rather than a missing file. The
        // loader calls this again once the code lands.
    }

    /**
     * What search may look through: the dashboard's bookmarks, plus the ones
     * kept in Unsorted.
     *
     * Search is the one surface outside its own view where a kept bookmark may
     * turn up. Everywhere else -- config's list, the tag cloud, the smart
     * collections, health -- it stays out, which is why it is no longer part of
     * allBookmarks at all. But a bookmark nothing can find is a bookmark you
     * have lost, so search reaches into Unsorted as well and says so with a
     * badge on the row. Switchable, because a reader who treats Unsorted as a
     * holding pen may not want it answering.
     *
     * Used by both the first build and every refresh: the component is
     * constructed from its own copy of the data, so a pool assembled in only
     * one of the two would be right until the first render and wrong after it,
     * or the other way round.
     *
     * The kept rows are appended whatever `globalShortcuts` says, and that is
     * deliberate rather than an oversight. That setting scopes search to the
     * page you are standing on, and Unsorted is not a page -- nothing on the
     * dashboard routes to it, and standing on page 2 says nothing about what
     * you want out of the holding pen. `searchUnsorted` is the one switch that
     * governs these rows; scoping them to a page as well would mean that with
     * global shortcuts off they could not be found anywhere, which is the exact
     * loss this feature exists to prevent.
     */
    searchBookmarkPool(bookmarksForSearch) {
        const d = this.dash;
        const base = bookmarksForSearch || [];
        if (d.settings?.searchUnsorted === false) {
            return base;
        }
        /*
         * Deduped by URL, and the filed copy wins.
         *
         * The same address can sit on a page and still have a copy waiting in
         * Unsorted -- keeping one from the inbox does not check whether it is
         * already filed somewhere. Concatenated plainly, that URL answered
         * twice, and the second row claimed it was unsorted when a home for it
         * already existed. A bookmark that has a home is presented as being in
         * that home.
         */
        const seen = new Set(base
            .map((bookmark) => String(bookmark?.url || '').trim())
            .filter(Boolean));
        const kept = (d.unsortedBookmarks || []).filter((bookmark) => {
            const url = String(bookmark?.url || '').trim();
            // A row with no address cannot collide with one, so it rides along.
            if (!url) return true;
            if (seen.has(url)) return false;
            seen.add(url);
            return true;
        });
        return [...base, ...kept];
    }

    // Method to update search component when data changes

    updateSearchComponent() {
        const d = this.dash;
        if (d.searchComponent) {
            // Use all bookmarks if global shortcuts is enabled, otherwise just current page
            const bookmarksForSearch = d.settings.globalShortcuts ? d.allBookmarks : d.bookmarks;
            d.searchComponent.updateData(
                this.searchBookmarkPool(bookmarksForSearch), d.bookmarks, d.allBookmarks,
                d.settings, d.language, d.finders, d.pages);
        }
        window.DashboardTagCloud?.syncFromSettings?.();
    }


    applyFindFilter(query) {
        const d = this.dash;
        d._findFilter = query || '';
        const layout = document.getElementById('dashboard-layout');

        if (!d._findFilter) {
            layout?.querySelectorAll('.bookmark-link').forEach(t => t.classList.remove('find-hidden'));
            d.keyboardNavigation?.scheduleUpdate?.();
            return;
        }

        const q = d._findFilter.toLowerCase();
        layout?.querySelectorAll('.bookmark-link').forEach(tile => {
            const name = (tile.querySelector('.bookmark-text')?.textContent || '').toLowerCase();
            const url  = (tile.getAttribute('data-bookmark-url') || '').toLowerCase();
            tile.classList.toggle('find-hidden', !name.includes(q) && !url.includes(q));
        });
        d.keyboardNavigation?.scheduleUpdate?.();
    }


    initializeStatusMonitor() {
        const d = this.dash;
        // Initialize status monitor with current settings
        if (window.StatusMonitor) {
            d.statusMonitor = new window.StatusMonitor(d.settings);
            // Make dashboard instance available globally for status monitor
            window.dashboardInstance = d;
        } else {
            console.warn('StatusMonitor not found. Make sure status.js is loaded.');
        }
    }


    initializeKeyboardNavigation() {
        const d = this.dash;
        d.keyboardNavigation?.cleanup?.();
        if (window.KeyboardNavigation) {
            d.keyboardNavigation = new window.KeyboardNavigation(d);
        } else {
            console.warn('KeyboardNavigation not found. Make sure keyboard-navigation.js is loaded.');
        }
    }


    initializeSwipeNavigation() {
        const d = this.dash;
        d.swipeNavigation?.cleanup?.();
        // Initialize swipe navigation component for touch gestures
        if (window.SwipeNavigation) {
            d.swipeNavigation = new window.SwipeNavigation(d);
        } else {
            console.warn('SwipeNavigation not found. Make sure swipe-navigation.js is loaded.');
        }
        this._updatePageSwipeHint();
    }


    _updatePageSwipeHint() {
        const d = this.dash;
        const hint = document.getElementById('page-swipe-hint');
        if (!hint) return;
        const multiPage = Array.isArray(d.pages) && d.pages.length > 1;
        const touch = d.isCoarsePointer();
        if (multiPage && touch) {
            hint.removeAttribute('hidden');
        } else {
            hint.setAttribute('hidden', '');
        }
    }


    initializeHyprMode() {
        const d = this.dash;
        // Initialize HyprMode component
        if (window.hyprMode) {
            window.hyprMode.init(d.settings.hyprMode || false, d.language);
        } else {
            console.warn('HyprMode not found. Make sure hypr-mode.js is loaded.');
        }
    }

    // Method to update status monitor when settings change

    updateStatusMonitor() {
        const d = this.dash;
        if (d.statusMonitor) {
            d.statusMonitor.updateSettings(d.settings);
            if (d.settings.showStatus && document.querySelector('#dashboard-layout .bookmark-link')) {
                d.statusMonitor.refreshAllStatuses?.();
            }
        }
    }


    setupPageShortcuts() {
        const d = this.dash;
        // Listen for number key presses to switch pages
        document.addEventListener('keydown', (e) => {
            // Only handle number keys 1-9
            // Ignore if user is typing in an input field or if search is active
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT'
                || e.target.isContentEditable) {
                return;
            }
            if (document.body.classList.contains('bookmark-inline-edit-active')) {
                return;
            }

            // Check if shortcut search is active
            const searchElement = document.getElementById('shortcut-search');
            if (searchElement && searchElement.classList.contains('show')) {
                return;
            }

            if (d.isModalOpen()) {
                return;
            }

            if (d.searchComponent && d.searchComponent.isActive()) {
                return;
            }

            if (window.DashboardTagCloud?.modalOpen) {
                if (e.key === '/' && window.DashboardTagCloud.handleSlashKey?.(e)) {
                    return;
                }
                return;
            }
            
            // Don't trigger if Ctrl, Alt, or Meta are pressed (but allow Shift)
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }

            if (e.key === 'F1') {
                e.preventDefault();
                e.stopPropagation();
                window.nextdashRecordKey?.('! or F1');
                d.showKeyboardCheatSheet();
                return;
            }

            if (e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                window.nextdashRecordKey?.(',');
                d.showPageOverlay();
                return;
            }

            // ' or Shift+O — slide a docked action bar out of view or back.
            if (e.key === "'" || (e.code === 'KeyO' && e.shiftKey)) {
                if (window.ActionBarAutoHide?.toggle()) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.("' or Shift+O");
                    return;
                }
            }

            // '<' (Shift+,) — jump to config. Layout-independent: also accept the
            // physical comma key with Shift, since some layouts don't emit '<'.
            if (e.key === '<' || (e.code === 'Comma' && e.shiftKey)) {
                e.preventDefault();
                e.stopPropagation();
                window.nextdashRecordKey?.('<');
                window.nextdashTrack?.('nav:config-shortcut', { dir: 'to-config' });
                // Same destination as Shift+S: the config view, in place. This
                // used to navigate to the standalone /config page with a full
                // reload, so the two config shortcuts landed somewhere
                // different. Falls back to the old page only if the view is
                // unavailable, so the key never becomes a no-op.
                if (d.config?.openConfigView) {
                    void d.config.openConfigView();
                } else {
                    window.location.href = '/config';
                }
                return;
            }

            if (e.key === '&') {
                e.preventDefault();
                e.stopPropagation();
                window.nextdashRecordKey?.('&');
                d.showOmnibox();
                return;
            }

            const key = e.key;

            if (key === '/') {
                if (window.DashboardTagCloud?.handleSlashKey?.(e)) {
                    return;
                }
            }

            // Check if a number key (1-9) was pressed
            // Legacy inbox shortcut. Superseded by Shift+I and no longer documented
            // in the cheat sheet, but kept working so it does not break the habit of
            // anyone already using it.
            if (key === '0') {
                if (d.keyboardNavigation?.isGChordActive?.()) {
                    return;
                }
                // Swallowed either way: with the inbox off there is nothing for
                // 0 to open, and letting it through put the shortcut palette on
                // screen instead -- see the digit branch below.
                e.preventDefault();
                e.stopPropagation();
                if (d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
                    void d.inbox.openInboxView();
                }
                return;
            }

            // Shift+letter opens a view. Shift-modified rather than a bare letter
            // because bare letters open the shortcut search, which is how a bookmark
            // with that shortcut letter is reached.
            // e.code, not e.key: on a layout where Shift+H yields another character
            // the physical key is still the one the user pressed.
            if (e.shiftKey && e.code === 'KeyH') {
                if (d.health?.isEnabled?.()) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('Shift + H');
                    void d.health.openHealthView();
                }
                return;
            }

            // Shift+Q flips the search mode where you are, rather than in
            // config. Which way a bare query is read — letters find names, or
            // letters find shortcuts — is the kind of thing you want to change
            // for one search and change back, and walking to Behavior → Search
            // for that is longer than the search itself.
            if (e.shiftKey && e.code === 'KeyQ') {
                e.preventDefault();
                e.stopPropagation();
                window.nextdashRecordKey?.('Shift + Q');
                void d.toggleSearchMode?.();
                return;
            }

            if (e.shiftKey && e.code === 'KeyI') {
                if (d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('Shift + I');
                    void d.inbox.openInboxView();
                }
                return;
            }

            if (e.shiftKey && e.code === 'KeyU') {
                if (d.unsorted?.isEnabled?.()) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('Shift + U');
                    void d.unsorted.openUnsortedView();
                }
                return;
            }

            // Shift+S opens the config view in place. Unlike '<' above, which
            // still navigates to the old standalone /config page, this stays
            // inside the dashboard shell — nothing reloads.
            if (e.shiftKey && e.code === 'KeyS') {
                if (d.config?.openConfigView) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('Shift + S');
                    window.nextdashTrack?.('nav:config-shortcut', { dir: 'to-config' });
                    void d.config.openConfigView();
                }
                return;
            }

            // Shift+A opens the theme browser -- Appearance, the same
            // first-letter mnemonic as Shift+I (Inbox), Shift+H (Health) and
            // Shift+S (Settings) above. It goes straight to the modal that
            // "Browse themes" in Appearance opens, via the config view's own
            // openThemeBrowser(), rather than stopping at the section: config
            // never has to be entered just to switch a theme.
            if (e.shiftKey && e.code === 'KeyA') {
                if (d.config?.openThemeBrowser) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('Shift + A');
                    window.nextdashTrack?.('nav:theme-browser-shortcut');
                    void d.config.openThemeBrowser();
                }
                return;
            }
            if (key >= '1' && key <= '9') {
                if (d.keyboardNavigation?.isGChordActive?.()) {
                    return;
                }

                const pageIndex = parseInt(key, 10) - 1;

                if (pageIndex < d.pages.length) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nextdashRecordKey?.('1–9');

                    const page = d.pages[pageIndex];
                    void d.requestPageNavigation(page.id);
                    return;
                }

                /*
                 * A digit with no page behind it is still the pages' key.
                 *
                 * Left to fall through it reached the shortcut palette, so 5 on
                 * a two-page install opened a search box while 2 switched pages
                 * -- the same key doing two unrelated things depending on how
                 * many pages you happen to have, and changing meaning the
                 * moment you add one. Swallowed here instead: 1-9 switch pages
                 * or do nothing at all.
                 */
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Handle Shift + Arrow keys for page navigation
            if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
                e.preventDefault();
                e.stopPropagation();

                const currentIndex = d.pages.findIndex((page) => d.samePageId(page.id, d.currentPageId));
                if (currentIndex === -1) return;

                let newIndex;
                if (key === 'ArrowLeft') {
                    newIndex = currentIndex > 0 ? currentIndex - 1 : d.pages.length - 1;
                } else {
                    newIndex = currentIndex < d.pages.length - 1 ? currentIndex + 1 : 0;
                }

                const page = d.pages[newIndex];
                void d.requestPageNavigation(page.id);
            }
        });
    }


    setupExtensionBookmarkSavedListener() {
        const d = this.dash;
        window.addEventListener('nextdash:bookmark-saved', async (event) => {
            const detail = event.detail || {};
            const fallback = d.language?.t('dashboard.extensionBookmarkSaved')
                || 'Bookmark saved from extension';
            const message = detail.message || fallback;
            d.showNotification(message, 'success', { duration: 6000 });

            if (d.inlineEditingBookmarkIndex !== null) {
                d.updateHealthBadge();
                return;
            }

            const pageId = detail.pageId != null ? String(detail.pageId) : null;
            if (pageId && pageId !== String(d.currentPageId)) {
                d.data?.invalidatePageDataCache?.(Number(pageId));
                if (d.needsCrossPageBookmarks()) {
                    await d.loadAllBookmarks();
                }
            } else if (pageId) {
                d.data?.invalidatePageDataCache?.(Number(d.currentPageId));
                await d.loadPageBookmarks(d.currentPageId, { forceFetch: true, animate: false });
            } else {
                await d.loadAllBookmarks();
            }
            d.updateHealthBadge();
        });
    }


    /**
     * Rotating footer tips are gone; the search-flow hint that shared this entry
     * point is not. Kept under the old name because mobile-experience.js and the
     * dashboard both call it on layout/settings changes.
     */
    initializeButtonTipsRotation() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            return;
        }
        this.initializeSearchFlowHint();
    }



    teardownDashboardTimers() {
        const d = this.dash;
        d.visual?.stopHealthBadgePolling?.();
        if (d._postOnboardingPromptsTimer) {
            clearTimeout(d._postOnboardingPromptsTimer);
            d._postOnboardingPromptsTimer = null;
        }
        if (d.searchComponent?._openBookmarkTimer) {
            clearTimeout(d.searchComponent._openBookmarkTimer);
            d.searchComponent._openBookmarkTimer = null;
        }
    }




    initializeSearchFlowHint() {
        const d = this.dash;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return;
        if (d.onboardingStartedInSession) return;
        if (d.settings?.onboardingCompleted !== true) return;
        const hintEl = document.getElementById('search-flow-hint');
        if (!hintEl) return;

        if (d.isCoarsePointer()) {
            hintEl.querySelectorAll('.sfh-seg-swipe').forEach((el) => el.classList.remove('hidden'));
        }

        const storageKey = 'nextdash:search-flow-hint-v2';
        try {
            if (localStorage.getItem(storageKey)) return;
        } catch {}

        hintEl.hidden = false;
        try { localStorage.setItem(storageKey, '1'); } catch {}

        // CSS handles the staggered wipe animation on .sfh-seg spans.
        // Last segment delay is 2.22s + 0.3s duration; dismiss after segments + reading time.
        setTimeout(() => {
            hintEl.classList.add('dismissing');
            setTimeout(() => { hintEl.hidden = true; }, 500);
        }, 6200);
    }









    setupBookmarkTracking() {
        const d = this.dash;
        document.addEventListener('click', (e) => {
            if (e.target.closest('.bookmark-inline-form')) {
                return;
            }
            const openLink = e.target.closest('a.bookmark-open');
            if (!openLink) {
                return;
            }
            try {
                d.dismissBookmarkPreviewInteractions();
            } catch (_err) {
                // ignore errors
            }
        });
    }

}

window.DashboardSetup = DashboardSetup;
