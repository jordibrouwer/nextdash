/**
 * One-time guided tour on Config → Categories (add demo category, reorder, remove).
 * Same UX as other config tours: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigCategoriesTour {
    static STORAGE_KEY = 'nextdash:config-categories-tour-v1';
    static DEMO_FLAG = '_configCategoriesTourDemo';
    static DEMO_NAME = 'news';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigCategoriesTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._demoCategoryId = null;
        this._demoAddHandled = false;
        this._demoMoveHandled = false;
        this._demoCleanupHandled = false;
        this._demoCleanupInProgress = false;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigCategoriesTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="categories"]')) return 'no-categories-tab';
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
        if (!document.querySelector('[data-tab-content="categories"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-categories-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-categories-tour-active');
        document.body.classList.remove('config-categories-tour-ready');
        document.documentElement.classList.remove('config-categories-tour-scroll-lock');
        document.body.classList.remove('config-categories-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-categories-tour-highlight')
            .forEach((el) => el.classList.remove('config-categories-tour-highlight'));
        if (window.configManager) {
            window.configManager._configCategoriesTourActive = false;
        }
    }

    ensureCategoriesTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('categories');
        } else {
            const panel = document.querySelector('[data-tab-content="categories"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="categories"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'categories') {
            window.history.replaceState(null, '', '#categories');
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

    async waitForCategoriesTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureCategoriesTabActive();
            const panel = document.querySelector('[data-tab-content="categories"]');
            const list = document.getElementById('categories-list');
            if (panel && list && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="categories"]') &&
            document.getElementById('categories-list')
        );
    }

    async ensureCategoriesListReady() {
        const mgr = window.configManager;
        if (!mgr) return;
        const pageId = mgr.currentCategoriesPageId || mgr.currentPageId || 1;
        if (typeof mgr.loadPageCategories === 'function') {
            try {
                await mgr.loadPageCategories(pageId);
            } catch (error) {
                console.warn('Categories tour: could not load categories', error);
            }
        }
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-categories-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-categories-tour-scroll-lock');
        document.body.classList.add('config-categories-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-categories-tour-scroll-lock');
        document.body.classList.remove('config-categories-tour-scroll-lock');
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

    findDemoCategory() {
        const mgr = window.configManager;
        if (!mgr?.categoriesData) return null;
        return (
            mgr.categoriesData.find((c) => c[ConfigCategoriesTour.DEMO_FLAG]) ||
            (this._demoCategoryId
                ? mgr.categoriesData.find((c) => c.id === this._demoCategoryId)
                : null)
        );
    }

    findDemoCategoryElement() {
        const demo = this.findDemoCategory();
        if (!demo) return null;
        const items = document.querySelectorAll('#categories-list .category-item');
        for (const el of items) {
            if (el.getAttribute('data-category-id') === demo.id) {
                return el;
            }
        }
        return items.length ? items[items.length - 1] : null;
    }

    findDemoRemoveButton() {
        const row = this.findDemoCategoryElement();
        return row?.querySelector('.btn-danger') || null;
    }

    findDemoDragHandle() {
        const row = this.findDemoCategoryElement();
        return row?.querySelector('.js-drag-handle') || null;
    }

    syncCategoriesListUi() {
        const mgr = window.configManager;
        if (!mgr?.categories) return;
        mgr.categories.render(mgr.categoriesData, mgr.generateId.bind(mgr));
        mgr.categories.initReorder(mgr.categoriesData, (newCategories) => {
            mgr.categoriesData = newCategories;
        });
    }

    async persistCategoriesChanges(eventType) {
        const mgr = window.configManager;
        if (!mgr?.persistCategoriesStructureAndRefresh) return;
        try {
            await mgr.persistCategoriesStructureAndRefresh({ eventType });
        } catch (error) {
            console.warn('Categories tour: persist failed', error);
        }
    }

    async addTourDemoCategory() {
        const mgr = window.configManager;
        if (!mgr) return false;

        const existing = this.findDemoCategory();
        if (existing) {
            this._demoCategoryId = existing.id;
            return true;
        }

        if (!Array.isArray(mgr.categoriesData)) {
            mgr.categoriesData = [];
        }

        const newCategory = {
            id: mgr.generateId('news'),
            name: ConfigCategoriesTour.DEMO_NAME,
            icon: '',
            [ConfigCategoriesTour.DEMO_FLAG]: true,
        };
        mgr.categoriesData.push(newCategory);
        this._demoCategoryId = newCategory.id;
        this.syncCategoriesListUi();
        mgr.markDirty?.();
        await this.persistCategoriesChanges('category-added');
        return true;
    }

    async moveTourDemoCategoryToFront() {
        const mgr = window.configManager;
        if (!mgr?.categoriesData || !this._demoCategoryId) return false;

        const idx = mgr.categoriesData.findIndex((c) => c.id === this._demoCategoryId);
        if (idx <= 0) return idx === 0;

        const [category] = mgr.categoriesData.splice(idx, 1);
        mgr.categoriesData.unshift(category);
        this.syncCategoriesListUi();
        mgr.markDirty?.();
        await this.persistCategoriesChanges('category-reordered');
        return true;
    }

    async removeTourDemoCategory({ silent = false } = {}) {
        if (this._demoCleanupInProgress) return false;
        const mgr = window.configManager;
        if (!mgr?.categoriesData) return true;

        const idx = mgr.categoriesData.findIndex(
            (c) => c[ConfigCategoriesTour.DEMO_FLAG] || c.id === this._demoCategoryId
        );
        if (idx === -1) {
            this._demoCategoryId = null;
            return true;
        }

        if (!silent) {
            const removed = await mgr.categories.remove(mgr.categoriesData, idx, {
                message: this.t(
                    'configCategoriesTourRemoveConfirmMessage',
                    'Remove the demo category “news” from this page? Bookmarks in it become uncategorized.'
                ),
            });
            if (!removed) return false;
        } else {
            const category = mgr.categoriesData[idx];
            if (
                Number(mgr.currentPageId) === Number(mgr.currentCategoriesPageId) &&
                category
            ) {
                mgr.bookmarksData.forEach((bookmark) => {
                    if (bookmark.category === category.id) {
                        bookmark.category = '';
                    }
                });
            }
            mgr.categoriesData.splice(idx, 1);
        }

        this._demoCategoryId = null;
        this.syncCategoriesListUi();
        mgr.markDirty?.();
        await mgr.persistCategoriesStructureAndRefresh({
            persistBookmarks: true,
            eventType: 'category-removed',
        });
        mgr.renderStructureWorkspace?.();
        return true;
    }

    async cleanupTourDemoCategory({ prompt = false } = {}) {
        if (!this.findDemoCategory()) return true;
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
                                'configCategoriesTourCleanupConfirmTitle',
                                'Remove the demo category?'
                            ),
                            message: this.t(
                                'configCategoriesTourCleanupConfirmMessage',
                                'We added “news” only for this tour. Remove it now so your categories stay unchanged.'
                            ),
                            confirmText: this.t('configCategoriesTourCleanupConfirmYes', 'Remove news'),
                            cancelText: this.t('config.cancel', 'Cancel'),
                        });
                    } else {
                        confirmed = window.confirm(
                            this.t(
                                'configCategoriesTourCleanupConfirmMessage',
                                'Remove the demo category “news”?'
                            )
                        );
                    }
                } catch {
                    confirmed = false;
                }
                if (!confirmed) return false;
            }
            return await this.removeTourDemoCategory({ silent: true });
        } finally {
            this._demoCleanupInProgress = false;
        }
    }

    async ensureDemoRemoved() {
        if (!this.findDemoCategory()) return true;
        return this.removeTourDemoCategory({ silent: true });
    }

    async promptAddTourDemoCategory() {
        this.unlockScroll();

        const title = this.t('configCategoriesTourDemoConsentTitle', 'Add a demo category “news”?');
        const message = this.t(
            'configCategoriesTourDemoConsentMessage',
            'For this tour we can add a temporary category named “news” on the current page. You will reorder it and remove it before the tour ends — nothing stays on your dashboard.'
        );

        let confirmed = false;
        try {
            if (window.AppModal?.confirm) {
                confirmed = await window.AppModal.confirm({
                    title,
                    message,
                    confirmText: this.t('configCategoriesTourDemoConsentYes', 'Add news'),
                    cancelText: this.t('configCategoriesTourDemoConsentNo', 'Skip demo'),
                });
            } else {
                confirmed = window.confirm(`${title}\n\n${message}`);
            }
        } catch {
            confirmed = false;
        }

        if (!confirmed) return false;
        return this.addTourDemoCategory();
    }

    async handleDemoAddStep(step) {
        if (this._demoAddHandled) return;
        this._demoAddHandled = true;

        const added = await this.promptAddTourDemoCategory();
        if (added) {
            step.body = this.t(
                'configCategoriesTourDemoAddedBody',
                'Here is your “news” category. Change the name or emoticon anytime. Column order here matches the category tabs on the dashboard.'
            );
            step.getTarget = () => this.findDemoCategoryElement();
            step.selector = null;
        } else {
            step.body = this.t(
                'configCategoriesTourDemoSkippedBody',
                'No demo category was added. Use + Add category when you are ready — you can still follow the rest of the tour.'
            );
            step.selector = '#add-category-btn';
            step.getTarget = null;
        }
    }

    async handleDemoMoveStep(step) {
        if (this._demoMoveHandled) return;
        this._demoMoveHandled = true;

        if (this.findDemoCategory()) {
            await this.moveTourDemoCategoryToFront();
            step.body = this.t(
                'configCategoriesTourReorderDoneBody',
                'We moved “news” to the first position — check your dashboard: the category tab order follows this list. Drag the ⠿ handle anytime to change order yourself.'
            );
            step.getTarget = () => this.findDemoDragHandle() || this.findDemoCategoryElement();
            step.selector = null;
        }
    }

    async handleCleanupStep(step) {
        if (this._demoCleanupHandled) return;
        this._demoCleanupHandled = true;

        if (!this.findDemoCategory()) {
            step.body = this.t(
                'configCategoriesTourCleanupNoneBody',
                'There is no demo category left on this page. Use Remove on any row when you want to delete a category — you confirm in a dialog first.'
            );
            return;
        }

        const removed = await this.cleanupTourDemoCategory({ prompt: true });
        if (removed) {
            step.body = this.t(
                'configCategoriesTourCleanupDoneBody',
                'The demo category “news” is removed. Your dashboard is back to how it was before the tour.'
            );
            step.getTarget = () => document.getElementById('categories-list');
            step.selector = null;
        } else {
            step.body = this.t(
                'configCategoriesTourCleanupKeptBody',
                'The demo category is still listed. Click Remove on the “news” row and confirm, or restart the tour from General → System tools.'
            );
            step.getTarget = () => this.findDemoRemoveButton() || this.findDemoCategoryElement();
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
                title: this.t('configCategoriesTourWelcomeTitle', 'Welcome to Categories'),
                body: this.t(
                    'configCategoriesTourWelcomeBody',
                    'Categories are the columns on your dashboard. Each page has its own list — pick a page, add or rename categories, drag to reorder, and remove ones you no longer need.'
                ),
                selector: '[data-tab-content="categories"] .simple-tab',
                scrollBlock: 'start',
            },
            {
                title: this.t('configCategoriesTourPageTitle', 'Choose a page'),
                body: this.t(
                    'configCategoriesTourPageBody',
                    'Use the Page menu to edit categories for that dashboard page. Switch pages here without leaving the Categories tab.'
                ),
                selector: '#categories-page-selector',
                scrollBlock: 'center',
            },
            {
                title: this.t('configCategoriesTourAddTitle', 'Add a category'),
                body: this.t(
                    'configCategoriesTourAddBody',
                    'Click + Add category for a new row. Next we can add a temporary “news” category for practice — only if you agree.'
                ),
                selector: '#add-category-btn',
                scrollBlock: 'center',
            },
            {
                id: 'demo-add',
                title: this.t('configCategoriesTourDemoTitle', 'Demo: category “news”'),
                body: this.t(
                    'configCategoriesTourDemoIntroBody',
                    'A short demo helps you see how categories appear on the dashboard. We can create “news” on this page now.'
                ),
                selector: '#categories-list',
                scrollBlock: 'center',
                onBeforeShow: (step) => this.handleDemoAddStep(step),
            },
            {
                title: this.t('configCategoriesTourFieldsTitle', 'Name & icon'),
                body: this.t(
                    'configCategoriesTourFieldsBody',
                    'Edit the display name and optional two-character emoticon. The category id stays stable when you rename — bookmarks keep their link.'
                ),
                getTarget: () => this.findDemoCategoryElement() || document.getElementById('categories-list'),
                scrollBlock: 'center',
            },
            {
                id: 'demo-move',
                title: this.t('configCategoriesTourReorderTitle', 'Reorder on the dashboard'),
                body: this.t(
                    'configCategoriesTourReorderIntroBody',
                    'Drag the ⠿ handle to change order. Next we move “news” to the first slot so you can see the tab shift on the dashboard.'
                ),
                getTarget: () => this.findDemoDragHandle() || this.findDemoCategoryElement(),
                scrollBlock: 'center',
                onBeforeShow: (step) => this.handleDemoMoveStep(step),
            },
            {
                title: this.t('configCategoriesTourRemoveTitle', 'Remove a category'),
                body: this.t(
                    'configCategoriesTourRemoveBody',
                    'Click Remove (red) on a row to delete that category. You confirm in a dialog; bookmarks can be moved, uncategorized, or deleted depending on your choice.'
                ),
                getTarget: () => this.findDemoRemoveButton() || document.getElementById('categories-list'),
                scrollBlock: 'center',
            },
            {
                id: 'demo-cleanup',
                title: this.t('configCategoriesTourCleanupTitle', 'Clean up the demo'),
                body: this.t(
                    'configCategoriesTourCleanupIntroBody',
                    'To leave your library unchanged, we remove the temporary “news” category now. Confirm in the next dialog — same flow as Remove on a normal row.'
                ),
                selector: '#categories-list',
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
            ConfigCategoriesTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._demoCategoryId = null;
            this._demoAddHandled = false;
            this._demoMoveHandled = false;
            this._demoCleanupHandled = false;
        }

        this.ensureCategoriesTabActive();
        await this.waitForCategoriesTabActive(force ? 50 : 30);
        await this.ensureCategoriesListReady();
        await this.waitMs(force ? 120 : 80);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-categories-tab';
            return false;
        }
        if (!document.getElementById('categories-list')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-categories-tour-active', 'true');
        document.body.classList.remove('config-categories-tour-ready');
        try {
            await this.showStep(0);
            document.body.classList.add('config-categories-tour-ready');
        } catch (error) {
            console.error('Config Categories tour failed to start', error);
            ConfigCategoriesTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    render() {
        ConfigCategoriesTour.teardownStaleDom();
        this.card = null;

        const card = document.createElement('div');
        card.className = 'config-categories-tour-card';
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
        progress.textContent = this.t('configCategoriesTourProgress', 'Step {step} of {total}')
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
            this.highlightedElement.classList.remove('config-categories-tour-highlight');
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
            element.classList.add('config-categories-tour-highlight');
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

    finish() {
        if (!this._tourShown) {
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
            window.configManager._configCategoriesTourActive = false;
        }
        document.body.removeAttribute('data-config-categories-tour-active');
        document.body.classList.remove('config-categories-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigCategoriesTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigCategoriesTour = ConfigCategoriesTour;
}
