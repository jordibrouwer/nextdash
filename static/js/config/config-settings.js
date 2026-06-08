/**
 * Settings Module
 * Handles settings UI and configuration
 */

const CONFIG_BACKGROUND_PRESETS = {
    sunset:   'linear-gradient(135deg, #c94b4b 0%, #4b134f 100%)',
    ocean:    'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    aurora:   'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    forest:   'linear-gradient(135deg, #0a3d0c 0%, #1a5e1f 50%, #0d2d0e 100%)',
    ember:    'linear-gradient(135deg, #3a1500 0%, #8b3800 60%, #ff6600 100%)',
    lavender: 'linear-gradient(135deg, #3d2b6b 0%, #7b5ea7 50%, #c2a0e0 100%)',
    nordic:   'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
    rose:     'linear-gradient(135deg, #b91d73 0%, #f953c6 100%)',
    morning:  'linear-gradient(135deg, #fff1eb 0%, #ace0f9 100%)',
    meadow:   'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    blush:    'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    mist:     'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
    petal:    'linear-gradient(135deg, #ffd6e7 0%, #ffafcc 100%)',
};

const CONFIG_THEME_BACKGROUND_MAP = {
    'cherry-graphite-dark':  'rose',
    'desert-sand-dark':      'ember',
    'forest-moss-dark':      'forest',
    'lavender-mist-dark':    'lavender',
    'midnight-neon-dark':    'aurora',
    'neon-grid-dark':        'aurora',
    'glacier-mint-dark':     'nordic',
    'kelp-drift-dark':       'ocean',
    'mulberry-silk-dark':    'rose',
    'rusted-rail-dark':      'ember',
    'steel-dawn-dark':       'nordic',
    'nordic-frost-dark':     'nordic',
    'ocean-depth-dark':      'ocean',
    'paper-ink-dark':        'nordic',
    'retro-crt-dark':        'ember',
    'arctic-cyan-dark':      'ocean',
    'copper-circuit-dark':   'ember',
    'coral-reef-dark':       'sunset',
    'emerald-matrix-dark':   'forest',
    'monochrome-mist-dark':  'nordic',
    'obsidian-gold-dark':    'aurora',
    'royal-amethyst-dark':   'lavender',
    'sakura-night-dark':     'rose',
    'solar-ember-dark':      'sunset',
    'sunflower-ink-dark':    'sunset',
    'volcanic-ash-dark':     'ember',
    'cherry-graphite-light': 'blush',
    'desert-sand-light':     'morning',
    'forest-moss-light':     'meadow',
    'lavender-mist-light':   'petal',
    'midnight-neon-light':   'mist',
    'neon-grid-light':       'mist',
    'glacier-mint-light':    'mist',
    'kelp-drift-light':      'meadow',
    'mulberry-silk-light':   'petal',
    'rusted-rail-light':     'morning',
    'steel-dawn-light':      'mist',
    'nordic-frost-light':    'mist',
    'ocean-depth-light':     'mist',
    'paper-ink-light':       'morning',
    'retro-crt-light':       'morning',
    'arctic-cyan-light':     'mist',
    'copper-circuit-light':  'morning',
    'coral-reef-light':      'blush',
    'emerald-matrix-light':  'meadow',
    'monochrome-mist-light': 'mist',
    'obsidian-gold-light':   'morning',
    'royal-amethyst-light':  'petal',
    'sakura-night-light':    'petal',
    'solar-ember-light':     'morning',
    'sunflower-ink-light':   'morning',
    'volcanic-ash-light':    'morning',
    'dark':  'aurora',
    'light': 'mist',
};

class ConfigSettings {
    constructor(language) {
        this.language = language;
        this.t = language.t.bind(language); // Translation function
        this.customThemes = {}; // Store selectable themes (id -> display name)
        this.userCustomThemeIds = new Set(); // Themes created in Config → theme (colors.custom)
        this.legacyThemeMap = {
            aurora: 'midnight-neon-dark',
            cyberpunk: 'retro-crt-dark',
            ember: 'solar-ember-dark',
            forest: 'forest-moss-dark',
            lavender: 'lavender-mist-dark',
            matcha: 'forest-moss-dark',
            midnight: 'midnight-neon-dark',
            mint: 'nordic-frost-light',
            nerd: 'retro-crt-dark',
            ocean: 'ocean-depth-dark',
            paper: 'paper-ink-light',
            peach: 'desert-sand-light',
            sunset: 'solar-ember-light',
            synthwave: 'cherry-graphite-dark',
            void: 'paper-ink-dark'
        };
    }

    normalizeThemeId(themeId) {
        if (!themeId) return 'dark';

        const normalized = this.legacyThemeMap[themeId] || themeId;
        if (normalized === 'light' || normalized === 'dark') {
            return normalized;
        }

        const themeIds = Object.keys(this.customThemes || {});
        if (themeIds.includes(normalized)) {
            return normalized;
        }

        // Allow built-in theme families before the async theme list is loaded.
        if (/-((dark)|(light))$/.test(normalized)) {
            return normalized;
        }

        return 'dark';
    }

    syncFontPresetDropdown(settings) {
        const select = document.getElementById('font-preset-select');
        if (!select || !window.DashboardFont) return;

        const path = settings.customFontPath && String(settings.customFontPath).trim();
        let customOpt = select.querySelector('option[value="custom"]');

        if (path) {
            if (!customOpt) {
                customOpt = document.createElement('option');
                customOpt.value = 'custom';
                customOpt.setAttribute('data-i18n', 'config.fontPresetCustom');
                select.appendChild(customOpt);
            }
            const label = this.t('config.fontPresetCustom', 'Custom font (uploaded)');
            customOpt.textContent = label !== 'config.fontPresetCustom' ? label : 'Custom font (uploaded)';
        } else if (customOpt) {
            customOpt.remove();
        }

        window.DashboardFont.normalizeFontSettings(settings);
        const resolved = window.DashboardFont.resolveActiveFontPreset(settings);
        settings.fontPreset = resolved;
        settings.enableCustomFont = resolved === 'custom';

        if (select.querySelector(`option[value="${resolved}"]`)) {
            select.value = resolved;
        } else {
            select.value = 'source-code-pro';
            settings.fontPreset = 'source-code-pro';
            settings.enableCustomFont = false;
        }
        select.disabled = false;
        this.updateCustomFontStatus(settings);
    }

    updateCustomFontStatus(settings, state = 'success') {
        const statusEl = document.getElementById('custom-font-status');
        if (!statusEl) return;
        const path = settings.customFontPath && String(settings.customFontPath).trim();
        if (!path) {
            statusEl.innerHTML = '';
            statusEl.className = 'setting-hint font-upload-status';
            return;
        }
        const fileName = path.split('/').pop() || path;
        const hint = this.t('config.uploadFontAvailableHint', 'Uploaded font available in the dropdown above.');
        const hintText = hint !== 'config.uploadFontAvailableHint'
            ? `${fileName} — ${hint}`
            : `${fileName} — uploaded font available in the dropdown above.`;
        const icon = state === 'error' ? '✕' : '✓';
        const cls  = state === 'error' ? 'is-error' : 'is-success';
        statusEl.className = `setting-hint font-upload-status ${cls}`;
        statusEl.innerHTML = `<span class="font-upload-status-icon" aria-hidden="true">${icon}</span><span>${hintText}</span>`;
    }

    getThemeDisplayName(themeId, value) {
        if (themeId === 'dark') {
            return 'Old Default [dark]';
        }
        if (themeId === 'light') {
            return 'Old Default [light]';
        }
        if (value && typeof value === 'object' && value.name) {
            return String(value.name);
        }
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
        return String(themeId || this.t('config.unnamedTheme') || 'Theme');
    }

    getPairedThemeVariant(themeId, wantsDark) {
        const normalized = this.normalizeThemeId(themeId);
        if (normalized === 'dark' || normalized === 'light') {
            return wantsDark ? 'dark' : 'light';
        }
        if (this.isUserCustomTheme(normalized)) {
            return normalized;
        }
        const match = normalized.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return normalized;
        }
        const pairCandidate = `${match[1]}-${wantsDark ? 'dark' : 'light'}`;
        const hasPair = Object.prototype.hasOwnProperty.call(this.customThemes || {}, pairCandidate);
        return hasPair ? pairCandidate : normalized;
    }

    isUserCustomTheme(themeId) {
        const normalized = this.normalizeThemeId(themeId);
        return this.userCustomThemeIds?.has(normalized) === true;
    }

    themeSupportsAutoDarkMode(themeId) {
        const normalized = this.normalizeThemeId(themeId);
        if (this.isUserCustomTheme(normalized)) {
            return false;
        }
        if (normalized === 'dark' || normalized === 'light') {
            return true;
        }
        const match = normalized.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return false;
        }
        const pairCandidate = `${match[1]}-${match[2] === 'dark' ? 'light' : 'dark'}`;
        return Object.prototype.hasOwnProperty.call(this.customThemes || {}, pairCandidate);
    }

    updateAutoDarkModeAvailability(themeId, settings, callbacks = {}, options = {}) {
        const checkbox = document.getElementById('auto-dark-mode-checkbox');
        const hint = document.getElementById('auto-dark-mode-unavailable-hint');
        const formGroup = document.getElementById('auto-dark-mode-form-group');
        if (!checkbox) return;

        const supported = this.themeSupportsAutoDarkMode(themeId);
        checkbox.disabled = !supported;
        if (formGroup) {
            formGroup.classList.toggle('auto-dark-mode-unavailable', !supported);
        }
        if (hint) {
            hint.hidden = supported;
        }

        if (!supported && settings?.autoDarkMode) {
            settings.autoDarkMode = false;
            checkbox.checked = false;
            if (callbacks.onAutoDarkModeChange) {
                callbacks.onAutoDarkModeChange(false);
            } else {
                this.applyAutoDarkMode(false, settings);
            }
            if (options.markDirtyOnDisable) {
                window.configManager?.markDirty?.();
            }
        }

        this.updateSystemAppearanceBadge(settings?.theme);
    }

    updateSystemAppearanceBadge(themeId) {
        const badge = document.getElementById('system-appearance-badge');
        if (!badge) return;

        if (!window.matchMedia) {
            badge.hidden = true;
            return;
        }

        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const labelKey = isDark ? 'config.systemAppearanceDark' : 'config.systemAppearanceLight';
        let label = this.t(labelKey);
        if (!label || label === labelKey) {
            label = isDark ? 'System: dark' : 'System: light';
        }

        badge.textContent = label;
        badge.hidden = false;
        badge.classList.toggle('is-dark', isDark);
        badge.classList.toggle('is-light', !isDark);

        const supported = themeId ? this.themeSupportsAutoDarkMode(themeId) : true;
        const autoDarkOn = Boolean(document.getElementById('auto-dark-mode-checkbox')?.checked);
        badge.classList.toggle('is-active', supported && autoDarkOn);
        badge.classList.toggle('is-muted', !supported);

        const titleKey = supported
            ? (autoDarkOn ? 'config.systemAppearanceHintActive' : 'config.systemAppearanceHintIdle')
            : 'config.systemAppearanceHintUnsupported';
        const title = this.t(titleKey);
        if (title && title !== titleKey) {
            badge.setAttribute('title', title);
        } else {
            badge.removeAttribute('title');
        }
    }

    initSystemAppearanceBadge(settings) {
        this.updateSystemAppearanceBadge(settings?.theme);
        if (this._systemAppearanceListenerAttached || !window.matchMedia) return;

        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => this.updateSystemAppearanceBadge(settings?.theme);
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', onChange);
        } else if (typeof media.addListener === 'function') {
            media.addListener(onChange);
        }
        this._systemAppearanceListenerAttached = true;
    }

    bindInfoButton(buttonId, titleKey, messageKey) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        btn.setAttribute('data-i18n-aria', titleKey);
        const applyAria = () => {
            const title = this.t(titleKey);
            if (title !== titleKey) btn.setAttribute('aria-label', title);
        };
        applyAria();
        if (!btn.dataset.settingInfoBound) {
            btn.dataset.settingInfoBound = 'true';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!window.AppModal) return;
                window.AppModal.alert({
                    title: this.t(titleKey),
                    htmlMessage: this.t(messageKey).replace(/\n/g, '<br>'),
                    confirmText: this.t('config.gotIt')
                });
            });
        }
    }

    /** Bind ℹ help modals for all settings (buttons live in config.html template). */
    bindAllSettingInfoButtons() {
        const defs = typeof window.SETTING_INFO_DEFS !== 'undefined' ? window.SETTING_INFO_DEFS : [];
        defs.forEach((def) => {
            this.bindInfoButton(def.btnId, `config.${def.title}`, `config.${def.message}`);
        });
    }

    updateLayoutDensityPreview(layoutPreset, densityMode, layoutVersion) {
        const cfg = (suffix, fallback = '') => {
            const flat = this.language?.translations?.config?.[suffix];
            if (typeof flat === 'string') return flat;
            const key = `config.${suffix}`;
            const v =
                this.language && typeof this.language.t === 'function' ? this.language.t(key) : key;
            return v && v !== key ? v : fallback;
        };
        const layoutPresets = window.LayoutUtils?.getLayoutPresets?.()
            || ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets', 'launcher'];
        const layoutVersions = window.LayoutVersionUtils?.getLayoutVersions?.() || ['classic', 'modern'];
        const densityModes = ['comfortable', 'compact', 'dense', 'auto'];
        const layoutKey = layoutPresets.includes(layoutPreset) ? layoutPreset : 'default';
        const versionKey = layoutVersions.includes(layoutVersion) ? layoutVersion : 'classic';
        const densityKey = densityModes.includes(densityMode) ? densityMode : 'compact';

        const layoutVersionDescription = document.getElementById('layout-version-description');
        const layoutDescription = document.getElementById('layout-preset-description');
        const densityDescription = document.getElementById('density-mode-description');
        const previewText = document.getElementById('layout-density-preview-text');

        const versionDesc = cfg(`layoutVersionDesc.${versionKey}`, '');
        const layoutDesc = cfg(`layoutPresetDesc.${layoutKey}`, '');
        const densityDesc = cfg(`densityDesc.${densityKey}`, '');
        const versionLabel = cfg(`layoutVersionName.${versionKey}`, versionKey);
        const layoutLabel = cfg(`layoutPresetName.${layoutKey}`, layoutKey);
        const densityLabel = cfg(`densityName.${densityKey}`, densityKey);

        if (layoutVersionDescription) {
            layoutVersionDescription.textContent = versionDesc || cfg('layoutVersionDescIntro', '');
        }
        if (layoutDescription) {
            layoutDescription.textContent = layoutDesc || cfg('layoutPresetDescIntro', '');
        }
        if (densityDescription) {
            densityDescription.textContent = densityDesc || cfg('densityDescIntro', '');
        }
        if (previewText) {
            const template = cfg(
                'layoutDensityPreview',
                '{version} · {layout} + {density}: {detail}'
            );
            previewText.textContent = template
                .replace('{version}', versionLabel)
                .replace('{layout}', layoutLabel)
                .replace('{density}', densityLabel)
                .replace('{detail}', (layoutDesc || '').toLowerCase());
        }
    }

    formatPageIds(ids) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return '';
        }
        return ids.join(', ');
    }

    parsePageIds(value) {
        if (!value || !value.trim()) {
            return [];
        }
        const unique = new Set();
        value.split(',').forEach((part) => {
            const parsed = parseInt(part.trim(), 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                unique.add(parsed);
            }
        });
        return Array.from(unique).sort((a, b) => a - b);
    }

    getSelectedPageIds(selectElement) {
        if (!selectElement) {
            return [];
        }
        return Array.from(selectElement.selectedOptions || [])
            .map((option) => Number(option.value))
            .filter((value) => Number.isFinite(value) && value > 0)
            .sort((a, b) => a - b);
    }

    populateSmartPageSelector(selectElement, pages, selectedPageIds) {
        if (!selectElement) {
            return;
        }

        const selected = new Set(
            (Array.isArray(selectedPageIds) ? selectedPageIds : [])
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0)
        );

        selectElement.innerHTML = '';
        (Array.isArray(pages) ? pages : []).forEach((page, index) => {
            const pageId = Number(page.id);
            if (!Number.isFinite(pageId) || pageId <= 0) {
                return;
            }

            const option = document.createElement('option');
            option.value = String(pageId);
            option.textContent = `${index + 1}. ${page.name || `${this.t('config.pagePrefix')} ${index + 1}`}`;
            option.selected = selected.has(pageId);
            selectElement.appendChild(option);
        });
    }

    populateSmartPageSelectors(pages, settings) {
        this.populateSmartPageSelector(
            document.getElementById('smart-today-pages-select'),
            pages,
            settings?.smartTodayPageIds || []
        );
        this.populateSmartPageSelector(
            document.getElementById('smart-recent-pages-select'),
            pages,
            settings?.smartRecentPageIds || []
        );
        this.populateSmartPageSelector(
            document.getElementById('smart-stale-pages-select'),
            pages,
            settings?.smartStalePageIds || []
        );
        this.populateSmartPageSelector(
            document.getElementById('smart-most-used-pages-select'),
            pages,
            settings?.smartMostUsedPageIds || []
        );
    }

    toggleSmartCollectionControls(type, enabled) {
        const map = {
            today: [
                'smart-today-pages-select',
                'smart-today-limit-select',
                'smart-today-work-keywords-input',
                'smart-today-evening-keywords-input',
                'smart-today-weekend-keywords-input'
            ],
            recent: ['smart-recent-pages-select', 'smart-recent-limit-select'],
            stale: ['smart-stale-pages-select', 'smart-stale-limit-select'],
            mostUsed: ['smart-most-used-pages-select', 'smart-most-used-limit-select']
        };
        (map[type] || []).forEach((id) => {
            this.setDependentControlState([id], enabled);
        });
    }

    async loadCustomThemes() {
        try {
            const [themesResponse, colorsResponse] = await Promise.all([
                fetch('/api/colors/custom-themes'),
                fetch('/api/colors')
            ]);
            if (themesResponse.ok) {
                this.customThemes = await themesResponse.json();
                window.CustomThemeIds = Array.isArray(this.customThemes)
                    ? this.customThemes
                    : Object.keys(this.customThemes || {});
            } else {
                this.customThemes = {};
                window.CustomThemeIds = [];
            }
            if (colorsResponse.ok) {
                const colors = await colorsResponse.json();
                this.userCustomThemeIds = new Set(Object.keys(colors?.custom || {}));
                window.UserCustomThemeIds = [...this.userCustomThemeIds];
            } else {
                this.userCustomThemeIds = new Set();
                window.UserCustomThemeIds = [];
            }
        } catch (error) {
            console.error('Error loading custom themes:', error);
            this.customThemes = {};
            this.userCustomThemeIds = new Set();
            window.CustomThemeIds = [];
            window.UserCustomThemeIds = [];
            window.AppNotification?.show?.(
                this.t('config.errorLoadingThemes') || 'Failed to load custom themes.',
                'warning',
                { durationMs: 5000 }
            );
        }
    }

    populateThemeSelect() {
        const themeSelect = document.getElementById('theme-select');
        if (!themeSelect) return;

        const currentValue = themeSelect.value;

        const allThemes = {
            dark: this.t('dashboard.darkTheme') || 'Dark',
            light: this.t('dashboard.lightTheme') || 'Light',
            ...(this.customThemes || {})
        };
        const sortedThemes = Object.entries(allThemes).sort(([idA, valueA], [idB, valueB]) => {
            const labelA = this.getThemeDisplayName(idA, valueA);
            const labelB = this.getThemeDisplayName(idB, valueB);
            return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
        });

        themeSelect.innerHTML = '';
        sortedThemes.forEach(([themeId, themeValue]) => {
            const option = document.createElement('option');
            option.value = themeId;
            option.textContent = this.getThemeDisplayName(themeId, themeValue);
            themeSelect.appendChild(option);
        });

        if (currentValue) {
            themeSelect.value = currentValue;
        }

        if (typeof configManager !== 'undefined' && typeof configManager.refreshCustomSelects === 'function') {
            configManager.refreshCustomSelects();
        }

        if (this._currentSettings) {
            this.updateAutoDarkModeAvailability(
                this._currentSettings.theme,
                this._currentSettings,
                this._settingsCallbacks || {}
            );
        }
    }

    /**
     * Setup event listeners for all settings controls
     * @param {Object} settings - Reference to settings object
     * @param {Function} callbacks - Object with callback functions
     */
    async setupListeners(settings, callbacks) {
        this._currentSettings = settings;
        this._settingsCallbacks = callbacks;
        await this.loadCustomThemes();
        this.populateThemeSelect();
        
        // Language select
        const languageSelect = document.getElementById('language-select');
        if (languageSelect) {
            this.language.setupLanguageSelector();
            languageSelect.addEventListener('change', async (e) => {
                const newLang = e.target.value;
                settings.language = newLang;
                await this.language.loadTranslations(newLang);
                this.updateSystemAppearanceBadge(settings.theme);
                await this.saveSettingsToServer(settings);
            });
        }
        
        // Theme select
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            const preferredTheme = this.normalizeThemeId(settings.theme || 'dark');
            const hasPreferredTheme = Array.from(themeSelect.options).some(option => option.value === preferredTheme);
            themeSelect.value = hasPreferredTheme ? preferredTheme : 'dark';
            settings.theme = themeSelect.value;
            themeSelect.addEventListener('change', async (e) => {
                settings.theme = e.target.value;
                this.updateAutoDarkModeAvailability(settings.theme, settings, callbacks, { markDirtyOnDisable: true });
                if (callbacks.onThemeChange) {
                    await callbacks.onThemeChange(settings.theme);
                } else {
                    this.reloadThemeCSS();
                    this.updateAutoPreview(settings.theme);
                    this.applyBackground(settings);
                }
            });
        }

        // Background picker
        this.populateBackgroundPresets();
        this.syncBgTypeUI(settings.backgroundType || 'none');
        this.syncPresetUI(settings.backgroundGradient || '');
        this.updateAutoPreview(settings.theme || '');
        this.applyBackground(settings);
        const bgImageUrlInput = document.getElementById('bg-image-url-input');
        if (bgImageUrlInput) {
            bgImageUrlInput.value = settings.backgroundImageUrl || '';
        }
        document.querySelectorAll('.bg-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                settings.backgroundType = btn.dataset.bgType;
                this.syncBgTypeUI(settings.backgroundType);
                this.applyBackground(settings);
            });
        });
        if (bgImageUrlInput) {
            bgImageUrlInput.addEventListener('input', (e) => {
                settings.backgroundImageUrl = e.target.value;
                this.applyBackground(settings);
            });
        }

        // Columns input
        const columnsInput = document.getElementById('columns-input');
        if (columnsInput) {
            columnsInput.value = settings.columnsPerRow;
            columnsInput.addEventListener('input', (e) => {
                settings.columnsPerRow = parseInt(e.target.value);
            });
        }

        const sortMethodSelect = document.getElementById('sort-method-select');
        if (sortMethodSelect) {
            sortMethodSelect.value = settings.sortMethod || 'order';
            sortMethodSelect.addEventListener('change', (e) => {
                settings.sortMethod = e.target.value;
            });
        }

        const layoutVersionSelect = document.getElementById('layout-version-select');
        if (layoutVersionSelect) {
            const versions = window.LayoutVersionUtils?.getLayoutVersions?.() || ['classic', 'modern'];
            const VERSION_LABELS = {
                classic: 'Classic',
                modern: 'Modern'
            };
            layoutVersionSelect.innerHTML = versions.map((version) => {
                const label = VERSION_LABELS[version] || (version.charAt(0).toUpperCase() + version.slice(1));
                return `<option value="${version}">${label}</option>`;
            }).join('');
            if (window.LayoutVersionUtils) {
                settings.layoutVersion = window.LayoutVersionUtils.normalizeLayoutVersion(settings.layoutVersion || 'classic');
            }
            layoutVersionSelect.value = settings.layoutVersion || 'classic';
            if (callbacks.onLayoutVersionChange) {
                callbacks.onLayoutVersionChange(layoutVersionSelect.value);
            }
            this.updateLayoutDensityPreview(
                settings.layoutPreset || 'default',
                settings.densityMode || 'compact',
                settings.layoutVersion || 'classic'
            );
            layoutVersionSelect.addEventListener('change', (e) => {
                settings.layoutVersion = window.LayoutVersionUtils
                    ? window.LayoutVersionUtils.normalizeLayoutVersion(e.target.value)
                    : e.target.value;
                if (callbacks.onLayoutVersionChange) {
                    callbacks.onLayoutVersionChange(settings.layoutVersion);
                }
                this.updateLayoutDensityPreview(
                    settings.layoutPreset || 'default',
                    settings.densityMode || 'compact',
                    settings.layoutVersion
                );
            });
        }

        const layoutPresetSelect = document.getElementById('layout-preset-select');
        if (layoutPresetSelect) {
            if (window.LayoutUtils) {
                const presets = window.LayoutUtils.getLayoutPresets();
                const LABEL_MAP = {
                    terminal: 'Terminal-ish',
                    masonry: 'Masonry',
                    list: 'List (detailed)',
                    widgets: 'Widgets / Modules',
                    compact: 'Compact',
                    cards: 'Cards',
                    default: 'Default',
                    launcher: 'Launcher'
                };
                layoutPresetSelect.innerHTML = presets.map((preset) => {
                    const label = LABEL_MAP[preset] || (preset.charAt(0).toUpperCase() + preset.slice(1));
                    return `<option value="${preset}">${label}</option>`;
                }).join('');
                settings.layoutPreset = window.LayoutUtils.normalizeLayoutPreset(settings.layoutPreset || 'default');
            }
            layoutPresetSelect.value = settings.layoutPreset || 'default';
            if (callbacks.onLayoutPresetChange) {
                callbacks.onLayoutPresetChange(layoutPresetSelect.value);
            }
            this.updateLayoutDensityPreview(
                settings.layoutPreset || 'default',
                settings.densityMode || 'compact',
                settings.layoutVersion || 'classic'
            );
            layoutPresetSelect.addEventListener('change', (e) => {
                settings.layoutPreset = window.LayoutUtils
                    ? window.LayoutUtils.normalizeLayoutPreset(e.target.value)
                    : e.target.value;
                if (callbacks.onLayoutPresetChange) callbacks.onLayoutPresetChange(settings.layoutPreset);
                this.updateLayoutDensityPreview(
                    settings.layoutPreset,
                    settings.densityMode || 'compact',
                    settings.layoutVersion || 'classic'
                );
            });
        }

        const densityModeSelect = document.getElementById('density-mode-select');
        if (densityModeSelect) {
            const DENSITIES = ['comfortable', 'compact', 'dense', 'auto'];
            const DENSITY_LABELS = {
                comfortable: 'Comfortable',
                compact: 'Compact',
                dense: 'Dense',
                auto: 'Auto (adaptive)'
            };
            densityModeSelect.innerHTML = DENSITIES.map(d => `<option value="${d}">${DENSITY_LABELS[d] || d}</option>`).join('');

            const normalizedDensity = DENSITIES.includes(settings.densityMode) ? settings.densityMode : 'compact';
            settings.densityMode = normalizedDensity;
            densityModeSelect.value = normalizedDensity;
            this.updateLayoutDensityPreview(
                settings.layoutPreset || 'default',
                normalizedDensity,
                settings.layoutVersion || 'classic'
            );

            densityModeSelect.addEventListener('change', (e) => {
                const value = DENSITIES.includes(e.target.value) ? e.target.value : 'compact';
                settings.densityMode = value;
                if (callbacks.onDensityModeChange) callbacks.onDensityModeChange(value);
                this.updateLayoutDensityPreview(
                    settings.layoutPreset || 'default',
                    value,
                    settings.layoutVersion || 'classic'
                );
            });
        }

        const packedColumnsCheckbox = document.getElementById('packed-columns-checkbox');
        if (packedColumnsCheckbox) {
            packedColumnsCheckbox.checked = settings.packedColumns === true;
            packedColumnsCheckbox.addEventListener('change', async (e) => {
                settings.packedColumns = e.target.checked;
                if (callbacks.onPackedColumnsChange) {
                    await callbacks.onPackedColumnsChange(settings.packedColumns === true);
                }
            });
        }

        const launcherIconSizeSelect = document.getElementById('launcher-icon-size-select');
        if (launcherIconSizeSelect) {
            const validSizes = ['small', 'normal', 'large'];
            launcherIconSizeSelect.value = validSizes.includes(settings.launcherIconSize) ? settings.launcherIconSize : 'normal';
            launcherIconSizeSelect.addEventListener('change', (e) => {
                settings.launcherIconSize = e.target.value;
                if (callbacks.onLauncherIconSizeChange) callbacks.onLauncherIconSizeChange(settings.launcherIconSize);
            });
        }

        const calendarUrlInput = document.getElementById('calendar-url-input');
        if (calendarUrlInput) {
            calendarUrlInput.value = settings.calendarUrl || '';
            calendarUrlInput.addEventListener('input', (e) => {
                settings.calendarUrl = e.target.value.trim();
                if (callbacks.onCalendarUrlChange) callbacks.onCalendarUrlChange(settings.calendarUrl);
            });
        }

        const buttonBarPositionSelect = document.getElementById('button-bar-position-select');

        if (buttonBarPositionSelect) {
            const validPositions = ['bottom', 'bottom-left', 'bottom-right'];
            buttonBarPositionSelect.value = validPositions.includes(settings.buttonBarPosition) ? settings.buttonBarPosition : 'bottom';
            buttonBarPositionSelect.addEventListener('change', () => {
                if (callbacks.onButtonBarPositionChange) callbacks.onButtonBarPositionChange();
            });
        }

        const autoDarkModeCheckbox = document.getElementById('auto-dark-mode-checkbox');
        if (autoDarkModeCheckbox) {
            autoDarkModeCheckbox.checked = settings.autoDarkMode === true;
            autoDarkModeCheckbox.addEventListener('change', (e) => {
                if (!this.themeSupportsAutoDarkMode(settings.theme)) {
                    e.target.checked = false;
                    settings.autoDarkMode = false;
                    return;
                }
                settings.autoDarkMode = e.target.checked;
                if (callbacks.onAutoDarkModeChange) callbacks.onAutoDarkModeChange(settings.autoDarkMode);
                this.updateSystemAppearanceBadge(settings.theme);
            });
            this.updateAutoDarkModeAvailability(settings.theme, settings, callbacks);
            this.initSystemAppearanceBadge(settings);
        }

        const backgroundOpacityInput = document.getElementById('background-opacity-input');
        const backgroundOpacityValue = document.getElementById('background-opacity-value');
        if (backgroundOpacityInput) {
            const initialOpacity = Number(settings.backgroundOpacity ?? 1);
            backgroundOpacityInput.value = String(initialOpacity);
            const setOpacitySliderFill = (value) => {
                const min = Number(backgroundOpacityInput.min || 0.65);
                const max = Number(backgroundOpacityInput.max || 1);
                const clamped = Math.min(max, Math.max(min, Number(value)));
                const ratio = max > min ? ((clamped - min) / (max - min)) : 1;
                backgroundOpacityInput.style.setProperty('--slider-fill', `${Math.round(ratio * 100)}%`);
            };
            setOpacitySliderFill(initialOpacity);
            if (backgroundOpacityValue) {
                backgroundOpacityValue.textContent = `${Math.round(initialOpacity * 100)}%`;
            }
            backgroundOpacityInput.addEventListener('input', (e) => {
                const value = Number(e.target.value);
                settings.backgroundOpacity = value;
                setOpacitySliderFill(value);
                if (backgroundOpacityValue) {
                    backgroundOpacityValue.textContent = `${Math.round(value * 100)}%`;
                }
                if (callbacks.onBackgroundOpacityChange) callbacks.onBackgroundOpacityChange(value);
            });
        }

        const fontWeightSelect = document.getElementById('font-weight-select');
        if (fontWeightSelect) {
            fontWeightSelect.value = settings.fontWeight || 'normal';
            fontWeightSelect.addEventListener('change', (e) => {
                settings.fontWeight = e.target.value;
                if (callbacks.onFontWeightChange) callbacks.onFontWeightChange(settings.fontWeight);
            });
        }

        const fontPresetSelect = document.getElementById('font-preset-select');
        if (fontPresetSelect && window.DashboardFont) {
            this.syncFontPresetDropdown(settings);
            fontPresetSelect.addEventListener('change', (e) => {
                const path = settings.customFontPath && String(settings.customFontPath).trim();
                const v = window.DashboardFont.normalizePresetId(e.target.value, path);
                settings.fontPreset = v;
                settings.enableCustomFont = v === 'custom';
                fontPresetSelect.value = v;
                if (callbacks.onFontPresetChange) callbacks.onFontPresetChange(v);
            });
        }

        const customFontInput = document.getElementById('custom-font-input');
        if (customFontInput) {
            customFontInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file || !window.ConfigFont || typeof window.ConfigFont.uploadFont !== 'function') {
                    return;
                }
                try {
                    const path = await window.ConfigFont.uploadFont(file);
                    settings.customFontPath = path;
                    settings.fontPreset = 'custom';
                    settings.enableCustomFont = true;
                    this.syncFontPresetDropdown(settings);
                    if (window.DashboardFont) {
                        window.DashboardFont.applyMainFont(settings);
                    }
                    const ok = await this.saveSettingsToServer(settings);
                    if (ok) {
                        if (window.ConfigManager?.signalDashboardSettingsUpdated) {
                            window.ConfigManager.signalDashboardSettingsUpdated('settings-updated');
                        }
                        const msg = this.t('config.fontUploadSuccess', 'Font uploaded. Select it from the UI font dropdown anytime.');
                        if (window.ConfigManager?.ui?.showNotification) {
                            window.ConfigManager.ui.showNotification(msg, 'success');
                        }
                    } else {
                        throw new Error('save failed');
                    }
                } catch (error) {
                    console.error('Error uploading font:', error);
                    const msg = this.t('config.fontUploadError', 'Font upload failed. Use .woff, .woff2, .ttf, or .otf (max 5 MB).');
                    if (window.ConfigManager?.ui?.showNotification) {
                        window.ConfigManager.ui.showNotification(msg, 'error');
                    }
                    const statusEl = document.getElementById('custom-font-status');
                    if (statusEl) {
                        statusEl.className = 'setting-hint font-upload-status is-error';
                        statusEl.innerHTML = `<span class="font-upload-status-icon" aria-hidden="true">✕</span><span>${msg}</span>`;
                    }
                }
            });
        }

        // Font size selector buttons
        const fontSizeOptions = document.querySelectorAll('.font-size-option');

        if (fontSizeOptions.length > 0) {
            // Normalize legacy alias values (if any) to current map
            const aliasMap = {
                small: 'sm',
                medium: 'm',
                large: 'l'
            };

            let fontSizeValue = settings.fontSize;
            if (fontSizeValue && aliasMap[fontSizeValue]) {
                fontSizeValue = aliasMap[fontSizeValue];
            }

            // Set initial active button
            const initialSize = fontSizeValue || 'm';
            fontSizeOptions.forEach(btn => {
                if (btn.dataset.size === initialSize) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            // Ensure the current font size is applied immediately
            settings.fontSize = initialSize;
            if (callbacks.onFontSizeChange) callbacks.onFontSizeChange(settings.fontSize);

            // Listen for changes
            fontSizeOptions.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const fontSize = e.target.dataset.size;
                    settings.fontSize = fontSize;

                    // Update active state
                    fontSizeOptions.forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');

                    if (callbacks.onFontSizeChange) callbacks.onFontSizeChange(settings.fontSize);
                });
            });
        }

        // New tab checkbox
        const newTabCheckbox = document.getElementById('new-tab-checkbox');
        if (newTabCheckbox) {
            newTabCheckbox.checked = settings.openInNewTab;
            newTabCheckbox.addEventListener('change', (e) => {
                settings.openInNewTab = e.target.checked;
            });
        }

        const pasteUrlQuickAddCheckbox = document.getElementById('paste-url-quick-add-checkbox');
        if (pasteUrlQuickAddCheckbox) {
            pasteUrlQuickAddCheckbox.checked = settings.pasteUrlQuickAdd !== false;
            pasteUrlQuickAddCheckbox.addEventListener('change', (e) => {
                settings.pasteUrlQuickAdd = e.target.checked;
            });
        }

        // HyprMode checkbox
        const allowLocalBookmarksCheckbox = document.getElementById('allow-local-bookmarks-checkbox');
        if (allowLocalBookmarksCheckbox) {
            allowLocalBookmarksCheckbox.checked = settings.allowLocalBookmarks !== false;
            allowLocalBookmarksCheckbox.addEventListener('change', (e) => {
                settings.allowLocalBookmarks = e.target.checked;
            });
        }

        const hyprModeCheckbox = document.getElementById('hypr-mode-checkbox');
        if (hyprModeCheckbox) {
            hyprModeCheckbox.checked = settings.hyprMode || false;
            hyprModeCheckbox.addEventListener('change', (e) => {
                settings.hyprMode = e.target.checked;
                // Disable preview if callback is provided
                if (callbacks.onHyprModeChange) callbacks.onHyprModeChange(settings.hyprMode);
            });
        }

        const showSearchFlowBannerCheckbox = document.getElementById('show-search-flow-banner-checkbox');
        if (showSearchFlowBannerCheckbox) {
            showSearchFlowBannerCheckbox.checked = settings.showSearchFlowBanner !== false;
            showSearchFlowBannerCheckbox.addEventListener('change', (e) => {
                settings.showSearchFlowBanner = e.target.checked;
            });
        }

        this.bindInfoButton('hypr-mode-info-btn', 'config.hyprModeInfoTitle', 'config.hyprModeInfoMessage');
        this.bindInfoButton('interleave-mode-info-btn', 'config.interleaveModeInfoTitle', 'config.interleaveModeInfoMessage');
        this.bindInfoButton('show-search-flow-banner-info-btn', 'config.showSearchFlowBannerInfoTitle', 'config.showSearchFlowBannerInfoMessage');
        this.bindInfoButton('fuzzy-suggestions-info-btn', 'config.fuzzySuggestionsInfoTitle', 'config.fuzzySuggestionsInfoMessage');
        this.bindInfoButton('include-finders-in-search-info-btn', 'config.includeFindersInSearchInfoTitle', 'config.includeFindersInSearchInfoMessage');
        this.bindInfoButton('packed-columns-info-btn', 'config.packedColumnsInfoTitle', 'config.packedColumnsInfoMessage');
        this.bindInfoButton('show-page-names-in-tabs-info-btn', 'config.showPageNamesInTabsInfoTitle', 'config.showPageNamesInTabsInfoMessage');
        this.bindInfoButton('show-page-tabs-info-btn', 'config.showPageTabsInfoTitle', 'config.showPageTabsInfoMessage');
        this.bindInfoButton('always-collapse-categories-info-btn', 'config.alwaysCollapseCategoriesInfoTitle', 'config.alwaysCollapseCategoriesInfoMessage');
        this.bindInfoButton('global-shortcuts-info-btn', 'config.globalShortcutsInfoTitle', 'config.globalShortcutsInfoMessage');
        this.bindInfoButton('show-tips-info-btn', 'config.showTipsInfoTitle', 'config.showTipsInfoMessage');
        this.bindInfoButton(
            'show-tag-cloud-button-info-btn',
            'config.showTagCloudButtonInfoTitle',
            'config.showTagCloudButtonInfoMessage'
        );
        this.bindInfoButton('keep-search-open-when-empty-info-btn', 'config.keepSearchOpenWhenEmptyInfoTitle', 'config.keepSearchOpenWhenEmptyInfoMessage');
        this.bindInfoButton('show-status-info-btn', 'config.showBookmarkStatusInfoTitle', 'config.showBookmarkStatusInfoMessage');
        this.bindInfoButton('show-health-dashboard-info-btn', 'config.showHealthDashboardInfoTitle', 'config.showHealthDashboardInfoMessage');
        this.bindInfoButton('skip-fast-ping-info-btn', 'config.skipFastPingInfoTitle', 'config.skipFastPingInfoMessage');
        this.bindInfoButton('status-offline-retries-info-btn', 'config.statusOfflineRetriesInfoTitle', 'config.statusOfflineRetriesInfoMessage');
        this.bindInfoButton('status-offline-retry-delay-info-btn', 'config.statusOfflineRetryDelayInfoTitle', 'config.statusOfflineRetryDelayInfoMessage');
        this.bindInfoButton('status-recheck-interval-info-btn', 'config.statusRecheckIntervalInfoTitle', 'config.statusRecheckIntervalInfoMessage');
        this.bindInfoButton('show-sync-toasts-info-btn', 'config.showSyncToastsInfoTitle', 'config.showSyncToastsInfoMessage');
        this.bindAllSettingInfoButtons();

        // Show background dots checkbox
        const showBackgroundDotsCheckbox = document.getElementById('show-background-dots-checkbox');
        if (showBackgroundDotsCheckbox) {
            showBackgroundDotsCheckbox.checked = settings.showBackgroundDots !== false;
            showBackgroundDotsCheckbox.addEventListener('change', (e) => {
                settings.showBackgroundDots = e.target.checked;
                if (callbacks.onBackgroundDotsChange) callbacks.onBackgroundDotsChange(e.target.checked);
                this.applyBackground(settings);
            });
        }

        // Show icons checkbox
        const showIconsCheckbox = document.getElementById('show-icons-checkbox');
        if (showIconsCheckbox) {
            showIconsCheckbox.checked = settings.showIcons !== false;
            showIconsCheckbox.addEventListener('change', (e) => {
                settings.showIcons = e.target.checked;
            });
        }

        const showLinkPreviewCardsCheckbox = document.getElementById('show-link-preview-cards-checkbox');
        const linkPreviewHoverDelaySelect = document.getElementById('link-preview-hover-delay-select');
        if (showLinkPreviewCardsCheckbox) {
            showLinkPreviewCardsCheckbox.checked = settings.showLinkPreviewCards === true;
            showLinkPreviewCardsCheckbox.addEventListener('change', (e) => {
                settings.showLinkPreviewCards = e.target.checked;
                this.setDependentControlState(['link-preview-hover-delay-select'], e.target.checked);
            });
        }
        if (linkPreviewHoverDelaySelect) {
            const currentDelay = Number(settings.linkPreviewHoverDelayMs ?? 150);
            const normalizedDelay = [100, 150, 250].includes(currentDelay) ? currentDelay : 150;
            linkPreviewHoverDelaySelect.value = String(normalizedDelay);
            this.setDependentControlState(['link-preview-hover-delay-select'], settings.showLinkPreviewCards === true);
            linkPreviewHoverDelaySelect.addEventListener('change', (e) => {
                const value = Number(e.target.value);
                settings.linkPreviewHoverDelayMs = [100, 150, 250].includes(value) ? value : 150;
            });
        }

        const showShortcutsCheckbox = document.getElementById('show-shortcuts-checkbox');
        if (showShortcutsCheckbox) {
            showShortcutsCheckbox.checked = settings.showShortcuts !== false;
            showShortcutsCheckbox.addEventListener('change', (e) => {
                settings.showShortcuts = e.target.checked;
            });
        }

        const showPinIconCheckbox = document.getElementById('show-pin-icon-checkbox');
        if (showPinIconCheckbox) {
            showPinIconCheckbox.checked = settings.showPinIcon === true;
            showPinIconCheckbox.addEventListener('change', (e) => {
                settings.showPinIcon = e.target.checked;
            });
        }

        const showNoteIconCheckbox = document.getElementById('show-note-icon-checkbox');
        if (showNoteIconCheckbox) {
            showNoteIconCheckbox.checked = settings.showNoteIcon !== false;
            showNoteIconCheckbox.addEventListener('change', (e) => {
                settings.showNoteIcon = e.target.checked;
            });
        }

        // Show title checkbox
        const showTitleCheckbox = document.getElementById('show-title-checkbox');
        if (showTitleCheckbox) {
            showTitleCheckbox.checked = settings.showTitle;
            showTitleCheckbox.addEventListener('change', (e) => {
                settings.showTitle = e.target.checked;
            });
        }

        // Enable custom title checkbox
        const enableCustomTitleCheckbox = document.getElementById('enable-custom-title-checkbox');
        if (enableCustomTitleCheckbox) {
            enableCustomTitleCheckbox.checked = settings.enableCustomTitle;
            enableCustomTitleCheckbox.addEventListener('change', (e) => {
                settings.enableCustomTitle = e.target.checked;
                this.toggleCustomTitleInput(e.target.checked);
            });
        }

        // Custom title input
        const customTitleInput = document.getElementById('custom-title-input');
        if (customTitleInput) {
            customTitleInput.value = settings.customTitle || '';
            customTitleInput.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                settings.customTitle = value;
                
                // Auto-enable checkbox when user starts typing (only if not already enabled)
                if (value && !settings.enableCustomTitle) {
                    settings.enableCustomTitle = true;
                    const checkbox = document.getElementById('enable-custom-title-checkbox');
                    if (checkbox) checkbox.checked = true;
                    this.toggleCustomTitleInput(true);
                }
            });
            // Initial visibility
            this.toggleCustomTitleInput(settings.enableCustomTitle);
        }

        // Enable custom favicon checkbox
        const enableCustomFaviconCheckbox = document.getElementById('enable-custom-favicon-checkbox');
        if (enableCustomFaviconCheckbox) {
            enableCustomFaviconCheckbox.checked = settings.enableCustomFavicon;
            enableCustomFaviconCheckbox.addEventListener('change', async (e) => {
                settings.enableCustomFavicon = e.target.checked;
                this.toggleCustomFaviconInput(e.target.checked);
                // Always save to server regardless of device-specific settings
                await this.saveSettingsToServer(settings);
            });
        }

        // Custom favicon input
        const customFaviconInput = document.getElementById('custom-favicon-input');
        if (customFaviconInput) {
            customFaviconInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const formData = new FormData();
                    formData.append('favicon', file);

                    try {
                        const response = await fetch('/api/favicon', {
                            method: 'POST',
                            body: formData
                        });

                        if (response.ok) {
                            const result = await response.json();
                            settings.customFaviconPath = result.path;
                            // Auto-enable checkbox when user uploads a file
                            if (!settings.enableCustomFavicon) {
                                settings.enableCustomFavicon = true;
                                const checkbox = document.getElementById('enable-custom-favicon-checkbox');
                                if (checkbox) checkbox.checked = true;
                                this.toggleCustomFaviconInput(true);
                            }
                            // Always save to server regardless of device-specific settings
                            await this.saveSettingsToServer(settings);
                        } else {
                            console.error('Failed to upload favicon');
                        }
                    } catch (error) {
                        console.error('Error uploading favicon:', error);
                    }
                }
            });
            // Initial visibility
            this.toggleCustomFaviconInput(settings.enableCustomFavicon);
        }


        // Show page in title checkbox
        const showPageInTitleCheckbox = document.getElementById('show-page-in-title-checkbox');
        if (showPageInTitleCheckbox) {
            showPageInTitleCheckbox.checked = settings.showPageInTitle;
            showPageInTitleCheckbox.addEventListener('change', (e) => {
                settings.showPageInTitle = e.target.checked;
            });
        }

        // Show date checkbox
        const showDateCheckbox = document.getElementById('show-date-checkbox');
        if (showDateCheckbox) {
            showDateCheckbox.checked = settings.showDate;
            showDateCheckbox.addEventListener('change', (e) => {
                settings.showDate = e.target.checked;
            });
        }

        const showTimeCheckbox = document.getElementById('show-time-checkbox');
        if (showTimeCheckbox) {
            showTimeCheckbox.checked = settings.showTime !== false;
            showTimeCheckbox.addEventListener('change', (e) => {
                settings.showTime = e.target.checked;
            });
        }

        const timeFormatSelect = document.getElementById('time-format-select');
        if (timeFormatSelect) {
            const timeFormat = settings.timeFormat === '12h' ? '12h' : '24h';
            settings.timeFormat = timeFormat;
            timeFormatSelect.value = timeFormat;
            timeFormatSelect.addEventListener('change', (e) => {
                settings.timeFormat = e.target.value === '12h' ? '12h' : '24h';
            });
        }

        const dateFormatSelect = document.getElementById('date-format-select');
        if (dateFormatSelect) {
            dateFormatSelect.value = settings.dateFormat || 'short-slash';
            dateFormatSelect.addEventListener('change', (e) => {
                settings.dateFormat = e.target.value;
            });
        }

        const showWeatherWithDateCheckbox = document.getElementById('show-weather-with-date-checkbox');
        if (showWeatherWithDateCheckbox) {
            showWeatherWithDateCheckbox.checked = settings.showWeatherWithDate === true;
            showWeatherWithDateCheckbox.addEventListener('change', (e) => {
                settings.showWeatherWithDate = e.target.checked;
                this.toggleWeatherControls(e.target.checked, settings.weatherSource);
            });
        }

        const weatherSourceSelect = document.getElementById('weather-source-select');
        if (weatherSourceSelect) {
            weatherSourceSelect.value = settings.weatherSource || 'manual';
            weatherSourceSelect.addEventListener('change', (e) => {
                settings.weatherSource = e.target.value;
                this.toggleWeatherManualLocationInput(e.target.value);
            });
        }

        const weatherLocationInput = document.getElementById('weather-location-input');
        if (weatherLocationInput) {
            weatherLocationInput.value = settings.weatherLocation || '';
            weatherLocationInput.addEventListener('input', (e) => {
                settings.weatherLocation = e.target.value.trim();
            });
        }

        const weatherUnitSelect = document.getElementById('weather-unit-select');
        if (weatherUnitSelect) {
            weatherUnitSelect.value = settings.weatherUnit || 'celsius';
            weatherUnitSelect.addEventListener('change', (e) => {
                settings.weatherUnit = e.target.value;
            });
        }

        const weatherRefreshSelect = document.getElementById('weather-refresh-select');
        if (weatherRefreshSelect) {
            const currentRefresh = Number(settings.weatherRefreshMinutes || 30);
            weatherRefreshSelect.value = Number.isFinite(currentRefresh) && currentRefresh > 0 ? String(currentRefresh) : '30';
            weatherRefreshSelect.addEventListener('change', (e) => {
                const value = Number(e.target.value);
                settings.weatherRefreshMinutes = Number.isFinite(value) && value > 0 ? value : 30;
            });
        }
        this.toggleWeatherControls(settings.showWeatherWithDate === true, settings.weatherSource);

        // Show config button checkbox
        const showConfigButtonCheckbox = document.getElementById('show-config-button-checkbox');
        if (showConfigButtonCheckbox) {
            showConfigButtonCheckbox.checked = settings.showConfigButton;
            showConfigButtonCheckbox.addEventListener('change', (e) => {
                settings.showConfigButton = e.target.checked;
            });
        }

        const showHealthDashboardCheckbox = document.getElementById('show-health-dashboard-checkbox');
        if (showHealthDashboardCheckbox) {
            showHealthDashboardCheckbox.checked = settings.showHealthDashboard !== false;
            showHealthDashboardCheckbox.addEventListener('change', (e) => {
                settings.showHealthDashboard = e.target.checked;
            });
        }

        // Show page names in tabs checkbox
        const showPageNamesInTabsCheckbox = document.getElementById('show-page-names-in-tabs-checkbox');
        if (showPageNamesInTabsCheckbox) {
            showPageNamesInTabsCheckbox.checked = settings.showPageNamesInTabs;
            showPageNamesInTabsCheckbox.addEventListener('change', (e) => {
                settings.showPageNamesInTabs = e.target.checked;
            });
        }

        // Show page tabs checkbox
        const showPageTabsCheckbox = document.getElementById('show-page-tabs-checkbox');
        if (showPageTabsCheckbox) {
            showPageTabsCheckbox.checked = settings.showPageTabs;
            showPageTabsCheckbox.addEventListener('change', (e) => {
                settings.showPageTabs = e.target.checked;
            });
        }

        // Always collapse categories checkbox
        const alwaysCollapseCategoriesCheckbox = document.getElementById('always-collapse-categories-checkbox');
        if (alwaysCollapseCategoriesCheckbox) {
            alwaysCollapseCategoriesCheckbox.checked = settings.alwaysCollapseCategories;
            alwaysCollapseCategoriesCheckbox.addEventListener('change', (e) => {
                settings.alwaysCollapseCategories = e.target.checked;
            });
        }

        const showAddBookmarkButtonCheckbox = document.getElementById('show-add-bookmark-button-checkbox');
        if (showAddBookmarkButtonCheckbox) {
            showAddBookmarkButtonCheckbox.checked = settings.showAddBookmarkButton !== false;
            showAddBookmarkButtonCheckbox.addEventListener('change', (e) => {
                settings.showAddBookmarkButton = e.target.checked;
            });
        }

        // Show search button checkbox
        const showSearchButtonCheckbox = document.getElementById('show-search-button-checkbox');
        if (showSearchButtonCheckbox) {
            showSearchButtonCheckbox.checked = settings.showSearchButton;
            showSearchButtonCheckbox.addEventListener('change', (e) => {
                settings.showSearchButton = e.target.checked;
            });
        }

        // Show finders button checkbox
        const showFindersButtonCheckbox = document.getElementById('show-finders-button-checkbox');
        if (showFindersButtonCheckbox) {
            showFindersButtonCheckbox.checked = settings.showFindersButton;
            showFindersButtonCheckbox.addEventListener('change', (e) => {
                settings.showFindersButton = e.target.checked;
            });
        }

        // Show commands button checkbox
        const showCommandsButtonCheckbox = document.getElementById('show-commands-button-checkbox');
        if (showCommandsButtonCheckbox) {
            showCommandsButtonCheckbox.checked = settings.showCommandsButton;
            showCommandsButtonCheckbox.addEventListener('change', (e) => {
                settings.showCommandsButton = e.target.checked;
            });
        }

        // Show cheatsheet button checkbox
        const showCheatSheetButtonCheckbox = document.getElementById('show-cheatsheet-button-checkbox');
        if (showCheatSheetButtonCheckbox) {
            showCheatSheetButtonCheckbox.checked = settings.showCheatSheetButton !== false;
            showCheatSheetButtonCheckbox.addEventListener('change', (e) => {
                settings.showCheatSheetButton = e.target.checked;
            });
        }

        const showRecentButtonCheckbox = document.getElementById('show-recent-button-checkbox');
        if (showRecentButtonCheckbox) {
            showRecentButtonCheckbox.checked = settings.showRecentButton !== false;
            showRecentButtonCheckbox.addEventListener('change', (e) => {
                settings.showRecentButton = e.target.checked;
            });
        }

        const showTagCloudButtonCheckbox = document.getElementById('show-tag-cloud-button-checkbox');
        if (showTagCloudButtonCheckbox) {
            showTagCloudButtonCheckbox.checked = settings.showTagCloudButton === true;
            showTagCloudButtonCheckbox.addEventListener('change', (e) => {
                settings.showTagCloudButton = e.target.checked;
            });
        }

        const showTipsCheckbox = document.getElementById('show-tips-checkbox');
        if (showTipsCheckbox) {
            showTipsCheckbox.checked = settings.showTips !== false;
            showTipsCheckbox.addEventListener('change', (e) => {
                settings.showTips = e.target.checked;
                window.TipsPolicy?.onUserPreference?.(e.target.checked);
            });
        }

        // Include finders in search checkbox
        const includeFindersInSearchCheckbox = document.getElementById('include-finders-in-search-checkbox');
        if (includeFindersInSearchCheckbox) {
            includeFindersInSearchCheckbox.checked = settings.includeFindersInSearch;
            includeFindersInSearchCheckbox.addEventListener('change', (e) => {
                settings.includeFindersInSearch = e.target.checked;
            });
        }

        // Animations enabled checkbox
        const animationsEnabledCheckbox = document.getElementById('animations-enabled-checkbox');
        if (animationsEnabledCheckbox) {
            animationsEnabledCheckbox.checked = settings.animationsEnabled !== false;
            animationsEnabledCheckbox.addEventListener('change', (e) => {
                settings.animationsEnabled = e.target.checked;
                if (callbacks.onAnimationsChange) callbacks.onAnimationsChange(e.target.checked);
            });
        }

        const showSyncToastsCheckbox = document.getElementById('show-sync-toasts-checkbox');
        if (showSyncToastsCheckbox) {
            showSyncToastsCheckbox.checked = settings.showSyncToasts !== false;
            showSyncToastsCheckbox.addEventListener('change', (e) => {
                settings.showSyncToasts = e.target.checked;
            });
        }

        // Show status checkbox
        const showStatusCheckbox = document.getElementById('show-status-checkbox');
        const colorizeStatusCheckbox = document.getElementById('colorize-status-checkbox');
        if (showStatusCheckbox) {
            showStatusCheckbox.checked = settings.showStatus;
            showStatusCheckbox.addEventListener('change', (e) => {
                settings.showStatus = e.target.checked;
                if (callbacks.onStatusVisibilityChange) callbacks.onStatusVisibilityChange();
                this.refreshStatusEssentialsSummary(settings, window.configManager?.allBookmarksData);
            });
        }
        if (colorizeStatusCheckbox) {
            colorizeStatusCheckbox.checked = settings.colorizeStatus !== false;
            colorizeStatusCheckbox.addEventListener('change', (e) => {
                settings.colorizeStatus = e.target.checked;
            });
        }

        // Show ping checkbox
        const showPingCheckbox = document.getElementById('show-ping-checkbox');
        if (showPingCheckbox) {
            showPingCheckbox.checked = settings.showPing;
            showPingCheckbox.addEventListener('change', (e) => {
                settings.showPing = e.target.checked;
            });
        }

        // Show status loading checkbox
        const showStatusLoadingCheckbox = document.getElementById('show-status-loading-checkbox');
        if (showStatusLoadingCheckbox) {
            showStatusLoadingCheckbox.checked = settings.showStatusLoading;
            showStatusLoadingCheckbox.addEventListener('change', (e) => {
                settings.showStatusLoading = e.target.checked;
            });
        }

        // Skip fast ping checkbox
        const skipFastPingCheckbox = document.getElementById('skip-fast-ping-checkbox');
        if (skipFastPingCheckbox) {
            skipFastPingCheckbox.checked = settings.skipFastPing;
            skipFastPingCheckbox.addEventListener('change', (e) => {
                settings.skipFastPing = e.target.checked;
            });
        }

        const statusOfflineRetriesInput = document.getElementById('status-offline-retries-input');
        if (statusOfflineRetriesInput) {
            statusOfflineRetriesInput.value = this.normalizeStatusOfflineRetries(settings.statusOfflineRetries);
            statusOfflineRetriesInput.addEventListener('input', (e) => {
                settings.statusOfflineRetries = this.normalizeStatusOfflineRetries(e.target.value);
                statusOfflineRetriesInput.value = settings.statusOfflineRetries;
            });
        }

        const statusOfflineRetryDelayInput = document.getElementById('status-offline-retry-delay-input');
        if (statusOfflineRetryDelayInput) {
            statusOfflineRetryDelayInput.value = this.normalizeStatusOfflineRetryDelayMs(settings.statusOfflineRetryDelayMs);
            statusOfflineRetryDelayInput.addEventListener('input', (e) => {
                settings.statusOfflineRetryDelayMs = this.normalizeStatusOfflineRetryDelayMs(e.target.value);
                statusOfflineRetryDelayInput.value = settings.statusOfflineRetryDelayMs;
            });
        }

        const statusRecheckIntervalSelect = document.getElementById('status-recheck-interval-select');
        if (statusRecheckIntervalSelect) {
            const allowed = [1, 3, 5, 10, 15, 30];
            const current = this.normalizeStatusRecheckIntervalMinutes(settings.statusRecheckIntervalMinutes);
            settings.statusRecheckIntervalMinutes = current;
            statusRecheckIntervalSelect.value = String(current);
            statusRecheckIntervalSelect.addEventListener('change', (e) => {
                settings.statusRecheckIntervalMinutes = this.normalizeStatusRecheckIntervalMinutes(e.target.value);
                statusRecheckIntervalSelect.value = String(settings.statusRecheckIntervalMinutes);
            });
        }

        this.refreshStatusEssentialsSummary(settings, window.configManager?.allBookmarksData);

        // Global shortcuts checkbox
        const globalShortcutsCheckbox = document.getElementById('global-shortcuts-checkbox');
        if (globalShortcutsCheckbox) {
            globalShortcutsCheckbox.checked = settings.globalShortcuts || false;
            globalShortcutsCheckbox.addEventListener('change', (e) => {
                settings.globalShortcuts = e.target.checked;
            });
        }

        // Enable fuzzy suggestions checkbox
        const enableFuzzySuggestionsCheckbox = document.getElementById('enable-fuzzy-suggestions-checkbox');
        if (enableFuzzySuggestionsCheckbox) {
            enableFuzzySuggestionsCheckbox.checked = settings.enableFuzzySuggestions || false;
            enableFuzzySuggestionsCheckbox.addEventListener('change', (e) => {
                settings.enableFuzzySuggestions = e.target.checked;
                this.toggleFuzzySuggestionsStartWith(e.target.checked);
            });
        }

        // Initial visibility for fuzzy suggestions start with
        this.toggleFuzzySuggestionsStartWith(settings.enableFuzzySuggestions || false);

        // Fuzzy suggestions start with checkbox
        const fuzzySuggestionsStartWithCheckbox = document.getElementById('fuzzy-suggestions-start-with-checkbox');
        if (fuzzySuggestionsStartWithCheckbox) {
            fuzzySuggestionsStartWithCheckbox.checked = settings.fuzzySuggestionsStartWith || false;
            fuzzySuggestionsStartWithCheckbox.addEventListener('change', (e) => {
                settings.fuzzySuggestionsStartWith = e.target.checked;
            });
        }

        // Keep search open when empty checkbox
        const keepSearchOpenWhenEmptyCheckbox = document.getElementById('keep-search-open-when-empty-checkbox');
        if (keepSearchOpenWhenEmptyCheckbox) {
            keepSearchOpenWhenEmptyCheckbox.checked = settings.keepSearchOpenWhenEmpty || false;
            keepSearchOpenWhenEmptyCheckbox.addEventListener('change', (e) => {
                settings.keepSearchOpenWhenEmpty = e.target.checked;
            });
        }

        const showSmartRecentCollectionCheckbox = document.getElementById('show-smart-recent-collection-checkbox');
        const showSmartTodayCollectionCheckbox = document.getElementById('show-smart-today-collection-checkbox');
        if (showSmartTodayCollectionCheckbox) {
            showSmartTodayCollectionCheckbox.checked = settings.showSmartTodayCollection !== false;
            showSmartTodayCollectionCheckbox.addEventListener('change', (e) => {
                settings.showSmartTodayCollection = e.target.checked;
                this.toggleSmartCollectionControls('today', e.target.checked);
            });
            this.toggleSmartCollectionControls('today', showSmartTodayCollectionCheckbox.checked);
        }

        const smartTodayPagesSelect = document.getElementById('smart-today-pages-select');
        if (smartTodayPagesSelect) {
            smartTodayPagesSelect.addEventListener('change', () => {
                settings.smartTodayPageIds = this.getSelectedPageIds(smartTodayPagesSelect);
            });
        }

        const smartTodayLimitSelect = document.getElementById('smart-today-limit-select');
        if (smartTodayLimitSelect) {
            const currentLimit = Number(settings.smartTodayLimit ?? 8);
            const normalizedLimit = Number.isFinite(currentLimit) && currentLimit >= 0 ? currentLimit : 8;
            smartTodayLimitSelect.value = normalizedLimit === 0 ? '0' : String(normalizedLimit);
            smartTodayLimitSelect.addEventListener('change', (e) => {
                const value = Number(e.target.value);
                settings.smartTodayLimit = Number.isFinite(value) && value >= 0 ? value : 8;
            });
        }

        const smartTodayWorkKeywordsInput = document.getElementById('smart-today-work-keywords-input');
        if (smartTodayWorkKeywordsInput) {
            smartTodayWorkKeywordsInput.value = String(settings.smartTodayWorkKeywords || '');
            smartTodayWorkKeywordsInput.addEventListener('input', (e) => {
                settings.smartTodayWorkKeywords = String(e.target.value || '').trim();
            });
        }

        const smartTodayEveningKeywordsInput = document.getElementById('smart-today-evening-keywords-input');
        if (smartTodayEveningKeywordsInput) {
            smartTodayEveningKeywordsInput.value = String(settings.smartTodayEveningKeywords || '');
            smartTodayEveningKeywordsInput.addEventListener('input', (e) => {
                settings.smartTodayEveningKeywords = String(e.target.value || '').trim();
            });
        }

        const smartTodayWeekendKeywordsInput = document.getElementById('smart-today-weekend-keywords-input');
        if (smartTodayWeekendKeywordsInput) {
            smartTodayWeekendKeywordsInput.value = String(settings.smartTodayWeekendKeywords || '');
            smartTodayWeekendKeywordsInput.addEventListener('input', (e) => {
                settings.smartTodayWeekendKeywords = String(e.target.value || '').trim();
            });
        }

        if (showSmartRecentCollectionCheckbox) {
            showSmartRecentCollectionCheckbox.checked = settings.showSmartRecentCollection !== false;
            showSmartRecentCollectionCheckbox.addEventListener('change', (e) => {
                settings.showSmartRecentCollection = e.target.checked;
                this.toggleSmartCollectionControls('recent', e.target.checked);
            });
            this.toggleSmartCollectionControls('recent', showSmartRecentCollectionCheckbox.checked);
        }

        const showSmartStaleCollectionCheckbox = document.getElementById('show-smart-stale-collection-checkbox');
        if (showSmartStaleCollectionCheckbox) {
            showSmartStaleCollectionCheckbox.checked = settings.showSmartStaleCollection !== false;
            showSmartStaleCollectionCheckbox.addEventListener('change', (e) => {
                settings.showSmartStaleCollection = e.target.checked;
                this.toggleSmartCollectionControls('stale', e.target.checked);
            });
            this.toggleSmartCollectionControls('stale', showSmartStaleCollectionCheckbox.checked);
        }

        const showSmartMostUsedCollectionCheckbox = document.getElementById('show-smart-most-used-collection-checkbox');
        if (showSmartMostUsedCollectionCheckbox) {
            showSmartMostUsedCollectionCheckbox.checked = settings.showSmartMostUsedCollection === true;
            showSmartMostUsedCollectionCheckbox.addEventListener('change', (e) => {
                settings.showSmartMostUsedCollection = e.target.checked;
                this.toggleSmartCollectionControls('mostUsed', e.target.checked);
            });
            this.toggleSmartCollectionControls('mostUsed', showSmartMostUsedCollectionCheckbox.checked);
        }

        const showTagCollectionsCheckbox = document.getElementById('show-tag-collections-checkbox');
        const tagCollectionsMinCountRow = document.getElementById('tag-collections-min-count-row');
        const tagCollectionsMinCountInput = document.getElementById('tag-collections-min-count');
        if (showTagCollectionsCheckbox) {
            showTagCollectionsCheckbox.checked = settings.showTagCollections === true;
            if (tagCollectionsMinCountRow) tagCollectionsMinCountRow.style.display = settings.showTagCollections ? '' : 'none';
            showTagCollectionsCheckbox.addEventListener('change', (e) => {
                settings.showTagCollections = e.target.checked;
                if (tagCollectionsMinCountRow) tagCollectionsMinCountRow.style.display = e.target.checked ? '' : 'none';
            });
        }
        if (tagCollectionsMinCountInput) {
            tagCollectionsMinCountInput.value = settings.tagCollectionsMinCount ?? 0;
            tagCollectionsMinCountInput.addEventListener('input', (e) => {
                settings.tagCollectionsMinCount = parseInt(e.target.value) || 0;
            });
        }

        const smartRecentPagesSelect = document.getElementById('smart-recent-pages-select');
        if (smartRecentPagesSelect) {
            smartRecentPagesSelect.addEventListener('change', () => {
                settings.smartRecentPageIds = this.getSelectedPageIds(smartRecentPagesSelect);
            });
        }

        const smartRecentLimitSelect = document.getElementById('smart-recent-limit-select');
        if (smartRecentLimitSelect) {
            const currentLimit = Number(settings.smartRecentLimit ?? 50);
            const normalizedLimit = Number.isFinite(currentLimit) && currentLimit >= 0 ? currentLimit : 50;
            smartRecentLimitSelect.value = normalizedLimit === 0 ? '0' : String(normalizedLimit);
            smartRecentLimitSelect.addEventListener('change', (e) => {
                const value = Number(e.target.value);
                settings.smartRecentLimit = Number.isFinite(value) && value >= 0 ? value : 50;
            });
        }

        const smartStalePagesSelect = document.getElementById('smart-stale-pages-select');
        if (smartStalePagesSelect) {
            smartStalePagesSelect.addEventListener('change', () => {
                settings.smartStalePageIds = this.getSelectedPageIds(smartStalePagesSelect);
            });
        }

        const smartStaleLimitSelect = document.getElementById('smart-stale-limit-select');
        if (smartStaleLimitSelect) {
            const currentLimit = Number(settings.smartStaleLimit ?? 50);
            const normalizedLimit = Number.isFinite(currentLimit) && currentLimit >= 0 ? currentLimit : 50;
            smartStaleLimitSelect.value = normalizedLimit === 0 ? '0' : String(normalizedLimit);
            smartStaleLimitSelect.addEventListener('change', (e) => {
                const value = Number(e.target.value);
                settings.smartStaleLimit = Number.isFinite(value) && value >= 0 ? value : 50;
            });
        }

        const smartMostUsedPagesSelect = document.getElementById('smart-most-used-pages-select');
        if (smartMostUsedPagesSelect) {
            smartMostUsedPagesSelect.addEventListener('change', () => {
                settings.smartMostUsedPageIds = this.getSelectedPageIds(smartMostUsedPagesSelect);
            });
        }

        const smartMostUsedLimitSelect = document.getElementById('smart-most-used-limit-select');
        if (smartMostUsedLimitSelect) {
            const currentLimit = Number(settings.smartMostUsedLimit ?? 25);
            const normalizedLimit = Number.isFinite(currentLimit) && currentLimit >= 0 ? currentLimit : 25;
            smartMostUsedLimitSelect.value = normalizedLimit === 0 ? '0' : String(normalizedLimit);
            smartMostUsedLimitSelect.addEventListener('change', (e) => {
                const value = Number(e.target.value);
                settings.smartMostUsedLimit = Number.isFinite(value) && value >= 0 ? value : 25;
            });
        }

        this.setupBookmarkPreviewMaintenance(callbacks);
    }

    setupBookmarkPreviewMaintenance(callbacks = {}) {
        const refreshBtn = document.getElementById('refresh-all-bookmark-previews-btn');
        const clearBtn = document.getElementById('clear-all-bookmark-previews-btn');
        if (!refreshBtn && !clearBtn) return;

        this.bindInfoButton(
            'bookmark-preview-maintenance-info-btn',
            'config.bookmarkPreviewMaintenanceInfoTitle',
            'config.bookmarkPreviewMaintenanceInfoMessage'
        );

        const t = (key, fallback, vars) => {
            const lang = window.configManager?.language;
            let text = fallback;
            if (lang && typeof lang.t === 'function') {
                const full = `config.${key}`;
                const val = lang.t(full);
                if (val && val !== full) text = val;
            }
            if (vars) {
                Object.entries(vars).forEach(([k, v]) => {
                    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
                });
            }
            return text;
        };

        const notify = (message, type = 'info') => {
            if (typeof callbacks.onNotify === 'function') {
                callbacks.onNotify(message, type);
                return;
            }
            window.configManager?.ui?.showNotification?.(message, type);
        };

        const setBusy = (busy) => {
            [refreshBtn, clearBtn].forEach((btn) => {
                if (btn) {
                    btn.disabled = busy;
                    btn.classList.toggle('btn-loading', busy);
                }
            });
        };

        const afterChange = async () => {
            if (typeof callbacks.onBookmarkPreviewsChanged === 'function') {
                await callbacks.onBookmarkPreviewsChanged();
            }
        };

        const runAction = async ({ confirmOptions, url, successKey, successFallback, countField }) => {
            if (!window.AppModal) return;
            const confirmed = await window.AppModal.confirm(confirmOptions);
            if (!confirmed) return;

            setBusy(true);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: typeof nextDashWriteHeaders === 'function'
                        ? nextDashWriteHeaders()
                        : {},
                });
                const data = response.ok ? await response.json().catch(() => ({})) : null;
                if (!response.ok || !data) {
                    notify(t('bookmarkPreviewMaintenanceFailed', 'Could not update bookmark previews.'), 'error');
                    return;
                }
                const count = Number(data[countField] ?? 0);
                notify(
                    t(successKey, successFallback, { count }),
                    'success'
                );
                await afterChange();
            } catch {
                notify(t('bookmarkPreviewMaintenanceFailed', 'Could not update bookmark previews.'), 'error');
            } finally {
                setBusy(false);
            }
        };

        refreshBtn?.addEventListener('click', () => {
            runAction({
                confirmOptions: {
                    title: t('bookmarkPreviewRefreshAllConfirmTitle', 'Refresh all bookmark previews?'),
                    message: t(
                        'bookmarkPreviewRefreshAllConfirmMessage',
                        'Re-fetches title, description and image for every bookmark with a URL. This may take a while for large libraries.'
                    ),
                    confirmText: t('bookmarkPreviewRefreshAll', 'Refresh all previews'),
                },
                url: '/api/previews/refresh',
                successKey: 'bookmarkPreviewRefreshAllDone',
                successFallback: 'Refreshed preview metadata for {count} bookmarks.',
                countField: 'refreshed',
            });
        });

        clearBtn?.addEventListener('click', () => {
            runAction({
                confirmOptions: {
                    title: t('bookmarkPreviewClearAllConfirmTitle', 'Clear all bookmark previews?'),
                    message: t(
                        'bookmarkPreviewClearAllConfirmMessage',
                        'Removes stored preview title, description and image from every bookmark and clears the server preview cache. Hover cards will fetch again on next use.'
                    ),
                    confirmText: t('bookmarkPreviewClearAll', 'Clear all previews'),
                    confirmClass: 'danger',
                },
                url: '/api/previews/clear',
                successKey: 'bookmarkPreviewClearAllDone',
                successFallback: 'Cleared preview metadata from {count} bookmarks.',
                countField: 'cleared',
            });
        });
    }

    /**
     * Update settings from UI elements
     * @param {Object} settings - Reference to settings object
     */
    updateFromUI(settings) {
        const themeSelect = document.getElementById('theme-select');
        const columnsInput = document.getElementById('columns-input'); 
        const newTabCheckbox = document.getElementById('new-tab-checkbox');
        const hyprModeCheckbox = document.getElementById('hypr-mode-checkbox');
        const showTitleCheckbox = document.getElementById('show-title-checkbox');
        const showDateCheckbox = document.getElementById('show-date-checkbox');
        const showTimeCheckbox = document.getElementById('show-time-checkbox');
        const timeFormatSelect = document.getElementById('time-format-select');
        const showConfigButtonCheckbox = document.getElementById('show-config-button-checkbox');
        const showHealthDashboardCheckbox = document.getElementById('show-health-dashboard-checkbox');
        const showAddBookmarkButtonCheckbox = document.getElementById('show-add-bookmark-button-checkbox');
        const showSearchButtonCheckbox = document.getElementById('show-search-button-checkbox');
        const showFindersButtonCheckbox = document.getElementById('show-finders-button-checkbox');
        const showCommandsButtonCheckbox = document.getElementById('show-commands-button-checkbox');
        const showCheatSheetButtonCheckbox = document.getElementById('show-cheatsheet-button-checkbox');
        const showRecentButtonCheckbox = document.getElementById('show-recent-button-checkbox');
        const showTagCloudButtonCheckbox = document.getElementById('show-tag-cloud-button-checkbox');
        const showTipsCheckbox = document.getElementById('show-tips-checkbox');
        const includeFindersInSearchCheckbox = document.getElementById('include-finders-in-search-checkbox');
        const showStatusCheckbox = document.getElementById('show-status-checkbox');
        const colorizeStatusCheckbox = document.getElementById('colorize-status-checkbox');
        const showPingCheckbox = document.getElementById('show-ping-checkbox');
        const showStatusLoadingCheckbox = document.getElementById('show-status-loading-checkbox');
        const skipFastPingCheckbox = document.getElementById('skip-fast-ping-checkbox');
        const globalShortcutsCheckbox = document.getElementById('global-shortcuts-checkbox');
        const animationsEnabledCheckbox = document.getElementById('animations-enabled-checkbox');
        const showSyncToastsCheckbox = document.getElementById('show-sync-toasts-checkbox');
        const enableCustomTitleCheckbox = document.getElementById('enable-custom-title-checkbox');
        const customTitleInput = document.getElementById('custom-title-input');
        const showPageInTitleCheckbox = document.getElementById('show-page-in-title-checkbox');
        const showPageNamesInTabsCheckbox = document.getElementById('show-page-names-in-tabs-checkbox');
        const enableCustomFaviconCheckbox = document.getElementById('enable-custom-favicon-checkbox');
        const languageSelect = document.getElementById('language-select');
        const interleaveModeCheckbox = document.getElementById('interleave-mode-checkbox');
        const enableFuzzySuggestionsCheckbox = document.getElementById('enable-fuzzy-suggestions-checkbox');
        const fuzzySuggestionsStartWithCheckbox = document.getElementById('fuzzy-suggestions-start-with-checkbox');
        const keepSearchOpenWhenEmptyCheckbox = document.getElementById('keep-search-open-when-empty-checkbox');
        const showSmartRecentCollectionCheckbox = document.getElementById('show-smart-recent-collection-checkbox');
        const showSmartTodayCollectionCheckbox = document.getElementById('show-smart-today-collection-checkbox');
        const showSmartStaleCollectionCheckbox = document.getElementById('show-smart-stale-collection-checkbox');
        const showSmartMostUsedCollectionCheckbox = document.getElementById('show-smart-most-used-collection-checkbox');
        const smartTodayPagesSelect = document.getElementById('smart-today-pages-select');
        const smartRecentPagesSelect = document.getElementById('smart-recent-pages-select');
        const smartStalePagesSelect = document.getElementById('smart-stale-pages-select');
        const smartMostUsedPagesSelect = document.getElementById('smart-most-used-pages-select');
        const smartTodayLimitSelect = document.getElementById('smart-today-limit-select');
        const smartRecentLimitSelect = document.getElementById('smart-recent-limit-select');
        const smartStaleLimitSelect = document.getElementById('smart-stale-limit-select');
        const smartMostUsedLimitSelect = document.getElementById('smart-most-used-limit-select');
        const smartTodayWorkKeywordsInput = document.getElementById('smart-today-work-keywords-input');
        const smartTodayEveningKeywordsInput = document.getElementById('smart-today-evening-keywords-input');
        const smartTodayWeekendKeywordsInput = document.getElementById('smart-today-weekend-keywords-input');
        const dateFormatSelect = document.getElementById('date-format-select');
        const showWeatherWithDateCheckbox = document.getElementById('show-weather-with-date-checkbox');
        const weatherSourceSelect = document.getElementById('weather-source-select');
        const weatherLocationInput = document.getElementById('weather-location-input');
        const weatherUnitSelect = document.getElementById('weather-unit-select');
        const weatherRefreshSelect = document.getElementById('weather-refresh-select');
        const densityModeSelect = document.getElementById('density-mode-select');
        const fontPresetSelect = document.getElementById('font-preset-select');

        if (themeSelect) settings.theme = themeSelect.value;
        if (columnsInput) settings.columnsPerRow = parseInt(columnsInput.value);
        if (newTabCheckbox) settings.openInNewTab = newTabCheckbox.checked;
        const pasteUrlEl = document.getElementById('paste-url-quick-add-checkbox');
        if (pasteUrlEl) settings.pasteUrlQuickAdd = pasteUrlEl.checked;
        const allowLocalEl = document.getElementById('allow-local-bookmarks-checkbox');
        if (allowLocalEl) settings.allowLocalBookmarks = allowLocalEl.checked;
        if (hyprModeCheckbox) settings.hyprMode = hyprModeCheckbox.checked;
        if (showTitleCheckbox) settings.showTitle = showTitleCheckbox.checked;
        if (showDateCheckbox) settings.showDate = showDateCheckbox.checked;
        if (showTimeCheckbox) settings.showTime = showTimeCheckbox.checked;
        if (timeFormatSelect) settings.timeFormat = timeFormatSelect.value === '12h' ? '12h' : '24h';
        if (showConfigButtonCheckbox) settings.showConfigButton = showConfigButtonCheckbox.checked;
        if (showHealthDashboardCheckbox) settings.showHealthDashboard = showHealthDashboardCheckbox.checked;
        if (showAddBookmarkButtonCheckbox) settings.showAddBookmarkButton = showAddBookmarkButtonCheckbox.checked;
        if (showSearchButtonCheckbox) settings.showSearchButton = showSearchButtonCheckbox.checked;
        if (showFindersButtonCheckbox) settings.showFindersButton = showFindersButtonCheckbox.checked;
        if (showCommandsButtonCheckbox) settings.showCommandsButton = showCommandsButtonCheckbox.checked;
        if (showCheatSheetButtonCheckbox) settings.showCheatSheetButton = showCheatSheetButtonCheckbox.checked;
        if (showRecentButtonCheckbox) settings.showRecentButton = showRecentButtonCheckbox.checked;
        if (showTagCloudButtonCheckbox) settings.showTagCloudButton = showTagCloudButtonCheckbox.checked;
        if (showTipsCheckbox) settings.showTips = showTipsCheckbox.checked;
        if (includeFindersInSearchCheckbox) settings.includeFindersInSearch = includeFindersInSearchCheckbox.checked;
        if (animationsEnabledCheckbox) settings.animationsEnabled = animationsEnabledCheckbox.checked;
        if (showSyncToastsCheckbox) settings.showSyncToasts = showSyncToastsCheckbox.checked;
        if (showStatusCheckbox) settings.showStatus = showStatusCheckbox.checked;
        if (colorizeStatusCheckbox) settings.colorizeStatus = colorizeStatusCheckbox.checked;
        if (showPingCheckbox) settings.showPing = showPingCheckbox.checked;
        if (showStatusLoadingCheckbox) settings.showStatusLoading = showStatusLoadingCheckbox.checked;
        if (skipFastPingCheckbox) settings.skipFastPing = skipFastPingCheckbox.checked;
        const statusOfflineRetriesInput = document.getElementById('status-offline-retries-input');
        const statusOfflineRetryDelayInput = document.getElementById('status-offline-retry-delay-input');
        if (statusOfflineRetriesInput) {
            settings.statusOfflineRetries = this.normalizeStatusOfflineRetries(statusOfflineRetriesInput.value);
        }
        if (statusOfflineRetryDelayInput) {
            settings.statusOfflineRetryDelayMs = this.normalizeStatusOfflineRetryDelayMs(statusOfflineRetryDelayInput.value);
        }
        const statusRecheckIntervalSelect = document.getElementById('status-recheck-interval-select');
        if (statusRecheckIntervalSelect) {
            settings.statusRecheckIntervalMinutes = this.normalizeStatusRecheckIntervalMinutes(statusRecheckIntervalSelect.value);
        }
        if (globalShortcutsCheckbox) settings.globalShortcuts = globalShortcutsCheckbox.checked;
        if (enableCustomTitleCheckbox) settings.enableCustomTitle = enableCustomTitleCheckbox.checked;
        if (customTitleInput) settings.customTitle = customTitleInput.value;
        if (showPageInTitleCheckbox) settings.showPageInTitle = showPageInTitleCheckbox.checked;
        if (showPageNamesInTabsCheckbox) settings.showPageNamesInTabs = showPageNamesInTabsCheckbox.checked;
        const showPageTabsCheckbox = document.getElementById('show-page-tabs-checkbox');
        if (showPageTabsCheckbox) settings.showPageTabs = showPageTabsCheckbox.checked;
        const alwaysCollapseCategoriesCheckbox = document.getElementById('always-collapse-categories-checkbox');
        if (alwaysCollapseCategoriesCheckbox) settings.alwaysCollapseCategories = alwaysCollapseCategoriesCheckbox.checked;
        if (enableCustomFaviconCheckbox) settings.enableCustomFavicon = enableCustomFaviconCheckbox.checked;
        if (languageSelect) settings.language = languageSelect.value;
        if (interleaveModeCheckbox) settings.interleaveMode = interleaveModeCheckbox.checked;
        if (enableFuzzySuggestionsCheckbox) settings.enableFuzzySuggestions = enableFuzzySuggestionsCheckbox.checked;
        if (fuzzySuggestionsStartWithCheckbox) settings.fuzzySuggestionsStartWith = fuzzySuggestionsStartWithCheckbox.checked;
        if (keepSearchOpenWhenEmptyCheckbox) settings.keepSearchOpenWhenEmpty = keepSearchOpenWhenEmptyCheckbox.checked;
        if (showSmartTodayCollectionCheckbox) settings.showSmartTodayCollection = showSmartTodayCollectionCheckbox.checked;
        if (showSmartRecentCollectionCheckbox) settings.showSmartRecentCollection = showSmartRecentCollectionCheckbox.checked;
        if (showSmartStaleCollectionCheckbox) settings.showSmartStaleCollection = showSmartStaleCollectionCheckbox.checked;
        if (showSmartMostUsedCollectionCheckbox) settings.showSmartMostUsedCollection = showSmartMostUsedCollectionCheckbox.checked;
        const showTagCollectionsChk = document.getElementById('show-tag-collections-checkbox');
        if (showTagCollectionsChk) settings.showTagCollections = showTagCollectionsChk.checked;
        const tagMinCountInp = document.getElementById('tag-collections-min-count');
        if (tagMinCountInp) settings.tagCollectionsMinCount = parseInt(tagMinCountInp.value) || 0;
        if (smartTodayPagesSelect) settings.smartTodayPageIds = this.getSelectedPageIds(smartTodayPagesSelect);
        if (smartRecentPagesSelect) settings.smartRecentPageIds = this.getSelectedPageIds(smartRecentPagesSelect);
        if (smartStalePagesSelect) settings.smartStalePageIds = this.getSelectedPageIds(smartStalePagesSelect);
        if (smartMostUsedPagesSelect) settings.smartMostUsedPageIds = this.getSelectedPageIds(smartMostUsedPagesSelect);
        if (smartTodayLimitSelect) {
            const parsedLimit = Number(smartTodayLimitSelect.value);
            settings.smartTodayLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 8;
        }
        if (smartRecentLimitSelect) {
            const parsedLimit = Number(smartRecentLimitSelect.value);
            settings.smartRecentLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 50;
        }
        if (smartStaleLimitSelect) {
            const parsedLimit = Number(smartStaleLimitSelect.value);
            settings.smartStaleLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 50;
        }
        if (smartMostUsedLimitSelect) {
            const parsedLimit = Number(smartMostUsedLimitSelect.value);
            settings.smartMostUsedLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 25;
        }
        if (smartTodayWorkKeywordsInput) settings.smartTodayWorkKeywords = smartTodayWorkKeywordsInput.value.trim();
        if (smartTodayEveningKeywordsInput) settings.smartTodayEveningKeywords = smartTodayEveningKeywordsInput.value.trim();
        if (smartTodayWeekendKeywordsInput) settings.smartTodayWeekendKeywords = smartTodayWeekendKeywordsInput.value.trim();
        if (dateFormatSelect) settings.dateFormat = dateFormatSelect.value;
        if (showWeatherWithDateCheckbox) settings.showWeatherWithDate = showWeatherWithDateCheckbox.checked;
        if (weatherSourceSelect) settings.weatherSource = weatherSourceSelect.value;
        if (weatherLocationInput) settings.weatherLocation = weatherLocationInput.value.trim();
        if (weatherUnitSelect) settings.weatherUnit = weatherUnitSelect.value;
        if (weatherRefreshSelect) {
            const parsedRefresh = Number(weatherRefreshSelect.value);
            settings.weatherRefreshMinutes = Number.isFinite(parsedRefresh) && parsedRefresh > 0 ? parsedRefresh : 30;
        }
        if (densityModeSelect) {
            settings.densityMode = ['comfortable', 'compact', 'dense', 'auto'].includes(densityModeSelect.value)
                ? densityModeSelect.value
                : 'compact';
        }
        if (fontPresetSelect && window.DashboardFont) {
            const path = settings.customFontPath && String(settings.customFontPath).trim();
            settings.fontPreset = window.DashboardFont.normalizePresetId(fontPresetSelect.value, path);
            settings.enableCustomFont = settings.fontPreset === 'custom';
        }
        const packedColumnsCheckbox = document.getElementById('packed-columns-checkbox');
        if (packedColumnsCheckbox) settings.packedColumns = packedColumnsCheckbox.checked;
        const launcherIconSizeSelectUI = document.getElementById('launcher-icon-size-select');
        if (launcherIconSizeSelectUI) {
            settings.launcherIconSize = ['small', 'normal', 'large'].includes(launcherIconSizeSelectUI.value)
                ? launcherIconSizeSelectUI.value
                : 'normal';
        }
        const calendarUrlInputUI = document.getElementById('calendar-url-input');
        if (calendarUrlInputUI) settings.calendarUrl = calendarUrlInputUI.value.trim();
        const buttonBarPositionSelectUI = document.getElementById('button-bar-position-select');
        if (buttonBarPositionSelectUI) {
            settings.buttonBarPosition = ['bottom', 'bottom-left', 'bottom-right'].includes(buttonBarPositionSelectUI.value)
                ? buttonBarPositionSelectUI.value
                : 'bottom';
        }
        const showIconsCheckbox = document.getElementById('show-icons-checkbox');
        const showLinkPreviewCardsCheckbox = document.getElementById('show-link-preview-cards-checkbox');
        const linkPreviewHoverDelaySelect = document.getElementById('link-preview-hover-delay-select');
        if (showIconsCheckbox) settings.showIcons = showIconsCheckbox.checked;
        if (showLinkPreviewCardsCheckbox) settings.showLinkPreviewCards = showLinkPreviewCardsCheckbox.checked;
        if (linkPreviewHoverDelaySelect) {
            const delay = Number(linkPreviewHoverDelaySelect.value);
            settings.linkPreviewHoverDelayMs = [100, 150, 250].includes(delay) ? delay : 150;
        }
        const showShortcutsCheckbox = document.getElementById('show-shortcuts-checkbox');
        if (showShortcutsCheckbox) settings.showShortcuts = showShortcutsCheckbox.checked;
        const showPinIconCheckbox = document.getElementById('show-pin-icon-checkbox');
        if (showPinIconCheckbox) settings.showPinIcon = showPinIconCheckbox.checked;
        const showNoteIconCheckbox = document.getElementById('show-note-icon-checkbox');
        if (showNoteIconCheckbox) settings.showNoteIcon = showNoteIconCheckbox.checked;
    }

    /**
     * Apply theme to page
     * @param {string} theme
     */
    applyTheme(theme) {
        const normalizedTheme = this.normalizeThemeId(theme);

        // Remove all theme classes
        document.body.classList.remove('dark', 'light');

        // Remove any custom theme classes
        const themeIds = Array.isArray(this.customThemes)
            ? this.customThemes
            : Object.keys(this.customThemes || {});
        themeIds.forEach(themeId => document.body.classList.remove(themeId));
        
        // Add the new theme class
        document.body.classList.add(normalizedTheme);
        document.body.setAttribute('data-theme', normalizedTheme);
        
        if (window.ThemeLoader) {
            const showBackgroundDots = document.getElementById('show-background-dots-checkbox')?.checked !== false;
            // Get current font size from body classes
            const currentClasses = Array.from(document.body.classList);
            const currentFontSizeClass = currentClasses.find(cls => cls.startsWith('font-size-'));
            const currentFontSize = currentFontSizeClass ? currentFontSizeClass.replace('font-size-', '') : 'm';
            window.ThemeLoader.applyTheme(normalizedTheme, showBackgroundDots, currentFontSize);
        }
    }

    reloadThemeCSS() {
        const link = document.querySelector('link[href^="/api/theme.css"]');
        if (!link || !link.parentNode) {
            return;
        }

        const newLink = link.cloneNode(true);
        newLink.href = `/api/theme.css?t=${Date.now()}`;
        link.parentNode.replaceChild(newLink, link);
    }

    /**
     * Apply font size to page
     * @param {string} fontSize
     */
    applyFontSize(fontSize) {
        document.body.classList.remove('font-size-xs', 'font-size-s', 'font-size-sm', 'font-size-m', 'font-size-lg', 'font-size-l', 'font-size-xl');
        document.body.classList.add(`font-size-${fontSize}`);
    }

    /**
     * Apply background dots setting
     * @param {boolean} showBackgroundDots
     */
    applyBackgroundDots(showBackgroundDots) {
        // Use ThemeLoader to apply background dots consistently
        if (window.ThemeLoader) {
            const theme = document.body.getAttribute('data-theme') || 'dark';
            // Get current font size from body classes
            const currentClasses = Array.from(document.body.classList);
            const currentFontSizeClass = currentClasses.find(cls => cls.startsWith('font-size-'));
            const currentFontSize = currentFontSizeClass ? currentFontSizeClass.replace('font-size-', '') : 'm';
            window.ThemeLoader.applyTheme(theme, showBackgroundDots, currentFontSize);
        }
        
        // Also set the data attribute for consistency
        if (showBackgroundDots !== false) {
            document.body.setAttribute('data-show-background-dots', 'true');
        } else {
            document.body.setAttribute('data-show-background-dots', 'false');
        }
    }

    /**
     * Update status options visibility
     * @param {boolean} showStatus
     */
    updateStatusOptionsVisibility(showStatus) {
        const enabled = Boolean(showStatus);
        const statusPanel = document.querySelector('[data-general-panel="status"]');
        if (!statusPanel) return;

        statusPanel.querySelectorAll('.checkbox-tree-child').forEach((row) => {
            row.classList.toggle('is-disabled', !enabled);
        });

        statusPanel.querySelectorAll('input, select, button.number-input-up, button.number-input-down').forEach((control) => {
            control.disabled = !enabled;
        });

        if (!enabled) {
            const ping = document.getElementById('show-ping-checkbox');
            if (ping) ping.checked = false;
        }
    }

    normalizeStatusOfflineRetries(value) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) return 3;
        return Math.min(10, Math.max(1, parsed));
    }

    normalizeStatusOfflineRetryDelayMs(value) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) return 450;
        return Math.min(3000, Math.max(100, parsed));
    }

    normalizeStatusRecheckIntervalMinutes(value) {
        const allowed = [1, 3, 5, 10, 15, 30];
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed) || !allowed.includes(parsed)) return 5;
        return parsed;
    }

    refreshStatusEssentialsSummary(settings, allBookmarks = []) {
        const line = document.getElementById('status-essentials-summary-line');
        const healthLink = document.getElementById('status-essentials-health-link');
        if (!line) return;

        const bookmarks = Array.isArray(allBookmarks) ? allBookmarks : [];
        const monitored = bookmarks.filter((b) => b?.checkStatus === true).length;
        const statusOn = settings?.showStatus !== false;

        if (!statusOn) {
            line.textContent = this.t('config.statusEssentialsSummaryOff', 'Off');
            if (healthLink) healthLink.hidden = true;
            return;
        }

        if (healthLink) healthLink.hidden = false;

        if (monitored === 0) {
            line.textContent = this.t('config.statusEssentialsSummaryOnNone', 'On · no bookmarks with status checks yet');
            return;
        }
        const template = this.t('config.statusEssentialsSummaryOnCount', 'On · {count} bookmarks monitored');
        line.textContent = template.replace('{count}', String(monitored));
    }

    /**
     * Toggle custom title input visibility
     * @param {boolean} enabled
     */
    toggleCustomTitleInput(enabled) {
        // Find the checkbox
        const checkbox = document.getElementById('enable-custom-title-checkbox');
        if (!checkbox) return;
        
        // Find the parent item
        const parentItem = checkbox.closest('.checkbox-tree-item');
        if (!parentItem) return;
        
        // Find all sibling items after this one that are checkbox-tree-child
        const siblings = Array.from(parentItem.parentNode.children);
        const startIndex = siblings.indexOf(parentItem);
        
        for (let i = startIndex + 1; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling.classList.contains('checkbox-tree-child')) {
                sibling.style.display = enabled ? 'block' : 'none';
            } else {
                // Stop at the first non-child item (assuming they are grouped)
                break;
            }
        }
    }

    /**
     * Toggle fuzzy suggestions start with visibility
     * @param {boolean} enabled
     */
    toggleFuzzySuggestionsStartWith(enabled) {
        // Find the checkbox
        const checkbox = document.getElementById('enable-fuzzy-suggestions-checkbox');
        if (!checkbox) return;
        
        // Find the parent item
        const parentItem = checkbox.closest('.checkbox-tree-item');
        if (!parentItem) return;
        
        // Find all sibling items after this one that are checkbox-tree-child
        const siblings = Array.from(parentItem.parentNode.children);
        const startIndex = siblings.indexOf(parentItem);
        
        for (let i = startIndex + 1; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling.classList.contains('checkbox-tree-child')) {
                sibling.style.display = enabled ? 'block' : 'none';
            } else {
                // Stop at the first non-child item (assuming they are grouped)
                break;
            }
        }
    }

    /**
     * Toggle custom favicon input visibility
     * @param {boolean} enabled
     */
    toggleCustomFaviconInput(enabled) {
        // Find the checkbox
        const checkbox = document.getElementById('enable-custom-favicon-checkbox');
        if (!checkbox) return;
        
        // Find the parent item
        const parentItem = checkbox.closest('.checkbox-tree-item');
        if (!parentItem) return;
        
        // Find all sibling items after this one that are checkbox-tree-child
        const siblings = Array.from(parentItem.parentNode.children);
        const startIndex = siblings.indexOf(parentItem);
        
        for (let i = startIndex + 1; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling.classList.contains('checkbox-tree-child')) {
                sibling.style.display = enabled ? 'block' : 'none';
            } else {
                // Stop at the first non-child item (assuming they are grouped)
                break;
            }
        }
    }

    /**
     * Toggle visibility of custom font input based on checkbox state
     * @param {boolean} enabled - Whether custom font is enabled
     */
    toggleWeatherManualLocationInput(source) {
        const weatherLocationInput = document.getElementById('weather-location-input');
        if (!weatherLocationInput) return;
        const shouldDisable = source === 'browser';
        weatherLocationInput.disabled = shouldDisable;
        const row = weatherLocationInput.closest('.checkbox-tree-child');
        if (row) {
            row.classList.toggle('is-disabled', shouldDisable);
        }
    }

    toggleWeatherControls(enabled, source) {
        const ids = ['weather-source-select', 'weather-location-input', 'weather-unit-select', 'weather-refresh-select'];
        this.setDependentControlState(ids, enabled);
        if (enabled) {
            this.toggleWeatherManualLocationInput(source || 'manual');
        }
    }

    setDependentControlState(ids, enabled) {
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = !enabled;
            const row = el.closest('.checkbox-tree-child');
            if (!row) return;
            row.classList.toggle('is-disabled', !enabled);
            row.style.display = enabled ? '' : 'none';
        });
    }

    /**
     * Attach a ↺ reset button next to a setting input.
     * Shows when the current value differs from the default; resets on click.
     * @param {HTMLElement} el - The input/select/checkbox element
     * @param {string} key - The settings key
     * @param {*} defaultValue - The default value for this key
     * @param {Object} settings - Live settings object
     * @param {Function} [onReset] - Optional callback after reset (receives new value)
     */
    watchSetting(el, key, defaultValue, settings, onReset) {
        if (!el) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'setting-reset-btn';
        btn.title = 'Reset to default';
        btn.setAttribute('aria-label', 'Reset to default');
        btn.textContent = '↺';

        const getElValue = () => {
            if (el.type === 'checkbox') return el.checked;
            if (el.type === 'number') return Number(el.value);
            return el.value;
        };

        const valuesEqual = (a, b) => {
            if (typeof a === 'boolean') return a === b;
            if (typeof a === 'number') return Number(a) === Number(b);
            return String(a) === String(b);
        };

        const formatVal = (v) => {
            if (typeof v === 'boolean') return v ? 'on' : 'off';
            return String(v);
        };

        const updateVisibility = () => {
            const current = getElValue();
            const isDefault = valuesEqual(current, defaultValue);
            btn.classList.toggle('setting-reset-btn--visible', !isDefault);
            if (!isDefault) {
                btn.title = `Reset to default: ${formatVal(defaultValue)} (was ${formatVal(current)})`;
            } else {
                btn.title = 'Reset to default';
            }
        };

        btn.addEventListener('click', () => {
            const previousValue = getElValue();
            if (el.type === 'checkbox') {
                el.checked = defaultValue;
            } else {
                el.value = String(defaultValue);
            }
            settings[key] = defaultValue;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            updateVisibility();
            if (onReset) onReset(defaultValue);
            const ui = window.configManager && window.configManager.ui;
            if (ui && typeof ui.showNotification === 'function') {
                ui.showNotification(
                    `Reset to ${formatVal(defaultValue)} (was ${formatVal(previousValue)})`,
                    'success'
                );
            }
        });

        // Initialise element value from settings
        if (el.type === 'checkbox') {
            el.checked = typeof settings[key] === 'boolean' ? settings[key] : Boolean(defaultValue);
        } else if (el.type === 'number') {
            el.value = settings[key] ?? defaultValue;
        } else {
            if (settings[key] !== undefined) el.value = settings[key];
        }

        el.parentElement.style.position = 'relative';
        el.insertAdjacentElement('afterend', btn);
        el.addEventListener('change', updateVisibility);
        updateVisibility();
    }

    /**
     * Attach watchSetting to all tracked settings inputs.
     * Call once after all inputs are bound.
     * @param {Object} settings - Live settings object
     * @param {Function} [markDirty] - Optional markDirty callback
     */
    attachSettingResetButtons(settings, markDirty) {
        const defaults = this.getDefaults();
        const watch = (id, key, onReset) => {
            const el = document.getElementById(id);
            this.watchSetting(el, key, defaults[key], settings, (val) => {
                if (markDirty) markDirty();
                if (onReset) onReset(val);
            });
        };

        watch('theme-select', 'theme');
        watch('columns-input', 'columnsPerRow');
        watch('density-mode-select', 'densityMode');
        watch('language-select', 'language');
        watch('font-size-select', 'fontSize');
        watch('font-weight-select', 'fontWeight');
        watch('date-format-select', 'dateFormat');
        watch('time-format-select', 'timeFormat');
        watch('weather-unit-select', 'weatherUnit');
        watch('weather-refresh-select', 'weatherRefreshMinutes');
        watch('link-preview-delay-select', 'linkPreviewHoverDelayMs');
        watch('new-tab-checkbox', 'openInNewTab');
        watch('show-background-dots-checkbox', 'showBackgroundDots');
        watch('show-title-checkbox', 'showTitle');
        watch('show-date-checkbox', 'showDate');
        watch('show-time-checkbox', 'showTime');
        watch('animations-enabled-checkbox', 'animationsEnabled');
        watch('show-page-tabs-checkbox', 'showPageTabs');
        watch('show-page-names-in-tabs-checkbox', 'showPageNamesInTabs');
        watch('always-collapse-categories-checkbox', 'alwaysCollapseCategories');
        watch('global-shortcuts-checkbox', 'globalShortcuts');
        watch('show-add-bookmark-button-checkbox', 'showAddBookmarkButton');
        watch('show-search-button-checkbox', 'showSearchButton');
        watch('show-finders-button-checkbox', 'showFindersButton');
        watch('show-commands-button-checkbox', 'showCommandsButton');
        watch('show-tag-cloud-button-checkbox', 'showTagCloudButton');
        watch('show-shortcuts-checkbox', 'showShortcuts');
        watch('show-icons-checkbox', 'showIcons');
        watch('show-link-preview-cards-checkbox', 'showLinkPreviewCards');
        watch('packed-columns-checkbox', 'packedColumns');
        watch('include-finders-in-search-checkbox', 'includeFindersInSearch');
        watch('enable-fuzzy-suggestions-checkbox', 'enableFuzzySuggestions');
        watch('interleave-mode-checkbox', 'interleaveMode');
    }

    /**
     * Reset settings to defaults
     * @returns {Object} - Default settings
     */
    getDefaults() {
        return {
            theme: 'cherry-graphite-dark',
            openInNewTab: true,
            columnsPerRow: 3,
            fontSize: 'm',
            showBackgroundDots: true,
            showTitle: true,
            showDate: true,
            showTime: true,
            timeFormat: '24h',
            dateFormat: 'short-slash',
            showWeatherWithDate: false,
            weatherSource: 'manual',
            weatherLocation: '',
            weatherUnit: 'celsius',
            weatherRefreshMinutes: 30,
            showConfigButton: true,
            showHealthDashboard: true,
            showSearchButton: true,
            showAddBookmarkButton: true,
            showFindersButton: true,
            showCommandsButton: true,
            showCheatSheetButton: true,
            showRecentButton: true,
            showTagCloudButton: true,
            showTips: true,
            showSearchFlowBanner: true,
            showStatus: true,
            colorizeStatus: true,
            showPing: true,
            statusOfflineRetries: 3,
            statusOfflineRetryDelayMs: 450,
            statusRecheckIntervalMinutes: 5,
            showPinIcon: false,
            showNoteIcon: true,
            showShortcuts: true,
            showIcons: false,
            showLinkPreviewCards: false,
            linkPreviewHoverDelayMs: 150,
            globalShortcuts: true,
            hyprMode: false,
            animationsEnabled: true,
            showSyncToasts: false,
            enableCustomTitle: false,
            customTitle: '',
            showPageInTitle: false,
            showPageNamesInTabs: false,
            enableCustomFavicon: false,
            customFaviconPath: '',
            language: 'en',
            interleaveMode: false,
            showPageTabs: true,
            alwaysCollapseCategories: false,
            backgroundOpacity: 1,
            fontWeight: 'normal',
            fontPreset: 'source-code-pro',
            autoDarkMode: false,
            showSmartRecentCollection: false,
            showSmartTodayCollection: true,
            showSmartStaleCollection: false,
            showSmartMostUsedCollection: false,
            smartTodayLimit: 8,
            smartRecentLimit: 50,
            smartStaleLimit: 50,
            smartMostUsedLimit: 25,
            smartTodayPageIds: [],
            smartTodayWorkKeywords: 'calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams',
            smartTodayEveningKeywords: 'youtube,spotify,netflix,reddit',
            smartTodayWeekendKeywords: 'news,weather,maps',
            smartRecentPageIds: [],
            smartStalePageIds: [],
            smartMostUsedPageIds: [],
            packedColumns: true,
            densityMode: 'compact',
            backgroundType: 'none',
            backgroundGradient: '',
            backgroundImageUrl: '',
        };
    }

    /**
     * Apply animations setting to page
     * @param {boolean} enabled
     */
    applyAnimations(enabled) {
        if (enabled) {
            document.body.classList.remove('no-animations');
        } else {
            document.body.classList.add('no-animations');
        }
    }

    applyBackgroundOpacity(value) {
        const opacity = Number(value ?? 1);
        const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0.65, opacity)) : 1;
        document.documentElement.style.setProperty('--dashboard-bg-opacity', String(clamped));
        document.body.style.opacity = String(clamped);
    }

    applyFontWeight(value) {
        const fontWeight = value || 'normal';
        document.documentElement.style.setProperty('--dashboard-font-weight', fontWeight);
        document.body.style.fontWeight = fontWeight;
    }

    applyAutoDarkMode(enabled, settings) {
        if (!enabled || !window.matchMedia) {
            return;
        }

        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => {
            const nextTheme = this.getPairedThemeVariant(settings?.theme || 'dark', media.matches);
            if (settings) {
                settings.theme = nextTheme;
            }
            this.applyTheme(nextTheme);
            this.updateAutoPreview(nextTheme);
            this.applyBackground(settings);
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) {
                const hasTheme = Array.from(themeSelect.options).some((option) => option.value === nextTheme);
                if (hasTheme) {
                    themeSelect.value = nextTheme;
                }
            }
        };

        apply();

        if (!this._autoDarkModeListenerAttached && typeof media.addEventListener === 'function') {
            media.addEventListener('change', () => {
                apply();
                this.updateSystemAppearanceBadge(settings?.theme);
            });
            this._autoDarkModeListenerAttached = true;
        }

        this.updateSystemAppearanceBadge(settings?.theme);
    }

    /**
     * Save settings to server (used for favicon changes to always persist globally)
     * @param {Object} settings
     */
    /**
     * @returns {Promise<boolean>}
     */
    async saveSettingsToServer(settings) {
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            if (!response.ok) {
                console.error('Settings save failed:', response.status);
                return false;
            }
            window.DeviceSettingsMerge?.pruneDeviceCacheAfterServerSave?.();
            if (settings?.showSearchFlowBanner !== false) {
                try {
                    sessionStorage.removeItem('nextDashSearchFlowHintDismissedV2');
                    localStorage.removeItem('nextDashSearchFlowHintDismissedV1');
                } catch {
                    // Ignore localStorage errors.
                }
            }
            return true;
        } catch (error) {
            console.error('Error saving settings to server:', error);
            return false;
        }
    }
    populateBackgroundPresets() {
        const grid = document.getElementById('bg-preset-grid');
        if (!grid) return;
        grid.innerHTML = '';
        Object.entries(CONFIG_BACKGROUND_PRESETS).forEach(([id, css]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bg-preset-btn';
            btn.dataset.preset = id;
            btn.style.background = css;
            btn.title = id;
            btn.setAttribute('aria-label', id);
            btn.addEventListener('click', () => {
                const settingsData = this._currentSettings;
                if (!settingsData) return;
                settingsData.backgroundGradient = id;
                this.syncPresetUI(id);
                this.applyBackground(settingsData);
            });
            grid.appendChild(btn);
        });
    }

    syncBgTypeUI(type) {
        document.querySelectorAll('.bg-type-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.bgType === type)
        );
        const autoSection = document.getElementById('bg-auto-section');
        const gradientSection = document.getElementById('bg-gradient-section');
        const imageSection = document.getElementById('bg-image-section');
        if (autoSection) autoSection.hidden = type !== 'auto';
        if (gradientSection) gradientSection.hidden = type !== 'gradient';
        if (imageSection) imageSection.hidden = type !== 'image';
    }

    syncPresetUI(preset) {
        document.querySelectorAll('.bg-preset-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.preset === preset)
        );
    }

    updateAutoPreview(theme) {
        const preview = document.getElementById('bg-auto-preview');
        if (!preview) return;
        const presetName = CONFIG_THEME_BACKGROUND_MAP[theme] || '';
        const css = CONFIG_BACKGROUND_PRESETS[presetName] || '';
        preview.style.background = css;
        preview.style.display = css ? 'block' : 'none';
    }

    applyBackground(settings) {
        const type = (settings && settings.backgroundType) || 'none';
        const body = document.body;
        body.classList.remove('has-custom-background', 'bg-gradient', 'bg-image');
        document.documentElement.style.removeProperty('--custom-background-image');

        if (type === 'none') {
            const showDots = settings ? settings.showBackgroundDots !== false : true;
            body.classList.toggle('no-background-dots', !showDots);
            return;
        }

        const showDots = settings ? settings.showBackgroundDots !== false : true;
        const forceNoDots = (type === 'image');
        body.classList.toggle('no-background-dots', forceNoDots || !showDots);
        body.classList.add('has-custom-background');

        let presetName = '';
        if (type === 'auto') {
            presetName = CONFIG_THEME_BACKGROUND_MAP[(settings && settings.theme) || ''] || '';
        } else if (type === 'gradient') {
            presetName = (settings && settings.backgroundGradient) || '';
        }

        if (presetName) {
            const css = CONFIG_BACKGROUND_PRESETS[presetName] || '';
            if (css) {
                document.documentElement.style.setProperty('--custom-background-image', css);
                body.classList.add('bg-gradient');
            }
            return;
        }

        if (type === 'image') {
            const url = ((settings && settings.backgroundImageUrl) || '').trim();
            if (url) {
                document.documentElement.style.setProperty(
                    '--custom-background-image',
                    `url('${url.replace(/'/g, '%27')}')`
                );
                body.classList.add('bg-image');
            }
        }
    }
}

// Export for use in other modules
window.ConfigSettings = ConfigSettings;
