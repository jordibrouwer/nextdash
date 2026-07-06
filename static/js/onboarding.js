class Onboarding {
    constructor(options = {}) {
        this.hasBookmarks = options.hasBookmarks === true;
        this.pagesCount = Number.isFinite(options.pagesCount) ? options.pagesCount : 1;
        this.settings = options.settings || {};
        this.language = options.language || null;
        this.serverCompleted = options.serverCompleted === true;
        this.onPersist = typeof options.onPersist === 'function' ? options.onPersist : null;
        this.onApplySettings = typeof options.onApplySettings === 'function' ? options.onApplySettings : null;
        this.onApplyBookmarks = typeof options.onApplyBookmarks === 'function' ? options.onApplyBookmarks : null;
        this.bookmarks = Array.isArray(options.bookmarks)
            ? options.bookmarks.map((bookmark) => ({ ...bookmark }))
            : [];
        this.allBookmarks = Array.isArray(options.allBookmarks)
            ? options.allBookmarks.map((bookmark) => ({ ...bookmark }))
            : [];
        this.pages = Array.isArray(options.pages) ? options.pages : [];
        this.statusMonitorBookmarks = this.allBookmarks.length > 0 ? this.allBookmarks : this.bookmarks;
        this.usesAllPagesStatusMonitor = this.allBookmarks.length > 0;
        this.mobileCompact = options.mobileCompact === true
            || (typeof window.MobileExperience?.shouldSkipHeavyUi === 'function' && window.MobileExperience.shouldSkipHeavyUi());
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
        if (this.mobileCompact) {
            return this.buildMobileSteps();
        }
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
                title: this.t('onboarding.weatherStepTitle', 'Date & weather'),
                body: this.t('onboarding.weatherStepBody', 'Choose weather display and tight columns behavior.'),
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
                title: this.t('onboarding.collectionsStepTitle', 'Smart collections'),
                body: this.t('onboarding.collectionsStepBody', 'nextDash can auto-group your bookmarks into dynamic sections. Enable the ones that suit your workflow — you can tweak them anytime in config.'),
                selector: '#dashboard-layout',
                placement: 'bottom',
                fields: [
                    {
                        id: 'showSmartTodayCollection',
                        type: 'radio',
                        label: this.t('onboarding.collectionsShowTodayLabel', 'Today collection'),
                        hint: this.t('onboarding.collectionsShowTodayHint', 'Shows bookmarks that match your time of day — work tools in the morning, leisure in the evening.'),
                        options: [
                            { value: 'true', label: this.t('onboarding.yes', 'Yes') },
                            { value: 'false', label: this.t('onboarding.no', 'No') }
                        ]
                    },
                    {
                        id: 'showSmartMostUsedCollection',
                        type: 'radio',
                        label: this.t('onboarding.collectionsShowMostUsedLabel', 'Most used collection'),
                        hint: this.t('onboarding.collectionsShowMostUsedHint', 'Shows your most opened bookmarks at a glance.'),
                        options: [
                            { value: 'true', label: this.t('onboarding.yes', 'Yes') },
                            { value: 'false', label: this.t('onboarding.no', 'No') }
                        ]
                    }
                ]
            },
            this.buildStatusMonitoringStep(),
            {
                title: this.t('onboarding.bookmarksInputStepTitle', 'Bookmarks: keyboard & mouse'),
                body: this.t(
                    'onboarding.bookmarksInputStepBody',
                    'Arrow keys move the highlight; Enter or Space opens; semicolon (;) edits. Drag the left strip to reorder; press and hold a row (not the strip) for about half a second for inline edit; press and hold a category title the same way to rename it. More in Help → Dashboard bookmarks.'
                ),
                selector: '#dashboard-layout',
                placement: 'bottom'
            },
            {
                title: this.hasBookmarks
                    ? this.t('onboarding.finishTitleReady', 'You are ready')
                    : this.t('onboarding.finishTitleStart', 'Ready to start'),
                body: this.buildFinishBody(),
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

    buildFinishBody() {
        const key = this.hasBookmarks ? 'onboarding.finishBodyReady' : 'onboarding.finishBodyStart';
        const fallback = this.hasBookmarks
            ? 'Setup complete. You can change anything later in config. Keyboard and mouse bookmark tips are in Help → Dashboard bookmarks.'
            : 'Setup complete. You have {count} page(s) — organize them in config → Pages. Press + for the full bookmark form, or & for a quick add. Keyboard and mouse tips are in Help → Dashboard bookmarks.';
        let body = this.t(key, fallback);
        if (body.includes('{count}')) {
            body = body.replace('{count}', String(this.pagesCount));
        }
        return body;
    }

    buildStatusMonitoringStep() {
        const hasBookmarks = this.statusMonitorBookmarks.length > 0;
        const selector = document.querySelector('.health-link a')
            ? '.health-link a'
            : (document.querySelector('#dashboard-mini-status')
                ? '#dashboard-mini-status'
                : '#dashboard-layout');

        const step = {
            title: this.t('onboarding.statusMonitorStepTitle', 'Which bookmarks to monitor?'),
            body: hasBookmarks
                ? this.t(
                    'onboarding.statusMonitorStepBody',
                    'Status checks ping selected bookmarks in the background and show online/offline on each row. Optional — change anytime in config or on the health page.'
                )
                : this.t(
                    'onboarding.statusMonitorStepBodyEmpty',
                    'When you add bookmarks, enable status per row to see online/offline indicators. GitHub is a good example to try first. Visit the health page anytime for broken links.'
                ),
            selector,
            placement: 'bottom',
            optionalNote: this.t(
                'onboarding.statusMonitorStepOptional',
                'Optional — skip or leave all unchecked; status stays available in config.'
            ),
        };

        if (hasBookmarks) {
            step.fields = [
                {
                    id: 'statusMonitorSelection',
                    type: 'bookmark-checklist',
                    label: this.t('onboarding.statusMonitorListLabel', 'Monitor these bookmarks'),
                    maxItems: 10,
                    exampleUrl: 'https://github.com',
                    exampleHint: this.t(
                        'onboarding.statusMonitorGithubHint',
                        'Good example — pings reliably and shows how status dots work.'
                    ),
                },
            ];
        }

        return step;
    }

    getStatusMonitorBookmarkList(maxItems = 10) {
        const sorted = [...this.statusMonitorBookmarks].sort((a, b) => {
            const aGithub = String(a?.url || '').includes('github.com') ? 0 : 1;
            const bGithub = String(b?.url || '').includes('github.com') ? 0 : 1;
            if (aGithub !== bGithub) return aGithub - bGithub;
            return String(a?.name || '').localeCompare(String(b?.name || ''));
        });
        return sorted.slice(0, maxItems);
    }

    getStatusMonitorScopeNote(shownCount, totalCount) {
        if (totalCount <= shownCount) {
            if (this.usesAllPagesStatusMonitor && this.pagesCount > 1) {
                return this.t(
                    'onboarding.statusMonitorAllPagesNote',
                    'Bookmarks from all pages — enable more per bookmark in config → Bookmarks.'
                );
            }
            return '';
        }
        const template = this.t(
            'onboarding.statusMonitorTruncatedNote',
            'Showing {shown} of {total} bookmarks across all pages. Enable more per bookmark in config → Bookmarks.'
        );
        return template
            .replace('{shown}', String(shownCount))
            .replace('{total}', String(totalCount));
    }

    getPageLabel(pageId) {
        const page = this.pages.find((entry) => String(entry.id) === String(pageId));
        if (page?.name) return page.name;
        return this.t('onboarding.statusMonitorPageFallback', 'Page {id}').replace('{id}', String(pageId));
    }

    buildStatusMonitorSelection(bookmarks) {
        const selection = {};
        bookmarks.forEach((bookmark) => {
            if (bookmark?.url) {
                selection[bookmark.url] = bookmark.checkStatus === true;
            }
        });
        return selection;
    }

    buildMobileSteps() {
        return [
            {
                title: this.t('onboarding.mobileWelcomeTitle', 'Welcome to nextDash'),
                body: this.t(
                    'onboarding.mobileWelcomeBody',
                    'Quick mobile setup — language and theme. Full settings are available on a computer or tablet.'
                ),
                selector: '.header-top',
                primaryLabel: this.t('onboarding.startSetup', 'Start setup')
            },
            {
                title: this.t('onboarding.mobileLanguageThemeTitle', 'Language & theme'),
                body: this.t('onboarding.mobileLanguageThemeBody', 'Pick your language and dashboard theme.'),
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
                        id: 'theme',
                        type: 'select',
                        label: this.t('onboarding.mobileThemeLabel', 'Theme'),
                        options: [
                            { value: 'cherry-graphite-dark', label: this.t('onboarding.mobileThemeDark', 'Dark') },
                            { value: 'cherry-graphite-light', label: this.t('onboarding.mobileThemeLight', 'Light') },
                            { value: 'ocean-dark', label: this.t('onboarding.mobileThemeOceanDark', 'Ocean dark') },
                            { value: 'ocean-light', label: this.t('onboarding.mobileThemeOceanLight', 'Ocean light') }
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
                    }
                ]
            },
            {
                title: this.t('onboarding.mobileFinishTitle', 'Ready on mobile'),
                body: this.t(
                    'onboarding.mobileFinishBody',
                    'Use search to open bookmarks. Swipe left or right to switch pages. Open config on a computer for full settings.'
                ),
                selector: '#search-button',
                placement: 'top',
                primaryLabel: this.t('onboarding.finishSetup', 'Finish setup')
            }
        ];
    }

    buildInitialSettings(settings) {
        return {
            language: settings.language || 'en',
            theme: settings.theme || 'cherry-graphite-dark',
            openInNewTab: settings.openInNewTab !== false,
            autoDarkMode: settings.autoDarkMode !== false,
            showWeatherWithDate: settings.showWeatherWithDate === true,
            weatherSource: settings.weatherSource || 'manual',
            weatherLocation: settings.weatherLocation || '',
            packedColumns: settings.packedColumns !== false,
            interleaveMode: settings.interleaveMode === true,
            showTips: settings.onboardingCompleted ? (settings.showTips !== false) : true,
            showSmartTodayCollection: settings.showSmartTodayCollection === true,
            showSmartMostUsedCollection: settings.showSmartMostUsedCollection === true,
            statusMonitorSelection: this.buildStatusMonitorSelection(this.statusMonitorBookmarks),
            layoutVersion: 'classic',
        };
    }

    render() {
        if (this.overlay) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        document.body.appendChild(overlay);
        this.overlay = overlay;

        // Card is appended directly to body so it sits above the highlighted element
        // (highlight z-index 2201, card z-index 2202).
        const card = document.createElement('div');
        card.className = 'onboarding-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-live', 'polite');
        card.innerHTML = `
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
        `;
        document.body.appendChild(card);
        this.card = card;

        card.querySelector('.onboarding-back').addEventListener('click', () => this.prevStep());
        card.querySelector('.onboarding-skip').addEventListener('click', () => this.finish());
        card.querySelector('.onboarding-next').addEventListener('click', () => this.nextStep());

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

        const title = this.card.querySelector('.onboarding-title');
        const body = this.card.querySelector('.onboarding-body');
        const progress = this.card.querySelector('.onboarding-progress');
        const fields = this.card.querySelector('.onboarding-fields');
        const back = this.card.querySelector('.onboarding-back');
        const next = this.card.querySelector('.onboarding-next');
        const secondary = this.card.querySelector('.onboarding-secondary');

        title.textContent = step.title;
        body.textContent = step.body;
        if (step.optionalNote) {
            body.textContent = `${step.body} ${step.optionalNote}`;
        }
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
            if (field.type === 'bookmark-checklist') {
                const maxItems = field.maxItems || 10;
                const items = this.getStatusMonitorBookmarkList(maxItems);
                const totalCount = this.statusMonitorBookmarks.length;
                const scopeNote = this.getStatusMonitorScopeNote(items.length, totalCount);
                const selection = this.localSettings.statusMonitorSelection || {};
                const showPageLabels = this.usesAllPagesStatusMonitor && this.pagesCount > 1;
                return `
                    <fieldset class="onboarding-fieldset onboarding-bookmark-checklist" data-field-id="${field.id}">
                        <legend class="onboarding-field-label">${field.label}</legend>
                        ${scopeNote ? `<p class="onboarding-status-monitor-scope-note">${scopeNote}</p>` : ''}
                        <div class="onboarding-bookmark-checklist-items">
                            ${items.map((bookmark) => {
                                const url = bookmark.url || '';
                                const checked = selection[url] === true;
                                const isExample = field.exampleUrl && url.replace(/\/$/, '') === field.exampleUrl.replace(/\/$/, '');
                                const pageLabel = showPageLabels
                                    ? `<span class="onboarding-bookmark-check-page">${this.escapeHtml(this.getPageLabel(bookmark.pageId))}</span>`
                                    : '';
                                return `
                                    <label class="onboarding-bookmark-check-option${isExample ? ' is-example' : ''}">
                                        <input
                                            type="checkbox"
                                            data-monitor-url="${this.escapeHtml(url)}"
                                            ${checked ? 'checked' : ''}
                                        >
                                        <span class="onboarding-bookmark-check-label">
                                            <span class="onboarding-bookmark-check-name">${this.escapeHtml(bookmark.name || url)}</span>
                                            ${pageLabel}
                                            ${isExample && field.exampleHint
                                                ? `<span class="onboarding-bookmark-check-hint">${field.exampleHint}</span>`
                                                : ''}
                                        </span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </fieldset>
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
            if (field.type === 'bookmark-checklist') {
                const selection = { ...(this.localSettings.statusMonitorSelection || {}) };
                container.querySelectorAll('[data-monitor-url]').forEach((checkbox) => {
                    const url = checkbox.getAttribute('data-monitor-url');
                    if (!url) return;
                    checkbox.addEventListener('change', () => {
                        selection[url] = checkbox.checked;
                        this.localSettings.statusMonitorSelection = selection;
                    });
                });
            }
        });

        this.refreshDependentFields(container);
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    refreshDependentFields(container) {
        const weatherLocationInput = container.querySelector('[data-field-id="weatherLocation"]');
        if (weatherLocationInput) {
            weatherLocationInput.disabled = this.localSettings.showWeatherWithDate !== true || this.localSettings.weatherSource !== 'manual';
        }
    }

    parseFieldValue(fieldId, value) {
        if (['openInNewTab', 'autoDarkMode', 'showWeatherWithDate', 'packedColumns', 'interleaveMode', 'showTips', 'showSmartTodayCollection', 'showSmartMostUsedCollection'].includes(fieldId)) {
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
        const fieldsContainer = this.card.querySelector('.onboarding-fields');
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
                return;
            }
            if (field.type === 'bookmark-checklist') {
                const selection = { ...(this.localSettings.statusMonitorSelection || {}) };
                fieldsContainer.querySelectorAll('[data-monitor-url]').forEach((checkbox) => {
                    const url = checkbox.getAttribute('data-monitor-url');
                    if (!url) return;
                    selection[url] = checkbox.checked;
                });
                this.localSettings.statusMonitorSelection = selection;
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
            this.highlightedElement.classList.remove('onboarding-highlight');
            this.highlightedElement = null;
        }
        if (!selector) {
            return;
        }
        let element = null;
        selector.split(',').map((part) => part.trim()).some((part) => {
            const candidate = document.querySelector(part);
            if (candidate) {
                element = candidate;
                return true;
            }
            return false;
        });
        if (!element) {
            return;
        }
        // Als het element verborgen is (bijv. button-hint in side-dock modus),
        // val terug op de button-container zelf.
        if (element.offsetParent === null && element.id === 'button-hint-text') {
            element = document.querySelector('.button-container') || element;
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

        const settingsPatch = {
            language: this.localSettings.language,
            theme: this.localSettings.theme,
            openInNewTab: this.localSettings.openInNewTab,
            autoDarkMode: this.localSettings.autoDarkMode,
            showWeatherWithDate: this.localSettings.showWeatherWithDate,
            weatherSource: this.localSettings.weatherSource,
            weatherLocation: this.localSettings.weatherLocation,
            packedColumns: this.localSettings.packedColumns,
            interleaveMode: this.localSettings.interleaveMode,
            showTips: this.localSettings.showTips,
            showSmartTodayCollection: this.localSettings.showSmartTodayCollection,
            showSmartMostUsedCollection: this.localSettings.showSmartMostUsedCollection,
            layoutVersion: 'classic',
        };
        const bookmarkSelection = { ...(this.localSettings.statusMonitorSelection || {}) };
        const shouldApplyBookmarks = this.onApplyBookmarks && this.statusMonitorBookmarks.length > 0;

        // Close the tour first so Skip/Finish never leaves the UI locked if callbacks throw.
        this.teardownUi();

        try {
            if (this.onPersist && !this.persisted) {
                window.TipsPolicy?.markOnboardingEnded?.();
            }

            Object.assign(this.settings, settingsPatch);

            if (this.onApplySettings) {
                this.onApplySettings(this.settings);
            }

            if (shouldApplyBookmarks) {
                Promise.resolve(this.onApplyBookmarks(bookmarkSelection, {
                    scope: this.usesAllPagesStatusMonitor ? 'all' : 'page',
                })).catch(() => {});
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
        } catch (error) {
            console.error('Onboarding finish failed:', error);
        }
    }

    teardownUi() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('onboarding-highlight');
            this.highlightedElement = null;
        }
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
        window.GuidedFlowGuard?.sync?.();
    }
}

window.Onboarding = Onboarding;
