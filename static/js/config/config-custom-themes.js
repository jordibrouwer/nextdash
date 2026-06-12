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
