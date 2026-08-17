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
     * The app-version token the page was rendered with, or '' if absent.
     *
     * Locales are served by a plain file server: no content hash in the name and
     * no cache-control, so a browser is free to reuse its stored copy for as
     * long as it likes. That is exactly what happened — an updated en.json kept
     * resolving to the old strings, and a new key came back empty, which showed
     * up as an info modal with a "Got it" button and nothing above it. The
     * fingerprint changes whenever any asset does, so appending it makes the URL
     * new after a deploy and stable in between.
     */
    static assetVersion() {
        if (typeof document === 'undefined') return '';
        return document.querySelector('meta[name="nextdash-app-version"]')?.content || '';
    }

    /**
     * Load translations for a specific language
     * @param {string} lang - Language code
     */
    /** The URL for one scope of one language, with the deploy fingerprint. */
    static localeUrl(lang, scope) {
        const version = ConfigLanguage.assetVersion();
        const params = [];
        if (scope) params.push(`scope=${encodeURIComponent(scope)}`);
        if (version) params.push(`v=${encodeURIComponent(version)}`);
        return `/locales/${lang}.json${params.length ? `?${params.join('&')}` : ''}`;
    }

    /**
     * Load the translations the dashboard needs to draw itself.
     *
     * Not the whole file: a third of it is the Help tab's prose — 182 KB of the
     * 570 KB in English — read only by the config module, which is itself loaded
     * on demand. Those keys arrive with it, through ensureHelpTranslations.
     */
    async loadTranslations(lang) {
        try {
            const response = await fetch(ConfigLanguage.localeUrl(lang, 'core'));
            if (response.ok) {
                this.translations = await response.json();
                this.currentLanguage = lang;
                this._helpLoadedFor = null;
                this.applyTranslations();
            } else {
                console.error(`Failed to load translations for ${lang}`);
            }
        } catch (error) {
            console.error('Error loading translations:', error);
        }
    }

    /**
     * Fetch the Help tab's strings and fold them in, once per language.
     *
     * Called before config renders. Failure is not fatal: t() falls back to the
     * key's own fallback text, which is the English wording — worse than a
     * translation, better than a blank panel.
     */
    async ensureHelpTranslations(lang) {
        const language = lang || this.currentLanguage;
        if (!language || this._helpLoadedFor === language) return;
        if (this._helpLoading) return this._helpLoading;
        this._helpLoading = (async () => {
            try {
                const res = await fetch(ConfigLanguage.localeUrl(language, 'help'));
                if (!res.ok) return;
                const extra = await res.json();
                const help = extra?.config || {};
                this.translations = this.translations || {};
                this.translations.config = { ...(this.translations.config || {}), ...help };
                this._helpLoadedFor = language;
            } catch {
                // Left for the next attempt; the fallbacks carry the panel.
            } finally {
                this._helpLoading = null;
            }
        })();
        return this._helpLoading;
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
            } else if (/<[a-z][\s\S]*>/i.test(translation)) {
                // Only use innerHTML for translations that intentionally carry markup
                // (e.g. <kbd>, <strong>); plain labels use textContent to stay safe.
                element.innerHTML = translation;
            } else {
                element.textContent = translation;
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
            // Tips are injected, not data-i18n markup, so applyTranslations does not
            // reach them; re-render so a language switch updates them too.
            window.ConfigHelpTips?.render?.({ t: (key) => this.t(key) });
            document.dispatchEvent(new CustomEvent('nextdash:translations-applied'));
            this.scheduleSearchIndexRefresh();
            const tab = window.configManager?.ui?._currentTab;
            if (tab) {
                window.configManager.ui.updateTabSaveMode(tab);
            }
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
