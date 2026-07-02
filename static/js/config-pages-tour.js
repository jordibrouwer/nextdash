/**
 * One-time guided tour on Config → Pages (add demo page, dashboard visibility, remove).
 * Same UX as other config tours: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigPagesTour {
    static STORAGE_KEY = 'nextdash:config-pages-tour-v1';
    static DEMO_FLAG = '_configPagesTourDemo';
    static DEMO_NAME = 'Tour demo';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigPagesTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._demoPageId = null;
        this._demoAddHandled = false;
        this._demoCleanupHandled = false;
        this._demoCleanupInProgress = false;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigPagesTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="pages"]')) return 'no-pages-tab';
        return null;
    }

    t(key, fallback) {
        const full = `config.${key}`;
        if (!this.language || typeof this.language.t !== 'function') return fallback;
        const raw = this.language.t(full);
        return raw && raw !== full ? raw : fallback;
    }

    demoPageName() {
        return this.t('configPagesTourDemoPageName', ConfigPagesTour.DEMO_NAME);
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
        if (!document.querySelector('[data-tab-content="pages"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-pages-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-pages-tour-active');
        document.body.classList.remove('config-pages-tour-ready');
        document.documentElement.classList.remove('config-pages-tour-scroll-lock');
        document.body.classList.remove('config-pages-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-pages-tour-highlight')
            .forEach((el) => el.classList.remove('config-pages-tour-highlight'));
        if (window.configManager) {
            window.configManager._configPagesTourActive = false;
        }
    }

    isPagesTabActive() {
        const mgr = window.configManager;
        if (mgr?.isConfigPagesTabActive?.()) return true;
        if (mgr?.ui?._currentTab === 'pages') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'pages') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'pages';
    }

    ensurePagesTabActive() {
        if (!this.isPagesTabActive()) {
            const mgr = window.configManager;
            if (mgr?.ui?.switchToTab) {
                mgr.ui.switchToTab('pages');
            } else {
                const panel = document.querySelector('[data-tab-content="pages"]');
                if (panel && !panel.classList.contains('active')) {
                    document.querySelector('.tab-button[data-tab="pages"]')?.click();
                }
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'pages') {
            window.history.replaceState(null, '', '#pages');
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

    async waitForPagesTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensurePagesTabActive();
            const panel = document.querySelector('[data-tab-content="pages"]');
            const list = document.getElementById('pages-list');
            if (panel && list && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="pages"]') && document.getElementById('pages-list')
        );
    }

    async waitForBookmarksPageSelector(maxAttempts = 30) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            const sel = document.getElementById('page-selector');
            if (sel && sel.options.length > 0) return sel;
            await this.waitMs(80);
        }
        return document.getElementById('page-selector');
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-pages-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-pages-tour-scroll-lock');
        document.body.classList.add('config-pages-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-pages-tour-scroll-lock');
        document.body.classList.remove('config-pages-tour-scroll-lock');
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
        const cardH = this.card?.getBoundingClientRect().height || 220;
        const stickyTop = 72;
        const margin = 24;
        return {
            viewTop: stickyTop + margin,
            viewBottom: window.innerHeight - cardH - margin,
        };
    }

    isElementInViewBand(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        const { viewTop, viewBottom } = this.getScrollMetrics();
        return rect.top >= viewTop - 8 && rect.bottom <= viewBottom + 8;
    }

    findDemoPage() {
        const mgr = window.configManager;
        if (!mgr?.pagesData) return null;
        return (
            mgr.pagesData.find((p) => p[ConfigPagesTour.DEMO_FLAG]) ||
            (this._demoPageId ? mgr.pagesData.find((p) => Number(p.id) === Number(this._demoPageId)) : null)
        );
    }

    findDemoPageElement() {
        const demo = this.findDemoPage();
        if (!demo) return null;
        const items = document.querySelectorAll('#pages-list .page-item');
        for (const el of items) {
            if (Number(el.getAttribute('data-page-id')) === Number(demo.id)) {
                return el;
            }
        }
        return items.length ? items[items.length - 1] : null;
    }

    findDemoRemoveButton() {
        const row = this.findDemoPageElement();
        return row?.querySelector('.btn-danger:not([disabled])') || null;
    }

    findPageSelectorTarget() {
        const sel = document.getElementById('page-selector');
        return sel?.closest('.page-selector-inline') || sel;
    }

    async addTourDemoPage() {
        const mgr = window.configManager;
        if (!mgr) return false;

        const existing = this.findDemoPage();
        if (existing) {
            this._demoPageId = existing.id;
            return true;
        }

        const demoName = this.demoPageName();
        try {
            await mgr.addPage({
                skipPrompt: true,
                pageName: demoName,
                templateId: 'blank',
            });
        } catch (error) {
            console.warn('Pages tour: addPage failed', error);
            return false;
        }

        const page =
            mgr.pagesData.find((p) => p[ConfigPagesTour.DEMO_FLAG]) ||
            mgr.pagesData.find((p) => p.name === demoName && Number(p.id) !== 1) ||
            mgr.pagesData[mgr.pagesData.length - 1];
        if (!page || Number(page.id) === 1) return false;

        page[ConfigPagesTour.DEMO_FLAG] = true;
        page.name = demoName;
        this._demoPageId = page.id;
        mgr.renderPagesTab?.();
        mgr.refreshPageDropdowns?.();
        return true;
    }

    async removeTourDemoPage({ silent = false } = {}) {
        const mgr = window.configManager;
        if (!mgr?.pagesData) return true;

        const idx = mgr.pagesData.findIndex(
            (p) => p[ConfigPagesTour.DEMO_FLAG] || Number(p.id) === Number(this._demoPageId)
        );
        if (idx === -1) {
            this._demoPageId = null;
            return true;
        }

        const page = mgr.pagesData[idx];
        if (!page || Number(page.id) === 1) {
            this._demoPageId = null;
            return true;
        }

        if (!silent) {
            await mgr.removePage(idx);
            this._demoPageId = this.findDemoPage() ? this._demoPageId : null;
            return !this.findDemoPage();
        }

        const ownedLock = !this._demoCleanupInProgress;
        if (ownedLock) this._demoCleanupInProgress = true;
        try {
            await mgr.data.deletePage(page.id);

            mgr.pagesData.splice(idx, 1);
            const origIndex = mgr.originalPagesData.findIndex((p) => p.id === page.id);
            if (origIndex !== -1) {
                mgr.originalPagesData.splice(origIndex, 1);
            }

            mgr.renderPagesList?.();
            mgr.pages.renderPageSelector(mgr.getVisiblePages(), 1);
            mgr.pages.initReorder(mgr.pagesData, (newPages) => mgr.handlePagesReordered(newPages));

            mgr.currentPageId = 1;
            mgr.currentCategoriesPageId = 1;
            await mgr.loadPageBookmarks(1);
            await mgr.loadPageCategories(1);

            const pageSelector = document.getElementById('page-selector');
            if (pageSelector) pageSelector.value = '1';

            const categoriesSelector = document.getElementById('categories-page-selector');
            if (categoriesSelector) {
                categoriesSelector.innerHTML = '';
                mgr.getVisiblePages().forEach((p) => {
                    const option = document.createElement('option');
                    option.value = p.id;
                    option.textContent = p.name;
                    if (Number(p.id) === 1) option.selected = true;
                    categoriesSelector.appendChild(option);
                });
                categoriesSelector.__customSelectInstance?.refresh?.();
            }

            await mgr.persistPagesStructureAndRefresh('page-removed');
            mgr.renderStructureWorkspace?.();
            mgr.refreshPageDropdowns?.();
            this._demoPageId = null;
            return true;
        } catch (error) {
            console.warn('Pages tour: silent remove failed', error);
            return false;
        } finally {
            if (ownedLock) this._demoCleanupInProgress = false;
        }
    }

    async cleanupTourDemoPage({ prompt = false } = {}) {
        if (!this.findDemoPage()) return true;
        if (this._demoCleanupInProgress) return false;

        this._demoCleanupInProgress = true;
        try {
            if (prompt) {
                this.unlockScroll();
                let confirmed = false;
                try {
                    if (window.AppModal?.confirm) {
                        confirmed = await window.AppModal.confirm({
                            title: this.t(
                                'configPagesTourCleanupConfirmTitle',
                                'Remove the demo page?'
                            ),
                            message: this.t(
                                'configPagesTourCleanupConfirmMessage',
                                'We added a temporary page only for this tour. Remove it now so your dashboard stays unchanged.'
                            ),
                            confirmText: this.t('configPagesTourCleanupConfirmYes', 'Remove demo page'),
                            cancelText: this.t('config.cancel', 'Cancel'),
                        });
                    } else {
                        confirmed = window.confirm(
                            this.t(
                                'configPagesTourCleanupConfirmMessage',
                                'Remove the demo page from this tour?'
                            )
                        );
                    }
                } catch {
                    confirmed = false;
                }
                if (!confirmed) return false;
            }
            return await this.removeTourDemoPage({ silent: true });
        } finally {
            this._demoCleanupInProgress = false;
        }
    }

    async ensureDemoRemoved() {
        if (!this.findDemoPage()) return true;
        return this.removeTourDemoPage({ silent: true });
    }

    async promptAddTourDemoPage() {
        this.unlockScroll();

        const title = this.t('configPagesTourDemoConsentTitle', 'Add a demo page?');
        const message = this.t(
            'configPagesTourDemoConsentMessage',
            'For this tour we can add a temporary page named “Tour demo”. You will see it on the dashboard and remove it before the tour ends — nothing stays behind.'
        );

        let confirmed = false;
        try {
            if (window.AppModal?.confirm) {
                confirmed = await window.AppModal.confirm({
                    title,
                    message,
                    confirmText: this.t('configPagesTourDemoConsentYes', 'Add demo page'),
                    cancelText: this.t('configPagesTourDemoConsentNo', 'Skip demo'),
                });
            } else {
                confirmed = window.confirm(`${title}\n\n${message}`);
            }
        } catch {
            confirmed = false;
        }

        if (!confirmed) return false;
        return this.addTourDemoPage();
    }

    async handleDemoAddStep(step) {
        if (this._demoAddHandled) return;
        this._demoAddHandled = true;

        const added = await this.promptAddTourDemoPage();
        if (added) {
            step.body = this.t(
                'configPagesTourDemoAddedBody',
                'Here is your demo page in the list. Rename it anytime — the name is used on the dashboard too.'
            );
            step.getTarget = () => this.findDemoPageElement();
            step.selector = null;
        } else {
            step.body = this.t(
                'configPagesTourDemoSkippedBody',
                'No demo page was added. Click + Add page when you are ready — you can still follow the rest of the tour.'
            );
            step.selector = '#add-page-btn';
            step.getTarget = null;
        }
    }

    async handleDashboardStep(step) {
        this.ensureBookmarksTabActive();
        await this.waitMs(120);
        const mgr = window.configManager;
        const sel = await this.waitForBookmarksPageSelector();
        if (sel && this._demoPageId) {
            sel.value = String(this._demoPageId);
            mgr.currentPageId = this._demoPageId;
            sel.dispatchEvent?.(new Event('change', { bubbles: true }));
            sel.__customSelectInstance?.refresh?.();
            await mgr.loadPageBookmarks?.(this._demoPageId);
        }

        if (this.findDemoPage()) {
            step.body = this.t(
                'configPagesTourDashboardDoneBody',
                'Your new page appears in this Page menu and as a tab on the dashboard (top bar). Switch with 1–9 or Shift+←/→. Click ← back to dashboard to see it live.'
            );
        } else {
            step.body = this.t(
                'configPagesTourDashboardSkippedBody',
                'Each page you add shows up here in Bookmarks and as a tab on the dashboard. Use the Page menu to edit bookmarks per page.'
            );
        }
        step.getTarget = () => this.findPageSelectorTarget();
        step.selector = null;
    }

    async handleReturnToPagesStep() {
        this.ensurePagesTabActive();
        await this.waitForPagesTabActive(25);
        window.configManager?.renderPagesTab?.();
        await this.waitMs(80);
    }

    async handleCleanupStep(step) {
        if (this._demoCleanupHandled) return;
        this._demoCleanupHandled = true;

        await this.handleReturnToPagesStep();

        if (!this.findDemoPage()) {
            step.body = this.t(
                'configPagesTourCleanupNoneBody',
                'There is no demo page left. Use Remove (red) on any row except the main page when you want to delete a page — you confirm in a dialog first.'
            );
            step.getTarget = () => document.getElementById('pages-list');
            step.selector = null;
            return;
        }

        const removed = await this.cleanupTourDemoPage({ prompt: true });
        if (removed) {
            step.body = this.t(
                'configPagesTourCleanupDoneBody',
                'The demo page is removed. Your dashboard is back to how it was before the tour.'
            );
            step.getTarget = () => document.getElementById('pages-list');
            step.selector = null;
        } else {
            step.body = this.t(
                'configPagesTourCleanupKeptBody',
                'The demo page is still listed. Click Remove on its row and confirm, or restart the tour from General → System tools.'
            );
            step.getTarget = () => this.findDemoRemoveButton() || this.findDemoPageElement();
            step.selector = null;
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

    async scrollToStepTarget(element, { block = 'center' } = {}) {
        if (!element || typeof element.scrollIntoView !== 'function') return;

        this.unlockScroll();

        if (!this.isElementInViewBand(element)) {
            const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
            const isFixedLike = style && (style.position === 'fixed' || style.position === 'sticky');

            element.scrollIntoView({
                behavior: 'auto',
                block: isFixedLike ? 'nearest' : block,
                inline: 'nearest',
            });

            const scrollRoot = document.scrollingElement || document.documentElement;
            if (scrollRoot && !isFixedLike) {
                const rect = element.getBoundingClientRect();
                const { viewTop, viewBottom } = this.getScrollMetrics();
                if (rect.top < viewTop) {
                    scrollRoot.scrollTop += Math.round(rect.top - viewTop);
                } else if (rect.bottom > viewBottom) {
                    scrollRoot.scrollTop += Math.round(rect.bottom - viewBottom);
                }
            }

            await this.waitMs(32);
        }

        this.lockScroll();
    }

    buildSteps() {
        return [
            {
                title: this.t('configPagesTourWelcomeTitle', 'Welcome to Pages'),
                body: this.t(
                    'configPagesTourWelcomeBody',
                    'Pages are separate bookmark workspaces on your dashboard. Each page has its own categories and bookmarks — add pages here, reorder them, and remove ones you no longer need.'
                ),
                selector: '[data-tab-content="pages"] .simple-tab',
                scrollBlock: 'start',
            },
            {
                title: this.t('configPagesTourListTitle', 'Your pages'),
                body: this.t(
                    'configPagesTourListBody',
                    'Every row is one dashboard page. Drag the ⠿ handle to change tab order on the dashboard. The main page cannot be removed.'
                ),
                selector: '#pages-list',
                scrollBlock: 'center',
            },
            {
                title: this.t('configPagesTourAddTitle', 'Add a page'),
                body: this.t(
                    'configPagesTourAddBody',
                    'Click + Add page for a new workspace. Next we can add a temporary demo page — only if you agree.'
                ),
                selector: '#add-page-btn',
                scrollBlock: 'center',
            },
            {
                id: 'demo-add',
                title: this.t('configPagesTourDemoTitle', 'Demo: new page'),
                body: this.t(
                    'configPagesTourDemoIntroBody',
                    'A short demo shows how a new page appears on the dashboard. We can create one now.'
                ),
                selector: '#pages-list',
                scrollBlock: 'center',
                onBeforeShow: (step) => this.handleDemoAddStep(step),
            },
            {
                title: this.t('configPagesTourNameTitle', 'Page name'),
                body: this.t(
                    'configPagesTourNameBody',
                    'Edit the name in the row. It is shown on dashboard page tabs and in Page menus across Config.'
                ),
                getTarget: () => this.findDemoPageElement() || document.getElementById('pages-list'),
                scrollBlock: 'center',
            },
            {
                id: 'dashboard-visible',
                title: this.t('configPagesTourDashboardTitle', 'On the dashboard'),
                body: this.t(
                    'configPagesTourDashboardIntroBody',
                    'New pages show up on the dashboard as tabs and in the Page menu when editing bookmarks. We switch to Bookmarks to point at the same list.'
                ),
                getTarget: () => this.findPageSelectorTarget(),
                scrollBlock: 'center',
                onBeforeShow: (step) => this.handleDashboardStep(step),
            },
            {
                title: this.t('configPagesTourRemoveTitle', 'Remove a page'),
                body: this.t(
                    'configPagesTourRemoveBody',
                    'Click Remove (red) on a row to delete that page and all its bookmarks. You confirm in a dialog first. The main page cannot be removed.'
                ),
                getTarget: () => this.findDemoRemoveButton() || document.getElementById('pages-list'),
                scrollBlock: 'center',
                onBeforeShow: () => this.handleReturnToPagesStep(),
            },
            {
                id: 'demo-cleanup',
                title: this.t('configPagesTourCleanupTitle', 'Clean up the demo'),
                body: this.t(
                    'configPagesTourCleanupIntroBody',
                    'To leave your library unchanged, we remove the temporary demo page now. Confirm in the next dialog — same flow as Remove on a normal row.'
                ),
                selector: '#pages-list',
                scrollBlock: 'center',
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
            ConfigPagesTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._demoPageId = null;
            this._demoAddHandled = false;
            this._demoCleanupHandled = false;
        }

        this.ensurePagesTabActive();
        await this.waitForPagesTabActive(force ? 50 : 30);
        window.configManager?.renderPagesTab?.();
        await this.waitMs(force ? 120 : 80);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-pages-tab';
            return false;
        }
        if (!document.getElementById('pages-list')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-pages-tour-active', 'true');
        document.body.classList.remove('config-pages-tour-ready');
        if (window.configManager) {
            window.configManager._configPagesTourActive = true;
        }
        try {
            await this.showStep(0);
            document.body.classList.add('config-pages-tour-ready');
        } catch (error) {
            console.error('Config Pages tour failed to start', error);
            ConfigPagesTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    removeTourCardOnly() {
        document.querySelectorAll('.config-pages-tour-card').forEach((el) => el.remove());
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    render() {
        this.removeTourCardOnly();

        const card = document.createElement('div');
        card.className = 'config-pages-tour-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'config-pages-tour-title');
        card.setAttribute('aria-describedby', 'config-pages-tour-body');
        card.innerHTML = `
            <div class="config-general-tour-progress" aria-live="polite"></div>
            <h3 id="config-pages-tour-title" class="config-general-tour-title"></h3>
            <p id="config-pages-tour-body" class="config-general-tour-body"></p>
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
        card.querySelector('.config-general-tour-skip').addEventListener('click', () => {
            window.ConfigTourRuntime?.skipConfigTour?.(this);
        });
        card.querySelector('.config-general-tour-next').addEventListener('click', () => this.nextStep());

        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.dismissWithoutComplete();
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    dismissWithoutComplete() {
        void this.ensureDemoRemoved().finally(() => this.close());
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
        progress.textContent = this.t('configPagesTourProgress', 'Step {step} of {total}')
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
            this.highlightedElement.classList.remove('config-pages-tour-highlight');
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

        const element = this.revealTarget(step);
        await this.waitMs(80);
        if (runId !== this._stepRunId) return;

        if (element) {
            await this.scrollToStepTarget(element, { block: step.scrollBlock || 'center' });
            if (runId !== this._stepRunId) return;
            element.classList.add('config-pages-tour-highlight');
            this.highlightedElement = element;
        } else {
            this.lockScroll();
        }

        if (runId !== this._stepRunId) return;
        this.updateStepContent(step, this.currentStep);
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

    finish({ skipped = false } = {}) {
        if (!skipped && !this._tourShown) {
            void this.ensureDemoRemoved().finally(() => this.close());
            return;
        }
        void this.markCompleted().then(() => this.ensureDemoRemoved()).finally(() => this.close());
    }

    close() {
        this._stepRunId += 1;
        this._tourShown = false;
        this.clearHighlight();
        this.unlockScroll();

        if (window.configManager) {
            window.configManager._configPagesTourActive = false;
        }
        document.body.removeAttribute('data-config-pages-tour-active');
        document.body.classList.remove('config-pages-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        if (!this.isPagesTabActive()) {
            this.ensurePagesTabActive();
        }
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigPagesTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigPagesTour = ConfigPagesTour;
}
