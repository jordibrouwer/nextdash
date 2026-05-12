/**
 * Custom Themes Module
 * Handles custom theme management (create, render, remove, reorder)
 */

class ConfigCustomThemes {
    constructor(onUpdate, t = null) {
        this.onUpdate = onUpdate; // Callback when themes are updated
        this.t = t || ((key) => key); // Translation function, default to return key
        this.currentSelectedTheme = null; // Currently selected custom theme for editing
    }

    /**
     * Generate a unique ID for a custom theme
     * @returns {string} - Unique ID
     */
    generateUniqueId() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `theme-${timestamp}-${random}`;
    }

    /**
     * Render custom themes list
     * @param {Object} customThemes - Object with custom theme IDs as keys
     */
    render(customThemes) {
        const container = document.getElementById('custom-themes-list');
        if (!container) return;

        container.innerHTML = '';

        // Ensure customThemes is an object
        if (!customThemes || typeof customThemes !== 'object') {
            customThemes = {};
        }

        // Convert object to array for rendering
        const themesArray = Object.keys(customThemes).map(key => ({
            id: key,
            name: customThemes[key].name || 'Unnamed Theme',
            colors: customThemes[key]
        }));

        themesArray.forEach((theme, index) => {
            const themeElement = this.createThemeElement(theme, index, customThemes);
            container.appendChild(themeElement);
        });
    }

    /**
     * Create a custom theme DOM element
     * @param {Object} theme
     * @param {number} index
     * @param {Object} customThemes - Reference to custom themes object
     * @returns {HTMLElement}
     */
    createThemeElement(theme, index, customThemes) {
        const div = document.createElement('div');
        div.className = 'category-item js-item is-idle';
        div.setAttribute('data-theme-id', theme.id);

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

        div.appendChild(nameInput);
        div.appendChild(removeButton);

        // Add event listener for name changes
        nameInput.addEventListener('input', (e) => {
            const themeId = e.target.getAttribute('data-theme-id');
            const newName = e.target.value;
            
            // Update only the name, keeping the same ID
            if (customThemes[themeId]) {
                customThemes[themeId].name = newName;
                
                // Update selector to show new name
                this.updateThemeSelector(customThemes);
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

        // Prefer refreshing the specific CustomSelect instance attached to this select
        try {
            const instance = selector.__customSelectInstance;
            if (instance && typeof instance.refresh === 'function') {
                instance.refresh();
                return;
            }
        } catch (e) {
            // ignore and fall back
        }

        // Fall back to global refresh helper if present
        if (typeof configManager !== 'undefined' && typeof configManager.refreshCustomSelects === 'function') {
            try { configManager.refreshCustomSelects(); } catch (e) { console.error('refreshCustomSelects error', e); }
            return;
        }

        // If not initialized yet, initialize custom selects for the page
        if (typeof initCustomSelects === 'function') {
            try { initCustomSelects(); } catch (e) { /* ignore */ }
        }
    }

    setupThemeSelector(customThemes) {
        const selector = document.getElementById('custom-theme-selector');
        if (!selector) return;

        selector.addEventListener('change', (e) => {
            const themeId = e.target.value;
            this.currentSelectedTheme = themeId;
            
            if (themeId && customThemes[themeId]) {
                this.showThemeColors(customThemes[themeId]);
                // Switch to custom theme preview
                if (window.switchToTheme) {
                    window.switchToTheme('custom');
                }
            } else {
                this.hideThemeColors();
            }
        });

        // Initialize selector options
        this.updateThemeSelector(customThemes);
    }

    /**
     * Show color inputs for selected custom theme
     * @param {Object} themeColors
     */
    showThemeColors(themeColors) {
        const colorSection = document.getElementById('custom-theme-colors-section');
        if (!colorSection) return;

        colorSection.style.display = 'block';

        // Populate color inputs
        const colorInputs = colorSection.querySelectorAll('input[data-prop]');
        colorInputs.forEach(input => {
            const prop = input.dataset.prop;
            const value = themeColors[prop] || '';
            
            if (input.type === 'color') {
                if (value && value.startsWith('#')) {
                    input.value = value;
                }
                // Update corresponding text input
                const textInput = document.getElementById(`${input.id}-text`);
                if (textInput) {
                    textInput.value = value;
                }
            } else if (input.classList.contains('color-text-input')) {
                input.value = value;
            } else if (input.classList.contains('color-text-input-full')) {
                input.value = value;
            }
        });
    }

    /**
     * Hide color inputs section
     */
    hideThemeColors() {
        const colorSection = document.getElementById('custom-theme-colors-section');
        if (colorSection) {
            colorSection.style.display = 'none';
        }
    }

    /**
     * Update color value for current custom theme
     * @param {Object} customThemes
     * @param {string} prop
     * @param {string} value
     */
    updateColorValue(customThemes, prop, value) {
        if (!this.currentSelectedTheme || !customThemes[this.currentSelectedTheme]) {
            return;
        }

        customThemes[this.currentSelectedTheme][prop] = value;
    }

    /**
     * Add a new custom theme
     * @param {Object} customThemes
     * @param {Object} defaultColors - Default dark theme colors to use as template
     * @returns {string} - The new theme ID
     */
    add(customThemes, defaultColors) {
        // Ensure customThemes is an object
        if (!customThemes || typeof customThemes !== 'object') {
            console.error('customThemes must be an object');
            return null;
        }

        const themeCount = Object.keys(customThemes).length;
        const themeName = `${this.t('config.customThemePrefix')} ${themeCount + 1}`;
        const themeId = this.generateUniqueId();

        // Create new theme with default dark colors
        customThemes[themeId] = {
            name: themeName,
            ...defaultColors
        };

        return themeId;
    }

    /**
     * Remove a custom theme (with confirmation)
     * @param {Object} customThemes
     * @param {string} themeId
     * @returns {Promise<boolean>} - Whether the theme was removed
     */
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
        
        // Clear selection if removed theme was selected
        if (this.currentSelectedTheme === themeId) {
            this.currentSelectedTheme = null;
            this.hideThemeColors();
        }
        
        return true;
    }

    /**
     * Get all custom theme IDs
     * @param {Object} customThemes
     * @returns {Array<string>}
     */
    getThemeIds(customThemes) {
        return Object.keys(customThemes || {});
    }
}

// Export for use in other modules
window.ConfigCustomThemes = ConfigCustomThemes;
