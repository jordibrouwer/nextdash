/**
 * Language Module
 * Handles language selection and i18n
 */

class ConfigLanguage {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = {};
        this._searchIndexRefreshTimer = null;
        this.availableLanguages = {
            'en': 'English',
            'nl': 'Dutch',
            'de': 'German',
            'fr': 'French',
        };
    }

    /**
     * Load translations for a specific language
     * @param {string} lang - Language code
     */
    async loadTranslations(lang) {
        try {
            const response = await fetch(`/locales/${lang}.json`);
            if (response.ok) {
                this.translations = await response.json();
                this.currentLanguage = lang;
                this.applyTranslations();
            } else {
                console.error(`Failed to load translations for ${lang}`);
            }
        } catch (error) {
            console.error('Error loading translations:', error);
        }
    }

    /**
     * Get translated text for a key
     * @param {string} key - Translation key (e.g., 'config.title')
     * @returns {string} Translated text or key if not found
     */
    t(key) {
        if (typeof key !== 'string') return String(key);
        const keys = key.split('.');
        let value = this.translations ?? {};
        for (const k of keys) {
            if (value == null || typeof value !== 'object') {
                return key;
            }
            value = value[k];
        }
        return typeof value === 'string' ? value : key;
    }

    /** Debounced search index rebuild after translated DOM text changes. */
    scheduleSearchIndexRefresh() {
        if (!document.getElementById('config-main')) return;
        clearTimeout(this._searchIndexRefreshTimer);
        this._searchIndexRefreshTimer = setTimeout(() => {
            window.ConfigSettingsSearch?.refreshIndex?.();
        }, 120);
    }

    /**
     * Apply translations to elements with data-i18n attribute
     */
    applyTranslations() {
        // Handle standard data-i18n
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);
            if (translation === key) {
                // Missing key: keep existing template text instead of showing raw i18n key.
                return;
            }
            if (element.hasAttribute('aria-label')) {
                element.setAttribute('aria-label', translation);
            } else {
                element.innerHTML = translation;
            }
        });

        // Handle data-i18n-placeholder
        const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
        placeholderElements.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = this.t(key);
            if (translation === key) {
                return;
            }
            element.placeholder = translation;
        });

        // Handle data-i18n-tooltip
        const toolbarKbdTooltipIds = new Set([
            'quick-add-toolbar-btn',
            'search-button',
            'commands-button',
            'finders-button',
            'recent-bookmarks-button',
            'help-button',
        ]);
        const tooltipElements = document.querySelectorAll('[data-i18n-tooltip]');
        tooltipElements.forEach(element => {
            if (toolbarKbdTooltipIds.has(element.id)) return;
            const key = element.getAttribute('data-i18n-tooltip');
            const translation = this.t(key);
            if (translation === key) {
                return;
            }
            element.setAttribute('data-tooltip', translation);
        });
        toolbarKbdTooltipIds.forEach((id) => {
            document.getElementById(id)?.removeAttribute('data-tooltip');
        });

        document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
            const key = element.getAttribute('data-i18n-aria');
            const translation = this.t(key);
            if (translation === key) return;
            element.setAttribute('aria-label', translation);
        });

        const mgr = window.configManager;
        if (mgr?.settings && mgr.settingsData) {
            mgr.settings.updateLayoutDensityPreview(
                mgr.settingsData.layoutPreset || 'default',
                mgr.settingsData.densityMode || 'compact'
            );
        }
        if (document.getElementById('config-main')) {
            window.ConfigSettingsSearch?.relocateForLayout?.();
            window.ConfigSettingsSearch?.syncMobileLayout?.({ rebuildIndex: false });
            const settings = window.configManager?.settingsData;
            const includeTagCloud = settings?.showTagCloudButton === true
                && window.MobileExperience?.isMobileLayout?.() !== true;
            window.DashboardTipsCatalog?.renderHelpOverview?.({
                language: { t: (key) => this.t(key) },
                includeTagCloud,
            });
            document.dispatchEvent(new CustomEvent('nextdash:translations-applied'));
            this.scheduleSearchIndexRefresh();
        }
    }

    /**
     * Setup language selector
     */
    setupLanguageSelector() {
        const languageSelect = document.getElementById('language-select');
        if (!languageSelect) return;

        // Populate options
        languageSelect.innerHTML = '';
        const nameKeys = {
            en: 'config.languageNameEn',
            nl: 'config.languageNameNl',
            de: 'config.languageNameDe',
            fr: 'config.languageNameFr',
        };
        Object.keys(this.availableLanguages).forEach(lang => {
            const option = document.createElement('option');
            option.value = lang;
            const labelKey = nameKeys[lang];
            const label = labelKey ? this.t(labelKey) : '';
            option.textContent = label && label !== labelKey ? label : this.availableLanguages[lang];
            languageSelect.appendChild(option);
        });

        // Set current value
        languageSelect.value = this.currentLanguage;

    }



    /**
     * Initialize with current language
     * @param {string} lang - Current language
     */
    async init(lang) {
        this.currentLanguage = lang;
        await this.loadTranslations(lang);
    }
}
