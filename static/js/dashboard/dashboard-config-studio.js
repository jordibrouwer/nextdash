/**
 * The look studio: the theme browser with tabs beside the dashboard.
 *
 * theme-browser.js draws the panel, the tabs and the theme grid; this file
 * hands it the rest. The Backdrop, Surface and Headers tabs are the Appearance
 * controls themselves (renderBackdropPanel, renderCardGlassPanel, the category
 * header schema panel), bound by the same binders, so a control cannot behave
 * one way in config and another way here.
 *
 * Those controls change the page live and save at once. In the studio they
 * still do both, but the save is gated: dashboard-data.js sends the look
 * fields as they were when the studio opened (`_lookStudioCommitted`), so
 * whatever else is saved meanwhile still lands and the look only lands on
 * Apply. Cancel writes the look fields back from the same snapshot and goes
 * through the existing revert.
 */
(function (global) {
    'use strict';

    const DEFAULT_TUNING = { strength: 1, scale: 1, seed: 0, blur: 0, brightness: 1, saturate: 1, tint: 0 };

    const HEAD_FIELDS = ['categoryHeaderStyle', 'categoryHeaderSize', 'showCategoryIcon',
        'showCategoryCount', 'categoryHeaderAccentLine'];

    /** Every setting the studio previews. Only these are gated and put back. */
    const LOOK_FIELDS = ['theme', 'themeBackdrop', 'themeSurfacePrefs', 'themeSurfacesForceAll',
        'backdropTuning', 'cardGlass', 'themeDepth', 'glowStrength', 'themeEffects', ...HEAD_FIELDS];

    /*
     * What each tab owns, for its dot and its Reset. themeSurfacePrefs holds
     * answers for two tabs at once, per theme, so those are named by key.
     */
    const TAB_FIELDS = {
        themes: { fields: ['theme'], prefs: [] },
        backdrop: { fields: ['themeBackdrop', 'backdropTuning'], prefs: ['backdrop'] },
        surface: { fields: ['themeDepth', 'glowStrength', 'themeEffects', 'cardGlass'],
            prefs: ['depth', 'glow', 'effects', 'alpha', 'blur', 'border'] },
        heads: { fields: HEAD_FIELDS, prefs: [] },
        looks: { fields: [], prefs: [] },
    };

    const HEAD_STYLES = ['clean', 'underlined', 'boxed', 'label', 'group'];

    /*
     * The built-in looks. A look is a set of answers, not a theme: it sets the
     * backdrop, the card glass and the headers, and leaves the theme alone.
     * The three glass looks ask for depth Glass as well, because card glass is
     * only drawn there and would otherwise change nothing.
     */
    const LOOKS = [
        {
            id: 'homepage', labelKey: 'config.lookHomepage', label: 'Homepage',
            noteKey: 'config.lookHomepageNote', note: 'Photo-like backdrop, glass cards, clean headers',
            backdrop: 'sunset', tuning: { strength: 1.2, blur: 0, brightness: 0.85, saturate: 1.1, tint: 0 },
            glass: { alpha: 0.55, blur: 12, border: null }, depth: 'glass',
            heads: { categoryHeaderStyle: 'clean', showCategoryIcon: true, showCategoryCount: false },
        },
        {
            id: 'homepage-boxed', labelKey: 'config.lookHomepageBoxed', label: 'Homepage boxed',
            noteKey: 'config.lookHomepageBoxedNote', note: 'Boxed headers, a little more blur',
            backdrop: 'mountains', tuning: { strength: 1.3, blur: 2, brightness: 0.75, saturate: 1.2, tint: 0 },
            glass: { alpha: 0.6, blur: 10, border: 'on' }, depth: 'glass',
            heads: { categoryHeaderStyle: 'boxed', showCategoryIcon: true, showCategoryCount: true },
        },
        {
            id: 'frosted', labelKey: 'config.lookFrosted', label: 'Frosted',
            noteKey: 'config.lookFrostedNote', note: 'Lots of blur, see-through cards',
            backdrop: 'bokeh', tuning: { strength: 1.6, blur: 8, brightness: 1, saturate: 1.4, tint: 0 },
            glass: { alpha: 0.3, blur: 24, border: 'on' }, depth: 'glass',
            heads: { categoryHeaderStyle: 'underlined', showCategoryIcon: false, showCategoryCount: false },
        },
        {
            id: 'plain', labelKey: 'config.lookPlain', label: 'Plain',
            noteKey: 'config.lookPlainNote', note: 'No backdrop, solid cards, label headers',
            backdrop: 'off', tuning: { strength: 1, blur: 0, brightness: 1, saturate: 1, tint: 0 },
            glass: { alpha: 1, blur: 0, border: 'on' }, depth: null,
            heads: { categoryHeaderStyle: 'label', showCategoryIcon: false, showCategoryCount: true },
        },
    ];

    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

    /** JSON with sorted keys and no undefined, so two equal answers compare equal. */
    function canonical(value) {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort()
                .filter((k) => value[k] !== undefined)
                .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    /** The part of the settings one tab owns. */
    function tabState(settings, tab) {
        const spec = TAB_FIELDS[tab];
        const out = {};
        spec.fields.forEach((field) => { out[field] = settings?.[field]; });
        if (spec.prefs.length) {
            const prefs = {};
            Object.entries(settings?.themeSurfacePrefs || {}).forEach(([id, entry]) => {
                const picked = {};
                spec.prefs.forEach((key) => {
                    if (entry && entry[key] !== undefined) picked[key] = entry[key];
                });
                if (Object.keys(picked).length) prefs[id] = picked;
            });
            out.prefs = prefs;
        }
        return out;
    }

    function randomIn(min, max, step) {
        const steps = Math.round((max - min) / step);
        return Number((min + step * Math.floor(Math.random() * (steps + 1))).toFixed(2));
    }

    Object.assign(global.DashboardConfig.prototype, {

        /** Open the studio, from config, the dashboard, Shift+A or the notice. */
        async openLookStudio(options = {}) {
            if (!window.ThemeBrowser?.open) return;
            if (window.ThemeBrowser.isOpen?.()) {
                window.ThemeBrowser.open();
                return;
            }
            const [colors, meta] = await Promise.all([
                this.loadColorsData(), this.loadThemeMeta(), this.loadThemeList(),
                window.ThemeLoader?.loadSurfaceMeta?.(),
            ]).then(([c, m]) => [c, m]);
            const palettes = {
                light: colors?.light || {},
                dark: colors?.dark || {},
                ...(colors?.builtIn || {}),
                ...(colors?.custom || {}),
            };

            // The studio docks beside the dashboard, so config steps aside
            // while it is open and comes back where it was when it closes.
            const returnTo = this.isActiveView() ? { section: this.section } : null;
            if (returnTo) this.closeConfigView();

            const settings = this.dash.settings;
            const before = {};
            LOOK_FIELDS.forEach((field) => {
                if (settings[field] !== undefined) before[field] = clone(settings[field]);
            });
            this._lookStudio = {
                before,
                returnTo,
                loadedSeed: Number(settings.backdropTuning?.seed) || 0,
                held: null,
                ui: null,
            };
            this.dash._lookStudioCommitted = { keys: LOOK_FIELDS, values: clone(before) };
            // What the existing revert puts back on Cancel.
            this._themePickerPrevious = settings.theme || 'dark';
            void this.loadStudioBackdrops();

            this._lookStudio.ui = window.ThemeBrowser.open({
                palettes,
                meta,
                tab: options.tab,
                current: () => this.dash.settings?.theme || 'dark',
                favorites: Array.isArray(settings.favoriteThemes) ? settings.favoriteThemes : [],
                t: (key, fallback) => this.t(key, fallback),
                displayName: (id, name) => this.themeDisplayName(id, name),
                onSelect: (id) => this.studioSelectTheme(id),
                onFavorites: (favorites) => {
                    // Not a look field, so this save goes through as it is.
                    this.dash.settings.favoriteThemes = favorites;
                    void this.saveSettingsWithFeedback();
                },
                renderTab: (tab) => this.renderStudioTab(tab),
                bindTab: (tab, host) => this.bindStudioTab(tab, host),
                isDirty: (tab) => this.studioTabDirty(tab),
                scope: () => this.surfaceScope(),
                setScope: (scope) => this.setToggle('themeSurfacesForceAll', scope === 'global'),
                onResetTab: (tab) => this.resetStudioTab(tab),
                onDice: (tab) => this.rollStudioTab(tab),
                onCompare: (on) => this.compareStudio(on),
                onCancel: () => this.cancelLookStudio(),
                onApply: () => this.applyLookStudio(),
                onClose: () => this.afterLookStudio(),
            });
            if (!this._lookStudio.ui) this.endLookStudio();
        },

        /** Drop the gate and the studio's state, whichever way it closed. */
        endLookStudio() {
            delete this.dash._lookStudioCommitted;
            const returnTo = this._lookStudio?.returnTo || null;
            this._lookStudio = null;
            return returnTo;
        },

        afterLookStudio() {
            const returnTo = this._lookStudioReturn;
            this._lookStudioReturn = null;
            if (returnTo) void this.openConfigView(returnTo.section);
        },

        /* ── Showing a look ─────────────────────────────────────────────── */

        /** Draw the page from the look fields in dash.settings, without saving. */
        applyStudioLook({ theme = true } = {}) {
            const settings = this.dash.settings;
            if (theme) {
                this.clearThemePreview();
                this.applyThemeLive();
            }
            // A theme of the reader's own that only lives in this browser has
            // no block in /api/theme.css yet: show it from its palette.
            const shown = this.displayTheme();
            if (theme && window.ThemeUtils?.isUserCustomThemeId?.(shown) && this.themeById(shown)) {
                this.previewThemeChoice(shown);
            }
            this.applyBackdropTuning({ ...DEFAULT_TUNING, ...(settings.backdropTuning || {}) });
            this.applyChromeSettings();
            void this.applyResolvedSurfaces();
        },

        /** Write look fields from `source` into the settings; absent ones are removed. */
        writeLookFields(source, fields = LOOK_FIELDS) {
            const settings = this.dash.settings;
            fields.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(source, field)) settings[field] = clone(source[field]);
                else delete settings[field];
            });
        },

        studioSelectTheme(id) {
            if (!id || !this._lookStudio) return;
            this.dash.settings.theme = id;
            this.applyStudioLook();
        },

        /* ── Tabs ───────────────────────────────────────────────────────── */

        renderStudioTab(tab) {
            const e = (v) => this.dash.escapeHtml(String(v));
            const t = (k, f) => this.t(k, f);
            switch (tab) {
                case 'backdrop':
                    return this.renderBackdropPanel() + this.renderBackdropTuningPanel();
                case 'surface':
                    return this.renderSurfacesPanel() + this.renderCardGlassPanel();
                case 'heads': {
                    const panels = this.panelsFor('appearance', 'display')
                        .filter((p) => p.controls?.some((c) => c.field === 'categoryHeaderStyle'));
                    return this.renderControlPanels(panels, 'behavior');
                }
                case 'looks':
                    return `
                        <p class="config-panel-note">${e(t('config.studioLooksNote', 'A look sets the backdrop, the card glass and the headers in one go. The theme stays what it is.'))}</p>
                        <div class="look-studio-looks">${LOOKS.map((look) => `
                            <div class="look-studio-look" data-studio-look="${e(look.id)}">
                                <span class="look-studio-look-sw" data-studio-look-sw="${e(look.backdrop)}" aria-hidden="true"></span>
                                <span class="look-studio-look-text">
                                    <b>${e(t(look.labelKey, look.label))}</b>
                                    <span>${e(t(look.noteKey, look.note))}</span>
                                </span>
                                <button type="button" class="look-studio-btn" data-studio-use-look="${e(look.id)}">${e(t('config.studioUseLook', 'Use'))}</button>
                            </div>`).join('')}
                        </div>`;
                default:
                    return '';
            }
        },

        bindStudioTab(tab, host) {
            if (tab === 'backdrop' || tab === 'surface') {
                host.querySelectorAll('select[data-appearance-select]').forEach((select) => {
                    select.addEventListener('change', () => this.setAppearanceSelect(select.getAttribute('data-appearance-select'), select.value));
                });
                this.bindAffordances(host, null, (field, def) => this.applyAppearanceField(field, def));
                this.bindLookControls(host);
            } else if (tab === 'heads') {
                this.bindControlPanels(host, 'behavior');
            } else if (tab === 'looks') {
                host.querySelectorAll('[data-studio-use-look]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.useStudioLook(button.getAttribute('data-studio-use-look'));
                        this._lookStudio?.ui?.refresh();
                    });
                });
                void this.paintStudioLooks(host);
            }
        },

        /** The recipes as /api/themes/backdrops draws them, fetched once per opening. */
        async loadStudioBackdrops() {
            if (this._lookStudio?.backdrops) return this._lookStudio.backdrops;
            try {
                const res = await fetch('/api/themes/backdrops');
                const data = res.ok ? await res.json() : null;
                if (this._lookStudio && data) this._lookStudio.backdrops = data;
                return data;
            } catch (_) {
                return null;
            }
        },

        async paintStudioLooks(host) {
            const data = await this.loadStudioBackdrops();
            host.querySelectorAll('[data-studio-look-sw]').forEach((sw) => {
                const look = data?.looks?.[sw.getAttribute('data-studio-look-sw')];
                if (!look) return;
                sw.style.backgroundImage = look.image;
                sw.style.backgroundSize = look.size;
                sw.style.backgroundPosition = look.position;
            });
        },

        studioTabDirty(tab) {
            const studio = this._lookStudio;
            if (!studio || !TAB_FIELDS[tab]) return false;
            return canonical(tabState(this.dash.settings, tab)) !== canonical(tabState(studio.before, tab));
        },

        /** Put one tab's answers back to what they were when the studio opened. */
        resetStudioTab(tab) {
            const studio = this._lookStudio;
            const spec = TAB_FIELDS[tab];
            if (!studio || !spec) return;
            this.writeLookFields(studio.before, spec.fields);
            if (spec.prefs.length) {
                const settings = this.dash.settings;
                const prefs = settings.themeSurfacePrefs || {};
                const old = studio.before.themeSurfacePrefs || {};
                new Set([...Object.keys(prefs), ...Object.keys(old)]).forEach((id) => {
                    const entry = { ...(prefs[id] || {}) };
                    spec.prefs.forEach((key) => {
                        if (old[id] && old[id][key] !== undefined) entry[key] = clone(old[id][key]);
                        else delete entry[key];
                    });
                    if (Object.keys(entry).length) prefs[id] = entry; else delete prefs[id];
                });
                if (Object.keys(prefs).length || studio.before.themeSurfacePrefs) settings.themeSurfacePrefs = prefs;
                else delete settings.themeSurfacePrefs;
            }
            this.applyStudioLook();
        },

        /** The dice: a surprise within one tab. Themes are rolled by the browser itself. */
        rollStudioTab(tab) {
            const settings = this.dash.settings;
            if (tab === 'backdrop') {
                const recipes = this._lookStudio?.backdrops?.recipes || [];
                const current = this.backdropChoice();
                const pool = recipes.filter((name) => name !== current);
                if (!pool.length) return;
                const recipe = pool[Math.floor(Math.random() * pool.length)];
                this._lastBackdropPick = recipe;
                settings.backdropTuning = { ...DEFAULT_TUNING, ...(settings.backdropTuning || {}), seed: 1 + Math.floor(Math.random() * 40) };
                this.setBackdropChoice(recipe);
                this.reloadThemeCSS();
            } else if (tab === 'surface') {
                this.setCardGlass({ alpha: randomIn(0.3, 1, 0.05), blur: randomIn(0, 24, 1) });
            } else if (tab === 'heads') {
                const pool = HEAD_STYLES.filter((style) => style !== settings.categoryHeaderStyle);
                settings.categoryHeaderStyle = pool[Math.floor(Math.random() * pool.length)];
                this.applyChromeSettings();
            } else if (tab === 'looks') {
                this.useStudioLook(LOOKS[Math.floor(Math.random() * LOOKS.length)].id);
            }
        },

        /** Set every answer a built-in look gives, through the controls' own setters. */
        useStudioLook(id) {
            const look = LOOKS.find((l) => l.id === id);
            const settings = this.dash.settings;
            if (!look || !settings) return;
            const tuning = { ...DEFAULT_TUNING, ...(settings.backdropTuning || {}), ...look.tuning };
            settings.backdropTuning = tuning;
            this.applyBackdropTuning(tuning);
            Object.assign(settings, look.heads);
            this.applyChromeSettings();
            this.setCardGlass(look.glass);
            if (look.depth) this.setSurface('themeDepth', look.depth);
            if (look.backdrop !== 'off') this._lastBackdropPick = look.backdrop;
            this.setBackdropChoice(look.backdrop);
        },

        /* ── Compare, Cancel, Apply ─────────────────────────────────────── */

        /** While held, show the look from before the studio opened. */
        compareStudio(on) {
            const studio = this._lookStudio;
            if (!studio) return;
            if (on) {
                if (studio.held) return;
                studio.held = {};
                LOOK_FIELDS.forEach((field) => {
                    if (this.dash.settings[field] !== undefined) studio.held[field] = clone(this.dash.settings[field]);
                });
                this.writeLookFields(studio.before);
            } else {
                if (!studio.held) return;
                this.writeLookFields(studio.held);
                studio.held = null;
            }
            this.applyStudioLook();
        },

        cancelLookStudio() {
            const studio = this._lookStudio;
            if (!studio) return;
            this.writeLookFields(studio.before);
            this._lookStudioReturn = this.endLookStudio();
            // The theme goes back through the revert the picker always used;
            // the rest of the look is drawn again from the restored fields.
            this.revertThemePreview();
            this.applyStudioLook({ theme: false });
        },

        async applyLookStudio() {
            const studio = this._lookStudio;
            if (!studio) return true;
            const gate = this.dash._lookStudioCommitted;
            delete this.dash._lookStudioCommitted;
            const ok = await this.saveSettingsWithFeedback();
            if (!ok) {
                // Nothing was stored, so the preview stays a preview.
                this.dash._lookStudioCommitted = gate;
                return false;
            }
            const themeChanged = studio.before.theme !== this.dash.settings.theme;
            this._themePickerPrevious = null;
            this._lookStudioReturn = this.endLookStudio();
            this.clearThemePreview();
            if (themeChanged) void this.offerGlowForGloss(this.dash.settings.theme);
            return true;
        },
    });
    global.DashboardConfigStudioReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
