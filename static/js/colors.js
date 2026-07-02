/**
 * Theme colors editor — embedded in Config (#colors tab) or legacy standalone page.
 */
class ColorsEditor {
    constructor(options = {}) {
        this.root = options.root || document.getElementById('theme-colors-editor');
        this.language = options.language || null;
        this.onDirtyChange = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : () => {};
        this.settings = options.settings || {};
        this.colorsData = { light: {}, dark: {}, builtIn: {}, custom: {} };
        this.customThemesManager = null;
        this.currentPreviewTheme = 'custom';
        this.currentBuiltInTheme = null;
        this.hasUnsavedColorChanges = false;
        this._initialized = false;
        this._bound = false;
        this._initPromise = null;
        this._undoStack = [];
        this._undoMax = 40;
        this._structureAutosaveTimer = null;
        this._subTabButtons = [];
    }

    static CUSTOM_THEME_STORAGE_KEY = 'nextdash:colors-custom-theme-id';
    static BUILTIN_THEME_STORAGE_KEY = 'nextdash:colors-builtin-theme-id';

    t(key, fallback) {
        if (this.language?.t) {
            const val = this.language.t(key);
            if (typeof val === 'string' && val !== key) return val;
        }
        return fallback || key;
    }

    isReadonly() {
        return Boolean(window.MobileExperience?.isMobileLayout?.());
    }

    markDirty() {
        this.hasUnsavedColorChanges = true;
        this.root?.querySelector('#save-colors-btn')?.classList.add('has-unsaved');
        this.onDirtyChange(true);
        this.updateUndoButton();
    }

    clearDirty() {
        this.hasUnsavedColorChanges = false;
        this.root?.querySelector('#save-colors-btn')?.classList.remove('has-unsaved');
        this.onDirtyChange(false);
        this._undoStack = [];
        this.updateUndoButton();
    }

    isDirty() {
        return this.hasUnsavedColorChanges;
    }

    clearPreviewStyle() {
        document.getElementById('color-preview-style')?.remove();
    }

    scheduleStructureAutosave() {
        if (this.isReadonly()) return;
        clearTimeout(this._structureAutosaveTimer);
        this._structureAutosaveTimer = setTimeout(() => {
            void this.autosaveThemeStructure();
        }, 800);
    }

    pushUndoSnapshot() {
        if (this.isReadonly()) return;
        try {
            const snap = JSON.stringify(this.colorsData);
            const last = this._undoStack[this._undoStack.length - 1];
            if (last === snap) return;
            this._undoStack.push(snap);
            if (this._undoStack.length > this._undoMax) this._undoStack.shift();
            this.updateUndoButton();
        } catch { /* ignore */ }
    }

    updateUndoButton() {
        const btn = this.root?.querySelector('#undo-colors-btn');
        if (!btn) return;
        btn.disabled = this._undoStack.length === 0 || this.isReadonly();
    }

    undo() {
        if (this.isReadonly() || this._undoStack.length === 0) return;
        const snap = this._undoStack.pop();
        try {
            this.colorsData = JSON.parse(snap);
            this.populateColorInputs();
            if (this.customThemesManager) {
                this.customThemesManager.render(this.colorsData.custom || {});
                this.customThemesManager.updateThemeSelector(this.colorsData.custom || {});
                if (this.customThemesManager.currentSelectedTheme) {
                    const id = this.customThemesManager.currentSelectedTheme;
                    if (this.colorsData.custom?.[id]) {
                        this.customThemesManager.showThemeColors(this.colorsData.custom[id]);
                    }
                }
            }
            this.renderBuiltInSelector();
            if (this.currentBuiltInTheme && this.colorsData.builtIn?.[this.currentBuiltInTheme]) {
                this.populateBuiltInColorInputs(this.colorsData.builtIn[this.currentBuiltInTheme]);
            }
            this.applyColorsToPreview();
            this.updateContrastHints();
            this.markDirty();
            this.updateUndoButton();
        } catch (e) {
            console.error('Undo failed', e);
        }
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        if (!this.root) return;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    async _doInit() {
        if (this._initialized) return;

        this.customThemesManager = new ConfigCustomThemes(() => {}, this.t.bind(this));
        this.injectPalettePreviews();
        this.initSubTabs();
        this.setupBuiltInSelector();
        this.bindEvents();
        this.applyReadonlyMode();
        await this.loadColors();
        this.customThemesManager.setupThemeSelector(this.colorsData.custom);
        this.restoreCustomThemeSelection();
        this.applyInitialSubTab();
        this._initialized = true;

        if (window.installThemeColorsInfoButtons && window.configManager?.settings) {
            window.installThemeColorsInfoButtons(window.configManager.settings);
        } else if (this.language?.applyTranslations) {
            this.language.applyTranslations();
        }
    }

    applyReadonlyMode() {
        const readonly = this.isReadonly();
        this.root?.classList.toggle('theme-colors-editor--readonly', readonly);
        const banner = this.root?.querySelector('#colors-mobile-readonly-banner');
        if (banner) banner.hidden = !readonly;
        this.root?.querySelectorAll('input, select, button').forEach((el) => {
            if (el.id === 'colors-import-file') return;
            if (el.classList.contains('colors-tab-button')) return;
            if (el.closest('#colors-mobile-readonly-banner')) return;
            if (el.classList.contains('colors-readonly-allowed')) return;
            if (readonly) {
                if (el.tagName === 'BUTTON') el.disabled = true;
                else el.setAttribute('disabled', 'disabled');
            } else if (el.id !== 'undo-colors-btn') {
                if (el.tagName === 'BUTTON') el.disabled = false;
                else el.removeAttribute('disabled');
            }
        });
        this.updateUndoButton();
    }

    injectPalettePreviews() {
        const source = this.root?.querySelector('#theme-preview-card');
        if (!source) return;
        ['dark', 'light'].forEach((tab) => {
            const panel = this.root.querySelector(`[data-colors-tab-panel="${tab}"] .config-section`);
            if (!panel || panel.querySelector(`#colors-palette-live-preview-${tab}`)) return;
            const clone = source.cloneNode(true);
            clone.id = `colors-palette-live-preview-${tab}`;
            clone.classList.add('colors-palette-live-preview');
            const hint = panel.querySelector('.colors-panel-hint');
            if (hint) hint.after(clone);
            else panel.prepend(clone);
        });
    }

    applyInitialSubTab() {
        const hash = window.location.hash.replace(/^#/, '');
        const match = hash.match(/^colors(?:\/(dark|light|custom|builtin))?$/);
        const sub = match?.[1] || sessionStorage.getItem('nextdash:colors-subtab') || 'custom';
        this.switchSubTab(sub, { updateHash: false });
    }

    initSubTabs() {
        this._subTabButtons = [...this.root.querySelectorAll('.colors-tab-button')];
        const panelIds = { dark: 'colors-tab-panel-dark', light: 'colors-tab-panel-light', custom: 'colors-tab-panel-custom', builtin: 'colors-tab-panel-builtin' };
        this._subTabButtons.forEach((btn, index) => {
            const tab = btn.getAttribute('data-colors-tab');
            btn.setAttribute('role', 'tab');
            btn.setAttribute('id', `colors-tab-${tab}`);
            const panelId = panelIds[tab];
            if (panelId) {
                btn.setAttribute('aria-controls', panelId);
                const panel = this.root.querySelector(`[data-colors-tab-panel="${tab}"]`);
                if (panel) {
                    panel.setAttribute('role', 'tabpanel');
                    panel.id = panelId;
                    panel.setAttribute('aria-labelledby', `colors-tab-${tab}`);
                }
            }
            btn.addEventListener('click', () => this.switchSubTab(tab));
            btn.addEventListener('keydown', (e) => this.onSubTabKeydown(e, index));
        });
        const tablist = this.root.querySelector('.colors-subtabs');
        if (tablist) {
            tablist.setAttribute('data-i18n-aria', 'colors.palettesTablistAria');
            if (this.language?.applyTranslations) this.language.applyTranslations();
        }
    }

    onSubTabKeydown(e, index) {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        let next = index;
        if (e.key === 'ArrowLeft') next = (index - 1 + this._subTabButtons.length) % this._subTabButtons.length;
        if (e.key === 'ArrowRight') next = (index + 1) % this._subTabButtons.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = this._subTabButtons.length - 1;
        this._subTabButtons[next]?.focus();
        this.switchSubTab(this._subTabButtons[next].getAttribute('data-colors-tab'));
    }

    switchSubTab(targetTab, { updateHash = true } = {}) {
        const valid = ['dark', 'light', 'custom', 'builtin'];
        if (!valid.includes(targetTab)) return;

        this._subTabButtons.forEach((btn) => {
            const active = btn.getAttribute('data-colors-tab') === targetTab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.tabIndex = active ? 0 : -1;
        });

        this.root.querySelectorAll('.colors-tab-panel').forEach((panel) => {
            const show = panel.getAttribute('data-colors-tab-panel') === targetTab;
            panel.hidden = !show;
            panel.classList.toggle('active', show);
        });

        if (targetTab === 'dark' || targetTab === 'light') {
            this.currentPreviewTheme = targetTab;
            this.applyColorsToPreview();
        } else if (targetTab === 'custom') {
            this.currentPreviewTheme = 'custom';
            const selector = this.root.querySelector('#custom-theme-selector');
            if (selector && !selector.value && this.customThemesManager) {
                this.customThemesManager.currentSelectedTheme = null;
                this.customThemesManager.hideThemeColors();
                this.clearPreviewStyle();
            } else {
                this.applyColorsToPreview();
            }
        } else if (targetTab === 'builtin') {
            this.currentPreviewTheme = 'builtin';
            this.applyColorsToPreview();
        }

        try {
            sessionStorage.setItem('nextdash:colors-subtab', targetTab);
        } catch (_) { /* ignore */ }

        if (updateHash && window.configManager?.ui?._currentTab === 'colors') {
            window.location.hash = (targetTab === 'custom') ? '#colors' : `#colors/${targetTab}`;
        }

        if (window.configManager?.ui?._currentTab === 'colors') {
            window.configManager.ui.updateBreadcrumb('colors');
        }
    }

    getPreviewScopeSelector() {
        if (this.currentPreviewTheme === 'custom') return '#theme-preview-card';
        if (this.currentPreviewTheme === 'builtin') return '#builtin-theme-preview-card';
        if (this.currentPreviewTheme === 'dark' || this.currentPreviewTheme === 'light') {
            return `#colors-palette-live-preview-${this.currentPreviewTheme}`;
        }
        return null;
    }

    async reloadIfStale() {
        if (this.isDirty() || this.isReadonly()) return;
        await this.loadColors();
    }

    async loadColors() {
        try {
            const response = await fetch('/api/colors');
            if (!response.ok) throw new Error('Failed to load colors');
            this.colorsData = await response.json();
            if (!this.colorsData.custom) this.colorsData.custom = {};
            if (!this.colorsData.builtIn) this.colorsData.builtIn = {};
            this.populateColorInputs();
            if (this.customThemesManager) {
                this.customThemesManager.render(this.colorsData.custom);
                this.customThemesManager.updateThemeSelector(this.colorsData.custom);
            }
            this.renderBuiltInSelector();
            this.applyColorsToPreview();
            this.updateContrastHints();
            this.clearDirty();
        } catch (error) {
            console.error('Error loading colors:', error);
            this.showErrorWithReload(this.t('colors.errorLoadingColors', 'Failed to load colors'));
        }
    }

    restoreCustomThemeSelection() {
        try {
            const stored = sessionStorage.getItem(ColorsEditor.CUSTOM_THEME_STORAGE_KEY);
            const selector = this.root?.querySelector('#custom-theme-selector');
            if (!stored || !selector || !this.colorsData.custom?.[stored]) return;
            selector.value = stored;
            this.customThemesManager.currentSelectedTheme = stored;
            this.customThemesManager.showThemeColors(this.colorsData.custom[stored]);
            selector.__customSelectInstance?.refresh?.();
            this.currentPreviewTheme = 'custom';
            this.applyColorsToPreview();
        } catch { /* ignore */ }
    }

    persistCustomThemeSelection(themeId) {
        try {
            if (themeId) sessionStorage.setItem(ColorsEditor.CUSTOM_THEME_STORAGE_KEY, themeId);
            else sessionStorage.removeItem(ColorsEditor.CUSTOM_THEME_STORAGE_KEY);
        } catch { /* ignore */ }
    }

    renderBuiltInSelector() {
        const selector = this.root?.querySelector('#builtin-theme-selector');
        if (!selector) return;
        const current = selector.value || this.currentBuiltInTheme;
        const label = this.t('colors.selectBuiltInTheme', 'Select a packaged theme');
        selector.innerHTML = `<option value="">${label}</option>`;
        Object.keys(this.colorsData.builtIn || {}).sort().forEach((id) => {
            const theme = this.colorsData.builtIn[id];
            const option = document.createElement('option');
            option.value = id;
            option.textContent = theme?.name || id;
            selector.appendChild(option);
        });
        if (current && this.colorsData.builtIn?.[current]) {
            selector.value = current;
            this.currentBuiltInTheme = current;
            this.populateBuiltInColorInputs(this.colorsData.builtIn[current]);
        }
        selector.__customSelectInstance?.refresh?.();
    }

    setupBuiltInSelector() {
        const selector = this.root?.querySelector('#builtin-theme-selector');
        if (!selector || selector.dataset.bound === '1') return;
        selector.dataset.bound = '1';
        selector.addEventListener('change', (e) => {
            const id = e.target.value;
            this.currentBuiltInTheme = id || null;
            try {
                if (id) sessionStorage.setItem(ColorsEditor.BUILTIN_THEME_STORAGE_KEY, id);
                else sessionStorage.removeItem(ColorsEditor.BUILTIN_THEME_STORAGE_KEY);
            } catch { /* ignore */ }
            const section = this.root.querySelector('#builtin-theme-colors-section');
            if (!id || !this.colorsData.builtIn?.[id]) {
                if (section) section.hidden = true;
                this.clearPreviewStyle();
                return;
            }
            if (section) section.hidden = false;
            this.populateBuiltInColorInputs(this.colorsData.builtIn[id]);
            this.currentPreviewTheme = 'builtin';
            this.applyColorsToPreview();
            this.updateContrastHints();
        });
        try {
            const stored = sessionStorage.getItem(ColorsEditor.BUILTIN_THEME_STORAGE_KEY);
            if (stored && this.colorsData.builtIn?.[stored]) {
                selector.value = stored;
                this.currentBuiltInTheme = stored;
            }
        } catch { /* ignore */ }
    }

    populateBuiltInColorInputs(themeColors) {
        this.root.querySelectorAll('input[data-theme="builtin"][data-prop]').forEach((input) => {
            const prop = input.dataset.prop;
            const value = themeColors?.[prop] || '';
            if (input.type === 'color') {
                if (value && value.startsWith('#')) input.value = value;
                const textInput = this.root.querySelector(`#${input.id}-text`);
                if (textInput) textInput.value = value;
            } else {
                input.value = value;
            }
            window.ColorValueUtils?.validateTextInput(input.classList.contains('color-text-input') ? input : this.root.querySelector(`#${input.id}-text`));
        });
    }

    populateColorInputs() {
        this.root.querySelectorAll('input[data-theme][data-prop]').forEach((input) => {
            const theme = input.dataset.theme;
            if (theme === 'custom' || theme === 'builtin') return;
            const prop = input.dataset.prop;
            const bucket = this.colorsData[theme];
            const value = bucket?.[prop];

            if (input.type === 'color') {
                if (value && value.startsWith('#')) input.value = value;
                const textInput = this.root.querySelector(`#${input.id}-text`);
                if (textInput) textInput.value = value || '';
            } else if (input.type === 'text') {
                input.value = value || '';
            }
            const textEl = input.classList.contains('color-text-input') || input.classList.contains('color-text-input-full')
                ? input
                : this.root.querySelector(`#${input.id}-text`);
            window.ColorValueUtils?.validateTextInput(textEl);
        });
    }

    updateColorValue(theme, prop, value) {
        this.pushUndoSnapshot();
        if (theme === 'custom') {
            if (this.customThemesManager?.currentSelectedTheme) {
                this.customThemesManager.updateColorValue(this.colorsData.custom, prop, value);
            }
        } else if (theme === 'builtin') {
            if (this.currentBuiltInTheme && this.colorsData.builtIn?.[this.currentBuiltInTheme]) {
                this.colorsData.builtIn[this.currentBuiltInTheme][prop] = value;
            }
        } else {
            if (!this.colorsData[theme]) this.colorsData[theme] = {};
            this.colorsData[theme][prop] = value;
            this.currentPreviewTheme = theme;
        }
        this.applyColorsToPreview();
        this.updateContrastHints();
    }

    applyColorsToPreview() {
        let colors;
        if (this.currentPreviewTheme === 'custom' && this.customThemesManager?.currentSelectedTheme) {
            colors = this.colorsData.custom[this.customThemesManager.currentSelectedTheme];
        } else if (this.currentPreviewTheme === 'builtin' && this.currentBuiltInTheme) {
            colors = this.colorsData.builtIn[this.currentBuiltInTheme];
        } else if (this.currentPreviewTheme === 'custom') {
            this.clearPreviewStyle();
            return;
        } else {
            colors = this.colorsData[this.currentPreviewTheme];
        }
        if (!colors) {
            this.clearPreviewStyle();
            return;
        }

        const scope = this.getPreviewScopeSelector();
        if (!scope || !document.querySelector(scope)) {
            this.clearPreviewStyle();
            return;
        }

        const vars = window.ColorValueUtils?.buildVarsBlock(colors) || '';
        let previewStyle = document.getElementById('color-preview-style');
        previewStyle?.remove();
        previewStyle = document.createElement('style');
        previewStyle.id = 'color-preview-style';
        previewStyle.textContent = `${scope} { ${vars} }`;
        document.head.appendChild(previewStyle);
    }

    updateContrastHints() {
        const hint = this.root?.querySelector('#colors-contrast-hint');
        if (!hint || !window.ColorValueUtils?.contrastRatio) return;
        let colors;
        if (this.currentPreviewTheme === 'custom' && this.customThemesManager?.currentSelectedTheme) {
            colors = this.colorsData.custom[this.customThemesManager.currentSelectedTheme];
        } else if (this.currentPreviewTheme === 'builtin' && this.currentBuiltInTheme) {
            colors = this.colorsData.builtIn[this.currentBuiltInTheme];
        } else if (this.currentPreviewTheme === 'dark' || this.currentPreviewTheme === 'light') {
            colors = this.colorsData[this.currentPreviewTheme];
        }
        if (!colors?.textPrimary || !colors?.backgroundPrimary) {
            hint.hidden = true;
            return;
        }
        const ratio = window.ColorValueUtils.contrastRatio(colors.textPrimary, colors.backgroundPrimary);
        if (ratio == null || ratio >= 4.5) {
            hint.hidden = true;
            return;
        }
        hint.hidden = false;
        hint.textContent = this.t('colors.contrastWarning', 'Low contrast between primary text and background ({ratio}:1).').replace('{ratio}', ratio.toFixed(1));
    }

    reloadThemeCSS() {
        const link = document.querySelector('link[href^="/api/theme.css"]');
        if (link) {
            const newLink = link.cloneNode();
            newLink.href = `/api/theme.css?${Date.now()}`;
            link.parentNode.replaceChild(newLink, link);
        }
    }

    showNotification(message, type = 'info') {
        window.AppNotification?.show(message, type, { durationMs: 3000 });
    }

    showErrorWithReload(message) {
        if (window.AppNotification?.showErrorWithReload) {
            window.AppNotification.showErrorWithReload(message);
        } else {
            this.showNotification(message, 'error');
        }
    }

    async saveColors() {
        if (this.isReadonly()) return;
        if (!this.validateAllColorInputs()) {
            this.showNotification(this.t('colors.invalidColorValue', 'Fix invalid color values before saving.'), 'error');
            return;
        }
        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/colors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.colorsData)
            });
            if (!response.ok) throw new Error('Failed to save colors');
            this.showNotification(this.t('colors.colorsSaved', 'Colors saved'), 'success');
            this.clearPreviewStyle();
            this.reloadThemeCSS();
            this.applyColorsToPreview();
            this.clearDirty();
            if (window.configManager?.settings) {
                await window.configManager.settings.loadCustomThemes();
                window.configManager.settings.populateThemeSelect?.();
                window.configManager.settings.updateAutoDarkModeAvailability?.(
                    window.configManager.settingsData?.theme,
                    window.configManager.settingsData,
                    window.configManager.settings._settingsCallbacks || {}
                );
            }
        } catch (error) {
            console.error('Error saving colors:', error);
            this.showErrorWithReload(this.t('colors.errorSavingColors', 'Failed to save colors'));
        }
    }

    validateAllColorInputs() {
        let ok = true;
        this.root.querySelectorAll('.color-text-input, .color-text-input-full').forEach((input) => {
            if (!window.ColorValueUtils?.validateTextInput(input)) ok = false;
        });
        return ok;
    }

    async autosaveThemeStructure() {
        if (this.isReadonly()) return;
        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/colors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.colorsData)
            });
            if (!response.ok) throw new Error('Failed to autosave');
            this.clearDirty();
            if (window.configManager?.settings) {
                await window.configManager.settings.loadCustomThemes();
                window.configManager.settings.populateThemeSelect?.();
                window.configManager.settings.updateAutoDarkModeAvailability?.(
                    window.configManager.settingsData?.theme,
                    window.configManager.settingsData,
                    window.configManager.settings._settingsCallbacks || {}
                );
            }
        } catch (error) {
            console.error('Error autosaving theme structure:', error);
            this.showErrorWithReload(this.t('colors.errorSavingColors', 'Failed to save colors'));
        }
    }

    async resetColors() {
        if (this.isReadonly()) return;
        const confirmed = await window.AppModal.danger({
            title: this.t('colors.resetColorsTitle', 'Reset colors'),
            message: this.t('colors.resetColorsMessage', 'Reset all theme colors to defaults?'),
            confirmText: this.t('config.reset', 'Reset'),
            cancelText: this.t('config.cancel', 'Cancel')
        });
        if (!confirmed) return;

        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/colors/reset', {
                method: 'POST',
            });
            if (!response.ok) throw new Error('Failed to reset');
            this.colorsData = await response.json();
            this.populateColorInputs();
            this.clearPreviewStyle();
            this.reloadThemeCSS();
            this.applyColorsToPreview();
            if (this.customThemesManager) {
                this.customThemesManager.render(this.colorsData.custom || {});
                this.customThemesManager.updateThemeSelector(this.colorsData.custom || {});
            }
            this.renderBuiltInSelector();
            this.showNotification(this.t('colors.colorsReset', 'Colors reset'), 'success');
            this.clearDirty();
        } catch (error) {
            console.error('Error resetting colors:', error);
            this.showErrorWithReload(this.t('colors.errorResettingColors', 'Failed to reset colors'));
        }
    }

    exportCurrentTheme() {
        let payload;
        let filename = 'nextdash-theme.json';
        if (this.currentPreviewTheme === 'custom' && this.customThemesManager?.currentSelectedTheme) {
            const id = this.customThemesManager.currentSelectedTheme;
            payload = { custom: { [id]: this.colorsData.custom[id] } };
            filename = `nextdash-${id}.json`;
        } else if (this.currentPreviewTheme === 'builtin' && this.currentBuiltInTheme) {
            const id = this.currentBuiltInTheme;
            payload = { builtIn: { [id]: this.colorsData.builtIn[id] } };
            filename = `nextdash-builtin-${id}.json`;
        } else if (this.currentPreviewTheme === 'dark' || this.currentPreviewTheme === 'light') {
            payload = { [this.currentPreviewTheme]: this.colorsData[this.currentPreviewTheme] };
            filename = `nextdash-${this.currentPreviewTheme}.json`;
        } else {
            payload = this.colorsData;
            filename = 'nextdash-colors.json';
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    async importThemeFile(file) {
        if (this.isReadonly() || !file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (data.custom && typeof data.custom === 'object') {
                Object.assign(this.colorsData.custom, data.custom);
            } else if (data.builtIn && typeof data.builtIn === 'object') {
                Object.assign(this.colorsData.builtIn, data.builtIn);
            } else if (data.dark) {
                this.colorsData.dark = { ...this.colorsData.dark, ...data.dark };
            } else if (data.light) {
                this.colorsData.light = { ...this.colorsData.light, ...data.light };
            } else {
                throw new Error('Unrecognized format');
            }
            this.populateColorInputs();
            if (this.customThemesManager) {
                this.customThemesManager.render(this.colorsData.custom || {});
                this.customThemesManager.updateThemeSelector(this.colorsData.custom || {});
            }
            this.renderBuiltInSelector();
            this.applyColorsToPreview();
            this.markDirty();
            this.showNotification(this.t('colors.importSuccess', 'Theme imported — click Save colors to persist.'), 'success');
        } catch (e) {
            console.error(e);
            this.showNotification(this.t('colors.importError', 'Could not import theme file.'), 'error');
        }
    }

    addCustomTheme() {
        if (this.isReadonly()) return;
        if (!this.customThemesManager) return;
        if (!this.colorsData.custom || typeof this.colorsData.custom !== 'object') {
            this.colorsData.custom = {};
        }
        const starterTheme =
            (this.colorsData.builtIn && this.colorsData.builtIn['cherry-graphite-dark']) ||
            this.colorsData.dark ||
            this.colorsData.light ||
            {};
        const themeId = this.customThemesManager.add(this.colorsData.custom, { ...starterTheme });
        if (!themeId) return;

        this.customThemesManager.render(this.colorsData.custom);
        this.customThemesManager.updateThemeSelector(this.colorsData.custom);
        const selector = this.root.querySelector('#custom-theme-selector');
        if (selector) {
            selector.value = themeId;
            this.customThemesManager.currentSelectedTheme = themeId;
            this.persistCustomThemeSelection(themeId);
            this.customThemesManager.showThemeColors(this.colorsData.custom[themeId]);
            this.currentPreviewTheme = 'custom';
            this.applyColorsToPreview();
            selector.__customSelectInstance?.refresh?.();
        }
        this.switchSubTab('custom', { updateHash: true });
        this.markDirty();
        void this.autosaveThemeStructure();
    }

    async removeCustomTheme(themeId) {
        if (this.isReadonly()) return;
        if (!this.customThemesManager) return;
        const wasSelected = this.customThemesManager.currentSelectedTheme === themeId;
        const removed = await this.customThemesManager.remove(this.colorsData.custom, themeId);
        if (!removed) return;

        this.customThemesManager.render(this.colorsData.custom);
        this.customThemesManager.updateThemeSelector(this.colorsData.custom);
        if (wasSelected) {
            this.clearPreviewStyle();
            this.persistCustomThemeSelection('');
            const selector = this.root.querySelector('#custom-theme-selector');
            if (selector) {
                selector.value = '';
                selector.__customSelectInstance?.refresh?.();
            }
        }
        await this.autosaveThemeStructure();
    }

    reorderCustomTheme(themeId, direction) {
        if (this.isReadonly() || !this.colorsData.custom?.[themeId]) return;
        const ids = Object.keys(this.colorsData.custom);
        const index = ids.indexOf(themeId);
        if (index < 0) return;
        const swap = direction === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= ids.length) return;
        const order = [...ids];
        [order[index], order[swap]] = [order[swap], order[index]];
        const reordered = {};
        order.forEach((id) => {
            reordered[id] = this.colorsData.custom[id];
        });
        this.colorsData.custom = reordered;
        this.customThemesManager.render(this.colorsData.custom);
        this.markDirty();
        this.scheduleStructureAutosave();
    }

    async confirmLeave() {
        if (!this.hasUnsavedColorChanges) return true;
        if (!window.AppModal) {
            const ok = window.confirm(this.t('config.unsavedColorChangesLeaveConfirm', 'You have unsaved color changes. Leave anyway?'));
            if (ok) await this.loadColors();
            return ok;
        }

        const saveAndLeave = await window.AppModal.confirm({
            title: this.t('config.unsavedColorChangesTitle', 'Unsaved color changes'),
            message: this.t('config.unsavedColorChangesSavePrompt', 'Save color changes before leaving?'),
            confirmText: this.t('config.unsavedChangesSaveAndLeave', 'Save and leave'),
            cancelText: this.t('config.unsavedChangesMoreOptions', 'More options')
        });
        if (saveAndLeave) {
            await this.saveColors();
            return !this.hasUnsavedColorChanges;
        }

        const leave = await window.AppModal.danger({
            title: this.t('config.unsavedChangesLeaveTitle', 'Leave without saving?'),
            message: this.t('config.unsavedChangesLeaveMessage', 'Unsaved color changes will be lost.'),
            confirmText: this.t('config.unsavedChangesLeaveWithoutSaving', 'Leave without saving'),
            cancelText: this.t('config.unsavedChangesStayHere', 'Stay here')
        });
        if (leave) {
            await this.loadColors();
            this.clearPreviewStyle();
        }
        return leave;
    }

    bindColorInputHandlers() {
        const onChange = (theme, prop, value, textInput) => {
            window.ColorValueUtils?.validateTextInput(textInput);
            this.updateColorValue(theme, prop, value);
            this.markDirty();
        };

        this.root.querySelectorAll('input[type="color"][data-theme][data-prop]').forEach((input) => {
            const handler = (e) => {
                const theme = e.target.dataset.theme;
                const prop = e.target.dataset.prop;
                const value = e.target.value;
                const textInput = this.root.querySelector(`#${e.target.id}-text`);
                if (textInput) textInput.value = value;
                onChange(theme, prop, value, textInput);
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        });

        this.root.querySelectorAll('.color-text-input').forEach((input) => {
            const handler = (e) => {
                const colorPickerId = e.target.id.endsWith('-text') ? e.target.id.slice(0, -5) : e.target.id;
                const colorPicker = this.root.querySelector(`#${colorPickerId}`);
                if (!colorPicker) return;
                const theme = colorPicker.dataset.theme;
                const prop = colorPicker.dataset.prop;
                const value = e.target.value;
                if (value.startsWith('#') && (value.length === 7 || value.length === 4)) {
                    colorPicker.value = value;
                }
                onChange(theme, prop, value, e.target);
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handler(e);
                    input.blur();
                }
            });
        });

        this.root.querySelectorAll('.color-text-input-full').forEach((input) => {
            const handler = (e) => {
                onChange(e.target.dataset.theme, e.target.dataset.prop, e.target.value, e.target);
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handler(e);
                    input.blur();
                }
            });
        });
    }

    bindEvents() {
        if (this._bound) return;
        this._bound = true;

        this.root.querySelector('#save-colors-btn')?.addEventListener('click', () => this.saveColors());
        this.root.querySelector('#reset-colors-btn')?.addEventListener('click', () => this.resetColors());
        this.root.querySelector('#undo-colors-btn')?.addEventListener('click', () => this.undo());
        this.root.querySelector('#export-colors-btn')?.addEventListener('click', () => this.exportCurrentTheme());
        this.root.querySelector('#import-colors-btn')?.addEventListener('click', () => {
            this.root.querySelector('#colors-import-file')?.click();
        });
        this.root.querySelector('#colors-import-file')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            void this.importThemeFile(file);
            e.target.value = '';
        });

        this.bindColorInputHandlers();

        document.addEventListener('keydown', (e) => {
            if (window.configManager?.ui?._currentTab !== 'colors') return;
            if (window.ConfigTourRuntime?.shouldBlockConfigShortcuts?.()) return;
            if (this.isReadonly()) return;
            const inField = e.target.closest('input, textarea, select');
            if (e.key === 's' || e.key === 'S') {
                if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
                e.preventDefault();
                void this.saveColors();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            if (window.configManager?.ui?._currentTab !== 'colors') return;
            void this.reloadIfStale();
        });
    }
}

window.ColorsEditor = ColorsEditor;
window.switchToTheme = (theme) => {
    window.configManager?.colorsEditor?.switchSubTab(theme === 'custom' ? 'custom' : theme);
};

async function handleThemeColorsEditorClick(event) {
    const addBtn = event.target.closest('#add-custom-theme-btn');
    if (!addBtn || !addBtn.closest('#theme-colors-editor')) return;

    event.preventDefault();
    event.stopPropagation();

    try {
        await window.configManager?.ensureColorsEditor?.();
        window.configManager?.colorsEditor?.addCustomTheme?.();
    } catch (error) {
        console.error('Add custom theme failed:', error);
    }
}

if (!window.__themeColorsEditorClickBound) {
    window.__themeColorsEditorClickBound = true;
    document.addEventListener('click', handleThemeColorsEditorClick);
}
