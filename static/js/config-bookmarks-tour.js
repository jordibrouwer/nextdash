/**
 * Guided tour on Config → Bookmarks: demo bookmarks in the editor and + modal,
 * dashboard + modal step, dynamic tour card, cleanup afterward.
 */
class ConfigBookmarksTour {
    static STORAGE_KEY = 'nextdash:config-bookmarks-tour-v2';
    static HANDOFF_KEY = 'nextdash:config-bookmarks-tour-handoff';
    static RESUME_KEY = 'nextdash:config-bookmarks-tour-resume';
    static DEMO_FLAG = '_configBookmarksTourDemo';
    static DEMO_NOTE = '_configBookmarksTourDemo';

    static DEMO_SITE_POOL = [
        { url: 'https://www.wikipedia.org/', name: 'Wikipedia' },
        { url: 'https://developer.mozilla.org/', name: 'MDN Web Docs' },
        { url: 'https://archive.org/', name: 'Internet Archive' },
        { url: 'https://www.gutenberg.org/', name: 'Project Gutenberg' },
        { url: 'https://openlibrary.org/', name: 'Open Library' },
        { url: 'https://www.wikidata.org/', name: 'Wikidata' },
        { url: 'https://commons.wikimedia.org/', name: 'Wikimedia Commons' },
        { url: 'https://www.openstreetmap.org/', name: 'OpenStreetMap' },
        { url: 'https://www.gnu.org/', name: 'GNU' },
        { url: 'https://www.debian.org/', name: 'Debian' },
        { url: 'https://www.khanacademy.org/', name: 'Khan Academy' },
        { url: 'https://www.bbc.com/news', name: 'BBC News' },
    ];

    constructor({ language, hasSeen, onMarkSeen, phase = 'config' } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigBookmarksTour.STORAGE_KEY;
        this.phase = phase;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._demoSites = null;
        this._demoEditorIndex = null;
        this._demoConsentHandled = false;
        this._demoEditorHandled = false;
        this._demoModalOpenHandled = false;
        this._demoModalSaveHandled = false;
        this._demoQuickAddHandled = false;
        this._demoDashboardNavHandled = false;
        this._demoCleanupHandled = false;
        this._demoCleanupInProgress = false;
        this._demosSkipped = false;
        this._handoff = null;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigBookmarksTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="bookmarks"]')) return 'no-bookmarks-tab';
        return null;
    }

    static consumeHandoff() {
        try {
            const raw = sessionStorage.getItem(ConfigBookmarksTour.HANDOFF_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(ConfigBookmarksTour.HANDOFF_KEY);
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    static consumeResume() {
        try {
            const v = sessionStorage.getItem(ConfigBookmarksTour.RESUME_KEY);
            if (!v) return null;
            sessionStorage.removeItem(ConfigBookmarksTour.RESUME_KEY);
            return v;
        } catch {
            return null;
        }
    }

    static setResume(value) {
        try {
            sessionStorage.setItem(ConfigBookmarksTour.RESUME_KEY, value);
        } catch {
            // ignore
        }
    }

    static maybeStartDashboardPhase(dashboard) {
        const handoff = ConfigBookmarksTour.consumeHandoff();
        if (!handoff) return null;
        const tour = new ConfigBookmarksTour({
            language: dashboard?.language || null,
            phase: 'dashboard',
        });
        tour._handoff = handoff;
        tour._demoSites = handoff.demoSites || null;
        void tour.startDashboardPhase(dashboard);
        return tour;
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
        if (this.phase === 'dashboard') return true;
        if (!force && this.hasCompletedTour()) return false;
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return false;
        if (!document.querySelector('[data-tab-content="bookmarks"]')) return false;
        return true;
    }

    pickDemoSites() {
        const pool = [...ConfigBookmarksTour.DEMO_SITE_POOL];
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return {
            editor: { ...pool[0] },
            modal: { ...pool[1] },
            dashboard: { ...pool[2] },
        };
    }

    demoLabel(site) {
        const suffix = this.t('configBookmarksTourDemoSuffix', '(tour)');
        return `${site.name} ${suffix}`.trim();
    }

    canonicalUrlKey(raw) {
        if (window.BookmarkUrlUtils) {
            return window.BookmarkUrlUtils.canonicalBookmarkURLKey(raw);
        }
        return String(raw || '').trim().toLowerCase();
    }

    getResolvedPageId() {
        const mgr = window.configManager;
        return mgr?.getResolvedBookmarksPageId?.() || mgr?.currentPageId || 1;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-bookmarks-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-bookmarks-tour-active');
        document.body.classList.remove('config-bookmarks-tour-ready');
        document.documentElement.classList.remove('config-bookmarks-tour-scroll-lock');
        document.body.classList.remove('config-bookmarks-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-bookmarks-tour-highlight')
            .forEach((el) => el.classList.remove('config-bookmarks-tour-highlight'));
        document.body.classList.remove(
            'config-bookmarks-tour-dialog-open',
            'config-bookmarks-tour-interactive-modal'
        );
        document
            .querySelectorAll('.config-bookmarks-tour-card--companion')
            .forEach((el) => el.classList.remove('config-bookmarks-tour-card--companion'));
        document
            .querySelectorAll('.config-bookmarks-tour-card.is-suppressed-for-dialog')
            .forEach((el) => el.classList.remove('is-suppressed-for-dialog'));
        window.GuidedFlowGuard?.leaveCompanionMode?.();
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        window.ConfigTourRuntime?.removeTourBackdropIfIdle?.();
        if (window.configManager) {
            window.configManager._configBookmarksTourActive = false;
        }
    }

    closeQuickAddModal() {
        const mgr = window.configManager;
        const delegate = mgr?.quickAdd?._delegate;
        if (delegate?.modal?.classList?.contains('show')) {
            delegate.closeModal?.();
        }
        const dashHandler = window.dashboardInstance?.searchComponent?.commandsComponent?.newCommandHandler;
        if (dashHandler?.modal?.classList?.contains('show')) {
            dashHandler.closeModal?.();
        }
    }

    ensureBookmarksTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('bookmarks');
        } else {
            const panel = document.querySelector('[data-tab-content="bookmarks"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="bookmarks"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'bookmarks' && !hash.startsWith('bookmarks/')) {
            window.history.replaceState(null, '', '#bookmarks');
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

    async waitForBookmarksTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureBookmarksTabActive();
            const panel = document.querySelector('[data-tab-content="bookmarks"]');
            const split = document.querySelector('.bookmarks-splitview');
            if (panel && split && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="bookmarks"]') &&
                document.querySelector('.bookmarks-splitview')
        );
    }

    waitForBookmarksReady(maxAttempts = 35) {
        return new Promise((resolve) => {
            const tick = (left) => {
                const split = document.querySelector('.bookmarks-splitview');
                const pageSel = document.getElementById('page-selector');
                const list = document.getElementById('bookmarks-list');
                const hasPageOptions = pageSel && pageSel.options && pageSel.options.length > 0;
                const hasList = list && (list.children.length > 0 || list.querySelector('.bookmark-item'));
                if (split && pageSel && hasPageOptions && (hasList || left <= 8)) {
                    resolve(true);
                    return;
                }
                if (left <= 0) {
                    resolve(Boolean(split && pageSel));
                    return;
                }
                setTimeout(() => tick(left - 1), 80);
            };
            tick(maxAttempts);
        });
    }

    async ensureBookmarksDataReady() {
        const mgr = window.configManager;
        if (!mgr?.loadPageBookmarks || !mgr.currentPageId) return;
        try {
            await mgr.loadPageBookmarks(mgr.currentPageId);
            mgr.renderStructureWorkspace?.();
        } catch (error) {
            console.warn('Bookmarks tour: could not refresh bookmark data', error);
        }
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (this.phase === 'dashboard') return;
        if (document.documentElement.classList.contains('config-bookmarks-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-bookmarks-tour-scroll-lock');
        document.body.classList.add('config-bookmarks-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-bookmarks-tour-scroll-lock');
        document.body.classList.remove('config-bookmarks-tour-scroll-lock');
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

    resetCardPosition() {
        if (!this.card) return;
        this.card.classList.remove('is-docked');
        this.card.style.removeProperty('top');
        this.card.style.removeProperty('left');
        this.card.style.removeProperty('bottom');
        this.card.style.removeProperty('right');
        this.card.style.removeProperty('transform');
    }

    isOversizedHighlight(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        return (
            rect.height > window.innerHeight * 0.52 ||
            rect.width > window.innerWidth * 0.78
        );
    }

    /** Pin tour card to bottom of viewport — stays above dimming, on top of large highlights */
    positionCardAtViewportBottom() {
        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);
    }

    restoreTourCardAfterDialog() {
        this.card?.classList.remove('is-suppressed-for-dialog');
        this.clearTourDialogLayerState();
        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);
        this.ensureTourCardInteractive();
    }

    ensureTourCardInteractive() {
        this.clearTourDialogLayerState();
        if (this.card) {
            this.card.classList.remove('is-suppressed-for-dialog');
            this.card.style.setProperty('pointer-events', 'auto', 'important');
            this.card.style.setProperty('visibility', 'visible', 'important');
            this.card.setAttribute('data-config-tour-card', 'true');
            if (
                document.body.classList.contains('config-bookmarks-tour-interactive-modal') ||
                this.card.classList.contains('config-bookmarks-tour-card--companion')
            ) {
                window.ConfigTourRuntime?.syncCompanionLayering?.(this.card);
            } else {
                window.ConfigTourRuntime?.syncTourLayering?.(this.card);
            }
        }
        document.body.classList.add('config-bookmarks-tour-ready');
    }

    async withTourDialog(fn) {
        document.body.classList.add('config-bookmarks-tour-dialog-open');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        try {
            if (window.ConfigTourRuntime?.withAppModal) {
                return await window.ConfigTourRuntime.withAppModal(fn);
            }
            window.ConfigTourRuntime?.setTourLayersForAppModal?.(true);
            try {
                return await fn();
            } finally {
                window.ConfigTourRuntime?.setTourLayersForAppModal?.(false);
            }
        } finally {
            this.restoreTourCardAfterDialog();
        }
    }

    prepareInteractiveModalStep() {
        document.body.classList.add('config-bookmarks-tour-interactive-modal');
        window.GuidedFlowGuard?.enterCompanionMode?.();
        if (this.card) {
            this.card.classList.add('config-bookmarks-tour-card--companion');
            this.resetCardPosition();
            this.card.classList.remove('is-docked');
        }
        window.ConfigTourRuntime?.syncCompanionLayering?.(this.card);
    }

    endInteractiveModalStep() {
        document.body.classList.remove('config-bookmarks-tour-interactive-modal');
        window.GuidedFlowGuard?.leaveCompanionMode?.();
        const quickAdd = document.getElementById('new-bookmark-modal');
        if (quickAdd) {
            quickAdd.style.removeProperty('z-index');
            quickAdd.style.removeProperty('pointer-events');
        }
        if (this.card) {
            this.card.classList.remove('config-bookmarks-tour-card--companion');
            window.ConfigTourRuntime?.syncTourLayering?.(this.card);
        }
    }

    findDashboardBackLink() {
        return (
            document.querySelector('.header-links a.back-link[href="/"]') ||
            document.querySelector('a.back-link[href="/"]')
        );
    }

    positionCardNearTarget(element, step = {}) {
        if (!this.card) return;

        if (!element) {
            this.positionCardAtViewportBottom();
            return;
        }

        const viewportPadding = 16;
        const headerClearance = 72;
        const gap = 20;
        const targetRect = element.getBoundingClientRect();
        const placement = step.cardPlacement || 'auto';
        const isModal = Boolean(
            element.closest?.('.modal-overlay') || element.classList?.contains('modal-new-bookmark')
        );

        if (
            placement === 'viewport-bottom' ||
            (placement === 'auto' && !isModal && this.isOversizedHighlight(element))
        ) {
            this.positionCardAtViewportBottom();
            return;
        }

        this.resetCardPosition();
        const cardW = this.card.getBoundingClientRect().width || Math.min(640, window.innerWidth * 0.96);
        const cardH = this.card.getBoundingClientRect().height || 220;

        let placeAbove = placement === 'top';
        if (placement === 'auto') {
            const spaceBelow = window.innerHeight - targetRect.bottom - viewportPadding;
            const spaceAbove = targetRect.top - headerClearance - viewportPadding;
            if (isModal) {
                placeAbove = true;
            } else {
                placeAbove =
                    targetRect.bottom > window.innerHeight * 0.5 ||
                    (spaceBelow < cardH + gap && spaceAbove >= cardH + gap);
            }
        } else if (placement === 'bottom') {
            placeAbove = false;
        }

        const maxLeft = Math.max(viewportPadding, window.innerWidth - cardW - viewportPadding);
        const centeredLeft = targetRect.left + targetRect.width / 2 - cardW / 2;
        const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));

        let top;
        if (placeAbove) {
            top = Math.max(headerClearance + viewportPadding, targetRect.top - cardH - gap);
        } else {
            top = Math.min(window.innerHeight - cardH - viewportPadding, targetRect.bottom + gap);
        }

        this.card.classList.add('is-docked');
        this.card.style.left = `${Math.round(left)}px`;
        this.card.style.top = `${Math.round(top)}px`;
        this.card.style.bottom = 'auto';
        this.card.style.transform = 'none';
    }

    getScrollMetrics() {
        const margin = 24;
        const stickyTop = 72;
        const cardRect = this.card?.getBoundingClientRect();
        if (cardRect && cardRect.height > 1 && this.card.classList.contains('is-docked')) {
            if (cardRect.top < window.innerHeight * 0.45) {
                return {
                    viewTop: cardRect.bottom + margin,
                    viewBottom: window.innerHeight - margin,
                };
            }
            return {
                viewTop: stickyTop + margin,
                viewBottom: cardRect.top - margin,
            };
        }
        const cardH = cardRect?.height || 220;
        return {
            viewTop: stickyTop + margin,
            viewBottom: window.innerHeight - cardH - margin,
        };
    }

    isElementInViewBand(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        const { viewTop, viewBottom } = this.getScrollMetrics();
        if (viewBottom <= viewTop + 40) return false;
        return rect.top >= viewTop - 8 && rect.bottom <= viewBottom + 8;
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

    ensureTargetClearOfCard(element) {
        if (!element || !this.card) return;
        const targetRect = element.getBoundingClientRect();
        const cardRect = this.card.getBoundingClientRect();
        const overlaps =
            targetRect.bottom > cardRect.top - 12 && targetRect.top < cardRect.bottom + 12;
        if (!overlaps) return;

        const scrollRoot = document.scrollingElement || document.documentElement;
        if (!scrollRoot) return;

        if (cardRect.top <= targetRect.bottom && cardRect.top >= targetRect.top - 40) {
            scrollRoot.scrollTop += Math.round(targetRect.bottom - cardRect.top + 28);
        } else if (cardRect.bottom >= targetRect.top && cardRect.bottom <= targetRect.bottom + 40) {
            scrollRoot.scrollTop += Math.round(targetRect.top - cardRect.bottom - 28);
        }
    }

    findEditorDemoBookmark() {
        const mgr = window.configManager;
        if (!mgr?.bookmarksData) return null;
        return mgr.bookmarksData.find((b) => b[ConfigBookmarksTour.DEMO_FLAG] === 'editor');
    }

    findEditorDemoIndex() {
        const mgr = window.configManager;
        if (!mgr?.bookmarksData) return -1;
        return mgr.bookmarksData.findIndex((b) => b[ConfigBookmarksTour.DEMO_FLAG] === 'editor');
    }

    findEditorDemoElement() {
        const idx = this.findEditorDemoIndex();
        if (idx < 0) return null;
        return document.querySelector(`[data-bookmark-index="${idx}"]`);
    }

    /** Top of the detail editor (name/URL) — keeps the highlight above the bottom tour card. */
    findDetailEditorHighlightElement() {
        const form = document.getElementById('bookmark-detail-form');
        if (form) {
            form.scrollTop = 0;
        }
        const nameField = document.getElementById('detail-name');
        const section =
            nameField?.closest('.bookmark-detail-section') ||
            form?.querySelector('.bookmark-detail-section');
        return (
            section ||
            document.querySelector('.bookmark-detail-header') ||
            document.getElementById('bookmark-detail-panel')
        );
    }

    ensureHighlightAboveTourCard(element) {
        if (!element) return;

        const detailForm = document.getElementById('bookmark-detail-form');
        const inDetail = element.closest('#bookmark-detail-panel');

        const nudgeDetailForm = () => {
            if (!inDetail || !detailForm) return;
            const { viewTop, viewBottom } = this.getScrollMetrics();
            const section = element.closest('.bookmark-detail-section') || element;
            const rect = section.getBoundingClientRect();
            if (rect.bottom > viewBottom) {
                detailForm.scrollTop += Math.round(rect.bottom - viewBottom + 20);
            }
            const afterDown = section.getBoundingClientRect();
            if (afterDown.top < viewTop) {
                detailForm.scrollTop = Math.max(
                    0,
                    detailForm.scrollTop - Math.round(viewTop - afterDown.top + 20)
                );
            }
        };

        nudgeDetailForm();
        const scrollParent = this.getScrollableAncestor(element);
        this.adjustScrollForViewBand(element, scrollParent);
        nudgeDetailForm();
    }

    applyEditorDemoFields(bookmark, site) {
        if (!bookmark || !site) return;
        bookmark.name = this.demoLabel(site);
        bookmark.url = site.url;
        bookmark.note = ConfigBookmarksTour.DEMO_NOTE;
        bookmark[ConfigBookmarksTour.DEMO_FLAG] = 'editor';

        const nameEl = document.getElementById('detail-name');
        const urlEl = document.getElementById('detail-url');
        const noteEl = document.getElementById('detail-note');
        if (nameEl) nameEl.value = bookmark.name;
        if (urlEl) urlEl.value = bookmark.url;
        if (noteEl) noteEl.value = '';
    }

    async promptDemoConsent() {
        this.unlockScroll();
        const title = this.t('configBookmarksTourDemoConsentTitle', 'Try adding demo bookmarks?');
        const message = this.t(
            'configBookmarksTourDemoConsentMessage',
            'We add a couple of temporary bookmarks with random public websites, then remove them before you finish the tour.'
        );

        return this.withTourDialog(async () => {
            try {
                if (window.AppModal?.confirm) {
                    return await window.AppModal.confirm({
                        title,
                        message,
                        confirmText: this.t('configBookmarksTourDemoConsentYes', 'Show me'),
                        cancelText: this.t('configBookmarksTourDemoConsentNo', 'Skip demos'),
                    });
                }
                return window.confirm(`${title}\n\n${message}`);
            } catch {
                return false;
            }
        });
    }

    async addEditorDemoBookmark() {
        const mgr = window.configManager;
        if (!mgr) return false;

        const existing = this.findEditorDemoBookmark();
        if (existing) {
            const idx = this.findEditorDemoIndex();
            this._demoEditorIndex = idx;
            if (idx >= 0 && typeof mgr.bookmarks.openDetailPanel === 'function') {
                mgr.bookmarks.openDetailPanel(idx, mgr.bookmarksData, mgr.bookmarksPageCategories);
            }
            this.applyEditorDemoFields(existing, this._demoSites.editor);
            return true;
        }

        mgr.addBookmark();
        const idx = mgr.bookmarksData.length - 1;
        const bookmark = mgr.bookmarksData[idx];
        if (!bookmark) return false;

        this._demoEditorIndex = idx;
        this.applyEditorDemoFields(bookmark, this._demoSites.editor);
        mgr.refreshBookmarksList({ focusIndex: idx });
        mgr.markDirty?.();
        await this.waitMs(32);
        this.ensureTourCardInteractive();
        return true;
    }

    async openConfigQuickAddModal(site) {
        const mgr = window.configManager;
        if (!mgr?.quickAdd) return false;

        if (!mgr.quickAdd._delegate) {
            mgr.quickAdd._delegate = mgr.quickAdd._build();
        }
        const delegate = mgr.quickAdd._delegate;
        if (!delegate) return false;

        const pages = (mgr.pagesData || []).filter((p) => !p.archived);
        delegate.setContext(this.getResolvedPageId(), mgr.bookmarksPageCategories || [], pages);
        delegate.openModal({ url: site.url, name: this.demoLabel(site) });
        await this.waitMs(120);

        const nameEl = document.getElementById('new-bookmark-name');
        const urlEl = document.getElementById('new-bookmark-url');
        if (nameEl && !nameEl.value) nameEl.value = this.demoLabel(site);
        if (urlEl && !urlEl.value) urlEl.value = site.url;

        if (delegate.usesMobileWizard?.()) {
            delegate.setWizardStep?.(1);
        }
        return Boolean(document.querySelector('.modal-new-bookmark'));
    }

    _tourFetch(url, init) {
        return typeof nextDashFetch === 'function' ? nextDashFetch(url, init) : fetch(url, init);
    }

    _tourJsonHeaders() {
        return typeof nextDashWriteHeaders === 'function'
            ? nextDashWriteHeaders({ 'Content-Type': 'application/json' })
            : { 'Content-Type': 'application/json' };
    }

    async createPersistedDemoBookmark(site, pageId) {
        const bookmark = {
            name: this.demoLabel(site),
            url: site.url,
            note: ConfigBookmarksTour.DEMO_NOTE,
            shortcut: '',
            category: '',
            pinned: false,
            checkStatus: false,
            tags: [],
            icon: '',
            createdAt: Date.now(),
            [ConfigBookmarksTour.DEMO_FLAG]: true,
        };

        try {
            const response = await this._tourFetch('/api/bookmarks/add', {
                method: 'POST',
                headers: this._tourJsonHeaders(),
                body: JSON.stringify({ page: pageId, bookmark }),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async deletePersistedDemo(pageId, url) {
        if (!pageId || !url) return true;
        const urlKey = this.canonicalUrlKey(url);
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return false;
            const list = await res.json();
            if (!Array.isArray(list)) return true;
            const bm = list.find(
                (b) =>
                    b[ConfigBookmarksTour.DEMO_FLAG] ||
                    b.note === ConfigBookmarksTour.DEMO_NOTE ||
                    this.canonicalUrlKey(b.url) === urlKey
            );
            if (!bm) return true;
            const del = await this._tourFetch('/api/bookmarks', {
                method: 'DELETE',
                headers: this._tourJsonHeaders(),
                body: JSON.stringify({ page: pageId, bookmark: bm }),
            });
            return del.ok;
        } catch {
            return false;
        }
    }

    async removeEditorDemoBookmark() {
        const mgr = window.configManager;
        if (!mgr?.bookmarksData) return true;

        const idx = this.findEditorDemoIndex();
        if (idx === -1) {
            this._demoEditorIndex = null;
            return true;
        }

        mgr.bookmarksData.splice(idx, 1);
        if (mgr.bookmarks.activeDetailIndex === idx) {
            mgr.bookmarks.activeDetailIndex = null;
            mgr.bookmarks.setDetailPanelMode?.('empty');
        }
        this._demoEditorIndex = null;
        mgr.refreshBookmarksList?.();
        mgr.markDirty?.();
        return true;
    }

    async ensureDemoRemoved() {
        if (this._demoCleanupInProgress) return false;
        this._demoCleanupInProgress = true;
        try {
            this.closeQuickAddModal();
            const pageId = this.getResolvedPageId();
            const sites = this._demoSites || this._handoff?.demoSites;
            await this.removeEditorDemoBookmark();
            if (sites) {
                await this.deletePersistedDemo(pageId, sites.modal?.url);
                await this.deletePersistedDemo(pageId, sites.dashboard?.url);
            }
            const mgr = window.configManager;
            if (mgr?.loadPageBookmarks) {
                try {
                    await mgr.loadPageBookmarks(mgr.currentPageId);
                    mgr.refreshBookmarksList?.({ skipFlush: true });
                } catch {
                    // ignore
                }
            }
            const dash = window.dashboardInstance;
            if (dash?.loadPageBookmarks) {
                try {
                    await dash.loadAllBookmarks?.();
                    await dash.loadPageBookmarks?.(dash.currentPageId);
                    dash.renderDashboard?.();
                } catch {
                    // ignore
                }
            }
            return true;
        } finally {
            this._demoCleanupInProgress = false;
        }
    }

    async handleDemoConsentStep(step) {
        if (this._demoConsentHandled) {
            this.ensureTourCardInteractive();
            return;
        }
        this._demoConsentHandled = true;

        if (!this._demoSites) this._demoSites = this.pickDemoSites();

        const confirmed = await this.promptDemoConsent();
        this.restoreTourCardAfterDialog();
        if (confirmed) {
            step.body = this.t(
                'configBookmarksTourDemoConsentYesBody',
                'Great — we use random public sites as examples. First: a bookmark in the list and editor (not saved to disk until you click Save).'
            );
        } else {
            step.body = this.t(
                'configBookmarksTourDemoConsentNoBody',
                'Skipped the live demos. Open + Bookmark anytime for Add & edit or Quick add (⚡).'
            );
            this._demosSkipped = true;
            this._demoEditorHandled = true;
            this._demoModalOpenHandled = true;
            this._demoModalSaveHandled = true;
            this._demoQuickAddHandled = true;
            this._demoDashboardNavHandled = true;
        }
    }

    async handleEditorDemoStep(step) {
        if (this._demoEditorHandled) {
            this.ensureTourCardInteractive();
            return;
        }
        this._demoEditorHandled = true;
        if (this._demosSkipped || !this._demoConsentHandled) return;

        const added = await this.addEditorDemoBookmark();
        if (added) {
            const idx = this.findEditorDemoIndex();
            const mgr = window.configManager;
            if (idx >= 0 && mgr?.bookmarks?.openDetailPanel) {
                mgr.bookmarks.openDetailPanel(idx, mgr.bookmarksData, mgr.bookmarksPageCategories);
            }
            step.body = this.t(
                'configBookmarksTourEditorDemoDoneBody',
                'Edit name, URL, category, and more on the right. This demo row stays in the editor until you click Save — it is not on the dashboard yet.'
            );
            step.getTarget = () => this.findDetailEditorHighlightElement();
            step.selector = null;
            step.scrollBlock = 'start';
            this.ensureTourCardInteractive();
        } else {
            step.body = this.t(
                'configBookmarksTourEditorDemoFailBody',
                'Open + Bookmark → Add & edit to create a bookmark, then fill name and URL on the right.'
            );
            step.selector = '#bookmark-add-menu';
            step.getTarget = null;
        }
    }

    async handleQuickAddDemoStep(step) {
        if (this._demoQuickAddHandled) return;
        this._demoQuickAddHandled = true;
        if (this._demosSkipped || !this._demoSites) return;

        const pageId = this.getResolvedPageId();
        const created = await this.createPersistedDemoBookmark(this._demoSites.modal, pageId);
        this.closeQuickAddModal();
        await this.waitMs(80);

        const mgr = window.configManager;
        if (created && mgr?.loadPageBookmarks) {
            try {
                await mgr.loadPageBookmarks(mgr.currentPageId);
                mgr.refreshBookmarksList?.({ skipFlush: true });
            } catch {
                // ignore
            }
        }

        if (created) {
            step.body = this.t(
                'configBookmarksTourQuickAddDoneBody',
                'Quick add writes straight to disk — no Save click. The bookmark appears in the list and on the dashboard.'
            );
            step.selector = '.bookmarks-list-scroll-area';
            step.getTarget = null;
        } else {
            step.body = this.t(
                'configBookmarksTourQuickAddFailBody',
                'Open + Bookmark → Quick add (⚡) to add a bookmark that saves immediately.'
            );
            step.selector = '#config-quick-add-btn';
            step.getTarget = null;
        }
    }

    handleBulkDemoStep(step) {
        const mgr = window.configManager;
        const bookmarks = mgr?.bookmarks;
        if (!bookmarks) return;

        bookmarks.clearSelection();
        const indexes = [];
        const demoIdx = this.findEditorDemoIndex();
        if (demoIdx >= 0) indexes.push(demoIdx);

        document.querySelectorAll('.bookmark-item').forEach((item) => {
            if (indexes.length >= 3) return;
            const index = parseInt(item.getAttribute('data-bookmark-index'), 10);
            if (!Number.isNaN(index) && !indexes.includes(index)) {
                indexes.push(index);
            }
        });

        if (indexes.length === 0) {
            step.body = this.t(
                'configBookmarksTourBulkEmptyBody',
                'Select bookmarks with the checkboxes in the list to show bulk actions.'
            );
            return;
        }

        indexes.forEach((index) => {
            bookmarks.selectedBookmarkIndexes.add(index);
            const checkbox = document.querySelector(`[data-bookmark-select="${index}"]`);
            if (checkbox) checkbox.checked = true;
        });
        bookmarks.bulkToolbarDismissed = false;
        bookmarks.updateBulkSelectionToolbar();

        step.body = this.t(
            'configBookmarksTourBulkDemoBody',
            'We selected a few bookmarks so you can try Move to, pin, status, favicon refresh, or delete.'
        );
    }

    async handleDashboardHandoffStep(step) {
        if (this._demoDashboardNavHandled) return;
        this._demoDashboardNavHandled = true;
        if (!this._demoSites) this._demoSites = this.pickDemoSites();

        const pageId = this.getResolvedPageId();
        try {
            sessionStorage.setItem(
                ConfigBookmarksTour.HANDOFF_KEY,
                JSON.stringify({
                    demoSites: this._demoSites,
                    pageId,
                })
            );
        } catch {
            // ignore
        }

        step.body = this.t(
            'configBookmarksTourDashboardHandoffBody',
            'Next we open the dashboard briefly: the + toolbar button uses this same modal. Click Next to continue there, then you return here to clean up.'
        );
        step.getTarget = () => this.findDashboardBackLink();
        step.selector = null;
    }

    clearTourDialogLayerState() {
        document.body.classList.remove(
            'config-bookmarks-tour-dialog-open',
            'guided-flow-modal-open'
        );
        window.ConfigTourRuntime?.setTourLayersForAppModal?.(false);
        window.GuidedFlowGuard?.syncModalOpenClass?.();
    }

    /** Resume-only cleanup (Step 1 of 1): no AppModal — demos removed in background so buttons stay clickable. */
    handleResumeCleanupStep(step) {
        this.clearTourDialogLayerState();
        step.body = this.t(
            'configBookmarksTourCleanupDoneBody',
            'All tour bookmarks are removed. Your collection is back to how it was before the tour.'
        );
        this.ensureTourCardInteractive();

        if (this._demoCleanupHandled) return;
        this._demoCleanupHandled = true;
        void this.ensureDemoRemoved().then(() => {
            if (!this.card || this.steps[this.currentStep]?.id !== 'demo-cleanup') return;
            const body = this.card.querySelector('.config-general-tour-body');
            if (body) {
                body.textContent = this.t(
                    'configBookmarksTourCleanupDoneBody',
                    'All tour bookmarks are removed. Your collection is back to how it was before the tour.'
                );
            }
            this.ensureTourCardInteractive();
        });
    }

    async handleCleanupStep(step) {
        if (this._demoCleanupHandled) {
            this.endInteractiveModalStep();
            this.clearTourDialogLayerState();
            this.ensureTourCardInteractive();
            return;
        }
        this._demoCleanupHandled = true;

        this.unlockScroll();
        let confirmed = true;
        try {
            confirmed = await this.withTourDialog(async () => {
                if (window.AppModal?.confirm) {
                    return await window.AppModal.confirm({
                        title: this.t('configBookmarksTourCleanupConfirmTitle', 'Remove demo bookmarks?'),
                        message: this.t(
                            'configBookmarksTourCleanupConfirmMessage',
                            'We remove the temporary tour bookmarks from the editor and from the saved page so your library stays unchanged.'
                        ),
                        confirmText: this.t('configBookmarksTourCleanupConfirmYes', 'Remove demos'),
                        cancelText: this.t('config.cancel', 'Cancel'),
                    });
                }
                return window.confirm(
                    this.t(
                        'configBookmarksTourCleanupConfirmMessage',
                        'Remove temporary tour bookmarks?'
                    )
                );
            });
        } catch {
            confirmed = false;
        }

        this.endInteractiveModalStep();
        this.clearTourDialogLayerState();

        if (!confirmed) {
            step.body = this.t(
                'configBookmarksTourCleanupKeptBody',
                'Demo bookmarks may still be present. Delete them in the list or restart the tour from General → System tools.'
            );
            this.ensureTourCardInteractive();
            return;
        }

        step.body = this.t(
            'configBookmarksTourCleanupDoneBody',
            'All tour bookmarks are removed. Your collection is back to how it was before the tour.'
        );
        this.ensureTourCardInteractive();
        void this.ensureDemoRemoved().then((removed) => {
            if (!removed && this.card && this.steps[this.currentStep]?.id === 'demo-cleanup') {
                const body = this.card.querySelector('.config-general-tour-body');
                const kept = this.t(
                    'configBookmarksTourCleanupKeptBody',
                    'Some demo bookmarks may still be present. Delete them in the list or restart the tour from General → System tools.'
                );
                step.body = kept;
                if (body) body.textContent = kept;
            }
            this.ensureTourCardInteractive();
        });
    }

    findDashboardDemoTile() {
        const url = this._demoSites?.dashboard?.url || this._handoff?.demoSites?.dashboard?.url;
        if (!url) return document.querySelector('.bookmark-link');
        const key = this.canonicalUrlKey(url);
        for (const tile of document.querySelectorAll('.bookmark-link')) {
            const href = tile.querySelector('a.bookmark-open')?.href || tile.dataset.bookmarkUrl || '';
            if (this.canonicalUrlKey(href) === key) return tile;
        }
        return document.querySelector('.bookmark-link');
    }

    async openDashboardQuickAdd(site, dashboard) {
        const handler = dashboard?.searchComponent?.commandsComponent?.newCommandHandler;
        if (!handler) return false;

        const pageId = Number(dashboard.currentPageId) || 1;
        const categories = dashboard.categories || [];
        const pages = dashboard.pages || [];
        handler.setContext(pageId, categories, pages);
        handler.openModal({ url: site.url, name: this.demoLabel(site) });
        await this.waitMs(120);
        if (handler.usesMobileWizard?.()) {
            handler.setWizardStep?.(1);
        }
        return Boolean(document.querySelector('.modal-new-bookmark'));
    }

    isStepSkipped(step) {
        if (!step) return true;
        if (step.skipWhenDemosSkipped && this._demosSkipped) return true;
        return false;
    }

    getVisibleStepCount() {
        return this.steps.filter((step) => !this.isStepSkipped(step)).length;
    }

    getVisibleStepNumber(index) {
        let number = 0;
        for (let i = 0; i <= index && i < this.steps.length; i += 1) {
            if (!this.isStepSkipped(this.steps[i])) number += 1;
        }
        return number;
    }

    resolveStepIndex(index, direction = 1) {
        let next = index + direction;
        while (next >= 0 && next < this.steps.length) {
            if (!this.isStepSkipped(this.steps[next])) return next;
            next += direction;
        }
        return index;
    }

    buildConfigSteps() {
        return [
            {
                title: this.t('configBookmarksTourWelcomeTitle', 'Welcome to the Bookmarks editor'),
                body: this.t(
                    'configBookmarksTourWelcomeBody',
                    'List on the left, detail editor on the right. Structure workspace above stays collapsed until you need pages or categories.'
                ),
                selector: '.bookmarks-splitview',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
            },
            {
                id: 'list-controls',
                title: this.t('configBookmarksTourListControlsTitle', 'Filter, sort & add'),
                body: this.t(
                    'configBookmarksTourListControlsBody',
                    'Pick page and category, change sort, search below, and use + Bookmark for Add & edit (needs Save) or Quick add (⚡, saves immediately).'
                ),
                selector: '.bookmarks-list-controls-row',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                id: 'demo-consent',
                title: this.t('configBookmarksTourDemoConsentStepTitle', 'Hands-on demo'),
                body: this.t(
                    'configBookmarksTourDemoConsentStepBody',
                    'Optional: we add temporary demo bookmarks, then remove them before you finish.'
                ),
                selector: '#bookmark-add-menu',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleDemoConsentStep(step),
            },
            {
                id: 'editor-demo',
                skipWhenDemosSkipped: true,
                title: this.t('configBookmarksTourEditorDemoTitle', 'Add & edit'),
                body: this.t(
                    'configBookmarksTourEditorDemoIntroBody',
                    'Open + Bookmark → Add & edit. It adds a row and opens the editor — click Save when you are done.'
                ),
                selector: '#bookmark-add-menu',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleEditorDemoStep(step),
            },
            {
                id: 'quick-add-demo',
                skipWhenDemosSkipped: true,
                title: this.t('configBookmarksTourQuickAddTitle', 'Quick add'),
                body: this.t(
                    'configBookmarksTourQuickAddBody',
                    'Quick add (⚡) saves immediately — unlike Add & edit, no Save click needed.'
                ),
                selector: '#config-quick-add-btn',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleQuickAddDemoStep(step),
            },
            {
                id: 'bulk-demo',
                title: this.t('configBookmarksTourBulkTitle', 'Bulk actions'),
                body: this.t(
                    'configBookmarksTourBulkBody',
                    'Select multiple bookmarks, then use Move to for page or category changes, plus pin, status, favicon refresh, or delete.'
                ),
                selector: '#bookmarks-bulk-toolbar',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleBulkDemoStep(step),
            },
            {
                title: this.t('configBookmarksTourSaveTitle', 'Save your changes'),
                body: this.t(
                    'configBookmarksTourSaveBody',
                    'Add & edit changes are not written until you click Save. Unsaved edits are highlighted.'
                ),
                selector: '#save-btn',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                id: 'demo-cleanup',
                skipWhenDemosSkipped: true,
                title: this.t('configBookmarksTourCleanupTitle', 'Clean up demos'),
                body: this.t(
                    'configBookmarksTourCleanupIntroBody',
                    'Remove temporary tour bookmarks from the editor and saved data.'
                ),
                selector: '.bookmarks-list-scroll-area',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleCleanupStep(step),
            },
        ];
    }

    buildDashboardSteps() {
        return [
            {
                title: this.t('configBookmarksTourDashboardToolbarTitle', 'Dashboard + button'),
                body: this.t(
                    'configBookmarksTourDashboardToolbarBody',
                    'Press + or click this button to add a bookmark without opening Config.'
                ),
                getTarget: () => document.getElementById('quick-add-toolbar-btn'),
                cardPlacement: 'viewport-bottom',
                unlockScroll: true,
            },
            {
                id: 'dashboard-modal',
                title: this.t('configBookmarksTourDashboardModalTitle', '+ bookmark modal'),
                body: this.t(
                    'configBookmarksTourDashboardModalBody',
                    'Same form as in Config Quick add. We prefilled another random site for this step.'
                ),
                companionModalStep: true,
                noHighlight: true,
                cardPlacement: 'viewport-bottom',
                unlockScroll: true,
                onBeforeShow: async (step) => {
                    const site = this._demoSites?.dashboard;
                    const dash = window.dashboardInstance;
                    if (!site || !dash) return;
                    await this.openDashboardQuickAdd(site, dash);
                },
            },
            {
                id: 'dashboard-create',
                title: this.t('configBookmarksTourDashboardCreateTitle', 'Saved on the dashboard'),
                body: this.t(
                    'configBookmarksTourDashboardCreateIntroBody',
                    'Creating here saves immediately and shows the tile on your current page.'
                ),
                getTarget: () => document.getElementById('quick-add-toolbar-btn'),
                cardPlacement: 'viewport-bottom',
                unlockScroll: true,
                onBeforeShow: async (step) => {
                    this.endInteractiveModalStep();
                    const site = this._demoSites?.dashboard;
                    const pageId = Number(window.dashboardInstance?.currentPageId) || this._handoff?.pageId || 1;
                    if (site) {
                        this.closeQuickAddModal();
                        await this.createPersistedDemoBookmark(site, pageId);
                        await this.waitMs(120);
                        const dash = window.dashboardInstance;
                        if (dash?.loadPageBookmarks) {
                            await dash.loadPageBookmarks(dash.currentPageId);
                            dash.renderDashboard?.();
                        }
                    }
                    const tile = this.findDashboardDemoTile();
                    if (tile) {
                        step.getTarget = () => tile;
                        step.body = this.t(
                            'configBookmarksTourDashboardTileBody',
                            'Here is the new tour bookmark on your dashboard. It is removed when you finish the tour in Config.'
                        );
                    }
                },
            },
            {
                title: this.t('configBookmarksTourDashboardReturnTitle', 'Back to Config'),
                body: this.t(
                    'configBookmarksTourDashboardReturnBody',
                    'Click Next to return to Config → Bookmarks and remove all demo bookmarks.'
                ),
                getTarget: () =>
                    document.querySelector('a.back-link[href="/config"]') ||
                    document.querySelector('a[href="/config"]'),
                cardPlacement: 'viewport-bottom',
                unlockScroll: true,
            },
        ];
    }

    buildResumeCleanupSteps() {
        return [
            {
                id: 'demo-cleanup',
                title: this.t('configBookmarksTourCleanupTitle', 'Clean up demos'),
                body: this.t(
                    'configBookmarksTourCleanupResumeBody',
                    'Welcome back — remove the temporary tour bookmarks from your library.'
                ),
                selector: '.bookmarks-splitview',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => {
                    this.handleResumeCleanupStep(step);
                },
            },
        ];
    }

    openAddBookmarkMenu() {
        const menu = document.getElementById('bookmark-add-menu');
        if (menu) menu.open = true;
    }

    revealTarget(step) {
        let element = null;
        if (typeof step?.getTarget === 'function') {
            element = step.getTarget();
        } else if (step?.selector) {
            element = document.querySelector(step.selector);
        }
        const needsOpenMenu = element && (
            element.id === 'add-bookmark-btn'
            || element.id === 'config-quick-add-btn'
            || element.closest?.('#bookmark-add-menu')
        );
        if (needsOpenMenu) {
            this.openAddBookmarkMenu();
        }
        if (element?.hidden) {
            element.hidden = false;
            element.removeAttribute('hidden');
        }
        return element;
    }

    async scrollToStepTarget(element, step = {}, options = {}) {
        if (!element || typeof element.scrollIntoView !== 'function') return;

        if (step.unlockScroll) {
            this.unlockScroll();
        } else {
            this.unlockScroll();
        }

        window.ConfigTourRuntime?.applyCardPlacement?.(this, element, step);
        await this.waitMs(16);

        const block = options.block || step.scrollBlock || 'center';
        const scrollParent = this.getScrollableAncestor(element);
        const scrollTarget =
            element.closest('.bookmark-detail-section') ||
            element.closest('.modal-new-bookmark') ||
            element;
        const needsScroll = !this.isElementInViewBand(element);

        if (needsScroll || scrollParent) {
            const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
            const isFixedLike = style && (style.position === 'fixed' || style.position === 'sticky');

            (scrollTarget || element).scrollIntoView({
                behavior: 'auto',
                block: scrollParent || isFixedLike ? 'nearest' : block,
                inline: 'nearest',
            });

            this.adjustScrollForViewBand(element, scrollParent);
            await this.waitMs(24);
            this.adjustScrollForViewBand(element, scrollParent);
            await this.waitMs(16);
        }

        this.ensureHighlightAboveTourCard(element);

        if (!step.unlockScroll && this.phase === 'config') {
            this.lockScroll();
        }
    }

    async prepareAndStart({ force = false, resumeCleanup = false } = {}) {
        this.lastFailureReason = null;
        if (!this.canStart({ force }) && !resumeCleanup) {
            this.lastFailureReason = 'blocked';
            return false;
        }

        this.ensurePageReady();

        if (force) {
            ConfigBookmarksTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._demoEditorIndex = null;
            this._demoConsentHandled = false;
            this._demoEditorHandled = false;
            this._demoModalOpenHandled = false;
            this._demoModalSaveHandled = false;
            this._demoQuickAddHandled = false;
            this._demoDashboardNavHandled = false;
            this._demoCleanupHandled = false;
        }

        if (!this._demoSites) {
            this._demoSites = this.pickDemoSites();
        }

        this.ensureBookmarksTabActive();
        await this.waitForBookmarksTabActive(force ? 50 : 30);
        await this.ensureBookmarksDataReady();
        await this.waitForBookmarksReady(force ? 45 : 30);

        if (!this.canStart({ force }) && !resumeCleanup) {
            this.lastFailureReason = 'no-bookmarks-tab';
            return false;
        }

        this.steps = resumeCleanup ? this.buildResumeCleanupSteps() : this.buildConfigSteps();

        if (resumeCleanup) {
            this.endInteractiveModalStep();
            this.clearTourDialogLayerState();
        }

        document.body.setAttribute('data-config-bookmarks-tour-active', 'true');
        document.body.classList.remove('config-bookmarks-tour-ready');

        this.render();
        if (!this.card) {
            document.body.removeAttribute('data-config-bookmarks-tour-active');
            this.lastFailureReason = 'render-failed';
            return false;
        }

        window.GuidedFlowGuard?.syncModalOpenClass?.();
        if (window.configManager) {
            window.configManager._configBookmarksTourActive = true;
        }
        try {
            await this.showStep(0);
        } catch (error) {
            console.error('Config Bookmarks tour failed to start', error);
            ConfigBookmarksTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    async startDashboardPhase(dashboard) {
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return false;

        this.ensurePageReady();
        if (!this._demoSites && this._handoff?.demoSites) {
            this._demoSites = this._handoff.demoSites;
        }
        if (!this._demoSites) {
            this._demoSites = this.pickDemoSites();
        }

        this.steps = this.buildDashboardSteps();
        this.render();
        if (!this.card) return false;

        document.body.setAttribute('data-config-bookmarks-tour-active', 'true');
        document.body.classList.add('config-bookmarks-tour-ready');

        try {
            await this.waitMs(dashboard ? 200 : 100);
            await this.showStep(0);
        } catch (error) {
            console.error('Config Bookmarks tour dashboard phase failed', error);
            ConfigBookmarksTour.teardownStaleDom();
            return false;
        }
        return true;
    }

    removeTourCardOnly() {
        document.querySelectorAll('.config-bookmarks-tour-card').forEach((el) => el.remove());
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    render() {
        this.removeTourCardOnly();

        const card = document.createElement('div');
        card.className = 'config-bookmarks-tour-card';
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

        this.bindTourCardActions(card);

        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.finish();
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    bindTourCardActions(card) {
        if (!card || card.dataset.tourActionsBound === '1') return;
        card.dataset.tourActionsBound = '1';
        card.setAttribute('data-config-tour-card', 'true');

        const onCardAction = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const btn = target.closest('.config-general-tour-btn');
            if (!btn || !(btn instanceof HTMLButtonElement) || btn.disabled) return;

            if (btn.classList.contains('config-general-tour-next')) {
                event.preventDefault();
                event.stopPropagation();
                this.nextStep();
            } else if (btn.classList.contains('config-general-tour-skip')) {
                event.preventDefault();
                event.stopPropagation();
                this.finish();
            } else if (btn.classList.contains('config-general-tour-back')) {
                event.preventDefault();
                event.stopPropagation();
                this.prevStep();
            }
        };

        card.addEventListener('click', onCardAction, true);
        card.addEventListener('pointerup', onCardAction, true);
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
        progress.textContent = this.t('configBookmarksTourProgress', 'Step {step} of {total}')
            .replace('{step}', String(this.getVisibleStepNumber(index)))
            .replace('{total}', String(this.getVisibleStepCount()));

        back.disabled = index === 0;
        next.textContent =
            index === this.steps.length - 1
                ? this.t('configGeneralTourFinish', 'Finish')
                : this.t('configGeneralTourNext', 'Next');
    }

    clearHighlight() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('config-bookmarks-tour-highlight');
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
            this.unlockScroll();
        }

        if (typeof step.onBeforeShow === 'function') {
            await step.onBeforeShow(step);
            if (runId !== this._stepRunId) return;
        }

        if (step.companionModalStep) {
            this.prepareInteractiveModalStep();
            await this.waitMs(40);
            if (runId !== this._stepRunId) return;
        }

        if (step.companionModalStep || step.noHighlight) {
            if (!step.unlockScroll && this.phase === 'config') {
                this.lockScroll();
            }
        } else {
            const element = this.revealTarget(step);
            await this.waitMs(80);
            if (runId !== this._stepRunId) return;

            if (element) {
                await this.scrollToStepTarget(element, step, { block: step.scrollBlock || 'center' });
                if (runId !== this._stepRunId) return;
                element.classList.add('config-bookmarks-tour-highlight');
                this.highlightedElement = element;
            } else if (!step.unlockScroll) {
                this.lockScroll();
            }
        }

        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);

        if (runId !== this._stepRunId) return;
        this.updateStepContent(step, this.currentStep);
        document.body.classList.add('config-bookmarks-tour-ready');
        window.ConfigTourRuntime?.syncTourLayering?.(this.card);
        this.bindTourCardActions(this.card);
        this.ensureTourCardInteractive();
        await this.waitMs(16);
        if (runId !== this._stepRunId) return;

        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);
        if (this.highlightedElement) {
            const inDetailEditor = this.highlightedElement.closest(
                '#bookmark-detail-panel, .bookmarks-splitview-detail'
            );
            if (inDetailEditor) {
                this.ensureHighlightAboveTourCard(this.highlightedElement);
            }
        }

        window.ConfigTourRuntime?.syncTourLayering?.(this.card);
        this.ensureTourCardInteractive();
        document.body.classList.add('config-bookmarks-tour-ready');
    }

    nextStep() {
        if (this.phase === 'dashboard' && this.currentStep >= this.steps.length - 1) {
            ConfigBookmarksTour.setResume('cleanup');
            this.close();
            window.location.href = '/config#bookmarks';
            return;
        }

        if (this.currentStep >= this.steps.length - 1) {
            this.finish();
            return;
        }

        const nextIndex = this.resolveStepIndex(this.currentStep, 1);
        if (nextIndex === this.currentStep) {
            this.finish();
            return;
        }
        void this.showStep(nextIndex);
    }

    prevStep() {
        const prevIndex = this.resolveStepIndex(this.currentStep, -1);
        if (prevIndex === this.currentStep) return;
        void this.showStep(prevIndex);
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

    finish() {
        if (this.phase === 'dashboard') {
            void this.ensureDemoRemoved().finally(() => {
                ConfigBookmarksTour.setResume('cleanup');
                this.close();
                window.location.href = '/config#bookmarks';
            });
            return;
        }

        if (!this._tourShown) {
            void this.ensureDemoRemoved().finally(() => this.close());
            return;
        }
        void this.markCompleted()
            .then(() => this.ensureDemoRemoved())
            .finally(() => this.close());
    }

    close() {
        this._stepRunId += 1;
        this._tourShown = false;
        this.clearHighlight();
        this.resetCardPosition();
        this.unlockScroll();
        this.closeQuickAddModal();
        this.restoreTourCardAfterDialog();
        this.endInteractiveModalStep();

        if (window.configManager) {
            window.configManager._configBookmarksTourActive = false;
        }
        document.body.removeAttribute('data-config-bookmarks-tour-active');
        document.body.classList.remove('config-bookmarks-tour-ready');
        window.ConfigTourRuntime?.removeTourBackdropIfIdle?.();
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigBookmarksTour.STORAGE_KEY);
            localStorage.removeItem('nextdash:config-bookmarks-tour-v1');
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigBookmarksTour = ConfigBookmarksTour;
}
