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
        document.body.setAttribute('data-show-health-dashboard', d.settings.showHealthDashboard !== false);
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

        const tip = (key, fallback = '') => {
            const fullKey = `dashboard.${key}`;
            const v = d.language?.t?.(fullKey);
            if (v && v !== fullKey) return v;
            return fallback || null;
        };
        const tips = (...entries) => entries.map(([key, fb]) => tip(key, fb)).filter(Boolean);
        const tipKeys = (...keys) => keys.map((key) => tip(key)).filter(Boolean);

        const priorityTips = tips(
            ['tipRecentStarShort', 'Tip: <code>*</code> recent'],
            ['tipOpenLastRecent', 'Tip: <code>*</code> shows recent bookmarks — <code>:open last 5</code> in command mode opens them in tabs'],
            ['tipCheatsheetBang', 'Tip: <code>!</code> cheatsheet'],
            ['tipNavigateArrows', 'Tip: <code>↑/↓</code> navigate bookmarks'],
            ['tipEditSemicolon', 'Tip: <code>;</code> edit bookmark (highlighted row or focused link)'],
            ['tipQuickDelete', 'Tip: <code>Shift+D</code> quick-delete — confirm in the popover; undo in the toast'],
            ['tipQuickMove', 'Tip: <code>Shift+M</code> quick-move — choose category or page in the popover'],
            ['tipQuickTag', 'Tip: <code>Shift+T</code> quick-tag — toggle tags on the selected bookmark; ✓ shows tags already applied'],
            ['tipCheatsheetCtrlSlash', 'Tip: <code>F1</code> cheatsheet'],
            ['tipPreviewBracket', 'Tip: <code>[</code> preview card on keyboard-selected bookmark'],
            ['tipCopyUrlCtrlC', 'Tip: <code>Ctrl+C</code> copy URL of keyboard-selected bookmark'],
            ['tipDragStripInlineEdit', 'Tip: left strip = drag reorder; long-press row (not strip) = inline edit'],
        ).concat(tipKeys('tipNewBookmarkAmpersand'));

        const normalTips = tips(
            ['tipSearchCommandFinder', 'Tip: <code>&gt;</code> search, <code>:</code> commands, <code>?</code> finders'],
            ['tipOpenSearch', 'Tip: <code>&gt;</code> open search'],
            ['tipOpenFinders', 'Tip: <code>?</code> open finders'],
            ['tipOpenCommands', 'Tip: <code>:</code> open commands'],
            ['tipJumpToPage', 'Tip: <code>1-9</code> jump to page'],
            ['tipPageOverview', 'Tip: <code>,</code> page overview — see all pages with bookmark counts'],
            ['tipQuickAddAmpersand', 'Tip: <code>&amp;</code> quick-add — name | url | shortcut in one field'],
            ['tipSwitchPage', 'Tip: <code>Shift+←/→</code> switch page'],
            ['tipEnterOpenBookmark', 'Tip: <code>Enter</code> open selected bookmark'],
            ['tipSpaceOpenBookmark', 'Tip: <code>Space</code> open selected bookmark'],
            ['tipInlineEditSemicolon', 'Tip: <code>;</code> inline-edit selected bookmark'],
            ['tipHoverPreview', 'Tip: hover bookmark (name/icon area) to load preview when enabled'],
            ['tipEnableLinkPreview', 'Tip: enable link preview cards in config → general → advanced → bookmarks'],
            ['tipEscCancel', 'Tip: <code>Esc</code> cancel current state'],
            ['tipAltReorderConfig', 'Tip: <code>Alt+↑/↓</code> reorder in config'],
            ['tipSearchCategory', 'Tip: use <code>category:work</code> in search'],
            ['tipSearchTag', 'Tip: use <code>tag:work</code> in search to filter by tag'],
            ['tipSearchStatus', 'Tip: use <code>status:online</code> in search'],
            ['tipSearchPage', 'Tip: use <code>page:2</code> in search'],
            ['tipFinderShortcut', 'Tip: use <code>?g term</code> finder shortcut'],
            ['tipAddTagsConfig', 'Tip: add tags to bookmarks in <code>config</code> → bookmarks'],
            ['tipDynamicCollections', 'Tip: create dynamic collections in <code>config</code> → collections'],
            ['tipTagCollections', 'Tip: enable tag collections in <code>config</code> → general → Smart Collections'],
            ['tipBackupsConfig', 'Tip: backups under <code>config</code> → backups'],
            ['tipCollapseCategory', 'Tip: click a category header to collapse or expand it'],
            ['tipGlobalShortcuts', 'Tip: global shortcuts from all pages in <code>config</code> → general → Dashboard'],
            ['tipLayoutPreset', 'Tip: layout preset & density in <code>config</code> → general → Basics'],
            ['tipLongPressInlineEdit', 'Tip: long-press a bookmark row (not the drag strip) to edit inline'],
            ['tipHealthPage', 'Tip: visit <code>health</code> page to find broken links and duplicates'],
            ['tipHealthFilters', 'Tip: use filters in <code>health</code> page to focus on specific issues'],
            ['tipHealthRefresh', 'Tip: <code>refresh</code> in health page re-scans all bookmarks'],
            ['tipHealthStale', 'Tip: check health page <code>stale</code> bookmarks you haven\'t used recently'],
            ['tipHealthMerge', 'Tip: merge duplicate bookmarks in health page bulk actions'],
            ['tipCommandNote', 'Tip: use <code>:note</code> in the command palette to edit a bookmark\'s note instantly'],
            ['tipInlineRename', 'Tip: press and hold a category title (~500 ms) to rename it; double-click a page tab to rename the page'],
            ['tipPreviewCopyUrl', 'Tip: hover a preview card and click the clipboard icon to copy the URL'],
            ['tipCompactBadge', 'Tip: compact/dense mode shows an open-count badge on each bookmark'],
            ['tipConfigSearchBar', 'Tip: use the search bar in config → bookmarks to filter by name, URL, tag, or note'],
            ['tipThemeToggle', 'Tip: the dark/light toggle button in the header flips the theme variant instantly'],
            ['tipHealthFavicon', 'Tip: use <code>favicon</code> button in health view to refresh a bookmark\'s icon'],
            ['tipNewBookmarkTags', 'Tip: add tags when creating a bookmark via <code>:new</code> — autocomplete suggests existing tags'],
        );
        if (d.isTagCloudTipRelevant()) {
            normalTips.push(...tips(
                ['tipTagCloudSlash', 'Tip: press <code>/</code> for the tag word cloud (desktop) — pick a tag to filter bookmarks on the dashboard'],
            ));
        }
        normalTips.push(
            ...tipKeys(
                'tipUndoDelete',
                'tipFaviconToggle',
                'tipPackedColumns',
                'tipHideShortcutPin',
                'tipKeyboardTab',
                'tipDisableTips',
                'tipDisableTipsAlt',
                'tipNewBookmarkAmpersandShort',
            ),
        );

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
