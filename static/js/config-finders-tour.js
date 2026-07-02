/**
 * One-time guided tour on Config → Finders (what they are, fields, Google example with consent).
 * Same UX as other config tours: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigFindersTour {
    static STORAGE_KEY = 'nextdash:config-finders-tour-v1';

    static GOOGLE_URL = 'https://www.google.com/search?q=%s';
    static GOOGLE_SHORTCUT_PREFERRED = 'g';
    /** Fallback order when preferred letter is taken by another finder. */
    static GOOGLE_SHORTCUT_FALLBACKS = ['g', 'o', 'e', 's', 'a', 'b', 'c', 'd', 'f', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigFindersTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._googleConsentHandled = false;
        this._googleExampleAdded = false;
        this._googleExampleShortcut = ConfigFindersTour.GOOGLE_SHORTCUT_PREFERRED;
    }

    tf(key, fallback, vars = {}) {
        let text = this.t(key, fallback);
        Object.entries(vars).forEach(([name, value]) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        });
        return text;
    }

    getUsedFinderShortcuts() {
        const mgr = window.configManager;
        if (!mgr?.findersData) return new Set();
        const used = new Set();
        mgr.findersData.forEach((finder) => {
            const shortcut = String(finder.shortcut || '')
                .toLowerCase()
                .replace(/[^a-z]/g, '');
            if (shortcut) used.add(shortcut);
        });
        return used;
    }

    /**
     * Pick a single-letter shortcut for the Google example (prefers g).
     * @returns {string|null}
     */
    pickGoogleExampleShortcut() {
        const used = this.getUsedFinderShortcuts();
        for (const letter of ConfigFindersTour.GOOGLE_SHORTCUT_FALLBACKS) {
            if (!used.has(letter)) return letter;
        }
        return null;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigFindersTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="finders"]')) return 'no-finders-tab';
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
        if (!document.querySelector('[data-tab-content="finders"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-finders-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-finders-tour-active');
        document.body.classList.remove('config-finders-tour-ready');
        document.documentElement.classList.remove('config-finders-tour-scroll-lock');
        document.body.classList.remove('config-finders-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-finders-tour-highlight')
            .forEach((el) => el.classList.remove('config-finders-tour-highlight'));
        if (window.configManager) {
            window.configManager._configFindersTourActive = false;
        }
    }

    ensureFindersTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('finders');
        } else {
            const panel = document.querySelector('[data-tab-content="finders"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="finders"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'finders') {
            window.history.replaceState(null, '', '#finders');
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

    async waitForFindersTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureFindersTabActive();
            const panel = document.querySelector('[data-tab-content="finders"]');
            const list = document.getElementById('finders-list');
            if (panel && list && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="finders"]') &&
            document.getElementById('finders-list')
        );
    }

    ensureFindersRendered() {
        const mgr = window.configManager;
        if (!mgr?.finders?.refresh || !Array.isArray(mgr.findersData)) return;
        mgr.finders.refresh(mgr);
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-finders-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-finders-tour-scroll-lock');
        document.body.classList.add('config-finders-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-finders-tour-scroll-lock');
        document.body.classList.remove('config-finders-tour-scroll-lock');
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

    hasGoogleFinderInData() {
        const mgr = window.configManager;
        if (!mgr?.findersData) return false;
        return mgr.findersData.some((f) =>
            String(f.searchUrl || '')
                .toLowerCase()
                .includes('google.com')
        );
    }

    findGoogleFinderElement() {
        const shortcut = (this._googleExampleShortcut || '').toLowerCase();
        const items = document.querySelectorAll('#finders-list .finder-item');
        for (const el of items) {
            const url = el.querySelector('[data-field="searchUrl"]')?.value || '';
            const rowShortcut = (el.querySelector('[data-field="shortcut"]')?.value || '').toLowerCase();
            if (url.includes('google.com') && (!shortcut || rowShortcut === shortcut)) {
                return el;
            }
        }
        for (const el of items) {
            const url = el.querySelector('[data-field="searchUrl"]')?.value || '';
            if (url.includes('google.com')) return el;
        }
        return document.querySelector('#finders-list .finder-item:last-child');
    }

    syncUsageStepShortcutText() {
        const shortcut = this._googleExampleShortcut || this.pickGoogleExampleShortcut() || 'g';
        const usageStep = this.steps.find((s) => s.id === 'usage');
        if (usageStep) {
            usageStep.body = this.tf(
                'configFindersTourUsageBody',
                'Press ? to open finder mode. Type {shortcut} and your words — e.g. ?{shortcut} nextdash — then Enter. The %s in the URL is replaced with your query. Enable “Include finders in search” under General → Advanced if you also want finders in normal search results.',
                { shortcut }
            );
        }
    }

    addGoogleFinderExample(shortcut) {
        const mgr = window.configManager;
        if (!mgr?.findersData || !mgr.finders) return false;

        const letter = String(shortcut || '')
            .toLowerCase()
            .replace(/[^a-z]/g, '');
        if (!letter) return false;

        if (this.hasGoogleFinderInData()) {
            this._googleExampleShortcut = letter;
            this.ensureFindersRendered();
            return true;
        }

        if (this.getUsedFinderShortcuts().has(letter)) {
            return false;
        }

        const finder = {
            id: typeof mgr.generateId === 'function' ? mgr.generateId('finder-google') : 'finder-google',
            name: this.t('configFindersTourGoogleName', 'Google'),
            searchUrl: ConfigFindersTour.GOOGLE_URL,
            shortcut: letter,
            tags: [],
            useCount: 0,
            lastUsed: 0,
        };
        mgr.findersData.push(finder);
        mgr.finders.refresh(mgr);
        mgr.markDirty?.();
        this._googleExampleShortcut = letter;
        this._googleExampleAdded = true;
        this.syncUsageStepShortcutText();
        return true;
    }

    buildGoogleConsentMessage(shortcut) {
        const preferred = ConfigFindersTour.GOOGLE_SHORTCUT_PREFERRED;
        let message = '';
        if (shortcut !== preferred) {
            message =
                this.tf(
                    'configFindersTourGoogleConsentShortcutNote',
                    'Shortcut {preferred} is already used by another finder — we will use {shortcut} for this Google example instead.',
                    { preferred, shortcut }
                ) + '\n\n';
        }
        message += this.tf(
            'configFindersTourGoogleConsentBody',
            'We can add a ready-made Google finder to your list now:\n\n• Name: Google\n• URL: https://www.google.com/search?q=%s\n• Shortcut: {shortcut}\n\nYou still need to click Save in config to keep it. Nothing is sent to Google until you use the finder on the dashboard.',
            { shortcut }
        );
        return message;
    }

    async promptAddGoogleFinder() {
        this.unlockScroll();

        const shortcut = this.pickGoogleExampleShortcut();
        if (!shortcut) {
            window.configManager?.ui?.showNotification?.(
                this.t(
                    'configFindersTourGoogleNoShortcut',
                    'All single-letter shortcuts are already used by finders. Free a letter or remove a finder, then try the tour again.'
                ),
                'warning'
            );
            return false;
        }
        this._googleExampleShortcut = shortcut;

        const title = this.t('configFindersTourGoogleConsentTitle', 'Add a Google finder example?');
        const message = this.buildGoogleConsentMessage(shortcut);

        let confirmed = false;
        try {
            if (window.AppModal?.confirm) {
                confirmed = await window.AppModal.confirm({
                    title,
                    message,
                    confirmText: this.t('configFindersTourGoogleConsentYes', 'Add Google finder'),
                    cancelText: this.t('configFindersTourGoogleConsentNo', 'No thanks'),
                });
            } else {
                confirmed = window.confirm(`${title}\n\n${message}`);
            }
        } catch {
            confirmed = false;
        }

        if (confirmed) {
            const added = this.addGoogleFinderExample(shortcut);
            if (!added) {
                window.configManager?.ui?.showNotification?.(
                    this.tf(
                        'configFindersTourGoogleShortcutTaken',
                        'Shortcut {shortcut} was just taken by another finder. Pick a different shortcut manually.',
                        { shortcut }
                    ),
                    'warning'
                );
                return false;
            }
            await this.waitMs(120);
        }
        return confirmed;
    }

    async handleGoogleExampleStep(step) {
        if (this._googleConsentHandled) {
            return;
        }
        this._googleConsentHandled = true;

        const added = await this.promptAddGoogleFinder();
        const shortcut = this._googleExampleShortcut || ConfigFindersTour.GOOGLE_SHORTCUT_PREFERRED;
        if (added) {
            step.body = this.tf(
                'configFindersTourGoogleAddedBody',
                'Here is your Google finder. The URL uses %s where your search words go. On the dashboard, press ? then {shortcut} and your query — for example ?{shortcut} nextdash opens Google with that search.',
                { shortcut }
            );
            step.selector = null;
            step.getTarget = () => this.findGoogleFinderElement();
        } else {
            step.body = this.t(
                'configFindersTourGoogleSkippedBody',
                'No problem — you can add finders yourself with + Add finder. Use %s in the URL where the search text should go, and pick a single-letter shortcut.'
            );
            step.getTarget = null;
            step.selector = '#add-finder-btn';
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
                title: this.t('configFindersTourWelcomeTitle', 'Welcome to Finders'),
                body: this.t(
                    'configFindersTourWelcomeBody',
                    'Finders are quick-search shortcuts to external sites — Google, DuckDuckGo, Wikipedia, and more. You trigger them from the dashboard with ? plus a shortcut key.'
                ),
                selector: '[data-tab-content="finders"] .simple-tab',
                scrollBlock: 'start',
            },
            {
                title: this.t('configFindersTourConceptTitle', 'What is a finder?'),
                body: this.t(
                    'configFindersTourConceptBody',
                    'Each finder has a name, a search URL with %s as the placeholder for your query, and a one-letter shortcut. nextDash opens the finished URL in your browser — it does not search inside your bookmark list.'
                ),
                selector: '.simple-tab-intro',
                scrollBlock: 'start',
            },
            {
                title: this.t('configFindersTourFieldsTitle', 'Name, URL, shortcut & tags'),
                body: this.t(
                    'configFindersTourFieldsBody',
                    'Edit each row here: display name, full search URL (must include %s), lowercase shortcut (a–z), and optional comma-separated tags for filtering in config.'
                ),
                selector: '#finders-list',
                scrollBlock: 'center',
            },
            {
                title: this.t('configFindersTourAddTitle', 'Add your own finder'),
                body: this.t(
                    'configFindersTourAddBody',
                    'Click + Add finder for a blank row. Change the URL and shortcut to match any search site you use regularly.'
                ),
                selector: '#add-finder-btn',
                scrollBlock: 'center',
            },
            {
                id: 'google-example',
                title: this.t('configFindersTourGoogleTitle', 'Example: Google'),
                body: this.tf(
                    'configFindersTourGoogleIntroBody',
                    'A common pattern is Google with URL https://www.google.com/search?q=%s. We prefer shortcut {preferred} if it is free; otherwise we suggest the next available letter. Next we can add this row — only if you agree.',
                    {
                        preferred: ConfigFindersTour.GOOGLE_SHORTCUT_PREFERRED,
                    }
                ),
                selector: '#finders-list',
                scrollBlock: 'center',
                onBeforeShow: (step) => this.handleGoogleExampleStep(step),
            },
            {
                id: 'usage',
                title: this.t('configFindersTourUsageTitle', 'Use finders on the dashboard'),
                body: this.tf(
                    'configFindersTourUsageBody',
                    'Press ? to open finder mode. Type {shortcut} and your words — e.g. ?{shortcut} nextdash — then Enter. The %s in the URL is replaced with your query. Enable “Include finders in search” under General → Advanced if you also want finders in normal search results.',
                    { shortcut: ConfigFindersTour.GOOGLE_SHORTCUT_PREFERRED }
                ),
                getTarget: () => this.findGoogleFinderElement() || document.getElementById('finders-list'),
                scrollBlock: 'center',
            },
            {
                title: this.t('configFindersTourMaintainTitle', 'Reorder & remove'),
                body: this.t(
                    'configFindersTourMaintainBody',
                    'Drag the ⠿ handle to change order. Remove deletes after confirmation. Usage stats (uses · last used) help you see which finders you actually use.'
                ),
                getTarget: () =>
                    this.findGoogleFinderElement() ||
                    document.querySelector('#finders-list .finder-item'),
                scrollBlock: 'center',
            },
            {
                title: this.t('configFindersTourSaveTitle', 'Save your finders'),
                body: this.t(
                    'configFindersTourSaveBody',
                    'Finder changes are stored when you click Save. If you added the Google example during this tour, save now to keep it after a refresh.'
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
            ConfigFindersTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._googleConsentHandled = false;
            this._googleExampleAdded = false;
            this._googleExampleShortcut = ConfigFindersTour.GOOGLE_SHORTCUT_PREFERRED;
        }

        this.ensureFindersTabActive();
        await this.waitForFindersTabActive(force ? 50 : 30);
        this.ensureFindersRendered();

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-finders-tab';
            return false;
        }
        if (!document.getElementById('finders-list')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.syncUsageStepShortcutText();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-finders-tour-active', 'true');
        document.body.classList.remove('config-finders-tour-ready');
        try {
            await this.showStep(0);
            document.body.classList.add('config-finders-tour-ready');
        } catch (error) {
            console.error('Config Finders tour failed to start', error);
            ConfigFindersTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    render() {
        ConfigFindersTour.teardownStaleDom();
        this.card = null;

        const card = document.createElement('div');
        card.className = 'config-finders-tour-card';
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
        progress.textContent = this.t('configFindersTourProgress', 'Step {step} of {total}')
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
            this.highlightedElement.classList.remove('config-finders-tour-highlight');
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
            element.classList.add('config-finders-tour-highlight');
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
            window.configManager._configFindersTourActive = false;
        }
        document.body.removeAttribute('data-config-finders-tour-active');
        document.body.classList.remove('config-finders-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigFindersTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigFindersTour = ConfigFindersTour;
}
