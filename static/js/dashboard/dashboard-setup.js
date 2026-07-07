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
        document.body.setAttribute('data-show-tips', d.shouldShowRotatingTipsNow() ? 'true' : 'false');
        document.body.setAttribute(
            'data-show-tag-cloud-button',
            d.settings.showTagCloudButton === true ? 'true' : 'false'
        );
        document.body.setAttribute('data-button-position', d.settings.buttonBarPosition || 'bottom');

        d.syncTagCloudButtonPlacement();
        d.syncSideRailDiscoverability?.();

        document.body.setAttribute('data-show-shortcuts', d.settings.showShortcuts !== false);
        document.body.setAttribute('data-pin-notes-disabled', 'true');
        document.body.setAttribute('data-show-pin-icon', 'false');
        document.body.setAttribute('data-show-note-icon', 'false');
        document.body.setAttribute('data-layout-preset', d.settings.layoutPreset || 'default');
        const layoutVersion = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.normalizeLayoutVersion(d.settings.layoutVersion)
            : (['classic', 'modern', 'glass'].includes((d.settings.layoutVersion || '').toLowerCase())
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
        // Use all bookmarks if global shortcuts is enabled, otherwise just current page
        const bookmarksForSearch = d.settings.globalShortcuts ? d.allBookmarks : d.bookmarks;
        
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
            if (key === '>') this.markInlineTipUsed('search_open');
            if (key === '?') this.markInlineTipUsed('finder_open');
            if (key === ':') this.markInlineTipUsed('command_open');
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
            if (key >= '1' && key <= '9') {
                if (d.keyboardNavigation?.isGChordActive?.()) {
                    return;
                }

                const pageIndex = parseInt(key) - 1;
                
                // Check if this page exists
                if (pageIndex < d.pages.length) {
                    e.preventDefault();
                    e.stopPropagation();

                    const page = d.pages[pageIndex];
                    void d.requestPageNavigation(page.id).then((switched) => {
                        if (!switched) {
                            return;
                        }
                        this.markInlineTipUsed('page_switch');
                    });
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
                void d.requestPageNavigation(page.id).then((switched) => {
                    if (!switched) {
                        return;
                    }
                    this.markInlineTipUsed('page_switch');
                });
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
            this.buildSearchIndex();
            d.updateHealthBadge();
        });
    }


    initializeButtonTipsRotation() {
        const d = this.dash;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            document.body.setAttribute('data-show-tips', 'false');
            return;
        }
        this.initializeSearchFlowHint();
        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }
        if (d.tipRotationTimer) {
            clearTimeout(d.tipRotationTimer);
            d.tipRotationTimer = null;
        }
        if (d.tipRotationDelayTimer) {
            clearTimeout(d.tipRotationDelayTimer);
            d.tipRotationDelayTimer = null;
        }

        const tipsEnabled = d.areRotatingTipsEnabled();
        if (!tipsEnabled) {
            document.body.setAttribute('data-show-tips', 'false');
            return;
        }

        const tipsDelayMs = window.TipsPolicy?.getTipsStartDelayMs?.() ?? 0;
        if (tipsDelayMs > 0) {
            document.body.setAttribute('data-show-tips', 'false');
            d.tipRotationDelayTimer = setTimeout(() => {
                d.tipRotationDelayTimer = null;
                window.TipsPolicy?.clearTipsStartDelay?.();
                this.initializeButtonTipsRotation();
            }, tipsDelayMs);
            return;
        }

        document.body.setAttribute('data-show-tips', 'true');

        const { priorityTips, normalTips } = window.DashboardTipsCatalog.buildLists({
            language: d.language,
            includeTagCloud: d.isTagCloudTipRelevant?.() === true,
        });

        let normalCounter = 0;
        const run = () => {
            if (!d.shouldShowRotatingTipsNow()) {
                document.body.setAttribute('data-show-tips', 'false');
                return;
            }
            const currentContextTips = this.getInlineContextTipsForCurrentPage();
            if (currentContextTips.length > 0) {
                d.setTipHtml(hintEl, currentContextTips[d.contextTipRotationIndex % currentContextTips.length]);
                d.contextTipRotationIndex += 1;
            } else {
                const showPriority = normalCounter >= 5;
                if (showPriority) {
                    d.setTipHtml(hintEl, priorityTips[d.tipPriorityIndex % priorityTips.length]);
                    d.tipPriorityIndex += 1;
                    normalCounter = 0;
                } else {
                    d.setTipHtml(hintEl, normalTips[d.tipRotationIndex % normalTips.length]);
                    d.tipRotationIndex += 1;
                    normalCounter += 1;
                }
            }
            const delay = 5000 + Math.floor(Math.random() * 3001); // 5-8s
            d.tipRotationTimer = setTimeout(run, delay);
        };
        run();
    }


    /** Refresh context tips after page change without resetting rotation timers or onboarding delay. */
    refreshButtonTipsOnPageChange() {
        const d = this.dash;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            return;
        }
        if (d.tipRotationDelayTimer) {
            return;
        }
        if (!d.tipRotationTimer || !d.shouldShowRotatingTipsNow()) {
            return;
        }
        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }
        const contextTips = this.getInlineContextTipsForCurrentPage();
        if (contextTips.length > 0) {
            d.setTipHtml(hintEl, contextTips[d.contextTipRotationIndex % contextTips.length]);
        }
    }


    teardownDashboardTimers() {
        const d = this.dash;
        if (d.tipRotationTimer) {
            clearTimeout(d.tipRotationTimer);
            d.tipRotationTimer = null;
        }
        if (d.tipRotationDelayTimer) {
            clearTimeout(d.tipRotationDelayTimer);
            d.tipRotationDelayTimer = null;
        }
        if (d.backupTipTimer) {
            clearTimeout(d.backupTipTimer);
            d.backupTipTimer = null;
        }
        if (d._postOnboardingPromptsTimer) {
            clearTimeout(d._postOnboardingPromptsTimer);
            d._postOnboardingPromptsTimer = null;
        }
        if (d.searchComponent?._openBookmarkTimer) {
            clearTimeout(d.searchComponent._openBookmarkTimer);
            d.searchComponent._openBookmarkTimer = null;
        }
    }


    scheduleBackupTip() {
        const d = this.dash;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            return;
        }
        if (d.backupTipShown || d.backupTipTimer) {
            return;
        }

        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }

        if (!d.shouldShowRotatingTipsNow()) {
            return;
        }

        d.backupTipTimer = setTimeout(() => {
            d.backupTipTimer = null;
            if (d.backupTipShown) {
                return;
            }

            const currentHintEl = document.getElementById('button-hint-text');
            if (!currentHintEl || !d.shouldShowRotatingTipsNow()) {
                return;
            }

            d.backupTipShown = true;
            const backupTip = d.language ? d.language.t('dashboard.tipBackup') : 'Tip: create a backup via <a class="button-hint-link" href="/config#backups">config → backups</a>.';
            d.setTipHtml(currentHintEl, backupTip);
        }, 30000);
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

        const isSideRail = document.body.getAttribute('data-button-position') === 'side-left';
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

    getInlineTipUsageState() {
        const d = this.dash;
        try {
            const raw = localStorage.getItem(d.inlineTipUsageStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }
            return parsed;
        } catch {
            return {};
        }
    }


    getCurrentPageTipUsage() {
        const d = this.dash;
        const state = this.getInlineTipUsageState();
        const pageKey = String(Number(d.currentPageId) || d.currentPageId || 'default');
        const pageState = state[pageKey];
        if (!pageState || typeof pageState !== 'object' || Array.isArray(pageState)) {
            return {};
        }
        return pageState;
    }


    markInlineTipUsed(tipKey) {
        const d = this.dash;
        if (!tipKey) return;
        try {
            const state = this.getInlineTipUsageState();
            const pageKey = String(Number(d.currentPageId) || d.currentPageId || 'default');
            if (!state[pageKey] || typeof state[pageKey] !== 'object' || Array.isArray(state[pageKey])) {
                state[pageKey] = {};
            }
            if (state[pageKey][tipKey] === true) {
                return;
            }
            state[pageKey][tipKey] = true;
            localStorage.setItem(d.inlineTipUsageStorageKey, JSON.stringify(state));
            this.initializeButtonTipsRotation();
        } catch {
            // ignore localStorage errors
        }
    }


    getInlineContextTipsForCurrentPage() {
        const d = this.dash;
        const usage = this.getCurrentPageTipUsage();
        const tips = [];
        if (!usage.search_open) {
            tips.push(d.language?.t?.('dashboard.contextTipSearchOpen') || 'Tip: <code>&gt;</code> open search (hides after first use on this page)');
        }
        if (!usage.finder_open) {
            tips.push(d.language?.t?.('dashboard.contextTipFinderOpen') || 'Tip: <code>?</code> open finders (hides after first use on this page)');
        }
        if (!usage.command_open) {
            tips.push(d.language?.t?.('dashboard.contextTipCommandOpen') || 'Tip: <code>:</code> open commands (hides after first use on this page)');
        }
        if (!usage.bookmark_open) {
            tips.push(d.language?.t?.('dashboard.contextTipBookmarkOpen') || 'Tip: open any bookmark once on this page to hide this tip');
        }
        if (Array.isArray(d.pages) && d.pages.length > 1 && !usage.page_switch) {
            tips.push(d.language?.t?.('dashboard.contextTipPageSwitch') || 'Tip: switch page with <code>1-9</code> or <code>Shift+←/→</code> to hide this tip');
        }
        return tips;
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
            this.markInlineTipUsed('bookmark_open');
            try {
                d.dismissBookmarkPreviewInteractions();
            } catch (_err) {
                // ignore errors
            }
        });
    }


    async buildSearchIndex() {
        const d = this.dash;
        try {
            await dashFetch('/api/search-index', {
                method: 'POST',
            });
        } catch (error) {
            // Keep dashboard functional if indexing fails
            console.warn('Search index build failed:', error);
        }
    }

}

window.DashboardSetup = DashboardSetup;
