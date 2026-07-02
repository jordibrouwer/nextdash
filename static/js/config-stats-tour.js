/**
 * One-time guided tour on Config → Stats (read-only library insights).
 * Same UX as other config tours: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigStatsTour {
    static STORAGE_KEY = 'nextdash:config-stats-tour-v1';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigStatsTour.STORAGE_KEY;
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
        if (typeof window.ConfigStatsTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="stats"]')) return 'no-stats-tab';
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
        if (!document.querySelector('[data-tab-content="stats"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-stats-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-stats-tour-active');
        document.body.classList.remove('config-stats-tour-ready');
        document.documentElement.classList.remove('config-stats-tour-scroll-lock');
        document.body.classList.remove('config-stats-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-stats-tour-highlight')
            .forEach((el) => el.classList.remove('config-stats-tour-highlight'));
        if (window.configManager) {
            window.configManager._configStatsTourActive = false;
        }
    }

    ensureStatsTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('stats');
        } else {
            const panel = document.querySelector('[data-tab-content="stats"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="stats"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'stats') {
            window.history.replaceState(null, '', '#stats');
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

    async waitForStatsTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureStatsTabActive();
            const panel = document.querySelector('[data-tab-content="stats"]');
            const layout = document.querySelector('.stats-layout');
            if (panel && layout && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="stats"]') &&
            document.querySelector('.stats-layout')
        );
    }

    ensureStatsDataReady() {
        const mgr = window.configManager;
        if (mgr?.stats?.refresh) {
            try {
                mgr.stats.refresh(mgr);
            } catch (error) {
                console.warn('Stats tour: could not refresh stats', error);
            }
        }
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-stats-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-stats-tour-scroll-lock');
        document.body.classList.add('config-stats-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-stats-tour-scroll-lock');
        document.body.classList.remove('config-stats-tour-scroll-lock');
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
                title: this.t('configStatsTourWelcomeTitle', 'Welcome to Stats'),
                body: this.t(
                    'configStatsTourWelcomeBody',
                    'Below the intro line, this is your stats dashboard: quick links on the left and insight sections on the right. Everything here is read-only — after you save bookmarks or settings elsewhere, reopen this tab to refresh the numbers.'
                ),
                selector: '.stats-layout',
                scrollBlock: 'start',
            },
            {
                title: this.t('configStatsTourIndexTitle', 'Jump between sections'),
                body: this.t(
                    'configStatsTourIndexBody',
                    'Use the quick links on the left to scroll to any block. On wide screens the index stays visible while you read the charts and tables on the right.'
                ),
                selector: '.stats-index',
                scrollBlock: 'start',
            },
            {
                title: this.t('configStatsTourOverviewTitle', 'Library overview'),
                body: this.t(
                    'configStatsTourOverviewBody',
                    'Counts for pages, categories, bookmarks, URLs, and shortcuts — plus average opens per bookmark. Click ℹ for a short explanation of each metric.'
                ),
                selector: '#stats-overview',
                scrollBlock: 'start',
            },
            {
                title: this.t('configStatsTourScoreTitle', 'Cleanup score'),
                body: this.t(
                    'configStatsTourScoreBody',
                    'A 0–100 health score with a colour bar. The list below explains penalties: never-opened bookmarks, stale items, duplicate URLs, shortcut conflicts, and more.'
                ),
                selector: '#stats-score',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourActivityTitle', 'Activity over time'),
                body: this.t(
                    'configStatsTourActivityBody',
                    'See opens in the selected period, how many bookmarks were active, and a sparkline of last-opened activity. Switch week, month, 3 months, 6 months, or all time.'
                ),
                selector: '#stats-activity',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourTopTitle', 'Top bookmarks'),
                body: this.t(
                    'configStatsTourTopBody',
                    'Tables for most opened and most recently opened bookmarks, with page names and timestamps. Change the period filter to focus on recent usage or all-time leaders.'
                ),
                selector: '#stats-top',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourPagesTitle', 'Pages & categories'),
                body: this.t(
                    'configStatsTourPagesBody',
                    'Compare bookmark counts and opens per page, then per category within pages. Use period buttons to limit stats to recent activity or view all time.'
                ),
                selector: '#stats-pages',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourTagsTitle', 'Tag usage'),
                body: this.t(
                    'configStatsTourTagsBody',
                    'See tag coverage, unique tags, and which tags appear on the most bookmarks. Tables rank tags and the most opened tagged bookmarks.'
                ),
                selector: '#stats-tags',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourShortcutsTitle', 'Shortcuts usage'),
                body: this.t(
                    'configStatsTourShortcutsBody',
                    'See how many bookmarks have keyboard shortcuts and which shortcuts get the most opens — useful when tuning your search workflow.'
                ),
                selector: '#stats-shortcuts',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourRotTitle', 'Rot & cleanup'),
                body: this.t(
                    'configStatsTourRotBody',
                    'Find bookmarks you never opened, items stale in the chosen period, and recently added links. Tables list candidates to review or remove.'
                ),
                selector: '#stats-rot',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourConflictsTitle', 'Conflicts & duplicates'),
                body: this.t(
                    'configStatsTourConflictsBody',
                    'Duplicate URLs and shortcut conflicts are counted here with detail rows. Open Health for deeper triage and one-click fixes on the dashboard.'
                ),
                selector: '#stats-conflicts',
                scrollBlock: 'center',
            },
            {
                title: this.t('configStatsTourSearchTitle', 'Search & status settings'),
                body: this.t(
                    'configStatsTourSearchBody',
                    'Shows whether the search index is built and how status monitoring is configured. Reopen this tab after changing settings or bookmarks to see updated numbers.'
                ),
                selector: '#stats-search',
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
            ConfigStatsTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
        }

        this.ensureStatsTabActive();
        await this.waitForStatsTabActive(force ? 50 : 30);
        this.ensureStatsDataReady();
        await this.waitMs(force ? 120 : 80);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-stats-tab';
            return false;
        }
        if (!document.querySelector('.stats-layout')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-stats-tour-active', 'true');
        document.body.classList.remove('config-stats-tour-ready');
        try {
            await this.showStep(0);
            document.body.classList.add('config-stats-tour-ready');
        } catch (error) {
            console.error('Config Stats tour failed to start', error);
            ConfigStatsTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    render() {
        ConfigStatsTour.teardownStaleDom();
        this.card = null;

        const card = document.createElement('div');
        card.className = 'config-stats-tour-card';
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
        card.querySelector('.config-general-tour-skip').addEventListener('click', () => {
            window.ConfigTourRuntime?.skipConfigTour?.(this);
        });
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
        progress.textContent = this.t('configStatsTourProgress', 'Step {step} of {total}')
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
            this.highlightedElement.classList.remove('config-stats-tour-highlight');
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
            element.classList.add('config-stats-tour-highlight');
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
            window.configManager._configStatsTourActive = false;
        }
        document.body.removeAttribute('data-config-stats-tour-active');
        document.body.classList.remove('config-stats-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigStatsTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigStatsTour = ConfigStatsTour;
}
