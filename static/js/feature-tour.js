class FeatureTour {
    constructor(options = {}) {
        this.settings = options.settings || {};
        this.language = options.language || null;
        this.localSettings = this.buildInitialSettings(options.settings || {});
        this.steps = this.buildSteps();
        this.currentStep = 0;
        this.overlay = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this.onPersist = typeof options.onPersist === 'function' ? options.onPersist : null;
        this.onApplySettings = typeof options.onApplySettings === 'function' ? options.onApplySettings : null;
        this.persisted = false;
    }

    _t(key, fallback) {
        if (this.language && typeof this.language.t === 'function') {
            const result = this.language.t('featureTour.' + key);
            if (result && result !== 'featureTour.' + key) return result;
        }
        return fallback;
    }

    buildSteps() {
        return [
            {
                title: this._t('step1Title', 'Tour of nextDash'),
                body: this._t('step1Body', 'Discover the most powerful features in a few clicks. You can always skip the tour or restart it later via Config.'),
                selector: '.header-top',
                primaryLabel: this._t('step1Start', 'Start tour')
            },
            {
                title: this._t('step2Title', 'Commands: the control panel'),
                body: this._t('step2Body', 'Press ":" or click this button. Change theme with :theme dark, adjust columns with :columns 4, or add a bookmark with :new. Commands are grouped and searchable.'),
                selector: '#commands-button',
                placement: 'top'
            },
            {
                title: this._t('step3Title', 'Finders: search beyond nextDash'),
                body: this._t('step3Body', 'Press "?" to open your finders. Finders are shortcuts to search engines. A DuckDuckGo finder is ready by default — type "?du linux" to search directly. Add or remove your own finders via Config → Finders.'),
                selector: '#finders-button',
                placement: 'top'
            },
            {
                title: this._t('step4Title', 'Search: find your bookmarks instantly'),
                body: this._t('step4Body', 'Press ">" or click the search button. Use filters like status:online, category:work or tag:dev. Your search history and saved searches are always available.'),
                selector: '#search-button',
                placement: 'top'
            },
            {
                title: this._t('stepPagesOverviewTitle', 'All pages at a glance'),
                body: this._t('stepPagesOverviewBody', 'Press "," or tap the pages button to see every page with bookmark counts — handy when you have many pages.'),
                selector: '#page-overview-header-btn',
                placement: 'bottom'
            },
            {
                title: this._t('step5Title', 'Columns and favicons'),
                body: this._t('step5Body', 'Set the number of columns that fits your screen. Favicons are the website icons next to each bookmark — handy for quick recognition.'),
                fields: [
                    {
                        id: 'columnsPerRow',
                        type: 'select',
                        label: this._t('step5ColumnsLabel', 'Columns per row'),
                        options: [
                            { value: '1', label: this._t('step5Col1', '1 column') },
                            { value: '2', label: this._t('step5Col2', '2 columns') },
                            { value: '3', label: this._t('step5Col3', '3 columns') },
                            { value: '4', label: this._t('step5Col4', '4 columns') },
                            { value: '5', label: this._t('step5Col5', '5 columns') },
                            { value: '6', label: this._t('step5Col6', '6 columns') }
                        ]
                    },
                    {
                        id: 'showIcons',
                        type: 'radio',
                        label: this._t('step5ShowIconsLabel', 'Show favicons'),
                        hint: this._t('step5ShowIconsHint', 'Website icons next to each bookmark for quick recognition.'),
                        options: [
                            { value: 'true', label: this._t('yes', 'Yes') },
                            { value: 'false', label: this._t('no', 'No') }
                        ]
                    }
                ]
            },
            {
                title: this._t('step6Title', 'Smart collections'),
                body: this._t('step6Body', 'nextDash automatically groups your bookmarks into dynamic sections. The Today collection shows bookmarks fitting your time of day: work tools in the morning, relaxation in the evening.'),
                fields: [
                    {
                        id: 'showSmartTodayCollection',
                        type: 'radio',
                        label: this._t('step6TodayLabel', 'Today collection'),
                        hint: this._t('step6TodayHint', 'Shows bookmarks that fit your time of day.'),
                        options: [
                            { value: 'true', label: this._t('on', 'On') },
                            { value: 'false', label: this._t('off', 'Off') }
                        ]
                    },
                    {
                        id: 'showSmartMostUsedCollection',
                        type: 'radio',
                        label: this._t('step6MostUsedLabel', 'Most used collection'),
                        hint: this._t('step6MostUsedHint', 'Shows your most opened bookmarks in one overview.'),
                        options: [
                            { value: 'true', label: this._t('on', 'On') },
                            { value: 'false', label: this._t('off', 'Off') }
                        ]
                    }
                ]
            },
            {
                title: this._t('step7Title', 'Managing bookmarks'),
                body: this._t('step7Body', 'Use arrow keys to navigate, Enter to open and ; to edit inline. Drag via the narrow handle strip on the left to reorder. In Config → Bookmarks you manage everything in bulk, import and export.')
            },
            {
                title: this._t('step8Title', 'Ready to use'),
                body: this._t('step8Body', 'The tour is complete. All features are fully configurable via Config: themes, layout version (Classic/Modern), layout presets, finders, smart collections and bookmark management.'),
                selector: '.config-link a',
                primaryLabel: this._t('step8Finish', 'Finish'),
                secondaryAction: {
                    label: this._t('step8GoToConfig', 'Go to Config'),
                    handler: () => {
                        window.location.href = '/config#general/advanced';
                    }
                }
            }
        ];
    }

    buildInitialSettings(settings) {
        return {
            columnsPerRow: settings.columnsPerRow || 3,
            showIcons: settings.showIcons !== false,
            showSmartTodayCollection: settings.showSmartTodayCollection === true,
            showSmartMostUsedCollection: settings.showSmartMostUsedCollection === true
        };
    }

    render() {
        if (this.overlay) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'feature-tour-overlay';
        document.body.appendChild(overlay);
        document.body.setAttribute('data-tour-active', 'true');
        this.overlay = overlay;

        // Card is appended directly to body so it sits above the highlighted element
        // (highlight z-index 2201, card z-index 2202).
        const card = document.createElement('div');
        card.className = 'feature-tour-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-live', 'polite');
        card.innerHTML = `
            <div class="feature-tour-progress"></div>
            <h3 class="feature-tour-title"></h3>
            <p class="feature-tour-body"></p>
            <div class="feature-tour-fields"></div>
            <div class="feature-tour-actions">
                <button type="button" class="feature-tour-btn feature-tour-back">${this._t('back', 'Back')}</button>
                <button type="button" class="feature-tour-btn feature-tour-skip">${this._t('skip', 'Skip')}</button>
                <button type="button" class="feature-tour-btn feature-tour-secondary" hidden></button>
                <button type="button" class="feature-tour-btn feature-tour-next">${this._t('next', 'Next')}</button>
            </div>
        `;
        document.body.appendChild(card);
        this.card = card;

        card.querySelector('.feature-tour-back').addEventListener('click', () => this.prevStep());
        card.querySelector('.feature-tour-skip').addEventListener('click', () => this.finish());
        card.querySelector('.feature-tour-next').addEventListener('click', () => this.nextStep());

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
        if (!this.overlay || !this.card || !step) {
            return;
        }

        const title = this.card.querySelector('.feature-tour-title');
        const body = this.card.querySelector('.feature-tour-body');
        const progress = this.card.querySelector('.feature-tour-progress');
        const fields = this.card.querySelector('.feature-tour-fields');
        const back = this.card.querySelector('.feature-tour-back');
        const next = this.card.querySelector('.feature-tour-next');
        const secondary = this.card.querySelector('.feature-tour-secondary');

        title.textContent = step.title;
        body.textContent = step.body;
        progress.textContent = `${this.currentStep + 1}/${this.steps.length}`;

        back.disabled = this.currentStep === 0;
        next.textContent = step.primaryLabel || (this.currentStep === this.steps.length - 1 ? this._t('finish', 'Finish') : this._t('next', 'Next'));
        this.renderFields(fields, step);

        if (step.secondaryAction && typeof step.secondaryAction.handler === 'function') {
            secondary.hidden = false;
            secondary.textContent = step.secondaryAction.label || this._t('open', 'Open');
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
                    <label class="feature-tour-field">
                        <span class="feature-tour-field-label">${field.label}</span>
                        <select class="feature-tour-input" data-field-id="${field.id}">
                            ${(field.options || []).map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}
                        </select>
                    </label>
                `;
            }
            if (field.type === 'radio') {
                return `
                    <fieldset class="feature-tour-fieldset" data-field-id="${field.id}">
                        <legend class="feature-tour-field-label">${field.label}</legend>
                        ${(field.options || []).map((option) => `
                            <label class="feature-tour-radio-option">
                                <input type="radio" name="feature-tour-${field.id}" value="${option.value}">
                                <span>${option.label}</span>
                            </label>
                        `).join('')}
                        ${field.hint ? `<div class="feature-tour-field-hint">${field.hint}</div>` : ''}
                    </fieldset>
                `;
            }
            return '';
        }).join('');

        fields.forEach((field) => {
            const value = this.localSettings[field.id];
            if (field.type === 'select') {
                const element = container.querySelector(`[data-field-id="${field.id}"]`);
                if (element) {
                    element.value = String(value ?? '');
                    element.addEventListener('change', () => {
                        this.localSettings[field.id] = this.parseFieldValue(field.id, element.value);
                    });
                }
            }
            if (field.type === 'radio') {
                const radios = container.querySelectorAll(`input[name="feature-tour-${field.id}"]`);
                radios.forEach((radio) => {
                    radio.checked = String(value) === String(radio.value);
                    radio.addEventListener('change', () => {
                        this.localSettings[field.id] = this.parseFieldValue(field.id, radio.value);
                    });
                });
            }
        });
    }

    parseFieldValue(fieldId, value) {
        if (['showIcons', 'showSmartTodayCollection', 'showSmartMostUsedCollection'].includes(fieldId)) {
            return String(value) === 'true';
        }
        if (fieldId === 'columnsPerRow') {
            return parseInt(value, 10) || 3;
        }
        return value;
    }

    collectCurrentStepInputs() {
        const step = this.steps[this.currentStep];
        if (!step || !Array.isArray(step.fields) || !this.overlay) return;
        const fieldsContainer = this.card.querySelector('.feature-tour-fields');
        if (!fieldsContainer) return;

        step.fields.forEach((field) => {
            if (field.type === 'select') {
                const element = fieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
                if (!element) return;
                this.localSettings[field.id] = this.parseFieldValue(field.id, element.value);
                return;
            }
            if (field.type === 'radio') {
                const selected = fieldsContainer.querySelector(`input[name="feature-tour-${field.id}"]:checked`);
                if (!selected) return;
                this.localSettings[field.id] = this.parseFieldValue(field.id, selected.value);
            }
        });
    }

    positionCard(step) {
        if (!this.overlay || !this.card) return;
        const card = this.card;

        const resetToDefault = () => {
            card.style.removeProperty('top');
            card.style.removeProperty('left');
            card.style.removeProperty('bottom');
            card.style.removeProperty('transform');
        };

        // Mobile: use CSS default (bottom-center).
        if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches) {
            resetToDefault();
            return;
        }

        const target = step && step.selector ? document.querySelector(step.selector) : null;
        const placement = step && step.placement ? step.placement : 'bottom';
        if (!target || (placement !== 'top' && placement !== 'bottom')) {
            resetToDefault();
            return;
        }

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
        card.style.bottom = 'auto';
        card.style.transform = 'none';
    }

    highlight(selector) {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('feature-tour-highlight');
            this.highlightedElement = null;
        }
        if (!selector) {
            return;
        }
        const element = document.querySelector(selector);
        if (!element) {
            return;
        }
        element.classList.add('feature-tour-highlight');
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
            columnsPerRow: this.localSettings.columnsPerRow,
            showIcons: this.localSettings.showIcons,
            showSmartTodayCollection: this.localSettings.showSmartTodayCollection,
            showSmartMostUsedCollection: this.localSettings.showSmartMostUsedCollection
        });

        if (this.onApplySettings) {
            this.onApplySettings(this.settings);
        }

        if (this.onPersist && !this.persisted) {
            this.persisted = true;
            Promise.resolve(this.onPersist()).catch(() => {});
        }
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('feature-tour-highlight');
            this.highlightedElement = null;
        }
        document.body.removeAttribute('data-tour-active');
        if (this.card) {
            this.card.remove();
            this.card = null;
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

    start() {
        this.render();
        this.showStep(0);
    }
}

window.FeatureTour = FeatureTour;
