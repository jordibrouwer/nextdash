/**
 * Search Command: :fontsize
 * Changes the font size in the dashboard
 */

class SearchCommandFontSize {
    constructor(language = null) {
        this.language = language;
        this.fontSizeMap = ['xs', 's', 'sm', 'm', 'lg', 'l', 'xl'];
        this.fontSizeDisplayNames = {
            'xs': this.language ? this.language.t('dashboard.extraSmall') : 'Extra Small',
            's': this.language ? this.language.t('dashboard.small') : 'Small',
            'sm': this.language ? this.language.t('dashboard.smallMedium') : 'Small Medium',
            'm': this.language ? this.language.t('dashboard.medium') : 'Medium',
            'lg': this.language ? this.language.t('dashboard.largeMedium') : 'Large Medium',
            'l': this.language ? this.language.t('dashboard.large') : 'Large',
            'xl': this.language ? this.language.t('dashboard.extraLarge') : 'Extra Large'
        };
    }

    setLanguage(language) {
        this.language = language;
        // Update display names when language changes
        this.fontSizeDisplayNames = {
            'xs': this.language ? this.language.t('dashboard.extraSmall') : 'Extra Small',
            's': this.language ? this.language.t('dashboard.small') : 'Small',
            'sm': this.language ? this.language.t('dashboard.smallMedium') : 'Small Medium',
            'm': this.language ? this.language.t('dashboard.medium') : 'Medium',
            'lg': this.language ? this.language.t('dashboard.largeMedium') : 'Large Medium',
            'l': this.language ? this.language.t('dashboard.large') : 'Large',
            'xl': this.language ? this.language.t('dashboard.extraLarge') : 'Extra Large'
        };
    }

    getCurrentFontSize() {
        const dash = window.dashboardInstance;
        if (dash?.settings?.fontSize) {
            return dash.settings.fontSize;
        }
        if (window.ThemeLoader?.getFontSize) {
            return window.ThemeLoader.getFontSize();
        }
        for (const size of this.fontSizeMap) {
            if (document.body.classList.contains(`font-size-${size}`)) {
                return size;
            }
        }
        return 'm';
    }

    _buildFontSizeRow(size) {
        const displayName = this.fontSizeDisplayNames[size] || size.toUpperCase();
        const current = this.getCurrentFontSize();
        const name = size === current ? `${displayName} ✓` : displayName;
        return {
            name,
            shortcut: ':fontsize',
            stateId: `fontsize:${size}`,
            action: () => {
                this.applyFontSize(size);
                if (window.dashboardInstance?.settings) {
                    window.dashboardInstance.settings.fontSize = size;
                }
                return { stateId: `fontsize:${size}` };
            },
            type: 'command'
        };
    }

    handle(args) {
        // If args has one empty string, treat as no args
        const effectiveArgs = (args.length === 1 && args[0] === '') ? [] : args;

        if (effectiveArgs.length === 0) {
            return this.fontSizeMap.map((size) => this._buildFontSizeRow(size));
        }

        const sizeQuery = effectiveArgs.join(' ').toLowerCase();
        const matchingSizes = this.fontSizeMap.filter((size) => {
            const displayName = this.fontSizeDisplayNames[size] || size.toUpperCase();
            return displayName.toLowerCase().startsWith(sizeQuery) || size.startsWith(sizeQuery);
        });

        return matchingSizes.map((size) => this._buildFontSizeRow(size));
    }

    /**
     * Apply a font size
     * @param {string} fontSize - The font size to apply
     */
    async applyFontSize(fontSize) {
        // Remove all font size classes
        document.body.classList.remove('font-size-xs', 'font-size-s', 'font-size-sm', 'font-size-m', 'font-size-lg', 'font-size-l', 'font-size-xl');

        // Add the new font size class
        document.body.classList.add(`font-size-${fontSize}`);

        // Update settings
        const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';

        if (deviceSpecific) {
            const settings = localStorage.getItem('dashboardSettings');
            if (settings) {
                try {
                    const parsed = JSON.parse(settings);
                    // Update fontSize in localStorage
                    parsed.fontSize = fontSize;
                    if (window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                        window.DeviceSettingsMerge.saveDeviceLocalSettings(parsed);
                    } else {
                        localStorage.setItem('dashboardSettings', JSON.stringify(parsed));
                    }
                } catch (e) {
                    console.error('Error parsing dashboard settings:', e);
                }
            }
        } else {
            // For server settings, we need to fetch current settings, update fontSize, and save back
            try {
                const response = await fetch('/api/settings');
                if (response.ok) {
                    const currentSettings = await response.json();
                    currentSettings.fontSize = fontSize;

                    // Save updated settings to server
                    await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(currentSettings)
                    });
                }
            } catch (error) {
                console.error('Error saving font size to server:', error);
            }
        }
    }
}

// Export for use in other modules
window.SearchCommandFontSize = SearchCommandFontSize;
