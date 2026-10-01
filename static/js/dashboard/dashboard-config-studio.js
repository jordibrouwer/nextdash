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
     * backdrop and its sliders, the card glass, the depth and the category
     * headers, and leaves the theme's colours alone. Every look with glass
     * asks for depth Glass as well, because card glass is only drawn there and
     * would otherwise change nothing. Plain keeps the depth it finds.
     *
     * Each one names all five header answers, so going from one look to the
     * next never leaves a header setting behind from the one before.
     */
    const look = (id, label, note, backdrop, tuning, glass, depth, heads) => ({
        id, label, note, backdrop, depth,
        labelKey: `config.look.${id}`, noteKey: `config.look.${id}Note`,
        tuning: { strength: 1, blur: 0, brightness: 1, saturate: 1, tint: 0, ...tuning },
        glass: { border: null, ...glass },
        heads: { categoryHeaderSize: 'm', showCategoryIcon: true, showCategoryCount: false,
            categoryHeaderAccentLine: false, ...heads },
    });

    const LOOKS = [
        look('homepage', 'Homepage', 'Photo-like backdrop, glass cards, clean headers',
            'sunset', { strength: 1.2, brightness: 0.85, saturate: 1.1 },
            { alpha: 0.55, blur: 12 }, 'glass', { categoryHeaderStyle: 'clean' }),
        look('homepage-boxed', 'Homepage boxed', 'Boxed headers, a little more blur',
            'mountains', { strength: 1.3, blur: 2, brightness: 0.75, saturate: 1.2 },
            { alpha: 0.6, blur: 10, border: 'on' }, 'glass',
            { categoryHeaderStyle: 'boxed', showCategoryCount: true }),
        look('frosted', 'Frosted', 'Lots of blur, see-through cards',
            'bokeh', { strength: 1.6, blur: 8, saturate: 1.4 },
            { alpha: 0.3, blur: 24, border: 'on' }, 'glass',
            { categoryHeaderStyle: 'underlined', showCategoryIcon: false }),
        look('aurora', 'Aurora', 'Northern light behind clear glass',
            'aurora', { strength: 1.4, blur: 4, saturate: 1.2 },
            { alpha: 0.45, blur: 16 }, 'glass', { categoryHeaderStyle: 'underlined' }),
        look('night-sky', 'Night sky', 'Stars on a darkened page, quiet labels',
            'stars', { brightness: 0.8 },
            { alpha: 0.6, blur: 10 }, 'glass', { categoryHeaderStyle: 'label', showCategoryIcon: false }),
        look('soft', 'Soft', 'A blurred wash of colour, calm cards',
            'mesh', { strength: 0.8, blur: 6, saturate: 0.9 },
            { alpha: 0.7, blur: 14 }, 'glass', { categoryHeaderStyle: 'clean' }),
        look('desert', 'Desert', 'Warm dunes tinted by the theme, with counts',
            'dunes', { tint: 0.2 },
            { alpha: 0.6, blur: 12 }, 'glass', { categoryHeaderStyle: 'clean', showCategoryCount: true }),
        look('paper', 'Paper', 'Contour lines and near-solid cards, accent underline',
            'topo', { brightness: 1.05 },
            { alpha: 0.85, blur: 6 }, 'glass', { categoryHeaderStyle: 'underlined', categoryHeaderAccentLine: true }),
        look('blueprint', 'Blueprint', 'A drafting grid, edged cards, boxed headers',
            'blueprint', {},
            { alpha: 0.85, blur: 4, border: 'on' }, 'glass',
            { categoryHeaderStyle: 'boxed', showCategoryCount: true }),
        look('terminal', 'Terminal', 'Scanlines, solid cards, bare labels',
            'scanlines', {},
            { alpha: 0.9, blur: 0 }, 'glass',
            { categoryHeaderStyle: 'label', showCategoryIcon: false, showCategoryCount: true }),
        look('neon', 'Neon', 'Bright prisms, see-through cards, group cards',
            'prism', { strength: 1.6, saturate: 1.6 },
            { alpha: 0.4, blur: 18, border: 'on' }, 'glass', { categoryHeaderStyle: 'group' }),
        look('plain', 'Plain', 'No backdrop, solid cards, label headers',
            'off', {},
            { alpha: 1, blur: 0, border: 'on' }, null,
            { categoryHeaderStyle: 'label', showCategoryIcon: false, showCategoryCount: true }),
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
            // The tabs are Appearance's own controls, and their styles ride in
            // the views bundle, which nothing on the dashboard has asked for
            // yet when the studio is opened from there.
            const [colors, meta] = await Promise.all([
                this.loadColorsData(), this.loadThemeMeta(), this.loadThemeList(),
                window.ThemeLoader?.loadSurfaceMeta?.(),
                window.ViewStyles?.ensureViewStyles?.(),
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
                onPreview: (id) => this.studioPreviewTheme(id),
                onPreviewEnd: () => this.studioEndPreview(),
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

        /**
         * Show a theme the pointer is on, without choosing it: the colours,
         * and the surfaces the reader has for that theme. The settings keep
         * the chosen theme, so Apply, Cancel and the dots are unaffected.
         */
        studioPreviewTheme(id) {
            if (!id || !this._lookStudio || this._lookStudio.held) return;
            this.previewThemeChoice(id);
            void window.ThemeLoader?.applySurfacesForTheme?.(id, this.dash.settings);
        },

        /** Back to the chosen theme once the pointer leaves the grid. */
        studioEndPreview() {
            if (!this._lookStudio) return;
            this.clearThemePreview();
            window.ThemeLoader?.applyTheme?.(this.displayTheme(), this.currentFontSize());
            void this.applyResolvedSurfaces();
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
                        <div class="look-studio-looks-intro">
                            <p>${e(t('config.studioLooksIntro', 'A look is a set of answers for the other tabs: which backdrop is drawn and how strongly, how solid and blurred the cards are, and how category headers read. Your theme keeps its colours; a look only changes how they are used.'))}</p>
                            <p>${e(t('config.studioLooksHow', 'Use shows it on the page straight away. Nothing is stored until Apply, and Cancel puts everything back. “Applies to” below decides whether it holds for this theme or every theme. Afterwards each part can be tuned in its own tab.'))}</p>
                        </div>
                        <div class="look-studio-looks">${LOOKS.map((item) => `
                            <div class="look-studio-look" data-studio-look="${e(item.id)}">
                                <span class="look-studio-look-sw" data-studio-look-sw="${e(item.backdrop)}" aria-hidden="true"></span>
                                <span class="look-studio-look-text">
                                    <b>${e(t(item.labelKey, item.label))}</b>
                                    <span>${e(t(item.noteKey, item.note))}</span>
                                    <span class="look-studio-look-parts">${e(this.describeStudioLook(item))}</span>
                                </span>
                                <button type="button" class="look-studio-btn" data-studio-use-look="${e(item.id)}">${e(t('config.studioUseLook', 'Use'))}</button>
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

        /** What a look sets, in one line: "Backdrop sunset · Glass 55%, blur 12 · Clean headers". */
        describeStudioLook(item) {
            const t = (k, f) => this.t(k, f);
            const styleName = {
                clean: t('config.categoryHeaderClean', 'Clean'),
                underlined: t('config.categoryHeaderUnderlined', 'Underlined'),
                boxed: t('config.categoryHeaderBoxed', 'Boxed'),
                label: t('config.categoryHeaderLabel', 'Label'),
                group: t('config.categoryHeaderGroupCard', 'Group card'),
            }[item.heads.categoryHeaderStyle] || item.heads.categoryHeaderStyle;
            const parts = [
                item.backdrop === 'off'
                    ? t('config.lookPartNoBackdrop', 'No backdrop')
                    : t('config.lookPartBackdrop', 'Backdrop {recipe}').replace('{recipe}', item.backdrop),
                (item.glass.alpha >= 1
                    ? t('config.lookPartSolid', 'Solid cards')
                    : t('config.lookPartGlass', 'Glass {alpha}%, blur {blur}')
                        .replace('{alpha}', String(Math.round(item.glass.alpha * 100)))
                        .replace('{blur}', String(item.glass.blur)))
                    + (item.glass.border === 'on' ? t('config.lookPartEdge', ', edged') : ''),
                t('config.lookPartHeaders', '{style} headers').replace('{style}', styleName)
                    + (item.heads.showCategoryCount ? t('config.lookPartCount', ' with counts') : ''),
            ];
            return parts.join(' · ');
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
