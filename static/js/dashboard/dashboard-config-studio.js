/**
 * The look studio: the theme browser with tabs beside the dashboard.
 *
 * theme-browser.js draws the panel, the tabs and the theme grid; this file
 * hands it the rest. The Backdrop, Surface, Headers and Layout tabs are the
 * Appearance controls themselves (renderBackdropPanel, renderCardGlassPanel,
 * renderTypeFields, the schema panels cut down to their fields), bound by the
 * same binders, so a control cannot behave one way in config and another way
 * here.
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

    /** The header bar above the categories: on the Headers tab, below them. */
    const BAR_FIELDS = ['headerButtonStyle', 'pageSwitcherStyle'];

    /** The Layout tab: type first, then how the grid and its rows are laid out. */
    const TEXT_FIELDS = ['fontPreset', 'fontWeight', 'fontSize', 'inkGap', 'themeIconStyling'];
    const GRID_FIELDS = ['layoutPreset', 'columnsPerRow', 'densityMode', 'categorySpacing', 'sideMargin',
        'launcherIconSize', 'rowHighlight', 'showIcons', 'colorizeStatus'];

    /*
     * The ones the grid reads while it draws. Putting one of these back (on
     * Compare, Cancel or Reset) needs the grid drawn again; the chrome pass
     * alone leaves the old columns and rows standing.
     */
    const RENDER_FIELDS = ['layoutPreset', 'columnsPerRow', 'densityMode', 'categorySpacing', 'sideMargin',
        'showIcons', 'colorizeStatus'];

    /** Every setting the studio previews. Only these are gated and put back. */
    const LOOK_FIELDS = ['theme', 'themeBackdrop', 'themeSurfacePrefs', 'themeSurfacesForceAll',
        'backdropTuning', 'backgroundPattern', 'cardGlass', 'themeDepth', 'glowStrength', 'themeEffects',
        ...HEAD_FIELDS, ...BAR_FIELDS, ...TEXT_FIELDS, ...GRID_FIELDS];

    /*
     * What each tab owns, for its dot and its Reset. themeSurfacePrefs holds
     * answers for two tabs at once, per theme, so those are named by key.
     */
    const TAB_FIELDS = {
        themes: { fields: ['theme'], prefs: [] },
        backdrop: { fields: ['themeBackdrop', 'backdropTuning', 'backgroundPattern'], prefs: ['backdrop'] },
        surface: { fields: ['themeDepth', 'glowStrength', 'themeEffects', 'cardGlass'],
            prefs: ['depth', 'glow', 'effects', 'alpha', 'blur', 'border'] },
        heads: { fields: [...HEAD_FIELDS, ...BAR_FIELDS], prefs: [] },
        layout: { fields: [...TEXT_FIELDS, ...GRID_FIELDS], prefs: [] },
        looks: { fields: [], prefs: [] },
    };

    const HEAD_STYLES = ['clean', 'underlined', 'boxed', 'label', 'group'];
    const DENSITIES = ['comfortable', 'compact', 'dense'];
    const SPACINGS = ['snug', 'balanced', 'airy'];

    /** Which tabs the "Applies to" switch speaks for; the rest hold for every theme. */
    const SCOPED_TABS = ['backdrop', 'surface', 'looks'];

    /*
     * The built-in looks. A look is a set of answers, not a theme: it sets the
     * backdrop and its sliders, the card glass, the depth and the category
     * headers, and leaves the theme's colours alone. Every look with glass
     * asks for depth Glass as well, because card glass is only drawn there and
     * would otherwise change nothing. Plain keeps the depth it finds.
     *
     * Each one names all five header answers, so going from one look to the
     * next never leaves a header setting behind from the one before. The same
     * goes for the type and the spacing: every look names a font, a density
     * and the room between categories.
     */
    const look = (id, label, note, backdrop, tuning, glass, depth, heads, [font, density, spacing]) => ({
        id, label, note, backdrop, depth,
        text: { fontPreset: font, densityMode: density, categorySpacing: spacing },
        labelKey: `config.look.${id}`, noteKey: `config.look.${id}Note`,
        tuning: { strength: 1, blur: 0, brightness: 1, saturate: 1, tint: 0, ...tuning },
        glass: { border: null, ...glass },
        heads: { categoryHeaderSize: 'm', showCategoryIcon: true, showCategoryCount: false,
            categoryHeaderAccentLine: false, ...heads },
    });

    const LOOKS = [
        look('glass', 'Glass', 'Photo-like backdrop, glass cards, clean headers',
            'sunset', { strength: 1.2, brightness: 0.85, saturate: 1.1 },
            { alpha: 0.55, blur: 12 }, 'glass', { categoryHeaderStyle: 'clean' },
            ['inter', 'comfortable', 'balanced']),
        look('glass-boxed', 'Glass boxed', 'Boxed headers, a little more blur',
            'mountains', { strength: 1.3, blur: 2, brightness: 0.75, saturate: 1.2 },
            { alpha: 0.6, blur: 10, border: 'on' }, 'glass',
            { categoryHeaderStyle: 'boxed', showCategoryCount: true },
            ['inter', 'comfortable', 'balanced']),
        look('frosted', 'Frosted', 'Lots of blur, see-through cards',
            'bokeh', { strength: 1.6, blur: 8, saturate: 1.4 },
            { alpha: 0.3, blur: 24, border: 'on' }, 'glass',
            { categoryHeaderStyle: 'underlined', showCategoryIcon: false },
            ['dm-sans', 'comfortable', 'airy']),
        look('aurora', 'Aurora', 'Northern light behind clear glass',
            'aurora', { strength: 1.4, blur: 4, saturate: 1.2 },
            { alpha: 0.45, blur: 16 }, 'glass', { categoryHeaderStyle: 'underlined' },
            ['dm-sans', 'comfortable', 'balanced']),
        look('night-sky', 'Night sky', 'Stars on a darkened page, quiet labels',
            'stars', { brightness: 0.8 },
            { alpha: 0.6, blur: 10 }, 'glass', { categoryHeaderStyle: 'label', showCategoryIcon: false },
            ['ibm-plex-mono', 'compact', 'balanced']),
        look('soft', 'Soft', 'A blurred wash of colour, calm cards',
            'mesh', { strength: 0.8, blur: 6, saturate: 0.9 },
            { alpha: 0.7, blur: 14 }, 'glass', { categoryHeaderStyle: 'clean' },
            ['ibm-plex-sans', 'comfortable', 'airy']),
        look('desert', 'Desert', 'Warm dunes tinted by the theme, with counts',
            'dunes', { tint: 0.2 },
            { alpha: 0.6, blur: 12 }, 'glass', { categoryHeaderStyle: 'clean', showCategoryCount: true },
            ['ibm-plex-sans', 'comfortable', 'balanced']),
        look('paper', 'Paper', 'Contour lines and near-solid cards, accent underline',
            'topo', { brightness: 1.05 },
            { alpha: 0.85, blur: 6 }, 'glass', { categoryHeaderStyle: 'underlined', categoryHeaderAccentLine: true },
            ['ibm-plex-sans', 'comfortable', 'airy']),
        look('blueprint', 'Blueprint', 'A drafting grid, edged cards, boxed headers',
            'blueprint', {},
            { alpha: 0.85, blur: 4, border: 'on' }, 'glass',
            { categoryHeaderStyle: 'boxed', showCategoryCount: true },
            ['ibm-plex-mono', 'compact', 'snug']),
        look('terminal', 'Terminal', 'Scanlines, solid cards, bare labels',
            'scanlines', {},
            { alpha: 0.9, blur: 0 }, 'glass',
            { categoryHeaderStyle: 'label', showCategoryIcon: false, showCategoryCount: true },
            ['jetbrains-mono', 'dense', 'snug']),
        look('neon', 'Neon', 'Bright prisms, see-through cards, group cards',
            'prism', { strength: 1.6, saturate: 1.6 },
            { alpha: 0.4, blur: 18, border: 'on' }, 'glass', { categoryHeaderStyle: 'group' },
            ['jetbrains-mono', 'compact', 'balanced']),
        look('plain', 'Plain', 'No backdrop, solid cards, label headers',
            'off', {},
            { alpha: 1, blur: 0, border: 'on' }, null,
            { categoryHeaderStyle: 'label', showCategoryIcon: false, showCategoryCount: true },
            ['system', 'comfortable', 'balanced']),
    ];

    /*
     * Every palette by id, for the grid. The objects are the colour document's
     * own, so an edit in the studio's editor shows on its card at once.
     */
    const studioPalettes = (colors) => ({
        light: colors?.light || {},
        dark: colors?.dark || {},
        ...(colors?.builtIn || {}),
        ...(colors?.custom || {}),
    });

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

    /** What the grid is drawn from, to tell whether putting answers back needs a redraw. */
    const drawnFrom = (settings) => canonical(RENDER_FIELDS.map((field) => settings?.[field] ?? null));

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
            const palettes = studioPalettes(colors);

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
            // The colours as they were, for Cancel, Compare and Reset: an edit
            // made in the studio is held until Apply (saveColorsData).
            this._lookStudio.colorsBefore = clone(colors || this._colorsData || null);
            this._lookStudio.colorsHeld = false;
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
                renderEditor: (id) => this.renderStudioThemeEditor?.(id) || '',
                bindEditor: (id, host) => this.bindStudioThemeEditor?.(id, host),
                onEditStart: (id) => this.studioSelectTheme(id),
                onSaveAsTheme: this.openSaveAsThemeDialog ? () => this.openSaveAsThemeDialog() : undefined,
                lookSwitch: {
                    get: () => this.studioUsesThemeLook(),
                    set: (on) => this.setStudioUsesThemeLook(on),
                },
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
                usesScope: (tab) => SCOPED_TABS.includes(tab),
                scope: () => this.surfaceScope(),
                setScope: (scope) => this.setToggle('themeSurfacesForceAll', scope === 'global'),
                onResetTab: (tab, editing) => this.resetStudioTab(tab, editing),
                onDice: (tab) => this.rollStudioTab(tab),
                onCompare: (on) => this.compareStudio(on),
                onCancel: () => this.cancelLookStudio(),
                onApply: () => this.applyLookStudio(),
                onClose: () => this.afterLookStudio(),
            });
            if (!this._lookStudio.ui) this.endLookStudio();
        },

        /** Colour edits made in the studio, undone: the snapshot from when it opened. */
        restoreStudioColors() {
            const studio = this._lookStudio;
            if (!studio?.colorsHeld || !studio.colorsBefore) return;
            this._colorsData = clone(studio.colorsBefore);
            studio.colorsHeld = false;
            studio.colorsNow = null;
            this.syncCustomThemeIds?.();
            this.clearThemePreview();
            studio.ui?.setPalettes?.(studioPalettes(this._colorsData));
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

        /**
         * Draw the page from the look fields in dash.settings, without saving.
         * `redraw` when an answer the grid reads while drawing was put back.
         */
        applyStudioLook({ theme = true, redraw = false } = {}) {
            const settings = this.dash.settings;
            if (theme) {
                this.clearThemePreview();
                this.applyThemeLive();
            }
            // A theme of the reader's own that only lives in this browser has
            // no block in /api/theme.css yet: show it from its palette.
            const shown = this.displayTheme();
            // Colours edited here and not applied yet are not in it either.
            if (theme && (window.ThemeUtils?.isUserCustomThemeId?.(shown) || this._lookStudio?.colorsHeld)
                && this.themeById(shown)) {
                this.previewThemeChoice(shown);
            }
            this.applyBackdropTuning({ ...DEFAULT_TUNING, ...(settings.backdropTuning || {}) });
            window.ThemeLoader?.applyBackgroundPattern?.(settings.backgroundPattern || 'auto');
            window.DashboardFont?.applyMainFont?.(settings);
            this.dash.applyFontSize?.();
            window.ThemeLoader?.applyInkGap?.(settings.inkGap);
            window.ThemeIconStyling?.applyThemeIconStylingToDocument?.(settings);
            // Weight and icon size are body attributes written here.
            this.dash.visual?.applyVisualSettings?.();
            this.applyChromeSettings();
            // The layout class is drawn by the grid itself, so a layout that
            // changed back needs the grid drawn again; the chrome alone does
            // not do it. Only then: a redraw on every compare would flicker.
            const preset = settings.layoutPreset || 'default';
            const grid = document.querySelector('.dashboard-grid');
            if (redraw || (grid && !grid.classList.contains(`layout-${preset}`))) {
                this.dash.renderDashboard?.({ animate: false });
            }
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
            void window.ThemeLoader?.applySurfacesForTheme?.(id, this.dash.settings, id);
        },

        /** Back to the chosen theme once the pointer leaves the grid. */
        studioEndPreview() {
            if (!this._lookStudio) return;
            this.clearThemePreview();
            window.ThemeLoader?.applyTheme?.(this.displayTheme(), this.currentFontSize());
            if (this._lookStudio.colorsHeld) this.previewThemeChoice(this.displayTheme());
            void this.applyResolvedSurfaces();
        },

        studioSelectTheme(id) {
            if (!id || !this._lookStudio) return;
            const pairOf = (themeId) => window.ThemeUtils?.getPairedThemeVariant?.(themeId, true) || themeId;
            const sameFamily = pairOf(this.dash.settings.theme || 'dark') === pairOf(id);
            this.dash.settings.theme = id;
            // A look comes with the theme, not with its other half: switching
            // halves of one pair keeps whatever look is on screen. Set after
            // the theme, so answers kept per theme land on the new one.
            const look = this.themeLookOf(id);
            if (look && !sameFamily && this.studioUsesThemeLook()) this.applyLookAnswers(look);
            this.applyStudioLook();
        },

        /* ── Tabs ───────────────────────────────────────────────────────── */

        renderStudioTab(tab) {
            const e = (v) => this.dash.escapeHtml(String(v));
            const t = (k, f) => this.t(k, f);
            switch (tab) {
                case 'backdrop':
                    return this.renderBackdropPanel() + this.renderBackdropTuningPanel() + this.renderPatternPanel();
                case 'surface':
                    return this.renderSurfacesPanel() + this.renderCardGlassPanel();
                case 'heads': {
                    const panels = this.panelsFor('appearance', 'display')
                        .filter((p) => p.controls?.some((c) => c.field === 'categoryHeaderStyle'));
                    return this.renderControlPanels([...panels, ...this.studioPanels('header', BAR_FIELDS)], 'behavior');
                }
                case 'layout':
                    return `
                        <div class="config-panel">
                            <h3 class="config-panel-title">${e(t('config.appearanceTypeTitle', 'Type'))}</h3>
                            ${this.renderTypeFields()}
                            ${this.renderInkGapField()}
                        </div>
                        <div class="config-panel">
                            <h3 class="config-panel-title">${e(t('config.appearanceFaviconsTitle', 'Favicons'))}</h3>
                            <p class="config-panel-note">${e(t('config.appearanceFaviconsNote', 'How far the icons on your bookmark rows are pulled toward the theme.'))}</p>
                            ${this.renderIconStyling()}
                        </div>
                        ${this.renderControlPanels([
                            ...this.studioPanels('layout', GRID_FIELDS),
                            ...this.studioPanels('display', GRID_FIELDS),
                        ], 'behavior')}
                        <div class="config-panel">
                            <h3 class="config-panel-title">${e(t('config.appearanceDisplayQuickTitle', 'Quick display options'))}</h3>
                            ${this.renderRowToggles()}
                        </div>`;
                case 'looks':
                    return `
                        <div class="look-studio-looks-intro">
                            <p>${e(t('config.studioLooksIntro', 'A look is a set of answers for the other tabs: which backdrop is drawn and how strongly, how solid and blurred the cards are, how category headers read, and which font and spacing the dashboard uses. Your theme keeps its colours; a look only changes how they are used.'))}</p>
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

        /**
         * Appearance's schema panels on one tab, cut down to the given fields.
         * Panels with none of them are left out, and a cut-down panel loses
         * its Show all / Hide all and its note, which speak for rows that are
         * not there.
         */
        studioPanels(appearanceTab, fields) {
            return this.panelsFor('appearance', appearanceTab)
                .map((panel) => {
                    const controls = (panel.controls || []).filter((c) => fields.includes(c.field));
                    const whole = controls.length === (panel.controls || []).length;
                    return { ...panel, bulk: undefined, note: whole ? panel.note : undefined, controls };
                })
                .filter((panel) => panel.controls.length);
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
            } else if (tab === 'layout') {
                this.bindAppearanceFieldControls(host);
                this.bindAffordances(host, null, (field, def) => this.applyAppearanceField(field, def));
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
                `${this.fontPresetLabel(item.text.fontPreset)}, ${String({
                    comfortable: t('config.densityComfortable', 'Comfortable'),
                    compact: t('config.densityCompact', 'Compact'),
                    dense: t('config.densityDense', 'Dense'),
                }[item.text.densityMode] || item.text.densityMode).toLowerCase()}`,
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
            if (tab === 'themes' && studio.colorsHeld) return true;
            return canonical(tabState(this.dash.settings, tab)) !== canonical(tabState(studio.before, tab));
        },

        /** Put one tab's answers back to what they were when the studio opened. */
        resetStudioTab(tab, editing) {
            const studio = this._lookStudio;
            const spec = TAB_FIELDS[tab];
            if (!studio || !spec) return;
            // In the editor, Reset is the colours: back to the snapshot, and
            // the theme stays the one being edited.
            if (tab === 'themes' && editing) {
                this.restoreStudioColors();
                this.applyStudioLook();
                return;
            }
            if (tab === 'themes') this.restoreStudioColors();
            const drawn = drawnFrom(this.dash.settings);
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
            this.applyStudioLook({ redraw: drawnFrom(this.dash.settings) !== drawn });
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
            } else if (tab === 'layout') {
                // A font and a spacing: the two that change the feel the most.
                const fonts = (window.DashboardFont?.PRESET_IDS || ['source-code-pro', 'inter', 'system'])
                    .filter((id) => id !== settings.fontPreset);
                const pick = (list) => list[Math.floor(Math.random() * list.length)];
                this.setAppearanceSelect('fontPreset', pick(fonts));
                void this.setBehavior('densityMode', pick(DENSITIES), 'chromeRender');
                void this.setBehavior('categorySpacing', pick(SPACINGS), 'chromeRender');
            } else if (tab === 'looks') {
                this.useStudioLook(LOOKS[Math.floor(Math.random() * LOOKS.length)].id);
            }
        },

        useStudioLook(id) {
            this.applyLookAnswers(LOOKS.find((l) => l.id === id));
        },

        /**
         * Set every answer a look gives, built in or a theme's own, through
         * the controls' own setters. One path for both, so the two cannot
         * drift apart. A part the look does not have is left as it is.
         */
        applyLookAnswers(look) {
            const settings = this.dash.settings;
            if (!look || !settings) return;
            if (look.tuning) {
                const tuning = { ...DEFAULT_TUNING, ...(settings.backdropTuning || {}), ...look.tuning };
                settings.backdropTuning = tuning;
                this.applyBackdropTuning(tuning);
            }
            if (look.heads) {
                Object.assign(settings, look.heads);
                this.applyChromeSettings();
            }
            if (look.glass) this.setCardGlass(look.glass);
            if (look.depth) this.setSurface('themeDepth', look.depth);
            if (look.backdrop) {
                if (look.backdrop !== 'off') this._lastBackdropPick = look.backdrop;
                this.setBackdropChoice(look.backdrop);
            }
            if (look.text?.fontPreset) this.setAppearanceSelect('fontPreset', look.text.fontPreset);
            if (look.text?.densityMode) void this.setBehavior('densityMode', look.text.densityMode, 'chromeRender');
            if (look.text?.categorySpacing) void this.setBehavior('categorySpacing', look.text.categorySpacing, 'chromeRender');
        },

        /** The look a theme of the reader's own brings along, or null. */
        themeLookOf(id) {
            return this._colorsData?.custom?.[id]?.look || null;
        },

        /** "Use this theme's look", remembered per browser; on unless turned off. */
        studioUsesThemeLook() {
            try { return localStorage.getItem('nextdash:studio-use-theme-look') !== '0'; } catch (_) { return true; }
        },

        setStudioUsesThemeLook(on) {
            try { localStorage.setItem('nextdash:studio-use-theme-look', on ? '1' : '0'); } catch (_) { /* private mode */ }
        },

        /**
         * A theme picked outside the studio (the Appearance picker, `:theme`)
         * brings its look at once, and it is saved at once. Not on switching
         * halves of the same pair.
         */
        async applyThemeLookAndSave(id, previous) {
            const pairOf = (themeId) => window.ThemeUtils?.getPairedThemeVariant?.(themeId, true) || themeId;
            if (previous && pairOf(previous) === pairOf(id)) return;
            await this.loadColorsData();
            const look = this.themeLookOf(id);
            if (!look || this.dash.settings?.theme !== id) return;
            this.applyLookAnswers(look);
            await this.saveSettingsWithFeedback();
        },

        /* ── Compare, Cancel, Apply ─────────────────────────────────────── */

        /** While held, show the look from before the studio opened. */
        compareStudio(on) {
            const studio = this._lookStudio;
            if (!studio) return;
            const drawn = drawnFrom(this.dash.settings);
            if (on) {
                if (studio.held) return;
                if (studio.colorsHeld) {
                    studio.colorsNow = this._colorsData;
                    this._colorsData = clone(studio.colorsBefore);
                }
                studio.held = {};
                LOOK_FIELDS.forEach((field) => {
                    if (this.dash.settings[field] !== undefined) studio.held[field] = clone(this.dash.settings[field]);
                });
                this.writeLookFields(studio.before);
            } else {
                if (!studio.held) return;
                this.writeLookFields(studio.held);
                studio.held = null;
                if (studio.colorsNow) {
                    this._colorsData = studio.colorsNow;
                    studio.colorsNow = null;
                }
            }
            this.applyStudioLook({ redraw: drawnFrom(this.dash.settings) !== drawn });
        },

        cancelLookStudio() {
            const studio = this._lookStudio;
            if (!studio) return;
            const drawn = drawnFrom(this.dash.settings);
            this.writeLookFields(studio.before);
            this.restoreStudioColors();
            this._lookStudioReturn = this.endLookStudio();
            // The theme goes back through the revert the picker always used;
            // the rest of the look is drawn again from the restored fields.
            this.revertThemePreview();
            this.applyStudioLook({ theme: false, redraw: drawnFrom(this.dash.settings) !== drawn });
        },

        async applyLookStudio() {
            const studio = this._lookStudio;
            if (!studio) return true;
            // The colours first: a theme picked here may be one whose palette
            // only this save puts on the server.
            if (studio.colorsHeld) {
                studio.colorsPosting = true;
                const posted = await this.saveColorsData();
                studio.colorsPosting = false;
                if (!posted) return false;
                studio.colorsHeld = false;
                studio.colorsBefore = clone(this._colorsData);
            }
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
