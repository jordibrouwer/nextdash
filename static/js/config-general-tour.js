/**
 * One-time guided tour on Config → General (overview only, no user input).
 * Highlight uses CSS box-shadow cutout (stable) — no JS-positioned shade panels.
 */
class ConfigGeneralTour {
    static STORAGE_KEY = 'nextdash:config-general-tour-v1';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigGeneralTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this._layerBeforeTour = null;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigGeneralTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="general"]')) return 'no-general-tab';
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
        if (!document.querySelector('[data-tab-content="general"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-general-tour-card').forEach((el) => el.remove());
        document.getElementById('config-tour-backdrop')?.remove();
        document.body.removeAttribute('data-config-general-tour-active');
        document.body.classList.remove('config-general-tour-ready');
        document.documentElement.classList.remove('config-general-tour-scroll-lock');
        document.body.classList.remove('config-general-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-general-tour-highlight')
            .forEach((el) => el.classList.remove('config-general-tour-highlight'));
        if (window.configManager) {
            window.configManager._configGeneralTourActive = false;
            window.configManager._configGeneralTourStarting = false;
        }
        window.GuidedFlowGuard?.sync?.();
        window.ConfigSettingsSearch?.schedulePromoWhenIdle?.();
    }

    /** Clear a stuck tour (locked page, no visible card) after reload or failed start. */
    static recoverStaleDom() {
        const active = document.body.hasAttribute('data-config-general-tour-active');
        const card = document.querySelector('.config-general-tour-card');
        const scrollLocked = document.body.classList.contains('config-general-tour-scroll-lock');
        if (!active && !card && !scrollLocked) return false;

        let cardUsable = false;
        if (card) {
            const rect = card.getBoundingClientRect();
            const vis = window.getComputedStyle(card).visibility;
            cardUsable = rect.height > 8 && rect.width > 8 && vis !== 'hidden' && vis !== 'collapse';
        }

        if ((active || scrollLocked) && !cardUsable) {
            ConfigGeneralTour.teardownStaleDom();
            return true;
        }
        return false;
    }

    ensureGeneralTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('general');
        } else {
            const generalPanel = document.querySelector('[data-tab-content="general"]');
            if (generalPanel && !generalPanel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="general"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash.startsWith('general')) {
            window.history.replaceState(null, '', '#general');
            window.configManager?.generalLayers?.applyHash?.('#general');
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

    ensureGeneralLayersReady() {
        const gl = window.configManager?.generalLayers;
        if (!gl) return;
        if (gl.root?.dataset?.layersReady === '1') return;
        try {
            gl.init();
        } catch (error) {
            console.warn('ConfigGeneralLayers setup before tour', error);
        }
    }

    async waitForGeneralTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureGeneralTabActive();
            const panel = document.querySelector('[data-tab-content="general"]');
            const layout = document.querySelector('.general-layout');
            if (panel && layout && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="general"]') &&
            document.querySelector('.general-layout')
        );
    }

    waitForGeneralReady(maxAttempts = 30) {
        return new Promise((resolve) => {
            const tick = (left) => {
                const layersReady = window.configManager?.generalLayers?.root?.dataset?.layersReady === '1';
                const hasToolbar = Boolean(document.querySelector('#general-layer-toolbar'));
                const hasLayout = Boolean(document.querySelector('.general-layout'));
                const hasBasics = Boolean(document.querySelector('[data-general-panel="basics-core"]'));
                if (hasToolbar && hasLayout && (hasBasics || layersReady || left <= 0)) {
                    resolve(true);
                    return;
                }
                if (left <= 0) {
                    resolve(hasToolbar && hasLayout);
                    return;
                }
                setTimeout(() => tick(left - 1), 80);
            };
            tick(maxAttempts);
        });
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-general-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-general-tour-scroll-lock');
        document.body.classList.add('config-general-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-general-tour-scroll-lock');
        document.body.classList.remove('config-general-tour-scroll-lock');
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
        const gl = window.configManager?.generalLayers;
        const panelId = step?.panel;
        let selector = step?.selector;

        if (gl) {
            if (step?.layer === 'advanced') {
                if (gl.layer !== 'advanced') {
                    gl.applyLayer('advanced', { updateHash: false });
                }
            } else if (gl.layer !== 'all') {
                gl.applyLayer('all', { updateHash: false });
            }
        }

        if (panelId) {
            const panel = document.querySelector(`[data-general-panel="${panelId}"]`);
            if (panel) {
                panel.hidden = false;
                panel.removeAttribute('hidden');
                panel.classList.remove('is-collapsed');
                selector = `[data-general-panel="${panelId}"]`;
            }
        }

        let element = selector ? document.querySelector(selector) : null;
        if (panelId) {
            const panel = document.querySelector(`[data-general-panel="${panelId}"]`);
            if (panel) element = panel;
        }

        if (element && gl && panelId) {
            gl.scrollToPanel(panelId, { switchLayer: false });
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

    positionCardAtViewportBottom() {
        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);
    }

    ensureTourCardInteractive() {
        if (this.card) {
            this.card.classList.remove('is-suppressed-for-dialog');
            this.card.style.setProperty('pointer-events', 'auto', 'important');
            this.card.style.setProperty('visibility', 'visible', 'important');
            this.card.setAttribute('data-config-tour-card', 'true');
            window.ConfigTourRuntime?.syncTourLayering?.(this.card);
        }
        document.body.classList.add('config-general-tour-ready');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
    }

    buildSteps() {
        const steps = [
            {
                title: this.t('configGeneralTourWelcomeTitle', 'Welcome to General settings'),
                body: this.t(
                    'configGeneralTourWelcomeBody',
                    'This page controls how your dashboard looks and behaves. Changes apply after you click Save — the dashboard updates without a full reload.'
                ),
                noHighlight: true,
                cardPlacement: 'viewport-bottom',
                layer: 'essentials',
            },
            {
                title: this.t('configGeneralTourLayersTitle', 'Essentials and Advanced'),
                body: this.t(
                    'configGeneralTourLayersBody',
                    'Everyday options live under Essentials. Power features (smart collections, status checks, branding, search behavior) are under Advanced. Choose All sections for one scrollable page — Expand all / Collapse all appear in the toolbar.'
                ),
                selector: '#general-layer-toolbar',
                layer: 'essentials',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                title: this.t('configGeneralTourAppearanceTitle', 'Appearance'),
                body: this.t(
                    'configGeneralTourAppearanceBody',
                    'Theme, font size, animations, and rotating tips. Use the ℹ buttons for details on any setting.'
                ),
                selector: '[data-general-panel="basics-core"]',
                layer: 'essentials',
                panel: 'basics-core',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourLayoutTitle', 'Layout'),
                body: this.t(
                    'configGeneralTourLayoutBody',
                    'Choose Classic or Modern styling, then pick a layout preset and density. On the dashboard, switch quickly with :LAYOUTVERSION or :LAYOUTVERSION toggle.'
                ),
                selector: '[data-general-panel="layout"]',
                layer: 'essentials',
                panel: 'layout',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourBookmarksTitle', 'Bookmarks'),
                body: this.t(
                    'configGeneralTourBookmarksBody',
                    'How bookmarks are sorted, whether icons and shortcuts show, and whether links open in a new tab. Clipboard prompts and page tabs are here too.'
                ),
                selector: '[data-general-panel="bookmarks-essentials"]',
                layer: 'essentials',
                panel: 'bookmarks-essentials',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourToolbarTitle', 'Dashboard toolbar'),
                body: this.t(
                    'configGeneralTourToolbarBody',
                    'Choose which buttons appear in the footer: search, finders, commands, recent bookmarks, health, and more.'
                ),
                selector: '[data-general-panel="search-buttons"]',
                layer: 'essentials',
                panel: 'search-buttons',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourSmartTitle', 'Smart collections'),
                body: this.t(
                    'configGeneralTourSmartBody',
                    'Turn automatic groups like Today or Most used on or off. Open Advanced → Smart for limits, keywords, and per-collection tuning.'
                ),
                selector: '[data-general-panel="smart-collections-summary"]',
                layer: 'essentials',
                panel: 'smart-collections-summary',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourAdvancedTitle', 'Advanced sections'),
                body: this.t(
                    'configGeneralTourAdvancedBody',
                    'Expand appearance fine-tuning, bookmark display, live status pings, custom title/favicon, search overlay behavior, and system tools. Date, time, and weather live under Localization in Essentials.'
                ),
                selector: '[data-general-panel="appearance-advanced"]',
                layer: 'advanced',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourTabsTitle', 'Other config tabs'),
                body: this.t(
                    'configGeneralTourTabsBody',
                    'Pages, categories, bookmarks, finders, collections, and backups are managed on their own tabs. Theme colors have a dedicated editor under theme.'
                ),
                selector: '.config-section.section-controls .tabs-scroll-wrapper',
                layer: 'essentials',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourSearchTitle', 'Find any setting'),
                body: this.t(
                    'configGeneralTourSearchBody',
                    'Use the search box to jump to a setting on any tab. Matching sections expand automatically so the control is visible.'
                ),
                selector: '#config-settings-search-input',
                layer: 'essentials',
                scrollBlock: 'center',
            },
            {
                title: this.t('configGeneralTourSaveTitle', 'Save your changes'),
                body: this.t(
                    'configGeneralTourSaveBody',
                    'Click Save when you are done. Unsaved changes are highlighted; Discard reverts to the last saved state.'
                ),
                selector: '#save-btn',
                layer: 'essentials',
                scrollBlock: 'center',
            },
        ];
        return steps.filter((step) => {
            if (step.selector === '#config-settings-search-input') {
                if (window.MobileExperience?.isMobileLayout?.()) return false;
                const input = document.getElementById('config-settings-search-input');
                if (!input || input.closest('[hidden]')) return false;
            }
            return true;
        });
    }

    async prepareAndStart({ force = false } = {}) {
        this.lastFailureReason = null;
        if (!this.canStart({ force })) {
            this.lastFailureReason = 'blocked';
            return false;
        }

        this.ensurePageReady();

        if (force) {
            ConfigGeneralTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
        }

        this.ensureGeneralTabActive();
        await this.waitForGeneralTabActive(force ? 50 : 30);
        this.ensureGeneralLayersReady();
        await this.waitForGeneralReady(force ? 45 : 30);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-general-tab';
            return false;
        }
        if (!document.querySelector('.general-layout')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        const gl = window.configManager?.generalLayers;
        if (gl) {
            this._layerBeforeTour = gl.layer;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        this.updateStepContent(this.steps[0], 0);
        this.ensureTourCardInteractive();
        if (window.configManager) {
            window.configManager._configGeneralTourActive = true;
        }
        document.body.setAttribute('data-config-general-tour-active', 'true');
        try {
            await this.showStep(0);
        } catch (error) {
            console.error('Config General tour: first step failed', error);
            ConfigGeneralTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    render() {
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        this.clearHighlight();
        this.unlockScroll();
        this.card?.remove();
        this.card = null;

        const card = document.createElement('div');
        card.className = 'config-general-tour-card';
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
        progress.textContent = this.t('configGeneralTourProgress', 'Step {step} of {total}')
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
            this.highlightedElement.classList.remove('config-general-tour-highlight');
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

        if (step.cardPlacement === 'viewport-bottom') {
            this.positionCardAtViewportBottom();
        }

        let element = null;
        if (step.noHighlight) {
            this.updateStepContent(step, this.currentStep);
            this.ensureTourCardInteractive();
            this.lockScroll();
            return;
        } else {
            element = this.revealTarget(step);
            await this.waitMs(step?.panel || step?.layer === 'advanced' ? 120 : 50);
            if (runId !== this._stepRunId) return;

            if (element) {
                await this.scrollToStepTarget(element, { block: step.scrollBlock || 'center' });
                if (runId !== this._stepRunId) return;
                element.classList.add('config-general-tour-highlight');
                this.highlightedElement = element;
            } else {
                this.lockScroll();
            }
        }

        window.ConfigTourRuntime?.applyCardPlacement?.(this, element, step);

        if (runId !== this._stepRunId) return;
        this.updateStepContent(step, this.currentStep);
        this.ensureTourCardInteractive();
        await this.waitMs(16);
        if (runId !== this._stepRunId) return;
        window.ConfigTourRuntime?.applyCardPlacement?.(this, element, step);
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

        const gl = window.configManager?.generalLayers;
        if (gl) {
            const restore =
                this._layerBeforeTour === 'essentials' ||
                this._layerBeforeTour === 'advanced' ||
                this._layerBeforeTour === 'all'
                    ? this._layerBeforeTour
                    : gl.getStoredLayer?.();
            if (restore) {
                gl.applyLayer(restore, { updateHash: false });
            }
            this._layerBeforeTour = null;
        }
        if (window.configManager) {
            window.configManager._configGeneralTourActive = false;
        }
        document.body.removeAttribute('data-config-general-tour-active');
        document.body.classList.remove('config-general-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        window.GuidedFlowGuard?.sync?.();
        window.ConfigSettingsSearch?.schedulePromoWhenIdle?.();
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigGeneralTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigGeneralTour = ConfigGeneralTour;
}
