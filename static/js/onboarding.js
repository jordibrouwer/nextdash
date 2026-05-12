class Onboarding {
    constructor(options = {}) {
        this.hasBookmarks = options.hasBookmarks === true;
        this.settings = options.settings || {};
        this.language = options.language || null;
        this.localSettings = this.buildInitialSettings(options.settings || {});
        this.steps = this.buildSteps();
        this.currentStep = 0;
        this.overlay = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        // Use v2 keys to avoid stale localStorage state blocking first-run onboarding.
        this.version = 2;
        this.storageSeenKey = 'nextDashOnboardingSeenV2';
        this.storageVersionKey = 'nextDashOnboardingVersionV2';
        this.serverCompleted = options.serverCompleted === true;
        this.onPersist = typeof options.onPersist === 'function' ? options.onPersist : null;
        this.onApplySettings = typeof options.onApplySettings === 'function' ? options.onApplySettings : null;
        this.persisted = false;
    }

    t(key, fallback = '') {
        const translated = this.language && typeof this.language.t === 'function'
            ? this.language.t(key)
            : key;
        if (translated && translated !== key) {
            return translated;
        }
        return fallback || key;
    }

    shouldStart() {
        if (this.serverCompleted) {
            return false;
        }
        return true;
    }

    maybeStart() {
        if (!this.shouldStart()) {
            return;
        }
        this.render();
        this.showStep(0);
    }

    buildSteps() {
        return [
            {
                title: this.t('onboarding.welcomeTitle', 'Welcome to nextDash'),
                body: this.t('onboarding.welcomeBody', 'Quick setup in a few clicks. You can skip anytime.'),
                selector: '.header-top',
                primaryLabel: this.t('onboarding.startSetup', 'Start setup')
            },
            {
                title: this.t('onboarding.languageStepTitle', 'Language & basic behavior'),
                body: this.t('onboarding.languageStepBody', 'Pick your language and how links open.'),
                selector: '#search-button',
                placement: 'top',
                fields: [
                    {
                        id: 'language',
                        type: 'select',
                        label: this.t('onboarding.languageLabel', 'Language'),
                        options: [
                            { value: 'en', label: 'English' },
                            { value: 'nl', label: 'Nederlands' },
                            { value: 'de', label: 'Deutsch' },
                            { value: 'fr', label: 'Français' }
                        ]
                    },
                    {
                        id: 'openInNewTab',
                        type: 'radio',
                        label: this.t('onboarding.openLinksLabel', 'Open links in'),
                        options: [
                            { value: 'true', label: this.t('onboarding.openLinksNewTab', 'New tab (recommended)') },
                            { value: 'false', label: this.t('onboarding.openLinksCurrentTab', 'Current tab') }
                        ]
                    },
                    {
                        id: 'autoDarkMode',
                        type: 'radio',
                        label: this.t('onboarding.autoDarkModeLabel', 'Auto dark mode (follow system)'),
                        options: [
                            { value: 'true', label: this.t('onboarding.autoDarkModeOn', 'On (recommended)') },
                            { value: 'false', label: this.t('onboarding.autoDarkModeOff', 'Off') }
                        ]
                    }
                ]
            },
            {
                title: this.t('onboarding.weatherLayoutStepTitle', 'Date, weather, and layout'),
                body: this.t('onboarding.weatherLayoutStepBody', 'Choose weather display and tight columns behavior.'),
                selector: '#date-element',
                fields: [
                    {
                        id: 'showWeatherWithDate',
                        type: 'radio',
                        label: this.t('onboarding.showWeatherLabel', 'Show weather next to date'),
                        options: [
                            { value: 'false', label: this.t('onboarding.no', 'No') },
                            { value: 'true', label: this.t('onboarding.yes', 'Yes') }
                        ]
                    },
                    {
                        id: 'weatherSource',
                        type: 'radio',
                        label: this.t('onboarding.weatherSourceLabel', 'Weather location source'),
                        options: [
                            { value: 'browser', label: this.t('onboarding.weatherSourceBrowser', 'Use browser location') },
                            { value: 'manual', label: this.t('onboarding.weatherSourceManual', 'Set location manually') }
                        ]
                    },
                    {
                        id: 'weatherLocation',
                        type: 'text',
                        label: this.t('onboarding.weatherLocationLabel', 'Manual location'),
                        placeholder: this.t('onboarding.weatherLocationPlaceholder', 'City name (e.g. Leiden)')
                    },
                    {
                        id: 'packedColumns',
                        type: 'radio',
                        label: this.t('onboarding.tightColumnsLabel', 'Tight columns'),
                        hint: this.t('onboarding.tightColumnsHint', 'Tight columns fill vertical space better with many categories. Off keeps classic flow.'),
                        options: [
                            { value: 'true', label: this.t('onboarding.tightColumnsOn', 'On (recommended)') },
                            { value: 'false', label: this.t('onboarding.tightColumnsOff', 'Off') }
                        ]
                    }
                ]
            },
            {
                title: this.t('onboarding.searchTipsStepTitle', 'Search & tips'),
                body: this.t('onboarding.searchTipsStepBody', 'Tune keyboard flow and footer hints.'),
                selector: '#button-hint-text',
                placement: 'top',
                fields: [
                    {
                        id: 'interleaveMode',
                        type: 'radio',
                        label: this.t('onboarding.searchModeLabel', 'Search mode'),
                        options: [
                            { value: 'false', label: this.t('onboarding.searchModeDefault', 'Default: typing = shortcut search, "/" = fuzzy') },
                            { value: 'true', label: this.t('onboarding.searchModeInterleave', 'Interleave: typing = fuzzy, "/" = shortcuts') }
                        ]
                    },
                    {
                        id: 'showTips',
                        type: 'radio',
                        label: this.t('onboarding.showTipsLabel', 'Show rotating tips above buttons'),
                        options: [
                            { value: 'true', label: this.t('onboarding.yes', 'Yes') },
                            { value: 'false', label: this.t('onboarding.no', 'No') }
                        ]
                    }
                ]
            },
            {
                title: this.t('onboarding.keyboardBookmarksStepTitle', 'Bookmarks: keyboard'),
                body: this.t(
                    'onboarding.keyboardBookmarksStepBody',
                    'Use the arrow keys to move the highlight across the bookmark grid. Press Enter or Space to open. Press the semicolon key (;) to edit: works when a row is highlighted or when Tab has moved focus onto a bookmark link.'
                ),
                selector: '#dashboard-layout',
                placement: 'bottom'
            },
            {
                title: this.t('onboarding.mouseBookmarksStepTitle', 'Bookmarks: mouse'),
                body: this.t(
                    'onboarding.mouseBookmarksStepBody',
                    'Use the narrow strip on the left as a drag handle to reorder bookmarks or drop them into another category. Press and hold on the bookmark row itself (not on that strip) for about half a second to open the inline editor.'
                ),
                selector: '#dashboard-layout',
                placement: 'bottom'
            },
            {
                title: this.hasBookmarks
                    ? this.t('onboarding.finishTitleReady', 'You are ready')
                    : this.t('onboarding.finishTitleStart', 'Ready to start'),
                body: this.hasBookmarks
                    ? this.t('onboarding.finishBodyReady', 'Setup complete. You can change anything later in config.')
                    : this.t('onboarding.finishBodyStart', 'Setup complete. Open config to add bookmarks or restore from a backup.'),
                selector: this.hasBookmarks ? '#search-button' : '.config-link a',
                primaryLabel: this.t('onboarding.finishSetup', 'Finish setup'),
                secondaryAction: {
                    label: this.t('onboarding.openConfig', 'Open config'),
                    handler: () => {
                        window.location.href = '/config#general';
                    }
                }
            }
        ];
    }

    buildInitialSettings(settings) {
        return {
            language: settings.language || 'en',
            openInNewTab: settings.openInNewTab !== false,
            autoDarkMode: settings.autoDarkMode !== false,
            showWeatherWithDate: settings.showWeatherWithDate === true,
            weatherSource: settings.weatherSource || 'manual',
            weatherLocation: settings.weatherLocation || '',
            packedColumns: settings.packedColumns !== false,
            interleaveMode: settings.interleaveMode === true,
            showTips: settings.showTips !== false
        };
    }

    render() {
        if (this.overlay) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.innerHTML = `
            <div class="onboarding-card" role="dialog" aria-modal="true" aria-live="polite">
                <div class="onboarding-progress"></div>
                <h3 class="onboarding-title"></h3>
                <p class="onboarding-body"></p>
                <div class="onboarding-fields"></div>
                <div class="onboarding-actions">
                    <button type="button" class="onboarding-btn onboarding-back">${this.t('onboarding.back', 'Back')}</button>
                    <button type="button" class="onboarding-btn onboarding-skip">${this.t('onboarding.skip', 'Skip')}</button>
                    <button type="button" class="onboarding-btn onboarding-secondary" hidden></button>
                    <button type="button" class="onboarding-btn onboarding-next">${this.t('onboarding.next', 'Next')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.overlay = overlay;

        overlay.querySelector('.onboarding-back').addEventListener('click', () => this.prevStep());
        overlay.querySelector('.onboarding-skip').addEventListener('click', () => this.finish());
        overlay.querySelector('.onboarding-next').addEventListener('click', () => this.nextStep());

        this.keyHandler = (e) => {
            if (e.key === 'Escape') {
                this.finish();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    showStep(index) {
        this.currentStep = Math.max(0, Math.min(index, this.steps.length - 1));
        const step = this.steps[this.currentStep];
        if (!this.overlay || !step) {
            return;
        }

        const title = this.overlay.querySelector('.onboarding-title');
        const body = this.overlay.querySelector('.onboarding-body');
        const progress = this.overlay.querySelector('.onboarding-progress');
        const fields = this.overlay.querySelector('.onboarding-fields');
        const back = this.overlay.querySelector('.onboarding-back');
        const next = this.overlay.querySelector('.onboarding-next');
        const secondary = this.overlay.querySelector('.onboarding-secondary');

        title.textContent = step.title;
        body.textContent = step.body;
        progress.textContent = `${this.currentStep + 1}/${this.steps.length}`;

        back.disabled = this.currentStep === 0;
        next.textContent = step.primaryLabel || (this.currentStep === this.steps.length - 1
            ? this.t('onboarding.finish', 'Finish')
            : this.t('onboarding.next', 'Next'));
        this.renderFields(fields, step);

        if (step.secondaryAction && typeof step.secondaryAction.handler === 'function') {
            secondary.hidden = false;
            secondary.textContent = step.secondaryAction.label || 'Open';
            secondary.onclick = step.secondaryAction.handler;
        } else {
            secondary.hidden = true;
            secondary.textContent = '';
            secondary.onclick = null;
        }

        this.positionCard(step);
        this.highlight(step.selector);
    }

    renderFields(container, step) {
        if (!container) return;
        const fields = Array.isArray(step.fields) ? step.fields : [];
        if (fields.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';

        container.innerHTML = fields.map((field) => {
            if (field.type === 'select') {
                return `
                    <label class="onboarding-field">
                        <span class="onboarding-field-label">${field.label}</span>
                        <select class="onboarding-input" data-field-id="${field.id}">
                            ${(field.options || []).map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}
                        </select>
                    </label>
                `;
            }
            if (field.type === 'radio') {
                return `
                    <fieldset class="onboarding-fieldset" data-field-id="${field.id}">
                        <legend class="onboarding-field-label">${field.label}</legend>
                        ${(field.options || []).map((option) => `
                            <label class="onboarding-radio-option">
                                <input type="radio" name="onboarding-${field.id}" value="${option.value}">
                                <span>${option.label}</span>
                            </label>
                        `).join('')}
                        ${field.hint ? `<div class="onboarding-field-hint">${field.hint}</div>` : ''}
                    </fieldset>
                `;
            }
            if (field.type === 'text') {
                return `
                    <label class="onboarding-field">
                        <span class="onboarding-field-label">${field.label}</span>
                        <input
                            class="onboarding-input"
                            type="text"
                            data-field-id="${field.id}"
                            placeholder="${field.placeholder || ''}"
                        >
                    </label>
                `;
            }
            return '';
        }).join('');

        fields.forEach((field) => {
            const value = this.localSettings[field.id];
            if (field.type === 'select' || field.type === 'text') {
                const element = container.querySelector(`[data-field-id="${field.id}"]`);
                if (element) {
                    element.value = field.type === 'text' ? String(value || '') : String(value ?? '');
                    if (field.id === 'weatherLocation') {
                        element.disabled = this.localSettings.showWeatherWithDate !== true || this.localSettings.weatherSource !== 'manual';
                    }
                    element.addEventListener('change', () => {
                        this.localSettings[field.id] = this.parseFieldValue(field.id, element.value);
                        if (field.id === 'language') {
                            this.applyOnboardingLanguage(String(element.value || 'en'));
                            return;
                        }
                        this.refreshDependentFields(container);
                    });
                    if (field.type === 'text') {
                        element.addEventListener('input', () => {
                            this.localSettings[field.id] = this.parseFieldValue(field.id, element.value);
                        });
                    }
                }
            }
            if (field.type === 'radio') {
                const radios = container.querySelectorAll(`input[name="onboarding-${field.id}"]`);
                radios.forEach((radio) => {
                    radio.checked = String(value) === String(radio.value);
                    radio.addEventListener('change', () => {
                        this.localSettings[field.id] = this.parseFieldValue(field.id, radio.value);
                        this.refreshDependentFields(container);
                    });
                });
            }
        });

        this.refreshDependentFields(container);
    }

    refreshDependentFields(container) {
        const weatherLocationInput = container.querySelector('[data-field-id="weatherLocation"]');
        if (weatherLocationInput) {
            weatherLocationInput.disabled = this.localSettings.showWeatherWithDate !== true || this.localSettings.weatherSource !== 'manual';
        }
    }

    parseFieldValue(fieldId, value) {
        if (['openInNewTab', 'autoDarkMode', 'showWeatherWithDate', 'packedColumns', 'interleaveMode', 'showTips'].includes(fieldId)) {
            return String(value) === 'true';
        }
        return value;
    }

    async applyOnboardingLanguage(langCode) {
        if (!this.language || typeof this.language.loadTranslations !== 'function') {
            return;
        }
        try {
            await this.language.loadTranslations(langCode);
        } catch (error) {
            return;
        }
        this.steps = this.buildSteps();
        this.showStep(this.currentStep);
    }

    collectCurrentStepInputs() {
        const step = this.steps[this.currentStep];
        if (!step || !Array.isArray(step.fields) || !this.overlay) return;
        const fieldsContainer = this.overlay.querySelector('.onboarding-fields');
        if (!fieldsContainer) return;

        step.fields.forEach((field) => {
            if (field.type === 'select' || field.type === 'text') {
                const element = fieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
                if (!element) return;
                this.localSettings[field.id] = this.parseFieldValue(field.id, element.value);
                return;
            }
            if (field.type === 'radio') {
                const selected = fieldsContainer.querySelector(`input[name="onboarding-${field.id}"]:checked`);
                if (!selected) return;
                this.localSettings[field.id] = this.parseFieldValue(field.id, selected.value);
            }
        });
    }

    positionCard(step) {
        if (!this.overlay) return;
        const card = this.overlay.querySelector('.onboarding-card');
        if (!card) return;

        // Mobile keeps default bottom placement for stability.
        if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches) {
            this.overlay.classList.remove('onboarding-overlay-floating');
            card.style.removeProperty('top');
            card.style.removeProperty('left');
            return;
        }

        const target = step && step.selector ? document.querySelector(step.selector) : null;
        const placement = step && step.placement ? step.placement : 'bottom';
        if (!target || (placement !== 'top' && placement !== 'bottom')) {
            this.overlay.classList.remove('onboarding-overlay-floating');
            card.style.removeProperty('top');
            card.style.removeProperty('left');
            return;
        }

        this.overlay.classList.add('onboarding-overlay-floating');

        const viewportPadding = 16;
        const gap = 12;
        const rect = target.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        const maxLeft = Math.max(viewportPadding, window.innerWidth - cardRect.width - viewportPadding);
        const centeredLeft = rect.left + (rect.width / 2) - (cardRect.width / 2);
        const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));

        const desiredTop = placement === 'top'
            ? rect.top - cardRect.height - gap
            : rect.bottom + gap;
        const maxTop = Math.max(viewportPadding, window.innerHeight - cardRect.height - viewportPadding);
        const top = Math.min(maxTop, Math.max(viewportPadding, desiredTop));

        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
    }

    highlight(selector) {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('onboarding-highlight');
            this.highlightedElement = null;
        }
        if (!selector) {
            return;
        }
        const element = document.querySelector(selector);
        if (!element) {
            return;
        }
        element.classList.add('onboarding-highlight');
        this.highlightedElement = element;
        const computedStyle = window.getComputedStyle ? window.getComputedStyle(element) : null;
        const isFixedLike = computedStyle && (computedStyle.position === 'fixed' || computedStyle.position === 'sticky');
        if (!isFixedLike && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
    }

    nextStep() {
        this.collectCurrentStepInputs();
        if (this.currentStep >= this.steps.length - 1) {
            this.finish();
            return;
        }
        this.showStep(this.currentStep + 1);
    }

    prevStep() {
        this.showStep(this.currentStep - 1);
    }

    finish() {
        this.collectCurrentStepInputs();
        Object.assign(this.settings, {
            language: this.localSettings.language,
            openInNewTab: this.localSettings.openInNewTab,
            autoDarkMode: this.localSettings.autoDarkMode,
            showWeatherWithDate: this.localSettings.showWeatherWithDate,
            weatherSource: this.localSettings.weatherSource,
            weatherLocation: this.localSettings.weatherLocation,
            packedColumns: this.localSettings.packedColumns,
            interleaveMode: this.localSettings.interleaveMode,
            showTips: this.localSettings.showTips
        });

        if (this.onApplySettings) {
            this.onApplySettings(this.settings);
        }

        try {
            localStorage.setItem(this.storageSeenKey, 'true');
            localStorage.setItem(this.storageVersionKey, String(this.version));
        } catch (error) {
            // Ignore storage errors; onboarding can still close normally.
        }
        if (this.onPersist && !this.persisted) {
            this.persisted = true;
            Promise.resolve(this.onPersist()).catch(() => {});
        }
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('onboarding-highlight');
            this.highlightedElement = null;
        }
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }
}

window.Onboarding = Onboarding;
