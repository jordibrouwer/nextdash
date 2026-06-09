/**
 * One-time guided tour on Config → Tags (cloud, list, add tag on new bookmark, cleanup).
 * Same UX as other config tours: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigTagsTour {
    static STORAGE_KEY = 'nextdash:config-tags-tour-v1';
    static DEMO_FLAG = '_configTagsTourDemo';
    static DEMO_TAG = 'tour-demo';
    static DEMO_URL = 'https://example.com/tags-tour';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigTagsTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._demoBookmarkIndex = null;
        this._demoAddHandled = false;
        this._demoTagApplied = false;
        this._demoCleanupHandled = false;
        this._demoCleanupInProgress = false;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigTagsTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="tags"]')) return 'no-tags-tab';
        return null;
    }

    t(key, fallback) {
        const full = `config.${key}`;
        if (!this.language || typeof this.language.t !== 'function') return fallback;
        const raw = this.language.t(full);
        return raw && raw !== full ? raw : fallback;
    }

    hasCompletedTour() {
        if (this.hasSeen?.()) return true;
        try {
            return localStorage.getItem(this.storageKey) === '1';
        } catch {
            return false;
        }
    }

    canStart({ force = false } = {}) {
        if (!force && this.hasCompletedTour()) return false;
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return false;
        if (!document.querySelector('[data-tab-content="tags"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-tags-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-tags-tour-active');
        document.body.classList.remove('config-tags-tour-ready');
        document.documentElement.classList.remove('config-tags-tour-scroll-lock');
        document.body.classList.remove('config-tags-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-tags-tour-highlight')
            .forEach((el) => el.classList.remove('config-tags-tour-highlight'));
        if (window.configManager) {
            window.configManager._configTagsTourActive = false;
        }
        document.body.removeAttribute('data-config-tags-tour-bookmarks-phase');
        document.querySelectorAll('.tag-ac-dropdown').forEach((el) => el.remove());
        window.ConfigTourRuntime?.removeTourPortalIfEmpty?.();
        window.GuidedFlowGuard?.syncModalOpenClass?.();
    }

    isTagsTabActive() {
        const mgr = window.configManager;
        if (mgr?.isConfigTagsTabActive?.()) return true;
        if (mgr?.ui?._currentTab === 'tags') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'tags') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'tags';
    }

    ensureTagsTabActive() {
        if (!this.isTagsTabActive()) {
            const mgr = window.configManager;
            if (mgr?.ui?.switchToTab) {
                mgr.ui.switchToTab('tags');
            } else {
                const panel = document.querySelector('[data-tab-content="tags"]');
                if (panel && !panel.classList.contains('active')) {
                    document.querySelector('.tab-button[data-tab="tags"]')?.click();
                }
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'tags') {
            window.history.replaceState(null, '', '#tags');
        }
    }

    ensureBookmarksTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('bookmarks');
        } else {
            document.querySelector('.tab-button[data-tab="bookmarks"]')?.click();
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'bookmarks' && !hash.startsWith('bookmarks/')) {
            window.history.replaceState(null, '', '#bookmarks');
        }
        document.body.setAttribute('data-config-tags-tour-bookmarks-phase', 'true');
    }

    isBookmarksPhaseStep(step) {
        const id = step?.id;
        return id === 'bookmarks-intro' || id === 'tags-field';
    }

    async waitForBookmarksTabActive(maxAttempts = 50) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureBookmarksTabActive();
            const panel = document.querySelector('[data-tab-content="bookmarks"]');
            const addBtn = document.getElementById('add-bookmark-btn');
            if (panel?.classList.contains('active') && addBtn) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="bookmarks"]')?.classList.contains('active') &&
                document.getElementById('add-bookmark-btn')
        );
    }

    dismissTagAutocompleteOverlays() {
        document.querySelectorAll('.tag-ac-dropdown').forEach((el) => el.remove());
        const tagsEl = document.getElementById('detail-tags');
        if (tagsEl && typeof window.TagAutocomplete?.detach === 'function') {
            window.TagAutocomplete.detach(tagsEl);
        }
    }

    ensureTourCardInteractive() {
        document.body.classList.remove('guided-flow-modal-open');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        if (this.card) {
            window.ConfigTourRuntime?.reaffirmTourCard?.(this.card);
        }
    }

    ensurePageReady() {
        if (document.body?.classList.contains('loading')) {
            if (window.SkeletonLoading?.finish) {
                window.SkeletonLoading.finish();
            } else {
                document.body.classList.remove('loading');
            }
        }
    }

    async waitForDetailTagsField(maxAttempts = 30) {
        for (let i = 0; i < maxAttempts; i += 1) {
            const tags = document.getElementById('detail-tags');
            const form = document.getElementById('bookmark-detail-form');
            if (tags && form && form.style.display !== 'none') return tags;
            await this.waitMs(60);
        }
        return document.getElementById('detail-tags');
    }

    async waitForTagsTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureTagsTabActive();
            const panel = document.querySelector('[data-tab-content="tags"]');
            const list = document.getElementById('tags-list');
            if (panel && list && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="tags"]') && document.getElementById('tags-list')
        );
    }

    ensureTagsDataReady() {
        void this.reloadAllBookmarksForTagsView();
    }

    /** Reload tag data from the server (tags tab reads allBookmarksData). */
    async reloadAllBookmarksForTagsView() {
        const mgr = window.configManager;
        if (!mgr?.reloadTagsTabData) return;
        await mgr.reloadTagsTabData();
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-tags-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-tags-tour-scroll-lock');
        document.body.classList.add('config-tags-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-tags-tour-scroll-lock');
        document.body.classList.remove('config-tags-tour-scroll-lock');
        document.body.style.top = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        this._lockedScrollY = null;
        if (typeof y === 'number') {
            window.scrollTo(0, y);
        }
    }

    getScrollMetrics() {
        const margin = 24;
        const stickyTop = 72;
        const cardRect = this.card?.getBoundingClientRect();
        const cardH = cardRect?.height > 1 ? cardRect.height : 240;
        const cardTop =
            cardRect?.height > 1 ? cardRect.top : window.innerHeight - cardH - margin;
        return {
            viewTop: stickyTop + margin,
            viewBottom: Math.min(cardTop - margin, window.innerHeight - cardH - margin),
        };
    }

    isElementInViewBand(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        const { viewTop, viewBottom } = this.getScrollMetrics();
        if (viewBottom <= viewTop + 40) return false;
        return rect.top >= viewTop - 8 && rect.bottom <= viewBottom + 8;
    }

    findTagsFieldHighlightElement() {
        const tagsInput = document.getElementById('detail-tags');
        return tagsInput?.closest('.bookmark-detail-section') || tagsInput || null;
    }

    ensureTargetClearOfCard(element) {
        if (!element || !this.card) return;
        const targetRect = element.getBoundingClientRect();
        const cardRect = this.card.getBoundingClientRect();
        const overlaps =
            targetRect.bottom > cardRect.top - 12 && targetRect.top < cardRect.bottom + 12;
        if (!overlaps) return;

        const detailForm = document.getElementById('bookmark-detail-form');
        if (element.closest('#bookmark-detail-form') && detailForm) {
            const { viewBottom } = this.getScrollMetrics();
            if (targetRect.bottom > viewBottom) {
                detailForm.scrollTop += Math.round(targetRect.bottom - viewBottom + 24);
            }
            return;
        }

        const scrollRoot = document.scrollingElement || document.documentElement;
        if (!scrollRoot) return;
        if (cardRect.top <= targetRect.bottom && cardRect.top >= targetRect.top - 40) {
            scrollRoot.scrollTop += Math.round(targetRect.bottom - cardRect.top + 28);
        }
    }

    ensureTagsFieldInView(element) {
        const target = this.findTagsFieldHighlightElement() || element;
        if (!target) return;

        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);

        const detailForm = document.getElementById('bookmark-detail-form');
        const { viewTop, viewBottom } = this.getScrollMetrics();

        const nudgeForm = () => {
            if (!detailForm) return;
            const rect = target.getBoundingClientRect();
            if (rect.bottom > viewBottom) {
                detailForm.scrollTop += Math.round(rect.bottom - viewBottom + 24);
            }
            const afterDown = target.getBoundingClientRect();
            if (afterDown.top < viewTop) {
                detailForm.scrollTop = Math.max(
                    0,
                    detailForm.scrollTop - Math.round(viewTop - afterDown.top + 24)
                );
            }
        };

        nudgeForm();
        const scrollParent = detailForm || this.getScrollableAncestor(target);
        this.adjustScrollForViewBand(target, scrollParent);
        nudgeForm();
        this.ensureTargetClearOfCard(target);
    }

    getScrollableAncestor(element) {
        let node = element?.parentElement;
        while (node && node !== document.body) {
            const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
            if (!style) break;
            const overflowY = style.overflowY;
            const canScroll =
                (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
                node.scrollHeight > node.clientHeight + 1;
            if (canScroll) return node;
            node = node.parentElement;
        }
        return null;
    }

    adjustScrollForViewBand(element, scrollParent = null) {
        if (!element) return;

        const { viewTop, viewBottom } = this.getScrollMetrics();

        const nudgeParent = (parent) => {
            if (!parent) return;
            const rect = element.getBoundingClientRect();
            if (rect.bottom > viewBottom) {
                parent.scrollTop += Math.round(rect.bottom - viewBottom + 16);
            }
            const afterDown = element.getBoundingClientRect();
            if (afterDown.top < viewTop) {
                parent.scrollTop -= Math.round(viewTop - afterDown.top + 16);
            }
        };

        nudgeParent(scrollParent);

        const scrollRoot = document.scrollingElement || document.documentElement;
        if (!scrollRoot) return;

        const rect = element.getBoundingClientRect();
        if (rect.top < viewTop) {
            scrollRoot.scrollTop += Math.round(rect.top - viewTop);
        } else if (rect.bottom > viewBottom) {
            scrollRoot.scrollTop += Math.round(rect.bottom - viewBottom);
        }
    }

    findDemoBookmark() {
        const mgr = window.configManager;
        if (!mgr?.bookmarksData) return null;
        return (
            mgr.bookmarksData.find((b) => b[ConfigTagsTour.DEMO_FLAG]) ||
            (typeof this._demoBookmarkIndex === 'number'
                ? mgr.bookmarksData[this._demoBookmarkIndex]
                : null)
        );
    }

    findDemoBookmarkIndex() {
        const mgr = window.configManager;
        if (!mgr?.bookmarksData) return -1;
        return mgr.bookmarksData.findIndex((b) => b[ConfigTagsTour.DEMO_FLAG]);
    }

    syncDemoInAllBookmarks(bookmark) {
        const mgr = window.configManager;
        if (!mgr?.bookmarkStore || !bookmark) return;
        const existing = mgr.bookmarkStore.getAll().find((b) => b[ConfigTagsTour.DEMO_FLAG]);
        if (existing) {
            Object.assign(existing, bookmark);
            return;
        }
        const pageId = Number(mgr.currentPageId) || 1;
        mgr.bookmarkStore.getPage(pageId).push({ ...bookmark, pageId });
    }

    removeDemoFromAllBookmarks() {
        const mgr = window.configManager;
        if (!mgr?.bookmarkStore) return;
        mgr.bookmarkStore.removeWhere((b) => b[ConfigTagsTour.DEMO_FLAG]);
    }

    applyDemoTagToBookmark(bookmark) {
        if (!bookmark) return;
        const tag = ConfigTagsTour.DEMO_TAG;
        bookmark.tags = [tag];
        bookmark.name = this.t('configTagsTourDemoBookmarkName', 'Tags tour sample');
        bookmark.url = ConfigTagsTour.DEMO_URL;
        bookmark[ConfigTagsTour.DEMO_FLAG] = true;

        const nameEl = document.getElementById('detail-name');
        const urlEl = document.getElementById('detail-url');
        const tagsEl = document.getElementById('detail-tags');
        if (nameEl) nameEl.value = bookmark.name;
        if (urlEl) urlEl.value = bookmark.url;
        if (tagsEl) {
            tagsEl.value = tag;
            tagsEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this.dismissTagAutocompleteOverlays();
        this.syncDemoInAllBookmarks(bookmark);
    }

    async addTourDemoBookmark() {
        const mgr = window.configManager;
        if (!mgr) return false;

        const existing = this.findDemoBookmark();
        if (existing) {
            const idx = this.findDemoBookmarkIndex();
            this._demoBookmarkIndex = idx;
            if (idx >= 0 && typeof mgr.bookmarks.openDetailPanel === 'function') {
                mgr.bookmarks.openDetailPanel(idx, mgr.bookmarksData, mgr.bookmarksPageCategories);
            }
            this.applyDemoTagToBookmark(existing);
            return true;
        }

        this.ensureBookmarksTabActive();
        await this.waitMs(120);

        mgr.addBookmark();
        const idx = mgr.bookmarksData.length - 1;
        const bookmark = mgr.bookmarksData[idx];
        if (!bookmark) return false;

        bookmark[ConfigTagsTour.DEMO_FLAG] = true;
        this._demoBookmarkIndex = idx;
        this.applyDemoTagToBookmark(bookmark);
        mgr.markDirty?.();
        return true;
    }

    findDemoTagElement() {
        const tag = ConfigTagsTour.DEMO_TAG;
        const chip = [...document.querySelectorAll('.tag-cloud-chip')].find((el) =>
            (el.textContent || '').toLowerCase().includes(tag)
        );
        if (chip) return chip;
        try {
            return document.querySelector(`.tag-item[data-tag="${CSS.escape(tag)}"]`);
        } catch {
            return document.querySelector('.tag-item');
        }
    }

    isDemoBookmark(bookmark) {
        if (!bookmark) return false;
        if (bookmark[ConfigTagsTour.DEMO_FLAG]) return true;
        const url = String(bookmark.url || '').trim().toLowerCase();
        return url === ConfigTagsTour.DEMO_URL;
    }

    /**
     * Drop the tour demo bookmark without wiping real tags. The demo usually lives only
     * in memory (never saved); POSTing stale bookmarksData was clearing tags on disk.
     */
    async removeTourDemoBookmark({ silent = false } = {}) {
        if (this._demoCleanupInProgress) return false;
        const mgr = window.configManager;
        if (!mgr) return true;

        const pageId = Number(mgr.getResolvedBookmarksPageId?.() || mgr.currentPageId || 1);
        const hadDemoInMemory = this.findDemoBookmarkIndex() !== -1;

        if (!hadDemoInMemory) {
            this._demoBookmarkIndex = null;
            this.removeDemoFromAllBookmarks();
            await this.resyncBookmarksAfterTour(pageId);
            return true;
        }

        if (!silent) {
            const idx = this.findDemoBookmarkIndex();
            const removed = await mgr.bookmarks.remove(mgr.bookmarksData, idx);
            if (!removed) return false;
        }

        this._demoCleanupInProgress = true;
        try {
            let fromServer = [];
            try {
                fromServer = await mgr.data.loadBookmarksByPage(pageId);
            } catch (error) {
                console.warn('Tags tour: could not reload bookmarks before cleanup', error);
            }

            const serverDemoIdx = fromServer.findIndex((b) => this.isDemoBookmark(b));
            const demoWasPersisted = serverDemoIdx >= 0;

            if (demoWasPersisted) {
                const toSave = fromServer.filter((_, i) => i !== serverDemoIdx);
                await mgr.saveBookmarksPage(pageId, toSave);
            }

            // Always realign in-memory state with disk (keeps imported tags; drops unsaved demo).
            mgr.bookmarksData = demoWasPersisted
                ? fromServer.filter((_, i) => i !== serverDemoIdx)
                : fromServer;
            this._demoBookmarkIndex = null;
            this.removeDemoFromAllBookmarks();

            if (mgr.bookmarks) {
                mgr.bookmarks.activeDetailIndex = null;
                mgr.bookmarks.setDetailPanelMode?.('empty');
            }
            mgr.refreshBookmarksList?.({ skipFlush: true });
            if (!demoWasPersisted && typeof mgr.clearDirty === 'function') {
                mgr.clearDirty();
            }
            await this.resyncBookmarksAfterTour(pageId);
            return true;
        } catch (error) {
            console.warn('Tags tour: demo cleanup failed', error);
            return false;
        } finally {
            this._demoCleanupInProgress = false;
        }
    }

    async resyncBookmarksAfterTour(pageId) {
        const mgr = window.configManager;
        await this.reloadAllBookmarksForTagsView();
        if (mgr && Number.isFinite(Number(pageId))) {
            try {
                mgr.currentPageId = Number(pageId);
                await mgr.bookmarkStore.loadPage(pageId);
                mgr.refreshBookmarksList?.({ skipFlush: true });
            } catch (error) {
                console.warn('Tags tour: could not resync page bookmarks', error);
            }
        }
    }

    async cleanupTourDemoBookmark({ prompt = false } = {}) {
        if (!this.findDemoBookmark() && this.findDemoBookmarkIndex() === -1) return true;
        if (this._demoCleanupInProgress) return false;

        if (prompt) {
            this.unlockScroll();
        let confirmed = false;
        try {
            if (window.AppModal?.confirm) {
                confirmed = await window.ConfigTourRuntime?.withAppModal?.(() =>
                    window.AppModal.confirm({
                        title: this.t('configTagsTourCleanupConfirmTitle', 'Remove the demo bookmark?'),
                        message: this.t(
                            'configTagsTourCleanupConfirmMessage',
                            'We added a temporary bookmark with tag “tour-demo” for this tour. Remove it now so your library stays unchanged.'
                        ),
                        confirmText: this.t('configTagsTourCleanupConfirmYes', 'Remove demo'),
                        cancelText: this.t('config.cancel', 'Cancel'),
                    })
                );
            } else {
                    confirmed = window.confirm(
                        this.t(
                            'configTagsTourCleanupConfirmMessage',
                            'Remove the demo bookmark with tag tour-demo?'
                        )
                    );
                }
            } catch {
                confirmed = false;
            }
            window.GuidedFlowGuard?.syncModalOpenClass?.();
            if (!confirmed) return false;
        }

        return this.removeTourDemoBookmark({ silent: prompt });
    }

    async ensureDemoRemoved() {
        if (!this.findDemoBookmark() && this.findDemoBookmarkIndex() === -1) return true;
        return this.removeTourDemoBookmark({ silent: true });
    }

    async promptAddTourDemoBookmark() {
        const title = this.t('configTagsTourDemoConsentTitle', 'Try adding a tag on a new bookmark?');
        const message = this.t(
            'configTagsTourDemoConsentMessage',
            'We can open the Bookmarks tab, add a temporary bookmark, and set the tag “tour-demo” in the Tags field — then show it here on the Tags tab. The bookmark is removed before the tour ends.'
        );

        let confirmed = false;
        try {
            if (window.AppModal?.confirm) {
                confirmed = await window.ConfigTourRuntime?.withAppModal?.(() =>
                    window.AppModal.confirm({
                        title,
                        message,
                        confirmText: this.t('configTagsTourDemoConsentYes', 'Show me'),
                        cancelText: this.t('configTagsTourDemoConsentNo', 'Skip demo'),
                    })
                );
            } else {
                confirmed = window.confirm(`${title}\n\n${message}`);
            }
        } catch {
            confirmed = false;
        }
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        document.body.classList.remove('guided-flow-modal-open');
        return confirmed;
    }

    restoreTourCardAfterDialog() {
        document.body.classList.remove('guided-flow-modal-open');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        if (this.card) {
            window.ConfigTourRuntime?.elevateTourCard?.(this.card);
        }
    }

    async handleBookmarksIntroStep(step) {
        if (this._demoAddHandled) {
            this.ensureTourCardInteractive();
            return;
        }
        this._demoAddHandled = true;

        /* Switch to Bookmarks first so consent + highlight are on the same tab as the tour card. */
        await this.waitForBookmarksTabActive();
        this.ensureTourCardInteractive();
        await this.waitMs(120);

        const confirmed = await this.promptAddTourDemoBookmark();
        this.restoreTourCardAfterDialog();
        this.dismissTagAutocompleteOverlays();

        if (confirmed) {
            const added = await this.addTourDemoBookmark();
            if (added) {
                step.body = this.t(
                    'configTagsTourBookmarksAddedBody',
                    'A new bookmark is open on the right. Tags are comma-separated — we filled in “tour-demo”. Change the field anytime; tags are normalised to lowercase on save.'
                );
                step.getTarget = () => document.getElementById('add-bookmark-btn');
                step.selector = null;
            } else {
                step.body = this.t(
                    'configTagsTourBookmarksFailedBody',
                    'Could not add the demo bookmark. Click + Add yourself, select the row, then type tags in the Tags field below.'
                );
                step.selector = '#add-bookmark-btn';
                step.getTarget = null;
            }
        } else {
            step.body = this.t(
                'configTagsTourBookmarksSkippedBody',
                'Open + Add to create a bookmark, select it in the list, then type comma-separated tags in the Tags field on the right — for example work, dev, personal.'
            );
            step.selector = '#add-bookmark-btn';
            step.getTarget = null;
        }

        this.ensureTourCardInteractive();
    }

    async handleTagsFieldStep(step) {
        if (this._demoTagApplied) {
            this.ensureTourCardInteractive();
            return;
        }
        this._demoTagApplied = true;

        await this.waitForBookmarksTabActive();
        await this.waitMs(80);

        const bookmark = this.findDemoBookmark();
        if (bookmark) {
            const idx = this.findDemoBookmarkIndex();
            if (idx >= 0 && window.configManager?.bookmarks?.openDetailPanel) {
                window.configManager.bookmarks.openDetailPanel(
                    idx,
                    window.configManager.bookmarksData,
                    window.configManager.bookmarksPageCategories
                );
            }
            await this.waitForDetailTagsField();
            this.applyDemoTagToBookmark(bookmark);
            await this.waitMs(80);
            step.body = this.t(
                'configTagsTourTagsFieldDoneBody',
                'This Tags field is where you attach labels to a bookmark. We used “tour-demo” — add more with commas. They power search, filters, and dynamic collections.'
            );
        } else {
            step.body = this.t(
                'configTagsTourTagsFieldBody',
                'Select a bookmark in the list, then type comma-separated tags here — for example work, dev, personal. Tags are trimmed and lowercased when you save.'
            );
        }
        step.getTarget = () => this.findTagsFieldHighlightElement();
        step.selector = null;
        step.scrollBlock = 'start';
        this.ensureTourCardInteractive();
    }

    async handleTagsResultStep(step) {
        document.body.removeAttribute('data-config-tags-tour-bookmarks-phase');
        this.ensureTagsTabActive();
        await this.waitMs(120);
        this.ensureTagsDataReady();
        await this.waitMs(80);

        const demoEl = this.findDemoTagElement();
        if (demoEl) {
            step.body = this.t(
                'configTagsTourResultDoneBody',
                'Here is “tour-demo” in your tag cloud and list. Click a tag to see which bookmarks use it, or rename and delete tags globally.'
            );
            step.getTarget = () => demoEl;
            step.selector = null;
        } else {
            step.body = this.t(
                'configTagsTourResultEmptyBody',
                'After you save bookmarks with tags, they appear in the cloud and list here. Rename merges tags; delete removes them from every bookmark.'
            );
            step.selector = '#tags-cloud';
            step.getTarget = null;
        }
    }

    async handleCleanupStep(step) {
        if (this._demoCleanupHandled) return;
        this._demoCleanupHandled = true;

        if (!this.findDemoBookmark() && this.findDemoBookmarkIndex() === -1) {
            step.body = this.t(
                'configTagsTourCleanupNoneBody',
                'No demo bookmark remains. Tags you add in Bookmarks show up here automatically after save.'
            );
            this.ensureTagsTabActive();
            return;
        }

        const removed = await this.cleanupTourDemoBookmark({ prompt: true });
        this.ensureTagsTabActive();
        this.ensureTagsDataReady();

        if (removed) {
            step.body = this.t(
                'configTagsTourCleanupDoneBody',
                'The demo bookmark is removed. Your tag list is back to how it was before the tour.'
            );
            step.getTarget = () => document.getElementById('tags-list');
            step.selector = null;
        } else {
            step.body = this.t(
                'configTagsTourCleanupKeptBody',
                'The demo bookmark may still be on the current page in Bookmarks. Delete it there, or restart the tour from General → System tools.'
            );
            step.selector = '#tags-list';
            step.getTarget = null;
        }
    }

    revealTarget(step) {
        let element = null;
        if (typeof step?.getTarget === 'function') {
            element = step.getTarget();
        } else if (step?.selector) {
            element = document.querySelector(step.selector);
        }
        if (element?.hidden) {
            element.hidden = false;
            element.removeAttribute('hidden');
        }
        return element;
    }

    async scrollToStepTarget(element, step = {}, options = {}) {
        if (!element || typeof element.scrollIntoView !== 'function') return;

        const bookmarksPhase = this.isBookmarksPhaseStep(step);
        const scrollLocked = document.documentElement.classList.contains(
            'config-tags-tour-scroll-lock'
        );
        if (!scrollLocked && !bookmarksPhase) {
            this.unlockScroll();
        }

        window.ConfigTourRuntime?.applyCardPlacement?.(this, element, step);
        await this.waitMs(16);

        const block = options.block || step.scrollBlock || 'center';
        const detailForm = document.getElementById('bookmark-detail-form');
        const scrollParent = this.getScrollableAncestor(element) || detailForm;
        const scrollTarget =
            element.closest('.bookmark-detail-section') ||
            element.closest('.bookmarks-splitview') ||
            element;
        const tagsFieldStep = step?.id === 'tags-field';
        const needsScroll = tagsFieldStep || !this.isElementInViewBand(element);

        if (needsScroll || scrollParent) {
            const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
            const isFixedLike = style && (style.position === 'fixed' || style.position === 'sticky');
            const scrollBlock =
                tagsFieldStep && scrollParent === detailForm
                    ? 'start'
                    : scrollParent || isFixedLike
                      ? 'nearest'
                      : block;

            (scrollTarget || element).scrollIntoView({
                behavior: 'auto',
                block: scrollBlock,
                inline: 'nearest',
            });

            this.adjustScrollForViewBand(element, scrollParent);

            await this.waitMs(24);
            this.adjustScrollForViewBand(element, scrollParent);
            await this.waitMs(16);
        }

        if (tagsFieldStep || element.closest('#bookmark-detail-form')) {
            this.ensureTagsFieldInView(element);
        }

        window.ConfigTourRuntime?.applyCardPlacement?.(this, element, step);
        this.lockScroll();
    }

    buildSteps() {
        return [
            {
                title: this.t('configTagsTourWelcomeTitle', 'Welcome to Tags'),
                body: this.t(
                    'configTagsTourWelcomeBody',
                    'Tags group bookmarks across all pages. Manage them here — add them on each bookmark in the Bookmarks tab (comma-separated).'
                ),
                selector: '.tags-tab',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: async () => {
                    this.ensureTagsDataReady();
                },
            },
            {
                title: this.t('configTagsTourCloudTitle', 'Tag cloud'),
                body: this.t(
                    'configTagsTourCloudBody',
                    'Popular tags appear larger in the cloud. Click a chip to jump to that tag in the list below.'
                ),
                selector: '#tags-cloud',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: async () => {
                    this.ensureTagsDataReady();
                },
            },
            {
                title: this.t('configTagsTourListTitle', 'Rename, delete & drill-down'),
                body: this.t(
                    'configTagsTourListBody',
                    'Each row shows how many bookmarks use a tag. Rename merges tags globally; × removes a tag from every bookmark. Click the label to expand the bookmark list.'
                ),
                selector: '#tags-list',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: async () => {
                    this.ensureTagsDataReady();
                },
            },
            {
                id: 'bookmarks-intro',
                phase: 'bookmarks',
                title: this.t('configTagsTourBookmarksTitle', 'Add tags in Bookmarks'),
                body: this.t(
                    'configTagsTourBookmarksIntroBody',
                    'Tags are set per bookmark in Config → Bookmarks. Next we can add a sample bookmark and tag it for you — only if you agree.'
                ),
                selector: '#add-bookmark-btn',
                getTarget: () => document.getElementById('add-bookmark-btn'),
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleBookmarksIntroStep(step),
            },
            {
                id: 'tags-field',
                phase: 'bookmarks',
                title: this.t('configTagsTourTagsFieldTitle', 'Tags field'),
                body: this.t(
                    'configTagsTourTagsFieldIntroBody',
                    'The Tags field lives in the bookmark editor on the right. Comma-separated values become normalised tags when you save.'
                ),
                getTarget: () => this.findTagsFieldHighlightElement(),
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleTagsFieldStep(step),
            },
            {
                id: 'tags-result',
                title: this.t('configTagsTourResultTitle', 'See tags here'),
                body: this.t(
                    'configTagsTourResultIntroBody',
                    'Back on the Tags tab: every tag from your bookmarks appears in the cloud and list. We switch here to find your sample tag.'
                ),
                selector: '#tags-cloud',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleTagsResultStep(step),
            },
            {
                id: 'demo-cleanup',
                title: this.t('configTagsTourCleanupTitle', 'Clean up the demo'),
                body: this.t(
                    'configTagsTourCleanupIntroBody',
                    'To leave your library unchanged, we remove the temporary bookmark from the Bookmarks tab now.'
                ),
                selector: '#tags-list',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleCleanupStep(step),
            },
        ];
    }

    async prepareAndStart({ force = false } = {}) {
        this.lastFailureReason = null;
        if (!this.canStart({ force })) {
            this.lastFailureReason = 'blocked';
            return false;
        }

        this.ensurePageReady();

        if (force) {
            ConfigTagsTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._demoBookmarkIndex = null;
            this._demoAddHandled = false;
            this._demoTagApplied = false;
            this._demoCleanupHandled = false;
        }

        this.ensureTagsTabActive();
        await this.waitForTagsTabActive(force ? 50 : 30);
        this.ensureTagsDataReady();
        await this.waitMs(force ? 120 : 80);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-tags-tab';
            return false;
        }
        if (!document.getElementById('tags-list')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        if (window.configManager) {
            window.configManager._configTagsTourActive = true;
        }
        document.body.setAttribute('data-config-tags-tour-active', 'true');
        document.body.classList.remove('config-tags-tour-ready');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        try {
            await this.showStep(0);
            document.body.classList.add('config-tags-tour-ready');
        } catch (error) {
            console.error('Config Tags tour failed to start', error);
            ConfigTagsTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    removeTourCardOnly() {
        document.querySelectorAll('.config-tags-tour-card').forEach((el) => el.remove());
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    render() {
        this.removeTourCardOnly();

        const card = document.createElement('div');
        card.className = 'config-tags-tour-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.innerHTML = `
            <div class="config-general-tour-progress"></div>
            <h3 class="config-general-tour-title"></h3>
            <p class="config-general-tour-body"></p>
            <div class="config-general-tour-actions">
                <button type="button" class="config-general-tour-btn config-general-tour-back"></button>
                <button type="button" class="config-general-tour-btn config-general-tour-skip"></button>
                <button type="button" class="config-general-tour-btn config-general-tour-next"></button>
            </div>
        `;
        document.body.appendChild(card);
        this.card = card;
        window.ConfigTourRuntime?.elevateTourCard?.(card);

        card.querySelector('.config-general-tour-back').textContent = this.t('configGeneralTourBack', 'Back');
        card.querySelector('.config-general-tour-skip').textContent = this.t('configGeneralTourSkip', 'Skip tour');
        card.querySelector('.config-general-tour-next').textContent = this.t('configGeneralTourNext', 'Next');

        card.querySelector('.config-general-tour-back').addEventListener('click', () => this.prevStep());
        card.querySelector('.config-general-tour-skip').addEventListener('click', () => this.finish());
        card.querySelector('.config-general-tour-next').addEventListener('click', () => this.nextStep());

        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.finish();
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    updateStepContent(step, index) {
        if (!this.card || !step) return;

        const title = this.card.querySelector('.config-general-tour-title');
        const body = this.card.querySelector('.config-general-tour-body');
        const progress = this.card.querySelector('.config-general-tour-progress');
        const back = this.card.querySelector('.config-general-tour-back');
        const next = this.card.querySelector('.config-general-tour-next');

        if (!title || !body || !progress || !back || !next) return;

        title.textContent = step.title || '';
        body.textContent = step.body || '';
        if (step.title || step.body) {
            this._tourShown = true;
        }
        progress.textContent = this.t('configTagsTourProgress', 'Step {step} of {total}')
            .replace('{step}', String(index + 1))
            .replace('{total}', String(this.steps.length));

        back.disabled = index === 0;
        next.textContent =
            index === this.steps.length - 1
                ? this.t('configGeneralTourFinish', 'Finish')
                : this.t('configGeneralTourNext', 'Next');
    }

    clearHighlight() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('config-tags-tour-highlight');
            this.highlightedElement = null;
        }
    }

    async showStep(index) {
        this.currentStep = Math.max(0, Math.min(index, this.steps.length - 1));
        const step = this.steps[this.currentStep];
        if (!step || !this.card) return;

        const runId = ++this._stepRunId;
        const hadHighlight = Boolean(this.highlightedElement);

        if (hadHighlight) {
            this.clearHighlight();
            if (!this.isBookmarksPhaseStep(step)) {
                this.unlockScroll();
            }
        }

        if (step.phase === 'bookmarks') {
            document.body.setAttribute('data-config-tags-tour-bookmarks-phase', 'true');
        } else {
            document.body.removeAttribute('data-config-tags-tour-bookmarks-phase');
        }

        if (typeof step.onBeforeShow === 'function') {
            await step.onBeforeShow(step);
            if (runId !== this._stepRunId) return;
            this.restoreTourCardAfterDialog();
        }

        if (this.isBookmarksPhaseStep(step)) {
            window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);
        }

        const element = this.revealTarget(step);
        await this.waitMs(80);
        if (runId !== this._stepRunId) return;

        if (element) {
            await this.scrollToStepTarget(element, step, { block: step.scrollBlock || 'center' });
            if (runId !== this._stepRunId) return;
            element.classList.add('config-tags-tour-highlight');
            this.highlightedElement = element;
            if (step.id === 'tags-field') {
                this.ensureTagsFieldInView(element);
            }
        } else {
            this.lockScroll();
        }

        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);

        if (runId !== this._stepRunId) return;
        this.updateStepContent(step, this.currentStep);
        document.body.classList.add('config-tags-tour-ready');
        this.ensureTourCardInteractive();
    }

    nextStep() {
        if (this.currentStep >= this.steps.length - 1) {
            this.finish();
            return;
        }
        void this.showStep(this.currentStep + 1);
    }

    prevStep() {
        void this.showStep(this.currentStep - 1);
    }

    async markCompleted() {
        try {
            localStorage.setItem(this.storageKey, '1');
        } catch {
            // ignore
        }
        try {
            await this.onMarkSeen?.();
        } catch {
            // ignore
        }
    }

    async finish() {
        try {
            if (!this._tourShown) {
                await this.ensureDemoRemoved();
                await this.close();
                return;
            }
            await this.markCompleted();
            await this.ensureDemoRemoved();
            await this.close();
        } catch (error) {
            console.warn('Tags tour: finish failed', error);
            await this.close();
        }
    }

    async close() {
        this._stepRunId += 1;
        this._tourShown = false;
        this.clearHighlight();
        document
            .querySelectorAll('.config-tags-tour-highlight')
            .forEach((el) => el.classList.remove('config-tags-tour-highlight'));
        this.unlockScroll();

        const mgr = window.configManager;
        if (mgr) {
            mgr._configTagsTourActive = false;
            mgr._configTagsTourStarting = false;
        }
        document.body.removeAttribute('data-config-tags-tour-active');
        document.body.removeAttribute('data-config-tags-tour-bookmarks-phase');
        document.body.classList.remove('config-tags-tour-ready');
        this.dismissTagAutocompleteOverlays();
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        this.card?.remove();
        window.ConfigTourRuntime?.removeTourPortalIfEmpty?.();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        const pageId = Number(mgr?.getResolvedBookmarksPageId?.() || mgr?.currentPageId || 1);
        await this.resyncBookmarksAfterTour(pageId);
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigTagsTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigTagsTour = ConfigTagsTour;
}
