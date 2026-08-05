/**
 * DOM setup, search/status/nav wiring, tips, tracking.
 */
class DashboardSetup {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    setupDOM() {
        const d = this.dash;
        d.updateDateVisibility();

        document.body.setAttribute('data-show-title', d.settings.showTitle);
        document.body.setAttribute('data-show-date', d.settings.showDate);
        document.body.setAttribute('data-show-config-button', d.settings.showConfigButton !== false);
        document.body.setAttribute('data-show-health-dashboard', d.settings.showHealthDashboard === true);
        document.body.setAttribute('data-show-cheatsheet-button', d.settings.showCheatSheetButton !== false);
        document.body.setAttribute('data-show-add-bookmark-button', d.settings.showAddBookmarkButton !== false);
        document.body.setAttribute('data-show-search-button', d.settings.showSearchButton);
        document.body.setAttribute('data-show-finders-button', d.settings.showFindersButton);
        document.body.setAttribute('data-show-commands-button', d.settings.showCommandsButton);
        document.body.setAttribute('data-show-recent-button', d.settings.showRecentButton !== false);
        document.body.setAttribute(
            'data-show-tag-cloud-button',
            d.settings.showTagCloudButton === true ? 'true' : 'false'
        );
        const barPosition = d.settings.buttonBarPosition || 'bottom';
        document.body.setAttribute('data-button-position', barPosition);
        // Side-agnostic hook: layout-side-rail.css keys every rail rule off this
        // and reads the physical side from variables, so the two rails share one
        // set of rules instead of mirrored copies.
        if (barPosition === 'side-left' || barPosition === 'side-right') {
            document.body.setAttribute('data-rail', barPosition === 'side-left' ? 'left' : 'right');
        } else {
            document.body.removeAttribute('data-rail');
        }

        d.syncTagCloudButtonPlacement();
        d.syncSideRailDiscoverability?.();

        document.body.setAttribute('data-show-shortcuts', d.settings.showShortcuts !== false);
        const showPinIcon = d.settings.showPinIcon === true;
        const showNoteIcon = d.settings.showNoteIcon !== false;
        document.body.setAttribute('data-pin-notes-disabled', (!showPinIcon && !showNoteIcon) ? 'true' : 'false');
        document.body.setAttribute('data-show-pin-icon', showPinIcon ? 'true' : 'false');
        document.body.setAttribute('data-show-note-icon', showNoteIcon ? 'true' : 'false');
        document.body.setAttribute('data-layout-preset', d.settings.layoutPreset || 'default');
        const layoutVersion = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.normalizeLayoutVersion(d.settings.layoutVersion)
            : (['classic', 'modern'].includes((d.settings.layoutVersion || '').toLowerCase())
                ? (d.settings.layoutVersion || 'classic').toLowerCase()
                : 'classic');
        d.settings.layoutVersion = layoutVersion;
        if (window.LayoutVersionUtils) {
            window.LayoutVersionUtils.applyLayoutVersionToDOM(layoutVersion);
        } else {
            document.documentElement.setAttribute('data-layout-version', layoutVersion);
            document.body.setAttribute('data-layout-version', layoutVersion);
        }
        document.body.setAttribute('data-density-mode', d.settings.densityMode || 'compact');

        // Apply font size
        d.applyFontSize();

        if (window.DashboardFont) {
            window.DashboardFont.applyMainFont(d.settings);
        }

        // Apply background dots
        d.applyBackgroundDots();

        // Apply animations
        d.applyAnimations();

        // Control title visibility dynamically
        d.updateTitleVisibility();
        
        // Control config button visibility dynamically  
        d.updateConfigButtonVisibility();

        // Control health beta link visibility dynamically
        d.updateHealthDashboardVisibility();

        // Control page tabs visibility dynamically
        d.updatePageTabsVisibility();
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
            d.searchComponent = new window.SearchComponent(bookmarksForSearch, d.bookmarks, d.allBookmarks, d.settings, d.language, d.finders, d.pages);
        } else {
            console.warn('SearchComponent not found. Make sure search.js is loaded.');
        }
    }

    // Method to update search component when data changes

    updateSearchComponent() {
        const d = this.dash;
        if (d.searchComponent) {
            // Use all bookmarks if global shortcuts is enabled, otherwise just current page
            const bookmarksForSearch = d.settings.globalShortcuts ? d.allBookmarks : d.bookmarks;
            d.searchComponent.updateData(bookmarksForSearch, d.bookmarks, d.allBookmarks, d.settings, d.language, d.finders, d.pages);
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
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
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
                d.showKeyboardCheatSheet();
                return;
            }

            if (e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                d.showPageOverlay();
                return;
            }

            // '<' (Shift+,) — jump to config. Layout-independent: also accept the
            // physical comma key with Shift, since some layouts don't emit '<'.
            if (e.key === '<' || (e.code === 'Comma' && e.shiftKey)) {
                e.preventDefault();
                e.stopPropagation();
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
                if (d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
                    e.preventDefault();
                    e.stopPropagation();
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
                    void d.health.openHealthView();
                }
                return;
            }

            if (e.shiftKey && e.code === 'KeyI') {
                if (d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
                    e.preventDefault();
                    e.stopPropagation();
                    void d.inbox.openInboxView();
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
                    window.nextdashTrack?.('nav:config-shortcut', { dir: 'to-config' });
                    void d.config.openConfigView();
                }
                return;
            }
            if (key >= '1' && key <= '9') {
                if (d.keyboardNavigation?.isGChordActive?.()) {
                    return;
                }

                const pageIndex = parseInt(key, 10) - 1;
                
                // Check if this page exists
                if (pageIndex < d.pages.length) {
                    e.preventDefault();
                    e.stopPropagation();

                    const page = d.pages[pageIndex];
                    void d.requestPageNavigation(page.id);
                }
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

        const isSideRail = document.body.hasAttribute('data-rail');
        const storageKey = isSideRail
            ? 'nextdash:search-flow-hint-side-rail-v1'
            : 'nextdash:search-flow-hint-v2';
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
