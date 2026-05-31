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
        this.hasUnsavedColorChanges = false;
        this._initialized = false;
        this._bound = false;
        this._initPromise = null;
    }

    t(key, fallback) {
        if (this.language?.t) {
            const val = this.language.t(key);
            if (typeof val === 'string' && val !== key) return val;
        }
        return fallback || key;
    }

    markDirty() {
        this.hasUnsavedColorChanges = true;
        const badge = this.root?.querySelector('#colors-unsaved-indicator');
        if (badge) badge.hidden = false;
        this.onDirtyChange(true);
    }

    clearDirty() {
        this.hasUnsavedColorChanges = false;
        const badge = this.root?.querySelector('#colors-unsaved-indicator');
        if (badge) badge.hidden = true;
        this.onDirtyChange(false);
    }

    isDirty() {
        return this.hasUnsavedColorChanges;
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
        this.initSubTabs();
        this.bindEvents();
        await this.loadColors();
        this.customThemesManager.setupThemeSelector(this.colorsData.custom);
        this.applyInitialSubTab();
        this._initialized = true;
    }

    applyInitialSubTab() {
        const hash = window.location.hash.replace(/^#/, '');
        const match = hash.match(/^colors(?:\/(dark|light|custom))?$/);
        const sub = match?.[1] || sessionStorage.getItem('nextdash:colors-subtab') || 'custom';
        this.switchSubTab(sub, { updateHash: false });
    }

    initSubTabs() {
        const buttons = this.root.querySelectorAll('.colors-tab-button');
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                this.switchSubTab(btn.getAttribute('data-colors-tab'));
            });
        });
    }

    switchSubTab(targetTab, { updateHash = true } = {}) {
        const valid = ['dark', 'light', 'custom'];
        if (!valid.includes(targetTab)) return;

        this.root.querySelectorAll('.colors-tab-button').forEach((btn) => {
            const active = btn.getAttribute('data-colors-tab') === targetTab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
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
                document.getElementById('color-preview-style')?.remove();
            }
        }

        try {
            sessionStorage.setItem('nextdash:colors-subtab', targetTab);
        } catch (_) { /* ignore */ }

        if (updateHash && window.configManager?.ui?._currentTab === 'colors') {
            window.location.hash = targetTab === 'custom' ? '#colors' : `#colors/${targetTab}`;
        }

        if (window.configManager?.ui?._currentTab === 'colors') {
            window.configManager.ui.updateBreadcrumb('colors');
        }
    }

    async loadColors() {
        try {
            const response = await fetch('/api/colors');
            if (!response.ok) throw new Error('Failed to load colors');
            this.colorsData = await response.json();
            if (!this.colorsData.custom) this.colorsData.custom = {};
            this.populateColorInputs();
            if (this.customThemesManager) {
                this.customThemesManager.render(this.colorsData.custom);
                this.customThemesManager.updateThemeSelector(this.colorsData.custom);
            }
            this.applyColorsToPreview();
            this.clearDirty();
        } catch (error) {
            console.error('Error loading colors:', error);
            this.showErrorWithReload(this.t('colors.errorLoadingColors', 'Failed to load colors'));
        }
    }

    populateColorInputs() {
        this.root.querySelectorAll('input[data-theme][data-prop]').forEach((input) => {
            const theme = input.dataset.theme;
            const prop = input.dataset.prop;
            const bucket = theme === 'custom' ? null : this.colorsData[theme];
            const value = theme === 'custom'
                ? ''
                : bucket?.[prop];

            if (input.type === 'color') {
                if (value && value.startsWith('#')) input.value = value;
                const textInput = this.root.querySelector(`#${input.id}-text`);
                if (textInput) textInput.value = value || '';
            } else if (input.type === 'text') {
                input.value = value || '';
            }
        });
    }

    updateColorValue(theme, prop, value) {
        if (theme === 'custom') {
            if (this.customThemesManager?.currentSelectedTheme) {
                this.customThemesManager.updateColorValue(this.colorsData.custom, prop, value);
            }
        } else {
            if (!this.colorsData[theme]) this.colorsData[theme] = {};
            this.colorsData[theme][prop] = value;
            this.currentPreviewTheme = theme;
        }
        this.applyColorsToPreview();
    }

    applyColorsToPreview() {
        let colors;
        if (this.currentPreviewTheme === 'custom' && this.customThemesManager?.currentSelectedTheme) {
            colors = this.colorsData.custom[this.customThemesManager.currentSelectedTheme];
        } else if (this.currentPreviewTheme === 'custom') {
            return;
        } else {
            colors = this.colorsData[this.currentPreviewTheme];
        }
        if (!colors) return;

        let previewStyle = document.getElementById('color-preview-style');
        previewStyle?.remove();
        previewStyle = document.createElement('style');
        previewStyle.id = 'color-preview-style';
        previewStyle.textContent = `
            body {
                --text-primary: ${colors.textPrimary} !important;
                --text-secondary: ${colors.textSecondary} !important;
                --text-tertiary: ${colors.textTertiary} !important;
                --background-primary: ${colors.backgroundPrimary} !important;
                --background-secondary: ${colors.backgroundSecondary} !important;
                --background-dots: ${colors.backgroundDots} !important;
                --background-modal: ${colors.backgroundModal} !important;
                --border-primary: ${colors.borderPrimary} !important;
                --border-secondary: ${colors.borderSecondary} !important;
                --accent-success: ${colors.accentSuccess} !important;
                --accent-warning: ${colors.accentWarning} !important;
                --accent-error: ${colors.accentError} !important;
            }
        `;
        document.head.appendChild(previewStyle);
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
        try {
            const response = await fetch('/api/colors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.colorsData)
            });
            if (!response.ok) throw new Error('Failed to save colors');
            this.showNotification(this.t('colors.colorsSaved', 'Colors saved'), 'success');
            document.getElementById('color-preview-style')?.remove();
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

    async autosaveThemeStructure() {
        try {
            const response = await fetch('/api/colors', {
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
        const confirmed = await window.AppModal.danger({
            title: this.t('colors.resetColorsTitle', 'Reset colors'),
            message: this.t('colors.resetColorsMessage', 'Reset all theme colors to defaults?'),
            confirmText: this.t('config.reset', 'Reset'),
            cancelText: this.t('config.cancel', 'Cancel')
        });
        if (!confirmed) return;

        try {
            const response = await fetch('/api/colors/reset', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to reset');
            this.colorsData = await response.json();
            this.populateColorInputs();
            document.getElementById('color-preview-style')?.remove();
            this.reloadThemeCSS();
            this.applyColorsToPreview();
            if (this.customThemesManager) {
                this.customThemesManager.render(this.colorsData.custom || {});
                this.customThemesManager.updateThemeSelector(this.colorsData.custom || {});
            }
            this.showNotification(this.t('colors.colorsReset', 'Colors reset'), 'success');
            this.clearDirty();
        } catch (error) {
            console.error('Error resetting colors:', error);
            this.showErrorWithReload(this.t('colors.errorResettingColors', 'Failed to reset colors'));
        }
    }

    addCustomTheme() {
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
        if (!this.customThemesManager) return;
        const wasSelected = this.customThemesManager.currentSelectedTheme === themeId;
        const removed = await this.customThemesManager.remove(this.colorsData.custom, themeId);
        if (!removed) return;

        this.customThemesManager.render(this.colorsData.custom);
        this.customThemesManager.updateThemeSelector(this.colorsData.custom);
        if (wasSelected) {
            document.getElementById('color-preview-style')?.remove();
            const selector = this.root.querySelector('#custom-theme-selector');
            if (selector) {
                selector.value = '';
                selector.__customSelectInstance?.refresh?.();
            }
        }
        await this.autosaveThemeStructure();
    }

    async confirmLeave() {
        if (!this.hasUnsavedColorChanges) return true;
        if (!window.AppModal) {
            return window.confirm(this.t('config.unsavedColorChangesLeaveConfirm', 'You have unsaved color changes. Leave anyway?'));
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

        return window.AppModal.danger({
            title: this.t('config.unsavedChangesLeaveTitle', 'Leave without saving?'),
            message: this.t('config.unsavedChangesLeaveMessage', 'Unsaved color changes will be lost.'),
            confirmText: this.t('config.unsavedChangesLeaveWithoutSaving', 'Leave without saving'),
            cancelText: this.t('config.unsavedChangesStayHere', 'Stay here')
        });
    }

    bindEvents() {
        if (this._bound) return;
        this._bound = true;

        this.root.querySelector('#save-colors-btn')?.addEventListener('click', () => this.saveColors());
        this.root.querySelector('#reset-colors-btn')?.addEventListener('click', () => this.resetColors());

        this.root.querySelectorAll('input[type="color"][data-theme][data-prop]').forEach((input) => {
            const handler = (e) => {
                const theme = e.target.dataset.theme;
                const prop = e.target.dataset.prop;
                const value = e.target.value;
                const textInput = this.root.querySelector(`#${e.target.id}-text`);
                if (textInput) textInput.value = value;
                this.updateColorValue(theme, prop, value);
                this.markDirty();
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
                this.updateColorValue(theme, prop, value);
                this.markDirty();
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
                this.updateColorValue(e.target.dataset.theme, e.target.dataset.prop, e.target.value);
                this.markDirty();
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
