/**
 * Custom Themes Module — create, render, remove, and reorder custom themes.
 */

class ConfigCustomThemes {
    constructor(onUpdate, t = null) {
        this.onUpdate = onUpdate;
        this.t = t || ((key) => key);
        this.currentSelectedTheme = null;
    }

    generateUniqueId() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `theme-${timestamp}-${random}`;
    }

    render(customThemes) {
        const container = document.getElementById('custom-themes-list');
        if (!container) return;

        container.innerHTML = '';

        if (!customThemes || typeof customThemes !== 'object') {
            customThemes = {};
        }

        const themesArray = Object.keys(customThemes).map((key) => ({
            id: key,
            name: customThemes[key].name || 'Unnamed Theme',
            colors: customThemes[key]
        }));

        themesArray.forEach((theme, index) => {
            const themeElement = this.createThemeElement(theme, index, themesArray.length, customThemes);
            container.appendChild(themeElement);
        });
    }

    createThemeElement(theme, index, total, customThemes) {
        const div = document.createElement('div');
        div.className = 'category-item js-item is-idle custom-theme-list-item';
        div.setAttribute('data-theme-id', theme.id);

        const reorderWrap = document.createElement('div');
        reorderWrap.className = 'custom-theme-reorder-btns';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'btn btn-secondary btn-small custom-theme-move-btn';
        upBtn.textContent = '↑';
        upBtn.title = this.t('colors.moveThemeUp', 'Move up');
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
            window.configManager?.colorsEditor?.reorderCustomTheme?.(theme.id, 'up');
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'btn btn-secondary btn-small custom-theme-move-btn';
        downBtn.textContent = '↓';
        downBtn.title = this.t('colors.moveThemeDown', 'Move down');
        downBtn.disabled = index >= total - 1;
        downBtn.addEventListener('click', () => {
            window.configManager?.colorsEditor?.reorderCustomTheme?.(theme.id, 'down');
        });

        reorderWrap.appendChild(upBtn);
        reorderWrap.appendChild(downBtn);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = `custom-theme-name-${index}`;
        nameInput.name = `custom-theme-name-${index}`;
        nameInput.value = theme.name;
        nameInput.placeholder = this.t('config.customThemeNamePlaceholder');
        nameInput.setAttribute('data-theme-id', theme.id);
        nameInput.setAttribute('data-field', 'name');

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn-danger';
        removeButton.textContent = this.t('config.remove');
        removeButton.addEventListener('click', () => {
            if (typeof configManager !== 'undefined' && typeof configManager.removeCustomTheme === 'function') {
                configManager.removeCustomTheme(theme.id);
            }
        });

        div.appendChild(reorderWrap);
        div.appendChild(nameInput);
        div.appendChild(removeButton);

        nameInput.addEventListener('input', (e) => {
            const themeId = e.target.getAttribute('data-theme-id');
            const newName = e.target.value;

            if (customThemes[themeId]) {
                customThemes[themeId].name = newName;
                this.updateThemeSelector(customThemes);
                window.configManager?.colorsEditor?.markDirty?.();
                window.configManager?.colorsEditor?.scheduleStructureAutosave?.();
            }
        });

        return div;
    }

    updateThemeSelector(customThemes) {
        const selector = document.getElementById('custom-theme-selector');
        if (!selector) return;

        const currentValue = selector.value;
        const selectLabel = this.t('colors.selectCustomTheme') === 'colors.selectCustomTheme'
            ? this.t('config.selectCustomTheme')
            : this.t('colors.selectCustomTheme');
        selector.innerHTML = '<option value="">' + selectLabel + '</option>';

        Object.keys(customThemes).forEach(themeId => {
            const option = document.createElement('option');
            option.value = themeId;
            option.textContent = customThemes[themeId].name || this.t('config.unnamedTheme');
            selector.appendChild(option);
        });

        if (currentValue && customThemes[currentValue]) {
            selector.value = currentValue;
        }

        try {
            const instance = selector.__customSelectInstance;
            if (instance && typeof instance.refresh === 'function') {
                instance.refresh();
                return;
            }
        } catch (e) {
            // ignore and fall back
        }

        if (typeof configManager !== 'undefined' && typeof configManager.refreshCustomSelects === 'function') {
            try { configManager.refreshCustomSelects(); } catch (e) { console.error('refreshCustomSelects error', e); }
            return;
        }

        if (typeof initCustomSelects === 'function') {
            try { initCustomSelects(); } catch (e) { /* ignore */ }
        }
    }

    setupThemeSelector(customThemes) {
        const selector = document.getElementById('custom-theme-selector');
        if (!selector) return;

        if (selector.dataset.themeSelectorBound === '1') {
            this.updateThemeSelector(customThemes);
            return;
        }
        selector.dataset.themeSelectorBound = '1';

        selector.addEventListener('change', (e) => {
            const themeId = e.target.value;
            this.currentSelectedTheme = themeId;
            window.configManager?.colorsEditor?.persistCustomThemeSelection?.(themeId);

            if (themeId && customThemes[themeId]) {
                this.showThemeColors(customThemes[themeId]);
                if (window.switchToTheme) {
                    window.switchToTheme('custom');
                }
                window.configManager?.colorsEditor?.applyColorsToPreview?.();
                window.configManager?.colorsEditor?.updateContrastHints?.();
            } else {
                this.hideThemeColors();
                window.configManager?.colorsEditor?.clearPreviewStyle?.();
            }
        });

        this.updateThemeSelector(customThemes);
    }

    showThemeColors(themeColors) {
        const colorSection = document.getElementById('custom-theme-colors-section');
        if (!colorSection) return;

        colorSection.style.display = 'block';

        const colorInputs = colorSection.querySelectorAll('input[data-prop]');
        colorInputs.forEach(input => {
            const prop = input.dataset.prop;
            const value = themeColors[prop] || '';

            if (input.type === 'color') {
                if (value && value.startsWith('#')) {
                    input.value = value;
                }
                const textInput = document.getElementById(`${input.id}-text`);
                if (textInput) {
                    textInput.value = value;
                }
            } else if (input.classList.contains('color-text-input')) {
                input.value = value;
            } else if (input.classList.contains('color-text-input-full')) {
                input.value = value;
            }
            const textEl = input.classList.contains('color-text-input') || input.classList.contains('color-text-input-full')
                ? input
                : document.getElementById(`${input.id}-text`);
            window.ColorValueUtils?.validateTextInput(textEl);
        });
    }

    hideThemeColors() {
        const colorSection = document.getElementById('custom-theme-colors-section');
        if (colorSection) {
            colorSection.style.display = 'none';
        }
    }

    updateColorValue(customThemes, prop, value) {
        if (!this.currentSelectedTheme || !customThemes[this.currentSelectedTheme]) {
            return;
        }

        customThemes[this.currentSelectedTheme][prop] = value;
    }

    add(customThemes, defaultColors) {
        if (!customThemes || typeof customThemes !== 'object') {
            console.error('customThemes must be an object');
            return null;
        }

        const themeCount = Object.keys(customThemes).length;
        const themeName = `${this.t('config.customThemePrefix')} ${themeCount + 1}`;
        const themeId = this.generateUniqueId();

        customThemes[themeId] = {
            ...defaultColors,
            name: themeName
        };

        return themeId;
    }

    async remove(customThemes, themeId) {
        const confirmed = await window.AppModal.danger({
            title: this.t('config.removeCustomThemeTitle'),
            message: this.t('config.removeCustomThemeMessage'),
            confirmText: this.t('config.remove'),
            cancelText: this.t('config.cancel')
        });

        if (!confirmed) {
            return false;
        }

        delete customThemes[themeId];

        if (this.currentSelectedTheme === themeId) {
            this.currentSelectedTheme = null;
            this.hideThemeColors();
        }

        return true;
    }

    getThemeIds(customThemes) {
        return Object.keys(customThemes || {});
    }
}

window.ConfigCustomThemes = ConfigCustomThemes;

/**
 * Theme UI glue — preview badge and icon styling controls.
 */
class ConfigThemesController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    initThemeIconStylingControls() {
        const enableCheckbox = document.getElementById('theme-iconstyling-enable');
        const controls = document.getElementById('theme-iconstyling-controls');
        const styleSelect = document.getElementById('theme-iconstyling-style');
        const intensityRange = document.getElementById('theme-iconstyling-intensity');
        const preview = document.getElementById('theme-iconstyling-preview');
        if (!enableCheckbox || !controls || !styleSelect || !intensityRange || !preview) return;
        if (enableCheckbox.dataset.themeIconBound === '1') return;
        enableCheckbox.dataset.themeIconBound = '1';
    
        const getTheme = () => this.c.settingsData.theme || document.documentElement.getAttribute('data-theme') || 'default';
        // Absent means on, the same rule the dashboard reads by -- see
        // normalizeEntry in theme-icon-styling.js.
        const getEntry = (theme) => (this.c.settingsData.themeIconStyling && this.c.settingsData.themeIconStyling[theme])
            || { enabled: true, style: 'muted', intensity: 0.5 };
    
        const applyEntry = (partial) => {
            const theme = getTheme();
            this.c.settingsData.themeIconStyling = this.c.settingsData.themeIconStyling || {};
            this.c.settingsData.themeIconStyling[theme] = { ...getEntry(theme), ...partial };
            this.c.markDirty();
            this.c.scheduleDirtyRecompute();
            this.c.updateThemeIconStylingPreview(theme);
        };
    
        const theme = getTheme();
        const entry = getEntry(theme);
        enableCheckbox.checked = !!entry.enabled;
        styleSelect.value = entry.style || 'muted';
        intensityRange.value = String(entry.intensity || 0.5);
        controls.hidden = !enableCheckbox.checked;
        this.c.updateThemeIconStylingPreview(theme);
    
        enableCheckbox.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;
            controls.hidden = !enabled;
            applyEntry({ enabled });
        });
    
        styleSelect.addEventListener('change', (e) => {
            applyEntry({ style: e.target.value });
        });
    
        intensityRange.addEventListener('input', (e) => {
            applyEntry({ intensity: parseFloat(e.target.value) || 0.5 });
        });
    
        intensityRange.addEventListener('change', (e) => {
            applyEntry({ intensity: parseFloat(e.target.value) || 0.5 });
        });
    }

    syncResetPanelGuard() {
        const resetCard = document.querySelector('[data-general-panel="reset"]');
        if (!resetCard) return;
        const collapsed = resetCard.classList.contains('is-collapsed');
        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) resetBtn.disabled = collapsed;
        const deleteAllBtn = document.getElementById('delete-all-bookmarks-btn');
        if (deleteAllBtn) deleteAllBtn.disabled = collapsed;
    }

    updateThemeIconStylingPreview(theme) {
        const preview = document.getElementById('theme-iconstyling-preview');
        const styleSelect = document.getElementById('theme-iconstyling-style');
        const intensityRange = document.getElementById('theme-iconstyling-intensity');
        if (!preview || !styleSelect || !intensityRange) return;
        const entry = (this.c.settingsData.themeIconStyling && this.c.settingsData.themeIconStyling[theme]) || { enabled: true, style: 'muted', intensity: 0.5 };
        const elems = Array.from(preview.querySelectorAll('.preview-icon'));
        elems.forEach((el) => {
            el.classList.remove('icon-themed', 'icon-themed--muted', 'icon-themed--tinted', 'icon-themed--overlay');
        });
        if (entry.enabled) {
            elems.forEach((el) => el.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`));
            preview.style.setProperty('--icon-theme-intensity', String(entry.intensity || 0.5));
        } else {
            preview.style.removeProperty('--icon-theme-intensity');
        }
    }

    updateThemePreviewBadge(options = {}) {
        const badge = document.getElementById('theme-preview-badge');
        if (!badge) return;
        const current = String(this.c.settingsData?.theme || '');
        const persisted = String(this.c._persistedTheme || '');
        const pending = current !== persisted;
        const saving = options.saving === true;
    
        badge.hidden = !pending && !saving;
        badge.classList.toggle('is-visible', pending || saving);
        badge.classList.toggle('is-saving', saving);
    
        const hintKey = saving ? 'config.themePreviewSaving' : 'config.themePreviewSaveHint';
        const hintFallback = saving ? 'Saving theme…' : 'Preview — click Save to keep';
        const hint = this.c.language?.t(hintKey);
        badge.textContent = hint && hint !== hintKey ? hint : hintFallback;
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of ['initThemeIconStylingControls', 'syncResetPanelGuard', 'updateThemeIconStylingPreview', 'updateThemePreviewBadge']) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigThemesController = ConfigThemesController;
