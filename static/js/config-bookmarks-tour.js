/**
 * One-time guided tour on Config → Bookmarks (editor, add, maintain collection).
 * Same UX as General tour: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigBookmarksTour {
    static STORAGE_KEY = 'nextdash:config-bookmarks-tour-v1';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigBookmarksTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigBookmarksTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="bookmarks"]')) return 'no-bookmarks-tab';
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
        if (!document.querySelector('[data-tab-content="bookmarks"]')) return false;
        return true;
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
        if (window.configManager) {
            window.configManager._configBookmarksTourActive = false;
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

    revealTarget(step) {
        const selector = step?.selector;
        if (!selector) return null;
        const element = document.querySelector(selector);
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
                title: this.t('configBookmarksTourWelcomeTitle', 'Welcome to the Bookmarks editor'),
                body: this.t(
                    'configBookmarksTourWelcomeBody',
                    'This tab is your bookmark control center: structure pages and categories at the top, then a list on the left and an editor on the right. Changes apply to the dashboard after you click Save.'
                ),
                selector: '.bookmarks-splitview',
                scrollBlock: 'start',
            },
            {
                title: this.t('configBookmarksTourStructureTitle', 'Pages, categories & structure'),
                body: this.t(
                    'configBookmarksTourStructureBody',
                    'Use the structure columns to add or reorder pages and categories, or jump straight to a bookmark. Archived pages are listed separately at the end.'
                ),
                selector: '.structure-workspace',
                scrollBlock: 'start',
            },
            {
                title: this.t('configBookmarksTourPageFilterTitle', 'Page, category & sort'),
                body: this.t(
                    'configBookmarksTourPageFilterBody',
                    'Choose which dashboard page you edit. Filter by category or change the sort order to find bookmarks quickly in a large collection.'
                ),
                selector: '.bookmarks-list-controls-row',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourAddTitle', 'Add bookmarks'),
                body: this.t(
                    'configBookmarksTourAddBody',
                    'Quick add (⚡) opens a minimal form for a fast URL. + Add creates a blank bookmark in the list and opens the full editor on the right.'
                ),
                selector: '#config-quick-add-btn',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourSearchTitle', 'Search the list'),
                body: this.t(
                    'configBookmarksTourSearchBody',
                    'Type here to filter the bookmark list by name or URL. Clear the field to show everything again.'
                ),
                selector: '.bookmarks-list-search-row',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourListTitle', 'Bookmark list'),
                body: this.t(
                    'configBookmarksTourListBody',
                    'Click a row to edit it on the right. Drag the ⠿ handle to reorder within the page. Use checkboxes to select multiple bookmarks for bulk actions.'
                ),
                selector: '.bookmarks-list-scroll-area',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourEditorTitle', 'Detail editor'),
                body: this.t(
                    'configBookmarksTourEditorBody',
                    'Edit name, URL, shortcut, category, tags, pin, and status. Fetch favicon and link previews, move or delete the bookmark, and see how it will look on the dashboard.'
                ),
                selector: '#bookmark-detail-panel',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourBulkTitle', 'Maintain many at once'),
                body: this.t(
                    'configBookmarksTourBulkBody',
                    'When one or more bookmarks are selected, use the bulk toolbar to move them to another category or page, toggle pin or status, refresh favicons, or delete in one go.'
                ),
                selector: '#bookmarks-bulk-toolbar',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourFaviconTitle', 'Favicon policy'),
                body: this.t(
                    'configBookmarksTourFaviconBody',
                    'Choose when bookmark icons are refreshed: automatically when you save a URL, or only when you request it manually from the editor or bulk toolbar.'
                ),
                selector: '#favicon-refresh-policy-select',
                scrollBlock: 'center',
            },
            {
                title: this.t('configBookmarksTourSaveTitle', 'Save your changes'),
                body: this.t(
                    'configBookmarksTourSaveBody',
                    'Bookmark edits are not written to disk until you click Save. Unsaved changes are highlighted; Discard restores the last saved state.'
                ),
                selector: '#save-btn',
                scrollBlock: 'center',
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
            ConfigBookmarksTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
        }

        this.ensureBookmarksTabActive();
        await this.waitForBookmarksTabActive(force ? 50 : 30);
        await this.ensureBookmarksDataReady();
        await this.waitForBookmarksReady(force ? 45 : 30);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-bookmarks-tab';
            return false;
        }
        if (!document.querySelector('.bookmarks-splitview')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-bookmarks-tour-active', 'true');
        document.body.classList.remove('config-bookmarks-tour-ready');
        try {
            await this.showStep(0);
            document.body.classList.add('config-bookmarks-tour-ready');
        } catch (error) {
            console.error('Config Bookmarks tour failed to start', error);
            ConfigBookmarksTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    render() {
        ConfigBookmarksTour.teardownStaleDom();
        this.card = null;

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
        progress.textContent = this.t('configBookmarksTourProgress', 'Step {step} of {total}')
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

        const element = this.revealTarget(step);
        await this.waitMs(80);
        if (runId !== this._stepRunId) return;

        if (element) {
            await this.scrollToStepTarget(element, { block: step.scrollBlock || 'center' });
            if (runId !== this._stepRunId) return;
            element.classList.add('config-bookmarks-tour-highlight');
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
            this.close();
            return;
        }
        void this.markCompleted().finally(() => this.close());
    }

    close() {
        this._stepRunId += 1;
        this._tourShown = false;
        this.clearHighlight();
        this.unlockScroll();

        if (window.configManager) {
            window.configManager._configBookmarksTourActive = false;
        }
        document.body.removeAttribute('data-config-bookmarks-tour-active');
        document.body.classList.remove('config-bookmarks-tour-ready');
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
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigBookmarksTour = ConfigBookmarksTour;
}
