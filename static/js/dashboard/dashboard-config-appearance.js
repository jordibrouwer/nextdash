/**
 * Config → Appearance: themes, fonts, colours and the controls that set them.
 *
 * Moved out of dashboard-config.js verbatim: same methods, same prototype, same
 * order. Only the moment the file arrives has changed — it is fetched when this
 * section is opened rather than on every visit to any other one.
 *
 * The bodies are not re-indented. Several of them build markup from multi-line
 * template literals, and shifting every line four spaces to the right would
 * change the strings they produce.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /** Everything a body.font-size-* rule sets (font-size.css). */
    global.DashboardConfig.FONT_SCALE_VARS = [
        '--font-size-title', '--font-size-date', '--font-size-category',
        '--font-size-bookmark', '--font-size-controls', '--font-size-text',
    ];

    /**
     * Names a point on the ink-gap range.
     *
     * Four words instead of a number, because the number is a lightness step in
     * OKLCH and nobody should have to know that to make their dashboard
     * readable. The boundaries are where the measured contrast crosses into the
     * next band: below 0.36 some themes fall under 4.5:1, above 0.50 the faint
     * text starts competing with the bookmark names.
     */
    /*
     * Text contrast, as four answers rather than a slider.
     *
     * The value is a lightness step in OKLCH and the slider let you pick any of
     * twenty-nine of them -- which is twenty-nine answers to a question with
     * four meanings, drawn unlike the two controls above it. These are the
     * midpoints of the bands inkGapLabelFor already named, so a dashboard that
     * was set with the slider keeps the word it had.
     */
    global.DashboardConfig.INK_GAP_STEPS = [
        [0.34, 'inkGapSoft', 'Soft'],
        [0.47, 'inkGapNormal', 'Normal'],
        [0.51, 'inkGapHigh', 'High'],
        [0.58, 'inkGapMax', 'Maximum'],
    ];

    /** A tab needs more panels than this before it gets an index. */
    global.DashboardConfig.APPEARANCE_INDEX_MIN_PANELS = 4;

    Object.assign(global.DashboardConfig.prototype, {

    addCustomTheme() {
        const data = this._colorsData;
        if (!data) return;
        const resolved = document.documentElement.getAttribute('data-theme') || '';
        const starter = data.builtIn?.[resolved] || data.dark || data.light || {};
        const names = Object.values(data.custom || {}).map((t) => t.name);
        const id = DashboardConfig.newThemeId();
        data.custom[id] = {
            ...starter,
            name: DashboardConfig.uniqueNameFrom(this.t('config.customThemePrefix', 'My theme'), names),
        };
        this._themeSelected = id;
        this.syncCustomThemeIds();
        this.repaintAppearanceBody();
        void this.saveColorsData();
    },

    /**
     * Which panels the reader left open on one Appearance tab, or null when
     * they have not chosen yet. A convenience of this browser, not a setting:
     * kept in localStorage, and in memory as well, so a browser that refuses
     * storage still keeps the choice for as long as the page is open.
     */
    appearanceOpenPanels(tab) {
        this._appearanceOpen = this._appearanceOpen || {};
        if (this._appearanceOpen[tab]) return this._appearanceOpen[tab];
        try {
            const list = JSON.parse(localStorage.getItem(DashboardConfig.APPEARANCE_OPEN_KEY + tab) || 'null');
            if (Array.isArray(list)) this._appearanceOpen[tab] = new Set(list.map(String));
        } catch { /* blocked or unreadable: the default stands */ }
        return this._appearanceOpen[tab] || null;
    },

    /**
     * Wire a panel's Show all / Hide all pair.
     *
     * Deliberately not a loop over setBehavior: that method saves and repaints
     * per call, so five toggles would be five PUTs, five chrome reapplications
     * and five repaints for one click — and a failure halfway would leave the
     * panel half applied. The fields are written together, the chrome is
     * reapplied once, and one save covers the lot.
     */
    /**
     * Apply "Only changed" to the hand-written Appearance controls.
     *
     * The schema panels filter themselves at render time, from the declaration.
     * These have no declaration to filter, so the pass runs over the rendered
     * DOM instead: every row `appearanceAff` stamped is hidden unless its field
     * differs from its default, and a panel left with no visible row goes with
     * them rather than standing as an empty heading.
     *
     * Rows without a stamp — upload buttons, the theme editor link, the tiles —
     * are not settings and have no default to compare against, so they are
     * dropped wholesale while the filter is on: keeping them would show actions
     * under a heading that promises only changed settings.
     */
    applyAppearanceChangedFilter(root) {
        const host = root || document.getElementById('config-appearance-body');
        if (!host) return;
        host.querySelectorAll('[data-appearance-filtered]').forEach((el) => {
            el.removeAttribute('data-appearance-filtered');
        });
        host.querySelectorAll('[data-appearance-filtered-empty]').forEach((el) => el.remove());
        if (!this.changedOnly) return;

        const s = this.dash.settings || {};
        // The attribute carries the hiding, not the `hidden` property: rows and
        // panels here set `display: grid`/`flex` on their own class, which
        // outranks the user-agent rule behind `hidden` and would leave a
        // "hidden" row on screen. A CSS rule keyed on this attribute wins
        // because it is written to be more specific.
        const hide = (el) => el.setAttribute('data-appearance-filtered', '');

        host.querySelectorAll('.config-panel').forEach((panel) => {
            // Schema panels are already filtered by renderControlPanels; a row
            // in one carries data-behavior-field, never an appearance stamp.
            if (panel.querySelector('[data-behavior-field]')) return;
            let kept = 0;
            panel.querySelectorAll('.config-field, .config-field-row').forEach((row) => {
                // Slider detail with no field of its own: the row says so.
                if (row.hasAttribute('data-fine-changed')) { kept += 1; return; }
                const aff = row.querySelector('[data-appearance-aff]');
                const field = aff?.getAttribute('data-appearance-aff');
                if (field && !this.isFieldDefault(field, s[field])) { kept += 1; return; }
                hide(row);
            });
            if (!kept) hide(panel);
        });
        // The tiles are navigation, not settings.
        host.querySelectorAll('.config-tiles').forEach(hide);
        this.syncFineFolds(host);

        // The toggle is disabled when a tab has nothing changed, so this is
        // reachable only by arriving with the filter already on — from the
        // Overview's count, which can land on any tab. Say so rather than
        // showing a tab that looks empty because it failed to render.
        const visible = [...host.querySelectorAll('.config-panel')]
            .some((p) => !p.hasAttribute('data-appearance-filtered'));
        if (!visible && !host.querySelector('.config-panel-empty')) {
            const note = document.createElement('p');
            note.className = 'config-panel-empty';
            note.setAttribute('data-appearance-filtered-empty', '');
            note.textContent = this.t('config.changedNoneOnTab', 'Nothing on this tab differs from its default.');
            host.appendChild(note);
        }
    },

    /**
     * Route an Appearance field to its dedicated setter. Used by the ↺
     * reset-to-default buttons so a reset applies live exactly like the control.
     */
    applyAppearanceField(field, value) {
        switch (field) {
            case 'fontPreset': this.setAppearanceSelect('fontPreset', value); break;
            case 'fontWeight': this.setFontWeight(value); break;
            case 'fontSize': this.setFontSize(value); break;
            case 'backgroundType': this.setBackgroundType(value); break;
            case 'backgroundOpacity':
                this.dash.settings.backgroundOpacity = window.VisualSettings?.clampBackgroundOpacity
                    ? window.VisualSettings.clampBackgroundOpacity(value)
                    : Number(value);
                this.dash.visual?.applyVisualSettings?.();
                this.persistAppearance();
                break;
            case 'launcherIconSize': this.setLauncherIconSize(value); break;
            case 'randomThemeMode': this.setRandomThemeMode(value); break;
            /*
             * The five that paint themselves.
             *
             * Each of these is drawn by an attribute or a custom property
             * rather than by a re-render, so writing the settings object alone
             * left the page exactly as it was and the ↺ looked broken. Same
             * appliers the selects above them call.
             */
            case 'themeDepth': this.setSurface('themeDepth', value); break;
            case 'glowStrength': this.setSurface('glowStrength', value); break;
            case 'themeEffects': this.setSurface('themeEffects', value); break;
            case 'categorySurface': this.setSurface('categorySurface', value); break;
            case 'animationSpeed':
                this.dash.settings.animationSpeed = 'normal';
                window.VisualSettings?.applyAnimationSpeed?.('normal');
                this.persistAppearance();
                break;
            case 'inkGap':
                this.dash.settings.inkGap = DashboardConfig.inkGapStepFor(value);
                window.ThemeLoader?.applyInkGap?.(this.dash.settings.inkGap);
                this.persistAppearance();
                break;
            case 'themeBackdrop':
                this.dash.settings.themeBackdrop = value;
                window.ThemeLoader?.applyThemeBackdrop?.(value);
                this.persistAppearance();
                break;
            case 'backgroundPattern':
                this.dash.settings.backgroundPattern = value;
                window.ThemeLoader?.applyBackgroundPattern?.(value);
                this.persistAppearance();
                break;
            default:
                // Fall back to a plain settings write + repaint for any field
                // without a dedicated live setter.
                this.dash.settings[field] = value;
                this.persistAppearance();
        }
    },

    /**
     * Fold the panels of the Appearance tab on screen.
     *
     * A pass over the rendered body rather than a second shape in every
     * renderer: the schema panels and the hand-written ones on Look,
     * Background and Surface all come out as a .config-panel with its title
     * first, and every repaint of the body lands in bindAppearanceControls,
     * which calls this. The header is a real button rather than a <details>
     * summary, because it also carries "Reset panel", which must not toggle.
     *
     * Custom themes is an editor with its own layout, and stays unfolded.
     */
    applyAppearanceFolds(body) {
        if (!body || this.appearanceTab === 'custom-themes') return;
        const panels = [...body.querySelectorAll('.config-panel')]
            .filter((panel) => !panel.parentElement?.closest('.config-panel'));
        const used = new Set();
        panels.forEach((panel, i) => this.makeAppearancePanelFoldable(panel, i, used));
        this.syncAppearanceFolds(body);
        this.openAppearancePanelFromLink(body);
        this.renderAppearancePanelIndex(body);
    },

    /**
     * Narrow a hand-written section to what matches the filter.
     *
     * The schema sections filter while they render, because the controls are
     * data there. Appearance is written out by hand, so the same field does
     * nothing unless something walks the rendered DOM — which is what this is:
     * every .config-field or .config-field-row whose text does not match is
     * hidden, a panel left with nothing goes with it, and a section left with
     * nothing says so rather than looking empty.
     *
     * Text rather than field names, matching the schema filter: someone typing
     * "webhook" is reading the page.
     */
    applyDomSettingsFilter(container) {
        // A body repaint hands in the body itself, which has no descendant by
        // that id; without this the filter was lost on every such repaint.
        const host = container.id === 'config-appearance-body'
            ? container
            : container.querySelector('#config-appearance-body');
        if (!host) return;
        const query = String(this.settingsFilter || '').trim().toLowerCase();
        this.repaintFilterElsewhere('appearance');
        host.querySelectorAll('[data-filter-empty]').forEach((el) => el.remove());
        // Only the outermost rows: a toggle or a field nested inside another row
        // is carried by its parent, and hiding the two independently left the
        // child visible in a hidden parent — which kept the panel alive and the
        // "nothing matches" line away.
        const rowSelector = '.config-field, .config-field-row';
        const rows = [...host.querySelectorAll(rowSelector)]
            .filter((row) => !row.parentElement?.closest(rowSelector));
        const panels = host.querySelectorAll('.config-panel');
        // The filter is typed without a repaint, so the folds follow it here:
        // open while it narrows, back to how the reader left them when cleared.
        this.syncAppearanceFolds(host);
        if (!query) {
            rows.forEach((row) => row.removeAttribute('hidden'));
            host.querySelectorAll('.config-chips[hidden]').forEach((el) => el.removeAttribute('hidden'));
            panels.forEach((panel) => panel.removeAttribute('hidden'));
            this.syncFineFolds(host);
            this.renderAppearancePanelIndex(host);
            return;
        }
        rows.forEach((row) => {
            // A chip group's label row reads its chips too, names and long
            // titles: they stand in the row after it, and a query for one chip
            // would otherwise hide the label and with it the whole panel.
            const chips = row.classList.contains('config-field--chips')
                && row.nextElementSibling?.classList.contains('config-chips')
                ? row.nextElementSibling : null;
            const chipText = chips
                ? [...chips.querySelectorAll('.config-chip')].map((c) => `${c.textContent} ${c.title || ''}`).join(' ')
                : '';
            const text = `${row.textContent || ''} ${chipText}`.toLowerCase();
            row.toggleAttribute('hidden', !text.includes(query));
            chips?.toggleAttribute('hidden', !text.includes(query));
        });
        let anyVisible = false;
        panels.forEach((panel) => {
            const visible = [...panel.querySelectorAll(rowSelector)]
                .filter((row) => !row.parentElement?.closest(rowSelector))
                .some((row) => !row.hasAttribute('hidden'));
            // A panel of prose and buttons with no fields at all — the theme
            // picker's own panel, say — is kept when its title or note matches.
            const titleMatch = (panel.querySelector('.config-panel-title')?.textContent || '')
                .toLowerCase().includes(query);
            panel.toggleAttribute('hidden', !visible && !titleMatch);
            if (visible || titleMatch) anyVisible = true;
        });
        this.syncFineFolds(host);
        this.renderAppearancePanelIndex(host);
        if (!anyVisible) {
            const note = document.createElement('p');
            note.className = 'config-panel-empty';
            note.setAttribute('data-filter-empty', '');
            note.textContent = this.t('config.settingsFilterNone', 'No setting on this tab matches that.');
            host.appendChild(note);
        }
    },

    bindAppearanceControls(container) {
        /*
         * The band is painted before anything binds, not after.
         *
         * Every appearance repaint lands here, and the band redraws its filter
         * bar from state -- so painting it at the end replaced the very node
         * the binder below had just wired, and the toggle was dead from the
         * first repaint onward.
         */
        this._fillShellHeadFromSection(document.getElementById('dashboard-layout') || document);

        this.bindSubTabStrip(container, 'data-appearance-tab', (tab) => this.switchAppearanceTab(tab));
        // The filter field is rendered by the shared bar, but this section is
        // hand-written markup — so it is applied to the DOM after each render
        // rather than while the controls are built.
        this.applyDomSettingsFilter(container);
        container.querySelectorAll('[data-settings-filter]').forEach((field) => {
            if (field.dataset.domFilterBound === '1') return;
            field.dataset.domFilterBound = '1';
            let debounce = null;
            const run = () => {
                this.settingsFilter = field.value;
                this.applyDomSettingsFilter(container);
            };
            field.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(run, 150);
            });
            field.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || !String(this.settingsFilter || '').trim()) return;
                e.preventDefault();
                e.stopPropagation();
                field.value = '';
                run();
            });
        });
        container.querySelectorAll('[data-tile-appearance-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.switchAppearanceTab(btn.getAttribute('data-tile-appearance-tab'));
            });
        });
        // Into Custom themes from Look, and back out of it. Not tab-strip
        // buttons, so they stay out of the strip's arrow-key order.
        (container.closest?.('#dashboard-layout') || container).querySelectorAll('[data-appearance-goto]').forEach((btn) => {
            if (btn.dataset.gotoBound === '1') return;
            btn.dataset.gotoBound = '1';
            btn.addEventListener('click', () => {
                void this.switchAppearanceTab(btn.getAttribute('data-appearance-goto'));
            });
        });
        this.bindFilterElsewhere(container);
        this.bindCustomThemes(container);
        container.querySelectorAll('[data-appearance-theme]').forEach((btn) => {
            btn.addEventListener('click', () => this.setQuickMode(btn.getAttribute('data-appearance-theme')));
        });
        this.bindAppearanceFieldControls(container);
        container.querySelectorAll('[data-appearance-randommode]').forEach((btn) => {
            btn.addEventListener('click', () => this.setAppearanceSelect('randomThemeMode', btn.getAttribute('data-appearance-randommode')));
        });
        container.querySelectorAll('[data-appearance-bg]').forEach((btn) => {
            btn.addEventListener('click', () => this.setBackgroundType(btn.getAttribute('data-appearance-bg')));
        });
        container.querySelectorAll('[data-appearance-gradient]').forEach((btn) => {
            btn.addEventListener('click', () => this.setBackgroundGradient(btn.getAttribute('data-appearance-gradient')));
        });
        // `change`, not `input`: saving mid-URL would fetch half-typed addresses.
        const bgUrl = container.querySelector('[data-appearance-text="backgroundImageUrl"]');
        if (bgUrl) {
            bgUrl.addEventListener('change', () => this.setBackgroundImageUrl(bgUrl.value));
        }
        this.bindThemePicker(container);
        // Range and text update live without a full repaint so the control keeps focus.
        const range = container.querySelector('[data-appearance-range="backgroundOpacity"]');
        if (range) {
            range.addEventListener('input', () => {
                const val = window.VisualSettings?.clampBackgroundOpacity
                    ? window.VisualSettings.clampBackgroundOpacity(range.value)
                    : Number(range.value);
                this.dash.settings.backgroundOpacity = val;
                this.dash.visual?.applyVisualSettings?.();
                const out = range.parentElement?.querySelector('.config-range-value');
                if (out) out.textContent = `${Math.round(val * 100)}%`;
            });
            range.addEventListener('change', () => void this.saveSettingsWithFeedback());
        }
                const titleInput = container.querySelector('[data-appearance-text="customTitle"]');
        if (titleInput) {
            titleInput.addEventListener('input', () => { this.dash.settings.customTitle = titleInput.value; });
            titleInput.addEventListener('change', () => {
                void this.saveSettingsWithFeedback();
                this.dash.pageNav?.updateDocumentTitle?.();
            });
        }
        container.querySelectorAll('[data-appearance-action]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleAppearanceAction(btn.getAttribute('data-appearance-action')));
        });
        const fontInput = container.querySelector('#config-font-input');
        if (fontInput) {
            fontInput.addEventListener('change', () => {
                const file = fontInput.files && fontInput.files[0];
                if (file) void this.uploadFont(file);
                fontInput.value = '';
            });
        }
        const faviconInput = container.querySelector('#config-favicon-input');
        if (faviconInput) {
            faviconInput.addEventListener('change', () => {
                const file = faviconInput.files && faviconInput.files[0];
                if (file) void this.uploadFavicon(file);
                faviconInput.value = '';
            });
        }
        // ℹ info modals + ↺ reset-to-default. Reset routes through the field's
        // live setter (via applyAppearanceField), which repaints the section so
        // the ↺ visibility refreshes.
        this.bindAffordances(container, null, (field, def) => this.applyAppearanceField(field, def));
        if (['layout', 'buttonbar', 'datetime', 'display', 'previews', 'header'].includes(this.appearanceTab)) {
            this.bindControlPanels(container, 'behavior');
        } else {
            // bindControlPanels brings the toggle with it; the tabs without
            // schema panels never call it, so they bind it here.
            this.bindChangedFilter(container);
        }
        // After the binders, so it runs on the markup they just wired rather
        // than on whatever the previous render left behind. The container is
        // the appearance body itself on a repaint and an ancestor of it on a
        // full render, so accept either — querySelector alone finds nothing
        // when the body *is* the container, and the filter would silently stop
        // running on exactly the path that repaints it.
        const body = container.id === 'config-appearance-body'
            ? container
            : container.querySelector('#config-appearance-body');
        this.applyAppearanceChangedFilter(body);
        // Last of the passes over the body: the filters above decide which
        // panels have a hit, and a panel with one is opened.
        this.applyAppearanceFolds(body);
        this.bindFormKeyboard(container);
        // The Background and Surface tabs bind what is new on them.
        this.bindFineFolds(container);
        this.bindLookControls?.(container);
    },

    /**
     * The binders for Appearance's own field controls -- font, weight, size,
     * the selects, the toggles and favicon styling. Shared with the look
     * studio, which shows some of these controls and must not bind the rest of
     * the config view (the shell head, the tab strip, the filter).
     */
    bindAppearanceFieldControls(container) {
        container.querySelectorAll('[data-appearance-font]').forEach((btn) => {
            // Small/Medium/Large says nothing about what the grid will look
            // like, so pointing at one shows it and leaving puts it back. The
            // theme picker already works this way; type is the other choice you
            // cannot judge from its label.
            const size = btn.getAttribute('data-appearance-font');
            const preview = () => {
                if (this._fontSizeBeforePreview == null) {
                    this._fontSizeBeforePreview = this.currentFontSize();
                }
                // Before the class changes: the panel must keep the size it has.
                this.holdConfigTypeScale();
                this.dash.settings.fontSize = size;
                this.dash.applyFontSize?.();
            };
            const revert = () => {
                const previous = this._fontSizeBeforePreview;
                this._fontSizeBeforePreview = null;
                this.releaseConfigTypeScale();
                if (previous == null) return;
                this.dash.settings.fontSize = previous;
                this.dash.applyFontSize?.();
            };
            btn.addEventListener('pointerenter', preview);
            btn.addEventListener('focus', preview);
            btn.addEventListener('pointerleave', revert);
            btn.addEventListener('blur', revert);
            btn.addEventListener('click', () => {
                // Taken, so there is nothing to put back — and the panel takes
                // the new size with everything else.
                this._fontSizeBeforePreview = null;
                this.releaseConfigTypeScale();
                this.setFontSize(size);
            });
        });
        container.querySelectorAll('[data-appearance-weight]').forEach((btn) => {
            btn.addEventListener('click', () => this.setFontWeight(btn.getAttribute('data-appearance-weight')));
        });
        container.querySelectorAll('[data-appearance-toggle]').forEach((input) => {
            input.addEventListener('change', () => {
                const field = input.getAttribute('data-appearance-toggle');
                const host = container.querySelector(`[data-appearance-art="${CSS.escape(field)}"]`);
                if (host) {
                    host.innerHTML = window.SettingArt?.render?.(
                        host.getAttribute('data-art-kind') || '', input.checked) || '';
                }
                return this.setToggle(field, input.checked);
            });
        });
        // `select` only: the theme picker shares the data-appearance-select hook
        // so search and the changed-filter still find it, but it is a button with
        // its own listbox and no change event to listen for.
        this.bindWidgetOpacity(container);
        container.querySelectorAll('select[data-appearance-select]').forEach((select) => {
            select.addEventListener('change', () => this.setAppearanceSelect(select.getAttribute('data-appearance-select'), select.value));
        });
        // Favicon harmonisation: the on/off and style buttons repaint (they change
        // which controls are shown); the slider updates live so it keeps the pointer.
        container.querySelectorAll('[data-appearance-toggle-icons]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.setIconStyling({ enabled: btn.getAttribute('data-appearance-toggle-icons') === 'on' });
            });
        });
        container.querySelectorAll('[data-appearance-iconstyle]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.setIconStyling({ style: btn.getAttribute('data-appearance-iconstyle') });
            });
        });
        const iconRange = container.querySelector('[data-appearance-icon-intensity]');
        if (iconRange) {
            iconRange.addEventListener('input', () => {
                const val = Number(iconRange.value);
                const out = iconRange.parentElement?.querySelector('.config-range-value');
                if (out) out.textContent = `${Math.round(val * 100)}%`;
                iconRange.parentElement?.querySelectorAll('.config-icon-preview-dot').forEach((dot) => {
                    dot.style.setProperty('--icon-theme-intensity', String(val));
                });
                const nextEntry = { ...this.iconStylingEntry(), intensity: val };
                const map = { ...(this.dash.settings.themeIconStyling || {}) };
                for (const key of this.iconStylingThemeKeysForWrite()) {
                    map[key] = { ...nextEntry };
                }
                this.dash.settings.themeIconStyling = map;
                window.ThemeIconStyling?.applyThemeIconStylingToDocument?.(this.dash.settings);
            });
            iconRange.addEventListener('change', () => {
                void this.setIconStyling({ intensity: Number(iconRange.value) }, { repaint: false });
            });
        }
    },

    bindCustomThemes(container) {
        container.querySelector('[data-theme-add]')
            ?.addEventListener('click', () => this.addCustomTheme());
        container.querySelectorAll('[data-theme-export]').forEach((btn) => {
            btn.addEventListener('click', () => this.exportCustomTheme(btn.getAttribute('data-theme-export')));
        });
        const themeImport = container.querySelector('#config-theme-import-input');
        container.querySelector('[data-theme-import]')
            ?.addEventListener('click', () => themeImport?.click());
        themeImport?.addEventListener('change', () => {
            const file = themeImport.files?.[0];
            themeImport.value = '';
            if (file) void this.importCustomTheme(file);
        });

        container.querySelectorAll('[data-theme-delete]').forEach((btn) => {
            btn.addEventListener('click', () => void this.deleteCustomTheme(btn.getAttribute('data-theme-delete')));
        });
        container.querySelectorAll('[data-theme-move]').forEach((btn) => {
            btn.addEventListener('click', () =>
                this.moveCustomTheme(btn.getAttribute('data-id'), btn.getAttribute('data-theme-move')));
        });
        const baseSelect = container.querySelector('[data-theme-base-select]');
        if (baseSelect) {
            baseSelect.addEventListener('change', () => {
                this._themeSelected = baseSelect.value || null;
                this.repaintAppearanceBody();
                if (this._themeSelected) {
                    this.previewThemeColors(this._themeSelected);
                    this.updateThemeContrastHint(this._themeSelected);
                } else {
                    this.clearThemePreview();
                }
            });
        }

        container.querySelectorAll('[data-theme-edit]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-theme-edit');
                this._themeSelected = this._themeSelected === id ? null : id;
                this.repaintAppearanceBody();
                if (this._themeSelected) {
                    this.previewThemeColors(this._themeSelected);
                    this.updateThemeContrastHint(this._themeSelected);
                } else {
                    this.clearThemePreview();
                }
            });
        });

        container.querySelectorAll('[data-theme-name]').forEach((input) => {
            const id = input.getAttribute('data-theme-name');
            input.addEventListener('change', () => {
                const theme = this._colorsData?.custom?.[id];
                if (!theme) return;
                const others = Object.entries(this._colorsData.custom)
                    .filter(([k]) => k !== id).map(([, t]) => t.name);
                if (!this.guardUniqueName(input, input.value, others, {
                    previous: theme.name,
                    message: this.t('config.themeNameDuplicate', 'A theme with this name already exists.'),
                })) return;
                theme.name = input.value;
                void this.saveColorsData();
            });
        });

        this.bindThemeColorInputs(container);
    },

    /** The Shape & character controls: preview while moving, save on release. */
    bindThemeCharacter(container, id, theme) {
        const fold = container.querySelector('[data-theme-character]');
        fold?.addEventListener('toggle', () => { this._themeCharacterOpen = fold.open; });
        const setValue = (prop, value, { save }) => {
            if (value === undefined) delete theme[prop];
            else theme[prop] = value;
            this.previewThemeColors(id);
            const reset = container.querySelector(`[data-theme-char-reset="${prop}"]`);
            reset?.classList.toggle('is-visible', value !== undefined);
            if (!save) return;
            // A packaged theme has no "automatic": the server fills an empty
            // field from the shipped theme, so empty saved and came straight
            // back. Automatic there means as shipped, written as such.
            if (value === undefined && !this.isCustomTheme(id)) {
                void this.shippedThemeValue(id, prop).then((shipped) => {
                    if (shipped !== undefined && shipped !== '' && shipped !== 0) theme[prop] = shipped;
                    this.previewThemeColors(id);
                    void this.saveColorsData();
                });
                return;
            }
            void this.saveColorsData();
        };
        container.querySelectorAll('[data-theme-char]').forEach((range) => {
            const prop = range.dataset.themeChar;
            const unit = range.dataset.unit || '';
            const readout = container.querySelector(`[data-theme-char-readout="${prop}"]`);
            const read = () => {
                const n = Number(range.value);
                return unit === 'em' ? `${n}em` : n;
            };
            range.addEventListener('input', () => {
                if (readout) readout.textContent = `${range.value}${unit}`;
                setValue(prop, read(), { save: false });
            });
            range.addEventListener('change', () => setValue(prop, read(), { save: true }));
        });

        const glowMode = container.querySelector('[data-theme-glow-mode]');
        glowMode?.addEventListener('change', () => {
            const range = container.querySelector('[data-theme-char="surfaceGlow"]');
            const readout = container.querySelector('[data-theme-char-readout="surfaceGlow"]');
            const custom = glowMode.value === 'custom';
            if (range) range.hidden = !custom;
            if (readout) {
                readout.hidden = !custom;
                readout.textContent = range?.value || '';
            }
            const value = glowMode.value === 'none' ? -1 : (custom ? Number(range?.value) : undefined);
            setValue('surfaceGlow', value, { save: true });
        });

        container.querySelectorAll('[data-theme-char-choice]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const prop = btn.dataset.themeCharChoice;
                const value = btn.dataset.value || undefined;
                container.querySelectorAll(`[data-theme-char-choice="${prop}"]`).forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                setValue(prop, value, { save: true });
            });
        });

        container.querySelectorAll('[data-theme-char-select]').forEach((select) => {
            const prop = select.dataset.themeCharSelect;
            select.addEventListener('change', () => {
                const raw = select.value;
                const value = raw === '' ? undefined : (prop === 'labelWeight' ? Number(raw) : raw);
                setValue(prop, value, { save: true });
            });
        });

        const tiles = container.querySelector('[data-theme-backdrops]');
        if (tiles) {
            tiles.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-theme-backdrop-tile]');
                if (!btn) return;
                tiles.querySelectorAll('[data-theme-backdrop-tile]').forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                setValue('backdrop', btn.getAttribute('data-theme-backdrop-tile') || undefined, { save: true });
            });
            void this.paintThemeBackdropTiles(container, theme);
        }

        container.querySelectorAll('[data-theme-char-reset]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const prop = btn.dataset.themeCharReset;
                setValue(prop, undefined, { save: true });
                // Redraw the row's control as automatic.
                this.repaintAppearanceBody();
                if (this._themeSelected) this.previewThemeColors(this._themeSelected);
            });
        });
    },

    /**
     * The colour fields themselves.
     *
     * Typing previews live but does not save — a save per keystroke would post
     * the whole colour document on every character. The commit happens on
     * `change`, which is blur or a picker selection.
     */
    bindThemeColorInputs(container) {
        const id = this._themeSelected;
        if (!id) return;
        const theme = this.themeById(id);
        if (!theme) return;

        const apply = (prop, value, { save }) => {
            theme[prop] = value;
            this.previewThemeColors(id);
            this.updateThemeContrastHint(id);
            if (save) void this.saveColorsData();
        };

        container.querySelectorAll('[data-theme-color]').forEach((input) => {
            const prop = input.getAttribute('data-theme-color');
            input.addEventListener('input', () => {
                // Invalid text is flagged but still previewed as far as the
                // browser can take it, so a half-typed hex does not blank out.
                window.ColorValueUtils?.validateTextInput?.(input);
                if (window.ColorValueUtils?.isValidCSSValue?.(input.value)) {
                    apply(prop, input.value.trim(), { save: false });
                    const picker = container.querySelector(`[data-theme-color-picker="${prop}"]`);
                    if (picker && /^#[0-9a-fA-F]{6}$/.test(input.value.trim())) picker.value = input.value.trim();
                }
            });
            input.addEventListener('change', () => {
                // An optional colour left empty goes back to being derived.
                if (input.dataset.themeColorOptional && !input.value.trim()) {
                    delete theme[prop];
                    window.ColorValueUtils?.validateTextInput?.(input);
                    this.previewThemeColors(id);
                    void this.saveColorsData();
                    return;
                }
                if (!window.ColorValueUtils?.isValidCSSValue?.(input.value)) {
                    // Put back the stored value rather than saving something the
                    // server would reject or render as an empty variable.
                    input.value = theme[prop] || '';
                    window.ColorValueUtils?.validateTextInput?.(input);
                    this.notify(this.t('config.themeColorInvalid', 'Enter a colour like #1a1a1a or rgba(0,0,0,.5).'), 'error');
                    return;
                }
                apply(prop, input.value.trim(), { save: true });
            });
        });

        container.querySelectorAll('[data-theme-color-picker]').forEach((picker) => {
            const prop = picker.getAttribute('data-theme-color-picker');
            const sync = (save) => {
                const hex = picker.value;
                const text = container.querySelector(`[data-theme-color="${prop}"]`);
                if (text) text.value = hex;
                apply(prop, hex, { save });
            };
            picker.addEventListener('input', () => sync(false));
            picker.addEventListener('change', () => sync(true));
        });

        container.querySelectorAll('[data-theme-action]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleThemeAction(btn.getAttribute('data-theme-action'), id));
        });
        this.bindThemeCharacter(container, id, theme);
    },

    /**
     * Wire the theme picker: open, move, preview, commit or cancel.
     *
     * Moving the highlight previews that theme on the dashboard behind the
     * config view; nothing is stored until the choice is taken. Leaving without
     * choosing — Escape, a click elsewhere, blur — puts the previous theme back,
     * so browsing the list can never change what you had.
     */
    bindThemePicker(container) {
        const root = container.querySelector('[data-theme-picker]');
        if (!root) return;
        const button = root.querySelector('[data-theme-picker-button]');
        const list = root.querySelector('[data-theme-picker-list]');
        if (!button || !list) return;

        const options = () => Array.from(list.querySelectorAll('[data-theme-option]'));
        const isOpen = () => !list.hidden;

        const highlight = (option, { preview = true } = {}) => {
            if (!option) return;
            options().forEach((o) => o.classList.toggle('is-active', o === option));
            list.setAttribute('aria-activedescendant', option.id);
            // Keeps the highlight in view when moving by keyboard, and does
            // nothing when the option is already visible.
            option.scrollIntoView({ block: 'nearest' });
            if (preview) this.previewThemeChoice(option.getAttribute('data-theme-option'));
        };

        const open = () => {
            if (isOpen()) return;
            // What to restore if the list is left without choosing.
            this._themePickerPrevious = this.dash.settings?.theme || 'dark';
            list.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            const current = list.querySelector('[data-theme-current]') || options()[0];
            // No preview on open: this is the theme already applied.
            highlight(current, { preview: false });
            list.focus();
        };

        const close = ({ restore }) => {
            if (!isOpen()) return;
            list.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            list.removeAttribute('aria-activedescendant');
            if (restore) this.revertThemePreview();
            button.focus();
        };
        // Config's Escape handler is on document in the capture phase, so it
        // reaches the key first and has to be able to cancel the picker itself.
        this.closeThemePickerFromKeyboard = () => close({ restore: true });

        const commit = (option) => {
            if (!option) return;
            const id = option.getAttribute('data-theme-option');
            // Drop the preview stylesheet before storing: applyThemeChoice
            // reloads the real theme CSS, and a leftover preview would sit on
            // top of it showing the same colours from the wrong source.
            this.clearThemePreview();
            list.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.setAttribute('value', id);
            const labelEl = button.querySelector('[data-theme-picker-label]');
            if (labelEl) labelEl.textContent = this.themePickerLabel(id);
            options().forEach((o) => {
                o.setAttribute('aria-selected', String(o === option));
                o.toggleAttribute('data-theme-current', o === option);
            });
            this._themePickerPrevious = null;
            button.focus();
            this.setAppearanceSelect('theme', id);
        };

        button.addEventListener('click', () => (isOpen() ? close({ restore: true }) : open()));

        list.addEventListener('mousemove', (e) => {
            const option = e.target.closest('[data-theme-option]');
            if (option) highlight(option);
        });

        /*
         * The line about a theme, while you are pointing at it.
         *
         * The list is a hundred names and a name says nothing about what a
         * theme is like; the bubble is where that sentence fits without
         * turning every row into two. One delegated pair of listeners rather
         * than a popover attached per option: the list is rebuilt whenever the
         * theme list loads, and per-option listeners would be rebound with it.
         */
        void this.loadThemeMeta().catch(() => {});
        list.addEventListener('mouseover', (e) => {
            const option = e.target.closest('[data-theme-option]');
            if (!option) return;
            const line = this.themeDescription(option.getAttribute('data-theme-option'));
            // Beside the list, not under the row: the next row is directly
            // beneath it, and a bubble there covers the thing it describes.
            if (line) window.FieldPopover?.show?.(option, line, { variant: 'theme', beside: list });
            else window.FieldPopover?.hide?.();
        });
        list.addEventListener('mouseleave', () => window.FieldPopover?.hide?.());
        list.addEventListener('click', (e) => {
            const option = e.target.closest('[data-theme-option]');
            if (option) commit(option);
        });

        list.addEventListener('keydown', (e) => {
            const all = options();
            const at = all.findIndex((o) => o.classList.contains('is-active'));
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = e.key === 'ArrowDown'
                    ? Math.min(at + 1, all.length - 1)
                    : Math.max(at - 1, 0);
                highlight(all[next]);
                return;
            }
            if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                highlight(e.key === 'Home' ? all[0] : all[all.length - 1]);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                commit(all[at]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                // Stop here: config's own Escape handler would otherwise read
                // this as "close the config view" on the same key press.
                e.stopPropagation();
                close({ restore: true });
                return;
            }
            // Typeahead. A native select gives this for free and this
            // hand-built replacement did not, which is felt at 150 themes:
            // reaching Terracotta meant holding an arrow key or scrolling.
            // Letters accumulate for a second so "te" beats "t", the way a
            // select behaves, and a repeated single letter steps through the
            // themes that start with it.
            if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            const now = Date.now();
            if (now - (this._themeTypeaheadAt || 0) > 1000) this._themeTypeahead = '';
            this._themeTypeaheadAt = now;
            const repeat = this._themeTypeahead === e.key.toLowerCase();
            this._themeTypeahead = repeat ? e.key.toLowerCase() : this._themeTypeahead + e.key.toLowerCase();
            const query = this._themeTypeahead;
            const labelOf = (option) => (option.textContent || '').trim().toLowerCase();
            const from = repeat ? at + 1 : at;
            const order = [...all.slice(from), ...all.slice(0, from)];
            const hit = order.find((option) => labelOf(option).startsWith(query));
            if (hit) highlight(hit);
        });

        // Leaving the picker entirely counts as cancelling. focusout fires
        // before the new focus lands, so the check is deferred a tick.
        list.addEventListener('focusout', () => {
            setTimeout(() => {
                if (isOpen() && !root.contains(document.activeElement)) close({ restore: true });
            }, 0);
        });
        // One outside-click listener at a time: Appearance repaints bind a new
        // picker, and the old one's listener would hold its detached list and
        // revert the preview on every click after.
        if (this._themePickerOutside) document.removeEventListener('pointerdown', this._themePickerOutside);
        this._themePickerOutside = (e) => {
            if (isOpen() && !root.contains(e.target)) close({ restore: true });
        };
        document.addEventListener('pointerdown', this._themePickerOutside);
    },

    /**
     * Widget opacity: how solid a widget's card is, 0 to 40 percent. Painted
     * while the slider moves, saved when it is let go.
     */
    bindWidgetOpacity(container) {
        const range = container.querySelector('[data-appearance-range="widgetOpacity"]');
        if (!range || range.dataset.wired === '1') return;
        range.dataset.wired = '1';
        range.addEventListener('input', () => {
            const percent = window.ThemeLoader?.applyWidgetOpacity?.(range.value) ?? Number(range.value);
            this.dash.settings.widgetOpacity = percent;
            const out = range.parentElement?.querySelector('.config-range-value');
            if (out) out.textContent = `${percent}%`;
        });
        range.addEventListener('change', () => this.persistAppearance());
    },

    async deleteCustomTheme(id) {
        const data = this._colorsData;
        const theme = data?.custom?.[id];
        if (!theme) return;
        const ok = await this.confirmAction(
            this.t('config.themeDeleteConfirm', 'Delete the theme “{name}”?')
                .replace('{name}', String(theme.name || id))
        );
        if (!ok) return;
        // What is on screen, read before the delete: pairing reads the id list
        // this changes, and asked afterwards it could never name the half that
        // was just removed.
        const shownBefore = this.displayTheme?.();
        delete data.custom[id];
        this.syncCustomThemeIds();
        if (this._themeSelected === id) this._themeSelected = null;
        // Its rows in the settings go with it rather than stay for good.
        const st = this.dash.settings || {};
        let rowsLeft = false;
        if (st.themeSurfacePrefs?.[id]) { delete st.themeSurfacePrefs[id]; rowsLeft = true; }
        if (st.themeIconStyling?.[id]) { delete st.themeIconStyling[id]; rowsLeft = true; }
        if (Array.isArray(st.favoriteThemes) && st.favoriteThemes.includes(id)) {
            st.favoriteThemes = st.favoriteThemes.filter((t) => t !== id);
            rowsLeft = true;
        }
        // A deleted theme that is still selected would leave the dashboard on a
        // theme that no longer exists, so fall back to the default.
        // Also the half on screen under Follow system, which is not the
        // stored one. 'default' is no theme id: the page lost every colour.
        // Only the stored choice falls back; when the half on screen goes and
        // the stored half stays, that one is drawn.
        const storedGone = this.dash.settings?.theme === id;
        const wasActive = storedGone || shownBefore === id;
        if (storedGone) {
            this.dash.settings.theme = window.ThemeLoader?.DEFAULT_THEME || 'look-ocean-dark';
        }
        if (storedGone || rowsLeft) void this.saveSettingsWithFeedback();
        this.repaintAppearanceBody();
        await this.saveColorsData();
        // The page still said data-theme="<deleted id>", and the reloaded theme
        // CSS no longer had a block for it: put the default on screen too.
        if (wasActive) this.applyThemeLive();
    },

    /**
     * Start a new theme from a full palette rather than blank fields.
     *
     * Every colour must be set or the dashboard renders with empty CSS
     * variables, so a new theme copies a packaged one — the current theme where
     * possible, so "add" reads as "start from what I am looking at".
     */
    /**
     * One theme as a file, and back again.
     *
     * A theme is a name and a dozen colours — small enough to paste into a chat
     * window, and until now movable only inside a whole-install backup, which
     * carries every bookmark with it. Exported with a marker and a version so
     * an import can tell a theme from any other JSON someone points at it.
     */
    exportCustomTheme(id) {
        const theme = this._colorsData?.custom?.[id];
        if (!theme) return;
        const payload = { nextdashTheme: 1, name: theme.name || id, colors: { ...theme } };
        delete payload.colors.name;
        const safeName = String(theme.name || id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        this.triggerDownload(
            new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
            `nextdash-theme-${safeName || 'custom'}.json`);
    },

    fontPresetLabel(preset) {
        const map = {
            'source-code-pro': ['config.fontPresetSourceCodePro', 'Source Code Pro'],
            'jetbrains-mono': ['config.fontPresetJetBrainsMono', 'JetBrains Mono'],
            'ibm-plex-mono': ['config.fontPresetIbmPlexMono', 'IBM Plex Mono'],
            inter: ['config.fontPresetInter', 'Inter'],
            'ibm-plex-sans': ['config.fontPresetIbmPlexSans', 'IBM Plex Sans'],
            'dm-sans': ['config.fontPresetDmSans', 'DM Sans'],
            system: ['config.fontPresetSystem', 'System'],
        };
        const [key, fallback] = map[preset] || [preset, preset];
        return this.t(key, fallback);
    },

    fontSizeLabel(size) {
        const map = {
            xs: ['config.fontSizeXS', 'XS'], s: ['config.fontSizeS', 'S'],
            sm: ['config.fontSizeSM', 'SM'], m: ['config.fontSizeM', 'M'],
            lg: ['config.fontSizeLG', 'LG'], l: ['config.fontSizeL', 'L'],
            xl: ['config.fontSizeXL', 'XL'],
        };
        const [key, fallback] = map[size] || [size, size.toUpperCase()];
        return this.t(key, fallback);
    },

    handleAppearanceAction(action) {
        switch (action) {
            case 'browse-themes': void this.openThemeBrowser(); break;
            case 'edit-colors': this.openThemeEditorTab(); break;
            case 'reset-theme-surfaces': this.resetThemeSurfaces(); break;
            case 'upload-font': document.getElementById('config-font-input')?.click(); break;
            case 'upload-favicon': document.getElementById('config-favicon-input')?.click(); break;
        }
    },

    async handleThemeAction(action, id) {
        const theme = this.themeById(id);
        if (!theme) return;
        if (action === 'apply') {
            // Same path the Theme dropdown uses: applyThemeChoice runs applyThemeLive,
            // which pairs the choice with the OS preference when "follow system
            // dark mode" is on, and persists through persistAppearance. Setting
            // settings.theme by hand skipped both, so the choice never reached
            // the server and <html data-theme> never changed.
            this.clearThemePreview();
            await this.applyThemeChoice(id);
            this.reloadThemeCSS();
            this.render();
            return;
        }
        if (action === 'duplicate') {
            const names = Object.values(this._colorsData.custom).map((t) => t.name);
            const copyId = DashboardConfig.newThemeId();
            // Without the collection: that is the set a packaged theme ships
            // in, and the copy is one of your own (as saveCurrentAsTheme does).
            const { collection: _collection, ...rest } = theme;
            this._colorsData.custom[copyId] = {
                ...rest,
                backdrop: theme.backdrop || this.themeBackdropOf(id) || undefined,
                name: DashboardConfig.uniqueNameFrom(
                    `${theme.name || id} ${this.t('config.themeCopySuffix', 'copy')}`, names),
            };
            this._themeSelected = copyId;
            this.syncCustomThemeIds();
            this.repaintAppearanceBody();
            await this.saveColorsData();
            return;
        }
        if (action === 'reset') {
            // /api/colors/reset restores light, dark and every packaged theme
            // while leaving custom ones alone, so it is safe to offer from here.
            const ok = await this.confirmAction(
                this.t('config.themeResetConfirm',
                    'Reset the packaged themes to their original colours? Your own themes are kept.'),
                { confirmLabel: this.t('config.themeResetDefaults', 'Reset to default') }
            );
            if (!ok) return;
            try {
                const res = await this.writeFetch('/api/colors/reset', { method: 'POST' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                this._colorsData = DashboardConfig.orderCustomThemes(await res.json());
                if (!this._colorsData.custom) this._colorsData.custom = {};
                this.clearThemePreview();
                this.reloadThemeCSS();
                this.repaintAppearanceBody();
                if (this._themeSelected) this.previewThemeColors(this._themeSelected);
                this.notify(this.t('config.saved', 'Saved'), 'success');
            } catch {
                this.notify(this.t('config.themeSaveError', 'Could not save the theme.'), 'error');
            }
            return;
        }
        if (action === 'export') {
            // The same file the list's ⤓ writes, for packaged themes too.
            const payload = { nextdashTheme: 1, name: theme.name || id, colors: { ...theme } };
            delete payload.colors.name;
            const safeName = String(theme.name || id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            this.triggerDownload(
                new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
                `nextdash-theme-${safeName || 'theme'}.json`);
        }
        if (action === 'import') {
            this.importThemeFromFile();
        }
        if (action === 'pair') {
            await this.makeThemePair(id);
        }
    },

    /**
     * Hold the config panel at the size it is while a font preview runs.
     *
     * The preview is meant to show the choice on the dashboard behind the
     * panel. applyFontSize() puts the class on <body>, and the panel reads the
     * same variables, so the panel resized too — including the button under the
     * pointer. It moved out from under the cursor, which fired pointerleave,
     * which reverted, which moved it back, which fired pointerenter: an
     * enter/leave loop the click never got through. Verified with an event log:
     * ten enter/leave pairs and no click at all.
     *
     * Copying the current values onto .config-view pins the panel while <body>
     * changes underneath it. Read before the class is swapped, or the values
     * are the preview's own.
     */
    holdConfigTypeScale() {
        const view = document.querySelector('.config-view');
        if (!view || view.dataset.fontScaleHeld === '1') return;
        const computed = getComputedStyle(document.body);
        DashboardConfig.FONT_SCALE_VARS.forEach((name) => {
            const value = computed.getPropertyValue(name).trim();
            if (value) view.style.setProperty(name, value);
        });
        view.dataset.fontScaleHeld = '1';
    },

    async importCustomTheme(file) {
        const data = this._colorsData;
        if (!data) return;
        let payload = null;
        try {
            payload = JSON.parse(await file.text());
        } catch {
            this.notify(this.t('config.themeImportInvalid', 'That file is not a nextDash theme.'), 'error');
            return;
        }
        // One reading of a theme file for both import buttons.
        const theme = this.normalizeImportedTheme(payload);
        if (!theme) {
            this.notify(this.t('config.themeImportInvalid', 'That file is not a nextDash theme.'), 'error');
            return;
        }
        const names = Object.values(data.custom || {}).map((t) => t.name);
        const id = DashboardConfig.newThemeId();
        data.custom[id] = { ...theme, name: DashboardConfig.uniqueNameFrom(theme.name, names) };
        this._themeSelected = id;
        this.syncCustomThemeIds();
        this.repaintAppearanceBody();
        await this.saveColorsData();
        this.notify(this.t('config.themeImported', 'Theme imported.'), 'success');
    },

    /**
     * Read a theme back in from an exported .json.
     *
     * Export has existed on its own since custom themes shipped, which made it
     * a one-way door: a palette built on a laptop could not be carried to the
     * server instance except through a full ZIP restore, which overwrites
     * everything. Lands as a new theme rather than overwriting one, so an
     * import can never destroy the palette you are looking at — the naming and
     * id logic is the same as Duplicate's.
     */
    importThemeFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text());
                const theme = this.normalizeImportedTheme(parsed);
                if (!theme) throw new Error('not a theme');

                const names = Object.values(this._colorsData.custom || {}).map((t) => t.name);
                const newId = DashboardConfig.newThemeId();
                this._colorsData.custom[newId] = {
                    ...theme,
                    name: DashboardConfig.uniqueNameFrom(theme.name, names),
                };
                this._themeSelected = newId;
                this.syncCustomThemeIds();
                this.repaintAppearanceBody();
                await this.saveColorsData();
                this.notify(this.t('config.themeImported', 'Theme imported.'), 'success');
            } catch {
                this.notify(this.t('config.themeImportError',
                    'That file is not a nextDash theme.'), 'error');
            }
        });
        input.click();
    },

    /** Just the ℹ, for rows whose reset is a button of the panel's own. */
    infoAff(field) {
        const esc = (v) => this.dash.escapeHtml(v);
        const meta = this.fieldMeta(field);
        const info = meta?.info && this.hasInfoText(meta.info)
            ? `<button type="button" class="config-info-btn" data-info-field="${esc(field)}" aria-label="${esc(this.t('config.settingInfoAria', 'More info'))}" title="${esc(this.t('config.settingInfoAria', 'More info'))}">ℹ</button>`
            : '';
        return `<span class="config-field-affordances" data-appearance-aff="${esc(field)}">${info}</span>`;
    },

    makeAppearancePanelFoldable(panel, index, used) {
        if (panel.hasAttribute('data-fold-key')) {
            used.add(panel.getAttribute('data-fold-key'));
            return;
        }
        const title = panel.querySelector(':scope > .config-panel-title');
        if (!title) return;
        const reset = title.querySelector('.config-panel-reset');
        reset?.remove();
        // Keyed by its title, which is what stays put when panels move between
        // tabs or change order; the index only breaks a tie.
        let key = String(title.textContent || '').trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `panel-${index}`;
        if (used.has(key)) key = `${key}-${index}`;
        used.add(key);
        const bodyId = `config-fold-${this.appearanceTab}-${key}`;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'config-panel-fold';
        button.setAttribute('aria-controls', bodyId);
        // The chevron is drawn by CSS on an empty, hidden span, so it is in
        // neither the button's name nor the title's text.
        const chevron = document.createElement('span');
        chevron.className = 'config-panel-fold-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        button.appendChild(chevron);
        while (title.firstChild) button.appendChild(title.firstChild);
        title.appendChild(button);

        const head = document.createElement('div');
        head.className = 'config-panel-head';
        panel.insertBefore(head, title);
        head.appendChild(title);
        const summary = document.createElement('p');
        summary.className = 'config-panel-summary';
        summary.id = `${bodyId}-summary`;
        head.appendChild(summary);
        if (reset) head.appendChild(reset);

        const inner = document.createElement('div');
        inner.className = 'config-panel-body';
        inner.id = bodyId;
        [...panel.childNodes].forEach((node) => {
            if (node === head) return;
            // The twinkle is drawn over the whole panel, folded or not.
            if (node.nodeType === 1 && node.classList.contains('config-new-features-panel-stars')) return;
            inner.appendChild(node);
        });
        panel.appendChild(inner);
        panel.classList.add('config-panel--fold');
        panel.setAttribute('data-fold-key', key);

        button.addEventListener('click', () => this.toggleAppearancePanel(panel));
        // The rest of the header row opens it too, for a pointer; the button
        // is what the keyboard and a screen reader meet.
        head.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, label')) return;
            this.toggleAppearancePanel(panel);
        });
    },

    /**
     * Turn a single custom theme into a light/dark pair.
     *
     * The theme keeps its palette and takes the suffix of the half it already
     * is, judged from its background; the other half starts from the base
     * palette of that lightness with this theme's accents and character, so it
     * is recognisably the same theme and readable from the start. Renaming the
     * id moves every setting that names it with it.
     */
    async makeThemePair(id) {
        const data = this._colorsData;
        const theme = data?.custom?.[id];
        if (!theme) return;
        const lum = window.ColorValueUtils?.relativeLuminance?.(String(theme.backgroundPrimary || '').trim());
        const half = lum != null && lum >= 0.4 ? 'light' : 'dark';
        const other = half === 'dark' ? 'light' : 'dark';
        const known = this.themePairOf(id);
        const base = known.half ? known.base : id;
        const ownId = `${base}-${half}`;
        const otherId = `${base}-${other}`;
        if (data.custom[otherId]) return;

        const neutrals = data[other] || {};
        const carried = {};
        ['accentPrimary', 'accentSuccess', 'accentWarning', 'accentError', 'accentInfo',
            ...DashboardConfig.THEME_CHARACTER_FIELDS.map((f) => f.prop)].forEach((k) => {
            if (theme[k] !== undefined && theme[k] !== '') carried[k] = theme[k];
        });
        const names = Object.values(data.custom).map((t) => t.name);
        const counterpart = {
            ...neutrals,
            ...carried,
            name: DashboardConfig.uniqueNameFrom(`${theme.name || base} ${this.t(`config.themePairSuffix_${other}`, other)}`, names),
        };
        // The look comes along, as both halves of a pair made in the studio
        // get it; the new half had none.
        if (theme.look) counterpart.look = JSON.parse(JSON.stringify(theme.look));

        // Rebuilt in order, with the new half straight after the old one.
        const next = {};
        Object.entries(data.custom).forEach(([key, value]) => {
            if (key === id) {
                next[ownId] = value;
                next[otherId] = counterpart;
            } else {
                next[key] = value;
            }
        });
        data.custom = next;

        if (ownId !== id) this.renameThemeInSettings(id, ownId);
        this._themeSelected = ownId;
        this.syncCustomThemeIds();
        this.repaintAppearanceBody();
        if (await this.saveColorsData() && ownId !== id) {
            await this.saveSettingsWithFeedback();
        }
    },

    /**
     * Random theme mode keys harmonisation to one shared pool entry instead of
     * per-theme entries (theme-icon-styling.js) — otherwise the toggle keeps
     * flipping back to disabled every time the pool rotates to a theme with no
     * entry of its own. Switching the mode changes which key is read, so the
     * entry is carried across rather than silently losing whatever the user
     * had set.
     */
    migrateIconStylingOnRandomModeChange(nowActive) {
        const poolKey = window.ThemeIconStyling?.RANDOM_POOL_KEY;
        const specificKey = window.ThemeIconStyling?.getSpecificThemeKey?.(this.dash.settings);
        if (!poolKey || !specificKey) return;
        const fromKey = nowActive ? specificKey : poolKey;
        const toKey = nowActive ? poolKey : specificKey;
        if (fromKey === toKey) return;
        const map = this.dash.settings.themeIconStyling || {};
        if (!Object.prototype.hasOwnProperty.call(map, fromKey)) return;
        // Never clobber a setting the target key already has of its own.
        if (Object.prototype.hasOwnProperty.call(map, toKey)) return;
        this.dash.settings.themeIconStyling = { ...map, [toKey]: { ...map[fromKey] } };
    },

    moveCustomTheme(id, direction) {
        const data = this._colorsData;
        if (!data?.custom?.[id]) return;
        const ids = Object.keys(data.custom);
        const i = ids.indexOf(id);
        const swap = direction === 'up' ? i - 1 : i + 1;
        if (swap < 0 || swap >= ids.length) return;
        [ids[i], ids[swap]] = [ids[swap], ids[i]];
        // Object key order is the theme order, so the map is rebuilt rather
        // than mutated in place.
        data.custom = Object.fromEntries(ids.map((k) => [k, data.custom[k]]));
        this.repaintAppearanceBody();
        void this.saveColorsData();
    },

    /**
     * Accept an exported theme, reject anything else.
     *
     * A theme is an object of colour values; without a check, any JSON file at
     * all would be accepted and land as a theme with no colours in it.
     */
    normalizeImportedTheme(parsed) {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        // Both shapes: an exported file wraps the theme in `colors`, and a bare
        // object of fields is what a backup's colors.json holds.
        const source = parsed.colors && typeof parsed.colors === 'object' ? parsed.colors : parsed;
        const colorKeys = Object.keys(source).filter((k) => k !== 'name'
            && typeof source[k] === 'string' && /^(#|rgb|hsl|var\()/i.test(source[k].trim()));
        if (!colorKeys.length || !source.backgroundPrimary || !source.textPrimary) return null;
        const rawName = parsed.name || source.name || this.t('config.themeImportedName', 'Imported theme');
        const out = { name: DashboardConfig.NAME_MAX_LENGTH
            ? String(rawName).trim().slice(0, DashboardConfig.NAME_MAX_LENGTH)
            : String(rawName) };
        colorKeys.forEach((k) => { out[k] = source[k]; });
        // The character fields come along too, in the type each one has; the
        // server holds them to their ranges when the theme is saved.
        DashboardConfig.THEME_CHARACTER_FIELDS.forEach(({ prop }) => {
            const v = source[prop];
            if (typeof v === 'number' && Number.isFinite(v)) out[prop] = v;
            else if (typeof v === 'string' && v.trim() && !colorKeys.includes(prop)) out[prop] = v.trim();
        });
        // A look comes along whole; the server keeps the parts it can draw.
        if (source.look && typeof source.look === 'object' && !Array.isArray(source.look)) out.look = source.look;
        return out.name ? out : null;
    },

    /** Open, once, the panel a link pointed into, and bring it on screen. */
    openAppearancePanelFromLink(body) {
        const pending = this._pendingAppearancePanel;
        if (!pending || pending.tab !== this.appearanceTab) return;
        this._pendingAppearancePanel = null;
        const selector = pending.field ? this.settingsJumpControlSelector(pending.field) : null;
        const el = selector
            ? document.querySelector(selector)
            : body.querySelector(`.config-panel--fold[data-fold-key="${CSS.escape(pending.panel || '')}"]`);
        const panel = el?.closest('.config-panel--fold');
        if (!panel) return;
        this.revealFoldedPanel(panel);
        requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest' }));
    },

    /**
     * Jump to the Custom themes tab.
     *
     * This used to reveal the old config's editor, embedded from a
     * server-rendered partial. That editor wired its buttons through a
     * document-level delegate calling window.configManager, which only exists
     * on the standalone /config page — so in this view its Add button silently
     * did nothing. The native tab replaces it and covers the same palettes.
     */
    openThemeEditorTab() {
        this.appearanceTab = 'custom-themes';
        this.render();
        void this.openCustomThemes();
    },

    /**
     * Show a theme on the dashboard without storing it.
     *
     * Reuses the editor's preview: a variables block scoped to the attribute the
     * document actually carries, which outranks /api/theme.css. Whether the id
     * resolves to a palette decides the approach — a built-in the browser
     * already has CSS for only needs the attribute swapped.
     */
    previewThemeChoice(id) {
        if (!id) return;
        const palette = this.themeById(id);
        if (palette) {
            this.previewThemeColors(id);
            return;
        }
        this.clearThemePreview();
        document.documentElement.setAttribute('data-theme', id);
    },

    /**
     * Preview a colour without saving.
     *
     * Writes the theme's variables into a <style> the dashboard picks up, using
     * the same buildVarsBlock the old editor used so a preview cannot disagree
     * with what /api/theme.css will produce.
     */
    previewThemeColors(id) {
        const theme = this.themeById(id);
        document.getElementById('config-theme-preview')?.remove();
        if (!theme) return;
        const vars = window.ColorValueUtils?.buildVarsBlock?.(theme) || '';
        if (!vars) return;
        const style = document.createElement('style');
        style.id = 'config-theme-preview';
        /*
         * Wear the candidate's name while previewing it.
         *
         * The colours alone are not the theme: theme-depth.css picks the
         * backdrop's *shape* -- scanlines, grid, hatch, dots -- and its tint
         * and depth with rules selecting on html[data-theme="…"]. Writing the
         * candidate's variables under the *active* theme's selector, which is
         * what this did, showed the new palette wearing the old theme's
         * texture: a combination that matches no theme at all. Applying the
         * theme is what random-theme rotation already does, and its backdrop
         * has always followed.
         *
         * /api/theme.css writes on the same selector, so the block still has to
         * name it rather than :root, which it would outrank.
         */
        if (this._themePreviewRestore === undefined) {
            this._themePreviewRestore = document.documentElement.getAttribute('data-theme');
        }
        document.documentElement.setAttribute('data-theme', id);
        style.textContent = `html[data-theme="${CSS.escape(id)}"] { ${vars} }`;
        document.head.appendChild(style);
        // The colours are not the look: the material, the depth and the card surface are the
        // candidate's own too, or a hover over a neon theme shows neon colours on classic cards.
        void window.ThemeLoader?.applySurfacesForTheme?.(id, this.dash.settings, id);
    },

    /** Recount the changed rows in the fold holding `el` while a slider moves. */
    refreshFineSummary(el) {
        const fold = el.closest('[data-fine]');
        const summary = fold?.querySelector('.config-fine-summary');
        if (!summary) return;
        const n = fold.querySelectorAll('.config-fine-body [data-fine-changed]').length;
        summary.textContent = n
            ? this.t('config.fineChanged', '{n} changed').replace('{n}', String(n))
            : this.t('config.fineDefault', 'At defaults');
    },

    /** Let the panel follow the body again. */
    releaseConfigTypeScale() {
        const view = document.querySelector('.config-view');
        if (!view) return;
        DashboardConfig.FONT_SCALE_VARS.forEach((name) => view.style.removeProperty(name));
        delete view.dataset.fontScaleHeld;
    },

    /** Everything in the settings that names a theme by id follows a rename. */
    renameThemeInSettings(from, to) {
        const s = this.dash.settings;
        if (!s) return;
        if (s.theme === from) s.theme = to;
        if (Array.isArray(s.favoriteThemes)) {
            s.favoriteThemes = s.favoriteThemes.map((t) => (t === from ? to : t));
        }
        if (s.themeIconStyling && s.themeIconStyling[from]) {
            s.themeIconStyling[to] = s.themeIconStyling[from];
            delete s.themeIconStyling[from];
        }
        // The theme's own backdrop, glass and depth: left under the old id,
        // a pair lost them.
        if (s.themeSurfacePrefs && s.themeSurfacePrefs[from]) {
            s.themeSurfacePrefs[to] = s.themeSurfacePrefs[from];
            delete s.themeSurfacePrefs[from];
        }
        if (document.documentElement.getAttribute('data-theme') === from) {
            document.documentElement.setAttribute('data-theme', to);
        }
    },

    renderAppearance() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const apIntro = `<p class="config-view-intro">${esc(this.t('config.appearanceIntro', 'Theme, type, and layout.'))}</p>`;
        // Which half of the current family is showing, so Quick mode marks the
        // right button whatever theme is picked. Reading s.theme directly only
        // ever matched the two legacy ids, leaving both buttons unlit on every
        // other theme.
        const theme = String(s.theme || 'dark').endsWith('-light') || s.theme === 'light' ? 'light' : 'dark';

        const randomMode = window.ThemeUtils?.normalizeRandomThemeMode?.(s) ?? s.randomThemeMode ?? 'off';
        const showingThemeId = randomMode !== 'off'
            ? (document.documentElement.getAttribute('data-theme')
                || window.VisualSettings?.resolveTheme?.(s)
                || s.theme
                || 'dark')
            : '';
        const randomShowingHint = randomMode !== 'off'
            ? `<p class="config-field-hint">${esc(this.t('config.randomThemeShowingHint', 'Currently showing: {theme}').replace('{theme}', this.themeDisplayName(showingThemeId, this._themeList?.[showingThemeId])))}</p>`
            : '';

        /*
         * One column of settings with the live preview beside it.
         *
         * No start screen and no second layer: the tab strip is the way in,
         * and every setting of the tab is on it. The preview follows the tab
         * -- the grid on Grid, a few rows on Rows -- so a choice is seen where
         * it lands. Custom themes is a page of Look with a way back to it, and
         * is its own editor, so it gets the whole width.
         */
        const subpageOf = DashboardConfig.APPEARANCE_SUBPAGES[this.appearanceTab];
        const back = subpageOf
            ? `<button type="button" class="config-subpage-back" data-appearance-goto="${esc(subpageOf)}">← ${esc(this.appearanceTabLabel(subpageOf))}</button>`
            : '';
        const preview = !subpageOf && window.ConfigPreview
            ? `<aside class="config-tabpage-side" aria-label="${esc(this.t('config.previewLabel', 'Preview'))}">
                   <nav class="config-panel-index" data-panel-index hidden
                        aria-label="${esc(this.t('config.panelIndexLabel', 'On this tab'))}"></nav>
                   <p class="config-tabpage-side-label">${esc(this.t('config.previewLabel', 'Preview'))}</p>
                   <div data-config-preview>${window.ConfigPreview.render(this, this.appearanceTab)}</div>
               </aside>`
            : '';
        const shell = (body) => `
            ${apIntro}
            ${this.renderSectionTabStrip('appearance')}
            <div class="config-tabpage${preview ? ' config-tabpage--preview' : ''}">
                <div class="config-tabpage-main">
                    ${back}
                    <div id="config-appearance-body" role="tabpanel" tabindex="0">${body}</div>
                    <div data-filter-elsewhere-host>${this.renderFilterElsewhere('appearance')}</div>
                </div>
                ${preview}
            </div>`;

        if (this.appearanceTab === 'custom-themes') {
            return shell(this.renderCustomThemes());
        }
        if (this.appearanceTab === 'background') {
            return shell(this.renderAppearanceBackgroundBody());
        }
        if (this.appearanceTab === 'surface') {
            return shell(this.renderAppearanceSurfaceBody());
        }
        if (this.appearanceTab === 'layout') {
            return shell(this.renderAppearanceLayoutBody());
        }
        if (this.appearanceTab === 'buttonbar') {
            return shell(this.renderAppearanceActionBarBody());
        }
        if (this.appearanceTab === 'datetime') {
            return shell(this.renderControlPanels(this.panelsFor('appearance', 'datetime'), 'behavior'));
        }
        if (this.appearanceTab === 'display') {
            return shell(this.renderAppearanceDisplayBody());
        }
        if (this.appearanceTab === 'previews') {
            return shell(this.renderControlPanels(this.panelsFor('appearance', 'previews'), 'behavior'));
        }
        if (this.appearanceTab === 'header') {
            return shell(this.renderAppearanceToolbarBody());
        }

        return shell(`
            <div class="config-panel config-panel--theme-controls">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceThemeTitle', 'Theme'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.appearanceThemeNote', 'Pick a built-in theme or follow your system. Edit the colours of any theme, or build your own, in the theme editor.'))}</p>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.themeLabel', 'Theme'))}</span>
                    <div class="config-theme-row">
                        ${this.renderThemePicker()}
                        <button type="button" class="config-btn config-theme-browse"
                                data-appearance-action="browse-themes">${esc(this.t('config.openThemeBrowser', 'Open theme studio'))}</button>
                    </div>
                    ${this.appearanceAff('theme')}
                </div>
                ${randomShowingHint}
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceMode', 'Quick mode'))}</span>
                    <div class="config-choices" role="group">
                        <button type="button" class="config-choice${theme === 'light' ? ' is-active' : ''}" data-appearance-theme="light" aria-pressed="${theme === 'light'}">${esc(this.t('config.themeLight', 'Light'))}</button>
                        <button type="button" class="config-choice${theme === 'dark' ? ' is-active' : ''}" data-appearance-theme="dark" aria-pressed="${theme === 'dark'}">${esc(this.t('config.themeDark', 'Dark'))}</button>
                    </div>
                    ${this.infoAff('quickMode')}
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="autoDarkMode" ${s.autoDarkMode ? 'checked' : ''}>
                        <span>${esc(this.t('config.appearanceAutoDark', 'Follow system dark mode'))}</span>
                    </label>
                    ${this.appearanceAff('autoDarkMode')}
                </div>
                <div class="config-field" data-config-setting-promo-anchor="randomThemeMode">
                    <span class="config-field-label">${esc(this.t('config.randomThemeModeLabel', 'Random theme'))}</span>
                    <div class="config-choices" role="group">${this.renderRandomThemeModeChoices(s)}</div>
                    ${this.appearanceAff('randomThemeMode')}
                </div>
                <!-- One button, not two. "Open the theme editor…" and "Make
                     your own theme…" both ran switchAppearanceTab to the same
                     tab, so they were one action wearing two labels -- and
                     that tab does both jobs: it recolours a packaged theme
                     and it builds a new one.

                     A row like the rest of the panel rather than a lone
                     button: it is reached the same way every setting here is,
                     so it says what it is and carries the same ℹ. -->
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.themeEditorLabel', 'Theme editor'))}</span>
                    <button type="button" class="config-btn config-btn--field" data-appearance-goto="custom-themes">${esc(this.t('config.openBuiltInColorsLink', 'Open the theme editor…'))}</button>
                    ${this.appearanceAff('themeEditor')}
                    <p class="config-panel-note">${esc(this.t('config.themeEditorNote', 'Change the colours of a theme that ships with nextDash, or build one of your own. A theme you make comes as a light and a dark half, like the packaged ones.'))}</p>
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceTextMotionTitle', 'Text and motion'))}</h3>
                ${this.renderInkGapField()}
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="animationsEnabled" ${s.animationsEnabled !== false ? 'checked' : ''}>
                        <span>${esc(this.t('config.enableAnimations', 'Enable animations'))}</span>
                    </label>
                    ${this.appearanceAff('animationsEnabled')}
                </div>
                <div class="config-field-row">
                    <label class="config-toggle">
                        <input type="checkbox" data-appearance-toggle="viewAnimationsEnabled" ${s.viewAnimationsEnabled !== false ? 'checked' : ''}>
                        <span>${esc(this.t('config.viewAnimations', 'Animations in views and modals'))}</span>
                    </label>
                    ${this.appearanceAff('viewAnimationsEnabled')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.animationSpeedLabel', 'Animation speed'))}</span>
                    <select class="config-select" data-appearance-select="animationSpeed">
                        ${[['slow', 'animationSpeedSlow', 'Slow'], ['normal', 'animationSpeedNormal', 'Normal'], ['fast', 'animationSpeedFast', 'Fast']]
                            .map(([value, key, fallback]) => `<option value="${value}"${(window.VisualSettings?.normalizeAnimationSpeed?.(s.animationSpeed) ?? 'normal') === value ? ' selected' : ''}>${esc(this.t(`config.${key}`, fallback))}</option>`).join('')}
                    </select>
                    ${this.appearanceAff('animationSpeed')}
                </div>
            </div>

            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.appearanceTypeTitle', 'Type'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.appearanceTypeNote', 'The typeface, weight, and size used across the dashboard. Upload a font file to use one that is not listed.'))}</p>
                ${this.renderTypeFields()}
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.uploadFontLabel', 'Custom font'))}</span>
                    <button type="button" class="config-btn config-btn--small" data-appearance-action="upload-font">${esc(this.t('config.detailUploadIconBtn', 'Upload…'))}</button>
                    <input type="file" id="config-font-input" accept=".woff,.woff2,.ttf,.otf" hidden>
                </div>
            </div>
`);
    },

    /**
     * The list of a long tab's panels above the preview, marking the one in
     * view.
     *
     * Only past three panels: with their summaries, three folded panels fit on
     * one screen and a list of them would only repeat it. Built from the
     * panels on screen, so the filter and "Only changed" narrow it too.
     * Choosing an entry opens that panel and brings it into view.
     */
    renderAppearancePanelIndex(body) {
        this._panelIndexObserver?.disconnect();
        this._panelIndexObserver = null;
        const nav = document.querySelector('[data-panel-index]');
        if (!nav || !body) return;
        const panels = [...body.querySelectorAll('.config-panel--fold')].filter((p) => !p.hidden);
        if (panels.length < DashboardConfig.APPEARANCE_INDEX_MIN_PANELS) {
            nav.hidden = true;
            nav.replaceChildren();
            return;
        }
        const esc = (v) => this.dash.escapeHtml(v);
        const titleOf = (panel) => String(panel.querySelector('.config-panel-fold')?.textContent || '').trim();
        nav.innerHTML = panels.map((panel) => `
            <button type="button" class="config-panel-index-item" data-panel-index-key="${esc(panel.getAttribute('data-fold-key'))}">${esc(titleOf(panel))}</button>`).join('');
        nav.hidden = false;
        const markKey = (key) => nav.querySelectorAll('[data-panel-index-key]').forEach((btn) => {
            if (key && btn.getAttribute('data-panel-index-key') === key) btn.setAttribute('aria-current', 'true');
            else btn.removeAttribute('aria-current');
        });
        let holdUntil = 0;
        nav.querySelectorAll('[data-panel-index-key]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-panel-index-key');
                const panel = body.querySelector(`.config-panel--fold[data-fold-key="${CSS.escape(key)}"]`);
                if (!panel) return;
                if (panel.classList.contains('is-folded')) this.toggleAppearancePanel(panel, true);
                panel.scrollIntoView({ block: 'start', behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth' });
                panel.querySelector('.config-panel-fold')?.focus({ preventScroll: true });
                // The chosen entry stays marked while the scroll runs: a last
                // panel too short to reach the top would otherwise hand the
                // mark to the one above it.
                markKey(key);
                holdUntil = Date.now() + 1000;
            });
        });
        // The entry for the topmost panel still on screen is the current one.
        if (typeof IntersectionObserver !== 'function') return;
        const seen = new Map();
        this._panelIndexObserver = new IntersectionObserver((entries) => {
            entries.forEach((e) => seen.set(e.target, e.isIntersecting));
            if (Date.now() < holdUntil) return;
            markKey(panels.find((p) => seen.get(p))?.getAttribute('data-fold-key'));
        });
        panels.forEach((p) => this._panelIndexObserver.observe(p));
    },

    /** Text contrast: on General, and on the studio's Layout tab. */
    renderInkGapField() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        // The ink gap is a lightness distance, not a percentage of anything, so
        // it is shown as the contrast it buys rather than as its own number:
        // "0.44" means nothing to a reader, "normal" and the ends of the range
        // do. Kept in step with normalizeInkGap on the server.
        const inkGap = Number.isFinite(Number(s.inkGap)) && Number(s.inkGap) > 0
            ? Math.min(0.58, Math.max(0.30, Number(s.inkGap)))
            : 0.47;
        return `
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.inkGapLabel', 'Text contrast'))}</span>
                    <select class="config-select" data-appearance-select="inkGap">
                        ${DashboardConfig.INK_GAP_STEPS.map(([value, key, fallback]) => `<option value="${value}"${DashboardConfig.inkGapStepFor(inkGap) === value ? ' selected' : ''}>${esc(this.t(`config.${key}`, fallback))}</option>`).join('')}
                    </select>
                    ${this.appearanceAff('inkGap')}
                    <p class="config-panel-note">${esc(this.t('config.inkGapNote', 'How far the fainter text sits from the surface it is drawn on. Every theme is measured against this, so the note beside a bookmark stays readable no matter which palette you pick. Lower gives a softer hierarchy, higher pushes everything toward the foreground.'))}</p>
                </div>`;
    },

    renderRandomThemeModeChoices(settings) {
        const esc = (v) => this.dash.escapeHtml(v);
        const current = window.ThemeUtils?.normalizeRandomThemeMode?.(settings)
            || settings?.randomThemeMode
            || 'off';
        const modes = [
            ['off', 'config.randomThemeModeOff', 'Off'],
            ['refresh', 'config.randomThemeModeRefresh', 'On page refresh'],
            ['view', 'config.randomThemeModeView', 'On view change'],
        ];
        return modes.map(([value, labelKey, fallback]) =>
            `<button type="button" class="config-choice${value === current ? ' is-active' : ''}" data-appearance-randommode="${esc(value)}" aria-pressed="${value === current}">${esc(this.t(labelKey, fallback))}</button>`
        ).join('');
    },

    /**
     * The theme picker: a listbox rather than a <select>.
     *
     * Moving through the list previews each theme on the real dashboard, and
     * that is only possible outside a native select — while the browser's own
     * popup is open it owns the keyboard, fires no change or input event, and
     * leaves `value` on the old option until the popup closes. There is nothing
     * to hang a preview on, so the list is built here instead.
     *
     * Closed, it is a button showing the current theme; open, a listbox
     * underneath it. The button carries the same data-appearance-select hook the
     * settings search and the "only changed" filter already look for.
     */
    renderThemePicker() {
        const esc = (v) => this.dash.escapeHtml(v);
        const current = this.dash.settings?.theme || 'dark';
        const label = this.themePickerLabel(current);
        // "· recoloured" needs the theme meta; redraw the closed list once it lands.
        if (!this._themeMeta) {
            void this.loadThemeMeta().then(() => {
                const list = document.querySelector('[data-theme-picker-list]');
                if (list?.hidden) list.innerHTML = this.renderThemeOptions();
            }).catch(() => {});
        }
        return `
            <div class="config-theme-picker" data-theme-picker>
                <button type="button" class="config-select config-theme-picker-button"
                        data-appearance-select="theme" data-theme-picker-button
                        aria-haspopup="listbox" aria-expanded="false"
                        value="${esc(current)}">
                    <span data-theme-picker-label>${esc(label)}</span>
                </button>
                <ul class="config-theme-picker-list" role="listbox" hidden tabindex="-1"
                    data-theme-picker-list
                    aria-label="${esc(this.t('config.themeLabel', 'Theme'))}">${this.renderThemeOptions()}</ul>
            </div>`;
    },

    /** Font, weight and size: on General, and on the studio's Layout tab. */
    renderTypeFields() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        // Small / Medium / Large names a size without showing one, so each
        // button carries the letters at the size it sets. Hovering still applies
        // the real thing to the dashboard behind the panel; this is what the
        // choice looks like before you get that far.
        const fontOptions = DashboardConfig.FONT_SIZES.map((size) => {
            const active = size === this.currentFontSize();
            return `<button type="button" class="config-choice config-choice--art${active ? ' is-active' : ''}" data-appearance-font="${esc(size)}" aria-pressed="${active ? 'true' : 'false'}">`
                + `${window.SettingArt?.render?.('fontSize', size) || ''}`
                + `<span class="config-choice-label">${esc(this.fontSizeLabel(size))}</span></button>`;
        }).join('');

        const presets = (window.DashboardFont?.PRESET_IDS) || ['source-code-pro', 'jetbrains-mono', 'ibm-plex-mono', 'inter', 'ibm-plex-sans', 'dm-sans', 'system'];
        const activePreset = window.DashboardFont?.resolveActiveFontPreset?.(s) || s.fontPreset || 'source-code-pro';
        const fontPresetOptions = presets.map((p) =>
            `<option value="${esc(p)}" ${p === activePreset ? 'selected' : ''}>${esc(this.fontPresetLabel(p))}</option>`
        ).join('');

        const weight = s.fontWeight || 'normal';
        const weights = [['normal', this.t('config.fontWeightNormal', 'Normal')], ['600', this.t('config.fontWeightSemiBold', 'Semi-bold')], ['bold', this.t('config.fontWeightBold', 'Bold')]];
        const weightChoices = weights.map(([val, label]) =>
            `<button type="button" class="config-choice${weight === val ? ' is-active' : ''}" data-appearance-weight="${esc(val)}" aria-pressed="${weight === val}">${esc(label)}</button>`
        ).join('');

        return `
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.fontPresetLabel', 'Font'))}</span>
                    <select class="config-select" data-appearance-select="fontPreset">${fontPresetOptions}</select>
                    ${this.appearanceAff('fontPreset')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.fontWeightLabel', 'Weight'))}</span>
                    <div class="config-choices" role="group">${weightChoices}</div>
                    ${this.appearanceAff('fontWeight')}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.appearanceFontSize', 'Font size'))}</span>
                    <div class="config-choices" role="group">${fontOptions}</div>
                    ${this.appearanceAff('fontSize')}
                </div>`;
    },

    /**
     * Put Depth, Glow and Effects back to what the theme asks for.
     *
     * One button for both modes, because it is one outcome: whether the three
     * were stored against this theme or forced across the install, what the
     * reader wants back is the theme's own answer.
     */
    resetThemeSurfaces() {
        const settings = this.dash.settings;
        if (!settings) return;

        if (settings.themeSurfacePrefs) {
            delete settings.themeSurfacePrefs[this.currentThemeId()];
            if (!Object.keys(settings.themeSurfacePrefs).length) {
                delete settings.themeSurfacePrefs;
            }
        }
        // A forced value outlives the per-theme entry, so it has to go too --
        // otherwise the button would appear to do nothing.
        settings.themeDepth = 'follow';
        settings.glowStrength = 'follow';
        settings.themeEffects = 'follow';
        settings.categorySurface = 'follow';
        settings.widgetSurface = 'background';
        window.ThemeLoader?.applyWidgetSurface?.('background');
        settings.widgetOpacity = 50;
        window.ThemeLoader?.applyWidgetOpacity?.(50);

        void this.applyResolvedSurfaces();
        this.persistAppearance();
        this.repaintAppearanceBody();
    },

    /** Put back whatever was applied before the picker was opened. */
    revertThemePreview() {
        this.clearThemePreview();
        const previous = this._themePickerPrevious;
        this._themePickerPrevious = null;
        if (!previous) return;
        // applyThemeLive re-resolves through auto dark mode, so this restores
        // what was on screen rather than the raw stored id.
        this.applyThemeLive();
    },

    setAppearanceSelect(name, value) {
        if (name === 'fontPreset') {
            this.dash.settings.fontPreset = value;
            window.DashboardFont?.applyMainFont?.(this.dash.settings);
            this.persistAppearance();
            return;
        }
        if (name === 'theme') {
            this.setTheme(value);
            return;
        }
        if (name === 'randomThemeMode') {
            this.setRandomThemeMode(value);
            return;
        }
        if (name === 'backgroundPattern') {
            const pattern = ['auto', 'dots', 'grid', 'lines', 'hatch', 'none'].includes(value) ? value : 'auto';
            this.dash.settings.backgroundPattern = pattern;
            window.ThemeLoader?.applyBackgroundPattern?.(pattern);
            this.persistAppearance();
            return;
        }
        if (name === 'themeBackdrop') {
            const mode = value === 'off' ? 'off' : 'follow';
            this.dash.settings.themeBackdrop = mode;
            window.ThemeLoader?.applyThemeBackdrop?.(mode);
            this.persistAppearance();
            return;
        }
        if (name === 'animationSpeed') {
            const speed = window.VisualSettings?.normalizeAnimationSpeed?.(value) ?? 'normal';
            this.dash.settings.animationSpeed = speed;
            window.VisualSettings?.applyAnimationSpeed?.(speed);
            this.persistAppearance();
            return;
        }
        if (name === 'inkGap') {
            const gap = DashboardConfig.inkGapStepFor(value);
            this.dash.settings.inkGap = gap;
            // Applied before it is saved, like the two controls above it.
            window.ThemeLoader?.applyInkGap?.(gap);
            this.persistAppearance();
            return;
        }
        /*
         * The three that go through setSurface.
         *
         * They are not a plain settings write any more: on Follow the theme a
         * value belongs to the theme on screen rather than to the install, and
         * setSurface is the one place that knows which. Validated here first,
         * because this path is reached from the settings search as well as
         * from the select, and the search hands over whatever it was given.
         */
        const surfaces = {
            glowStrength: ['follow', 'off', 'soft', 'full'],
            themeDepth: ['follow', 'flat', 'soft', 'rich', 'vivid', 'glass'],
            themeEffects: ['follow', 'off', 'held', 'full'],
            categorySurface: ['follow', 'glass', 'card', 'open'],
        };
        if (surfaces[name]) {
            this.setSurface(name, surfaces[name].includes(value) ? value : 'follow');
        }
        if (name === 'widgetSurface') this.setWidgetSurface(value);
        if (name === 'materialStyle') this.setMaterialStyle(value);
        if (name === 'neutralAccent') this.setNeutralAccent(value);
    },

    setBackgroundGradient(name) {
        if (!name || !(window.VisualSettings?.BACKGROUND_PRESETS || {})[name]) return;
        this.dash.settings.backgroundGradient = name;
        this.dash.settings.backgroundType = 'gradient';
        this.dash.visual?.applyBackground?.();
        this.persistAppearance();
    },

    /**
     * The URL is applied through the shared safeCssImageUrl guard downstream, so
     * anything it rejects simply renders no background rather than injecting CSS.
     */
    setBackgroundImageUrl(url) {
        this.dash.settings.backgroundImageUrl = String(url || '').trim();
        this.dash.visual?.applyBackground?.();
        void this.saveSettingsWithFeedback();
    },

    setBackgroundType(type) {
        if (!['auto', 'none', 'gradient', 'image'].includes(type)) return;
        this.dash.settings.backgroundType = type;
        // Switching to gradient with nothing chosen would apply no background at
        // all, which reads as a broken button — fall back to the first preset.
        if (type === 'gradient' && !this.dash.settings.backgroundGradient) {
            const first = Object.keys(window.VisualSettings?.BACKGROUND_PRESETS || {})[0];
            if (first) this.dash.settings.backgroundGradient = first;
        }
        this.dash.visual?.applyBackground?.();
        this.persistAppearance();
    },

    setFontSize(size) {
        if (!DashboardConfig.FONT_SIZES.includes(size)) return;
        this.dash.settings.fontSize = size;
        this.dash.applyFontSize?.();
        this.persistAppearance();
    },

    setFontWeight(weight) {
        if (!['normal', '600', 'bold'].includes(weight)) return;
        this.dash.settings.fontWeight = weight;
        this.dash.visual?.applyVisualSettings?.();
        this.persistAppearance();
    },

    setLauncherIconSize(size) {
        if (!['small', 'normal', 'large'].includes(size)) return;
        this.dash.settings.launcherIconSize = size;
        this.dash.visual?.applyVisualSettings?.();
        this.persistAppearance();
    },

    /**
     * Material style: signature or classic, install-wide. The theme's material
     * is the same either way; this picks which drawing of it the page gets.
     */
    setMaterialStyle(value) {
        if (!this.dash.settings) return;
        this.dash.settings.materialStyle = value === 'signature' ? 'signature' : 'classic';
        void this.applyResolvedSurfaces();
        this.persistAppearance();
    },

    /**
     * Accent of the neutrals: one of six colour words, or the theme's own. It is
     * drawn into theme.css, which is fetched again with the word asked for.
     */
    setNeutralAccent(value) {
        if (!this.dash.settings) return;
        const words = ['theme', 'blue', 'teal', 'green', 'amber', 'rose', 'violet'];
        this.dash.settings.neutralAccent = words.includes(value) ? value : 'theme';
        this._drawnNeutralAccent = this.dash.settings.neutralAccent;
        this.persistAppearance();
        // The accent is drawn into theme.css, so it is fetched again.
        this.reloadThemeCSS();
    },

    setRandomThemeMode(mode) {
        const normalized = ['off', 'refresh', 'view'].includes(mode) ? mode : 'off';
        const wasActive = window.ThemeIconStyling?.isRandomThemeModeActive?.(this.dash.settings) === true;
        this.dash.settings.randomThemeMode = normalized;
        this.dash.settings.randomThemeOnRefresh = normalized !== 'off';
        const nowActive = normalized !== 'off';
        if (wasActive !== nowActive) {
            this.migrateIconStylingOnRandomModeChange(nowActive);
        }
        document.documentElement.setAttribute('data-random-theme-mode', normalized);
        window.ThemeLoader?.clearSessionRandomTheme?.();
        this.applyThemeLive();
        this.persistAppearance();
    },

    setTheme(theme) {
        // A theme of the reader's own may bring a look; Quick mode switches
        // halves through applyThemeChoice directly and so never reaches this.
        const previous = this.dash.settings?.theme;
        void this.applyThemeChoice(theme).then(() => this.applyThemeLookAndSave?.(theme, previous));
    },

    setToggle(name, value) {
        const d = this.dash;
        switch (name) {
            case 'autoDarkMode':
                d.settings.autoDarkMode = value;
                this.applyThemeLive();
                break;
            /*
             * Which of the two places the three Surfaces answers live in.
             *
             * Turning it on hands the install's forced values back: the three
             * selects were writing per theme, so there is nothing global to
             * carry over and the theme's own answers are what is on screen.
             * They are seeded from what is being drawn, so ticking it keeps
             * the page exactly as it looks rather than snapping to a default.
             */
            case 'themeSurfacesForceAll': {
                d.settings.themeSurfacesForceAll = value;
                if (value) {
                    const body = document.body;
                    d.settings.themeDepth = body?.getAttribute('data-depth') || 'soft';
                    d.settings.glowStrength = body?.getAttribute('data-glow') || 'off';
                    d.settings.themeEffects = body?.getAttribute('data-effects') || 'held';
                    d.settings.categorySurface = body?.getAttribute('data-cat-surface') || 'glass';
                } else {
                    d.settings.themeDepth = 'follow';
                    d.settings.glowStrength = 'follow';
                    d.settings.themeEffects = 'follow';
                    d.settings.categorySurface = 'follow';
                }
                void this.applyResolvedSurfaces();
                this.repaintAppearanceBody();
                break;
            }
            case 'showIcons':
                d.settings.showIcons = value;
                d.renderDashboard?.({ animate: false });
                break;
            case 'colorizeStatus':
                d.settings.colorizeStatus = value;
                d.renderDashboard?.({ animate: false });
                break;
            case 'animationsEnabled':
                d.settings.animationsEnabled = value;
                d.visual?.applyVisualSettings?.();
                break;
            case 'viewAnimationsEnabled':
                d.settings.viewAnimationsEnabled = value;
                d.visual?.applyVisualSettings?.();
                break;
            case 'enableCustomTitle':
                d.settings.enableCustomTitle = value;
                d.pageNav?.updateDocumentTitle?.();
                break;
            case 'showPageInTitle':
                d.settings.showPageInTitle = value;
                d.pageNav?.updateDocumentTitle?.();
                break;
            default:
                return;
        }
        this.persistAppearance();
    },

    /**
     * Widget background: whether a widget draws a background of its own. An
     * install-wide word (auto, background, none), painted at once and saved
     * with the rest of the appearance.
     */
    setWidgetSurface(value) {
        const word = ['auto', 'background', 'none'].includes(value) ? value : 'auto';
        if (!this.dash.settings) return;
        this.dash.settings.widgetSurface = word;
        window.ThemeLoader?.applyWidgetSurface?.(word);
        this.persistAppearance();
    },

    /** One field of a packaged theme as it ships, or undefined. */
    async shippedThemeValue(id, prop) {
        try {
            const res = await fetch(`/api/themes/defaults?id=${encodeURIComponent(id)}`);
            if (!res.ok) return undefined;
            return (await res.json())?.defaults?.[prop];
        } catch (_error) {
            return undefined;
        }
    },

    /**
     * Render the ℹ/↺ affordances for an Appearance-section field.
     *
     * Also stamps the field name on the enclosing row, which is what lets the
     * "Only changed" filter hide the hand-written controls: unlike the schema
     * panels, there is no declaration to render them from, so the filter works
     * on the DOM and needs each row to say which setting it binds. Emitted even
     * when the field has no affordances to show, so the marker never depends on
     * whether the setting happens to carry an ℹ or a ↺.
     */
    /**
     * The affordances for the three surfaces, which answer to two resets.
     *
     * ↺ means "back to the installation default", and it reads the setting.
     * While the three belong to the theme, the setting sits on "follow" no
     * matter what the reader picks -- so the ↺ would never appear, and if it
     * did it would undo something other than what is on screen. The reset
     * that is right there is the panel's own button, which puts this theme
     * back to the surfaces it ships with.
     *
     * So these three carry ℹ and no ↺. One button under them puts all three
     * back, which is also the honest count: they are one answer about one
     * theme, and two controls for it would only raise the question of what
     * the difference was.
     */
    surfaceAff(field) {
        return this.infoAff(field);
    },

    /**
     * What a Surfaces select should be showing.
     *
     * The stored setting is not it: on follow the reader is looking at this
     * theme's answer, and a select showing "follow" while the page is plainly
     * glass is a control that disagrees with the screen. So it shows the
     * per-theme value when there is one, the forced value when there is one,
     * and Follow the theme when neither -- which is also exactly what the
     * select writes back.
     */
    surfaceSelectValue(field) {
        const settings = this.dash.settings || {};
        if (this.surfaceScope() === 'global') return settings[field] || 'follow';
        const key = { themeDepth: 'depth', glowStrength: 'glow', themeEffects: 'effects', categorySurface: 'catSurface' }[field];
        return settings.themeSurfacePrefs?.[this.currentThemeId()]?.[key] || 'follow';
    },

    /** Open or fold every panel on the body to match the state it should be in. */
    syncAppearanceFolds(body) {
        if (!body) return;
        const panels = [...body.querySelectorAll('.config-panel--fold')];
        if (!panels.length) return;
        const forced = this.appearanceFoldsForced();
        const chosen = this.appearanceOpenPanels(this.appearanceTab);
        panels.forEach((panel, i) => {
            const open = forced || (chosen ? chosen.has(panel.getAttribute('data-fold-key')) : i === 0);
            this.setAppearancePanelOpen(panel, open);
        });
    },

    /**
     * Fold state after a DOM filter pass over the hand-written bodies: a fold
     * with a visible row opens while the filter or Only changed is on, one
     * with none goes, and with both off each goes back to the reader's choice.
     */
    syncFineFolds(host) {
        const narrowed = this.changedOnly || Boolean(String(this.settingsFilter || '').trim());
        host.querySelectorAll('[data-fine]').forEach((fold) => {
            const rows = [...fold.querySelectorAll('.config-fine-body .config-field, .config-fine-body .config-field-row')];
            const hit = rows.some((row) => !row.hasAttribute('hidden') && !row.hasAttribute('data-appearance-filtered'));
            fold.toggleAttribute('hidden', narrowed && !hit);
            this.paintFineFold(fold, narrowed ? hit : this.isFineOpen(fold.dataset.fine));
        });
    },

    /** The backdrop recipe a theme draws, as /api/themes/meta resolved it. */
    themeBackdropOf(id) {
        return this._themeMeta?.themes?.[id]?.backdrop
            || window.ThemeLoader?.surfaceMetaFor?.(id)?.backdrop || '';
    },

    /** The line written for a theme, or '' for one that has none. */
    themeDescription(id) {
        const meta = this._themeMeta?.themes?.[id];
        return meta && meta.description ? meta.description : '';
    },

    /** Warn when primary text on the primary background falls below WCAG AA. */
    updateThemeContrastHint(id) {
        const hint = document.getElementById('config-theme-contrast');
        const theme = this.themeById(id);
        if (!hint || !theme || !window.ColorValueUtils?.contrastRatio) return;
        const ratio = window.ColorValueUtils.contrastRatio(theme.textPrimary, theme.backgroundPrimary);
        if (ratio == null || ratio >= 4.5) {
            hint.hidden = true;
            return;
        }
        hint.hidden = false;
        hint.textContent = this.t('config.themeContrastWarning',
            'Low contrast between primary text and background ({ratio}:1). Aim for 4.5:1 or higher.')
            .replace('{ratio}', ratio.toFixed(1));
    },

    async uploadFavicon(file) {
        try {
            const form = new FormData();
            form.append('favicon', file);
            const res = await this.writeFetch('/api/favicon', { method: 'POST', body: form });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            if (body.path) this.dash.settings.customFaviconPath = body.path;
            this.dash.settings.enableCustomFavicon = true;
            // Awaited before the reload below, or the reload could land first
            // and leave the favicon uploaded but never switched on.
            if ((await this.saveSettingsWithFeedback()) === false) throw new Error('not saved');
            this.notify(this.t('config.faviconUploadSuccess', 'Custom favicon applied. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch {
            this.notify(this.t('config.faviconUploadError', 'Could not upload the favicon.'), 'error');
        }
    },

    async uploadFont(file) {
        try {
            const form = new FormData();
            form.append('font', file);
            const res = await this.writeFetch('/api/font', { method: 'POST', body: form });
            if (!res.ok) throw Object.assign(new Error(await this.backupFailureReason(res)), { fromServer: true });
            const body = await res.json().catch(() => ({}));
            if (body.path) this.dash.settings.customFontPath = body.path;
            this.dash.settings.fontPreset = 'custom';
            this.dash.settings.enableCustomFont = true;
            window.DashboardFont?.applyMainFont?.(this.dash.settings);
            // Awaited: the toast below must not claim a font that was not saved.
            if ((await this.saveSettingsWithFeedback()) === false) throw new Error('not saved');
            this.notify(this.t('config.fontUploadSuccess', 'Custom font applied.'), 'success');
            this.persistAppearance();
        } catch (err) {
            // "The font is larger than 32 MB" rather than a bare failure.
            this.notify(this.withBackupReason(this.t('config.fontUploadError', 'Could not upload the font.'), err), 'error');
        }
    }

    });

    global.DashboardConfigAppearanceReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
