/**
 * Config → Appearance → Background and Surface.
 *
 * Two tabs that used to be one long panel on Look: what is behind the
 * dashboard (the source, the backdrop a theme draws, the sliders on it, the
 * pattern and the opacity) and what lies on it (depth, glow, effects, and the
 * card glass). The controls that moved keep the data-appearance-* hooks they
 * had, so bindAppearanceControls binds them as before; what is new is bound
 * here, by bindLookControls, which it calls at the end.
 *
 * The backdrop is chosen in one of three ways, and the answer is stored the way
 * the server reads it (see themeBackdrop in models.go):
 *
 *   follow      the theme's own backdrop
 *   off         none
 *   <recipe>    one of themeBackdropRecipes, in the colours of whichever theme
 *               is on screen
 *
 * Like Depth, Glow and Effects it belongs to the theme on screen, or to every
 * theme when "Use these for every theme" is ticked.
 */
(function (global) {
    'use strict';

    const DEFAULT_TUNING = { strength: 1, scale: 1, seed: 0, blur: 0, brightness: 1, saturate: 1, tint: 0 };

    /** The sliders: [key, label key, fallback label, min, max, step, unit]. */
    const TUNING_SLIDERS = [
        ['strength', 'config.backdropStrength', 'Intensity', 0, 2, 0.05],
        ['scale', 'config.backdropScale', 'Scale', 0.5, 2, 0.05],
        ['seed', 'config.backdropSeed', 'Variant', 0, 40, 1],
        ['blur', 'config.backdropBlur', 'Blur', 0, 20, 1],
        ['brightness', 'config.backdropBrightness', 'Brightness', 0.3, 1.4, 0.05],
        ['saturate', 'config.backdropSaturate', 'Saturation', 0, 2, 0.05],
        ['tint', 'config.backdropTint', 'Theme tint', 0, 0.9, 0.05],
    ];

    /** The CSS variable each slider drives on <html>; the seed has none. */
    const TUNING_VARS = {
        strength: ['--bd-strength', (v) => String(v)],
        scale: ['--bd-scale', (v) => String(v)],
        blur: ['--bd-blur', (v) => `${v}px`],
        brightness: ['--bd-brightness', (v) => String(v)],
        saturate: ['--bd-saturate', (v) => String(v)],
        tint: ['--bd-tint', (v) => String(v)],
    };

    const HEAD_PREVIEW_CLASS = 'config-pv-cat';

    function esc(config, value) {
        return config.dash.escapeHtml(String(value));
    }

    function tuningOf(config) {
        return { ...DEFAULT_TUNING, ...(config.dash.settings?.backdropTuning || {}) };
    }

    function formatTuning(key, value) {
        if (key === 'seed') return String(Math.round(value));
        if (key === 'blur') return `${Math.round(value)}px`;
        return Number(value).toFixed(2).replace(/0$/, '');
    }

    /** #rrggbb from a computed colour, or null when it is anything else. */
    function hexOf(value) {
        const v = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
    }

    function channels(hex) {
        return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }

    Object.assign(global.DashboardConfig.prototype, {

        /* ------------------------------------------------------------------ */
        /* Shared                                                             */
        /* ------------------------------------------------------------------ */

        /** The word a stored backdrop choice stands for here, for this theme. */
        backdropChoice() {
            const settings = this.dash.settings || {};
            const forced = String(settings.themeBackdrop || 'follow').toLowerCase();
            const own = settings.themeSurfacePrefs?.[this.currentThemeId()]?.backdrop;
            if (forced !== 'follow' && forced !== 'on') return forced;
            return own || 'follow';
        },

        /** Store a backdrop choice where the scope says it belongs, and draw it. */
        setBackdropChoice(value) {
            const settings = this.dash.settings;
            if (!settings) return;
            if (this.surfaceScope() === 'global') {
                settings.themeBackdrop = value;
            } else {
                // Same reasoning as setSurface: a forced value would outrank
                // the per-theme one and the control would look dead.
                settings.themeBackdrop = 'follow';
                const prefs = settings.themeSurfacePrefs || (settings.themeSurfacePrefs = {});
                const entry = prefs[this.currentThemeId()] || (prefs[this.currentThemeId()] = {});
                if (value === 'follow') {
                    delete entry.backdrop;
                    if (!Object.keys(entry).length) delete prefs[this.currentThemeId()];
                } else {
                    entry.backdrop = value;
                }
            }
            void this.applyResolvedSurfaces();
            this.persistAppearance();
        },

        /** Surface metadata for the theme on screen: what "follow" stands for. */
        themeOwnSurfaces() {
            return window.ThemeLoader?.surfaceMetaFor?.(this.displayTheme()) || {};
        },

        /* ------------------------------------------------------------------ */
        /* Background tab                                                     */
        /* ------------------------------------------------------------------ */

        renderAppearanceBackgroundBody() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const s = this.dash.settings || {};

            // --- the source: the background drawn over the backdrop ---
            const bgType = s.backgroundType || 'none';
            const bgTypes = [
                ['auto', t('config.backgroundAuto', 'Auto')],
                ['none', t('config.backgroundNone', 'None')],
                ['gradient', t('config.backgroundGradient', 'Gradient')],
                ['image', t('config.backgroundImage', 'Image')],
            ];
            const bgChoices = bgTypes.map(([val, label]) =>
                `<button type="button" class="config-choice${bgType === val ? ' is-active' : ''}" data-appearance-bg="${e(val)}" aria-pressed="${bgType === val}">${e(label)}</button>`).join('');
            const opacity = window.VisualSettings?.clampBackgroundOpacity
                ? window.VisualSettings.clampBackgroundOpacity(s.backgroundOpacity)
                : (Number.isFinite(Number(s.backgroundOpacity)) ? Number(s.backgroundOpacity) : 1);
            const presets = window.VisualSettings?.BACKGROUND_PRESETS || {};
            const activeGradient = s.backgroundGradient || '';
            const swatches = Object.entries(presets).map(([name, css]) =>
                `<button type="button" class="config-bg-swatch${activeGradient === name ? ' is-active' : ''}"
                         data-appearance-gradient="${e(name)}" style="background:${e(css)}"
                         aria-pressed="${activeGradient === name}"
                         aria-label="${e(t(`config.backgroundPreset.${name}`, name))}"
                         title="${e(t(`config.backgroundPreset.${name}`, name))}"></button>`).join('');
            const detail = bgType === 'auto'
                ? `<p class="config-field-hint">${e(t('config.backgroundAutoHint', 'A gradient matched to your active theme.'))}</p>`
                : bgType === 'gradient'
                    ? `<div class="config-field">
                           <span class="config-field-label">${e(t('config.backgroundGradientLabel', 'Gradient'))}</span>
                           <div class="config-bg-swatches" role="group">${swatches}</div>
                           <p class="config-field-hint">${e(t('config.backgroundGradientHint', 'Thirteen presets, from dark to light. Pair a light gradient with a light theme.'))}</p>
                       </div>`
                    : bgType === 'image'
                        ? `<div class="config-field">
                               <span class="config-field-label">${e(t('config.backgroundImageUrlLabel', 'Image URL'))}</span>
                               <input type="url" class="config-text" data-appearance-text="backgroundImageUrl"
                                      value="${e(s.backgroundImageUrl || '')}" placeholder="https://example.com/image.jpg">
                               <p class="config-field-hint">${e(t('config.backgroundImageUrlHint', 'A direct link to an image file. Lower the opacity below if it makes the bookmarks hard to read.'))}</p>
                           </div>`
                        : '';

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${e(t('config.appearanceBackgroundTitle', 'Background'))}</h3>
                    <p class="config-panel-note">${e(t('config.appearanceBackgroundNote', 'What sits behind the bookmarks. Auto follows your theme; Gradient and Image let you choose your own, and opacity fades it back so the text stays readable. It is drawn over the backdrop below.'))}</p>
                    <div class="config-field">
                        <span class="config-field-label">${e(t('config.backgroundLabel', 'Source'))}</span>
                        <div class="config-choices" role="group">${bgChoices}</div>
                        ${this.appearanceAff('backgroundType')}
                    </div>
                    ${detail}
                    <div class="config-field">
                        <span class="config-field-label">${e(t('config.backgroundOpacityLabel', 'Opacity'))}</span>
                        <input type="range" class="config-range" data-appearance-range="backgroundOpacity" min="0.65" max="1" step="0.05" value="${opacity}">
                        <span class="config-range-value">${Math.round(opacity * 100)}%</span>
                        ${this.appearanceAff('backgroundOpacity')}
                    </div>
                </div>
                ${this.renderBackdropPanel()}
                ${this.renderBackdropTuningPanel()}
                ${this.renderPatternPanel()}`;
        },

        /** The pattern drawn over the backdrop; on the Background tab and in the theme browser. */
        renderPatternPanel() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const current = this.dash.settings?.backgroundPattern || 'auto';
            const patterns = [['auto', 'Follow the theme'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Lines'], ['hatch', 'Hatch'], ['none', 'None']];
            const options = patterns.map(([option, label]) =>
                `<option value="${option}"${current === option ? ' selected' : ''}>${e(t('config.backgroundPattern' + option.charAt(0).toUpperCase() + option.slice(1), label))}</option>`).join('');
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${e(t('config.appearancePatternTitle', 'Pattern'))}</h3>
                    <div class="config-field">
                        <span class="config-field-label">${e(t('config.backgroundPatternLabel', 'Pattern over it'))}</span>
                        <select class="config-select" data-appearance-select="backgroundPattern">${options}</select>
                        ${this.appearanceAff('backgroundPattern')}
                        <p class="config-panel-note">${e(t('config.backgroundPatternNote', 'A texture drawn over the backdrop. Left to the theme, there is none while a backdrop is shown; with the backdrop off, most themes ask for dots and a few for something that suits them. Pick one to draw it over anything. Lines and hatch cover more of the page than dots do.'))}</p>
                    </div>
                </div>`;
        },

        renderBackdropPanel() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const choice = this.backdropChoice();
            const mode = choice === 'off' ? 'off' : (choice === 'follow' || choice === 'on' ? 'follow' : 'pick');
            const own = this.themeOwnSurfaces();
            const modes = [
                ['follow', t('config.backdropFollow', 'Follow the theme')],
                ['pick', t('config.backdropPick', 'Choose one')],
                ['off', t('config.backdropOff', 'Off')],
            ];
            const seg = modes.map(([val, label]) =>
                `<button type="button" class="config-choice${mode === val ? ' is-active' : ''}" data-backdrop-mode="${val}" aria-pressed="${mode === val}">${e(label)}</button>`).join('');
            const scopeNote = this.surfaceScope() === 'global'
                ? t('config.backdropScopeGlobal', 'This holds for every theme.')
                : this._lookStudio
                    ? t('config.backdropScopeStudio', 'This belongs to the theme you are on. “Applies to” below makes it hold for every theme.')
                    : t('config.backdropScopeTheme', 'This belongs to the theme you are on. Tick “Use these for every theme” on the Surface tab to make it hold for all of them.');
            const followNote = own.backdrop
                ? t('config.backdropFollowNote', 'This theme draws “{recipe}”.').replace('{recipe}', own.backdrop)
                : '';
            return `
                <div class="config-panel" data-backdrop-panel>
                    <h3 class="config-panel-title">${e(t('config.appearanceBackdropTitle', 'Backdrop'))}</h3>
                    <p class="config-panel-note">${e(t('config.appearanceBackdropNote', 'What is behind the content, under your own background image.'))}</p>
                    <div class="config-field">
                        <span class="config-field-label">${e(t('config.themeBackdropLabel', 'Theme backdrop'))}</span>
                        <div class="config-choices" role="group">${seg}</div>
                        ${this.surfaceAff('themeBackdrop')}
                        ${mode === 'follow' && followNote ? `<p class="config-field-hint">${e(followNote)}</p>` : ''}
                        <p class="config-field-hint">${e(scopeNote)}</p>
                    </div>
                    ${mode === 'pick' ? `<div class="config-backdrop-grid" data-backdrop-grid role="group" aria-label="${e(t('config.backdropGridLabel', 'Backdrops'))}"></div>` : ''}
                </div>`;
        },

        renderBackdropTuningPanel() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const tuning = tuningOf(this);
            const rows = TUNING_SLIDERS.map(([key, labelKey, fallback, min, max, step]) => `
                <div class="config-field config-field--slider" data-tuning-row="${key}">
                    <span class="config-field-label">${e(t(labelKey, fallback))}</span>
                    <input type="range" class="config-range" data-backdrop-tuning="${key}" min="${min}" max="${max}" step="${step}" value="${tuning[key]}">
                    <span class="config-range-value" data-tuning-out="${key}">${e(formatTuning(key, tuning[key]))}</span>
                    ${key === 'seed' ? `<button type="button" class="config-btn config-btn--small" data-backdrop-roll aria-label="${e(t('config.backdropRoll', 'Roll a new variant'))}" title="${e(t('config.backdropRoll', 'Roll a new variant'))}">🎲</button>` : ''}
                    ${this.infoAff(`backdrop${key[0].toUpperCase()}${key.slice(1)}`)}
                </div>`).join('');
            return `
                <div class="config-panel" data-backdrop-tuning-panel>
                    <h3 class="config-panel-title">${e(t('config.backdropTuningTitle', 'Backdrop settings'))}</h3>
                    <p class="config-panel-note">${e(t('config.backdropTuningNote', 'Intensity, scale and variant change the theme’s backdrop. Blur, brightness, saturation and tint change it and your own background image alike.'))}</p>
                    ${rows}
                    <div class="config-field">
                        <button type="button" class="config-btn config-btn--field" data-backdrop-reset>${e(t('config.backdropTuningReset', 'Back to the defaults'))}</button>
                    </div>
                </div>`;
        },

        /** Paint the thumbnails of the recipes, in the colours of the theme on screen. */
        async paintBackdropGrid(container, seed) {
            const grid = container.querySelector('[data-backdrop-grid]');
            if (!grid) return;
            const query = Number.isInteger(seed) ? `?seed=${seed}` : '';
            let data = null;
            try {
                const res = await fetch(`/api/themes/backdrops${query}`);
                data = res.ok ? await res.json() : null;
            } catch (_) { /* the grid stays empty, which says so */ }
            if (!data || !grid.isConnected) return;
            const chosen = this.backdropChoice();
            const ownRecipe = this.themeOwnSurfaces().backdrop || '';
            grid.innerHTML = data.recipes.map((name) => {
                const look = data.looks[name];
                const isOwn = name === ownRecipe;
                return `<button type="button" class="config-backdrop-thumb${chosen === name ? ' is-active' : ''}" data-backdrop-recipe="${esc(this, name)}" aria-pressed="${chosen === name}">
                    <span class="config-backdrop-sw" style="--bd-scale:0.5;--bd-strength:1;background-image:${look.image};background-size:${look.size};background-position:${look.position}"></span>
                    <span class="config-backdrop-name">${esc(this, name)}${isOwn ? ` <em>${esc(this, this.t('config.backdropThemeMark', 'theme'))}</em>` : ''}</span>
                </button>`;
            }).join('');
        },

        /**
         * The theme editor's backdrop row: Automatic and every recipe. The
         * theme being edited is previewed on the page, so the tiles are drawn
         * in its own colours.
         */
        async paintThemeBackdropTiles(container, theme) {
            const grid = container.querySelector('[data-theme-backdrops]');
            if (!grid) return;
            let data = null;
            try {
                const res = await fetch('/api/themes/backdrops');
                data = res.ok ? await res.json() : null;
            } catch (_) { /* the row stays empty */ }
            if (!data || !grid.isConnected) return;
            const current = String(theme?.backdrop || '');
            const tile = (name, label, look) => `<button type="button" class="config-backdrop-thumb${current === name ? ' is-active' : ''}" data-theme-backdrop-tile="${esc(this, name)}" aria-pressed="${current === name}">
                    <span class="config-backdrop-sw"${look ? ` style="--bd-scale:0.5;--bd-strength:1;background-image:${look.image};background-size:${look.size};background-position:${look.position}"` : ''}></span>
                    <span class="config-backdrop-name">${esc(this, label)}</span>
                </button>`;
            grid.innerHTML = tile('', this.t('config.themeCharAuto', 'Automatic'), null)
                + data.recipes.map((name) => tile(name, name, data.looks[name])).join('');
        },

        /* ------------------------------------------------------------------ */
        /* Surface tab                                                        */
        /* ------------------------------------------------------------------ */

        renderAppearanceSurfaceBody() {
            return `
                ${this.renderSurfacesPanel()}
                ${this.renderSurfaceScopePanel()}
                ${this.renderCardGlassPanel()}`;
        },

        /** Depth, Glow and Effects; on the Surface tab and in the theme browser. */
        renderSurfacesPanel() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const cap = (o) => o.charAt(0).toUpperCase() + o.slice(1);
            const select = (field, labelKey, label, options, optionKey, noteKey, note) => `
                <div class="config-field">
                    <span class="config-field-label">${e(t(labelKey, label))}</span>
                    <select class="config-select" data-appearance-select="${field}">
                        <option value="follow"${this.surfaceSelectValue(field) === 'follow' ? ' selected' : ''}>${e(t('config.themeSurfacesFollow', 'Follow the theme'))}</option>
                        ${options.map(([option, text]) => `<option value="${option}"${this.surfaceSelectValue(field) === option ? ' selected' : ''}>${e(t(optionKey + cap(option), text))}</option>`).join('')}
                    </select>
                    ${this.surfaceAff(field)}
                    <p class="config-panel-note">${e(t(noteKey, note))}</p>
                </div>`;
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${e(t('config.appearanceSurfacesTitle', 'Surfaces'))}</h3>
                    <p class="config-panel-note">${e(t('config.appearanceSurfacesNote', 'How a theme is drawn, rather than which theme it is. Both apply to whichever one is on.'))}</p>
                    ${select('themeDepth', 'config.themeDepthLabel', 'Depth',
                        [['flat', 'Flat'], ['soft', 'Soft'], ['rich', 'Rich'], ['vivid', 'Vivid'], ['glass', 'Glass']], 'config.themeDepth',
                        'config.themeDepthNote', 'How much of the theme is drawn behind the content: the tint in its greys, the raised surfaces, the wash behind the page. Follow the theme lets each theme bring its own.')}
                    ${select('glowStrength', 'config.glowStrengthLabel', 'Glow',
                        [['soft', 'Soft'], ['full', 'Full'], ['off', 'Off']], 'config.glowStrength',
                        'config.glowStrengthNote', 'How far the theme’s own colour carries around a surface and around what you are acting on. Follow the theme lets each theme bring its own.')}
                    ${select('themeEffects', 'config.themeEffectsLabel', 'Effects',
                        [['full', 'Full'], ['held', 'Held back'], ['off', 'Off']], 'config.themeEffects',
                        'config.themeEffectsNote', 'How loudly a theme’s character is drawn: the shine on a lacquered surface, the glow around a neon one, the grain on a brushed one, and how round its corners are.')}
                </div>`;
        },

        /** "Use these for every theme"; the theme browser has it in its footer instead. */
        renderSurfaceScopePanel() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const s = this.dash.settings || {};
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${e(t('config.appearanceSurfaceScopeTitle', 'Whose surfaces these are'))}</h3>
                    <p class="config-panel-note">${e(t('config.appearanceSurfaceScopeNote', 'Depth, Glow, Effects, the backdrop and the card glass can belong to the theme you are on, or to every theme.'))}</p>
                    <div class="config-field-row">
                        <label class="config-toggle">
                            <input type="checkbox" data-appearance-toggle="themeSurfacesForceAll"${s.themeSurfacesForceAll ? ' checked' : ''}>
                            <span>${e(t('config.themeSurfacesForceAllLabel', 'Use these for every theme'))}</span>
                        </label>
                        ${this.appearanceAff('themeSurfacesForceAll')}
                    </div>
                    <div class="config-field">
                        <span class="config-field-label">${e(t('config.themeResetLabel', 'This theme'))}</span>
                        <button type="button" class="config-btn config-btn--field" data-appearance-action="reset-theme-surfaces">${e(t('config.themeResetToIdeal', 'Back to the theme’s own'))}</button>
                    </div>
                </div>`;
        },

        /** The glass numbers that apply now: this theme's own entry, or the forced one. */
        cardGlassEntry() {
            const settings = this.dash.settings || {};
            if (this.surfaceScope() === 'global') return settings.cardGlass || {};
            return settings.themeSurfacePrefs?.[this.currentThemeId()] || {};
        },

        renderCardGlassPanel() {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const entry = this.cardGlassEntry();
            const own = this.themeOwnSurfaces();
            const themeAlpha = Number(own.surfaceAlpha);
            const themeBlur = Number(own.surfaceBlur);
            const alpha = typeof entry.alpha === 'number' ? entry.alpha : (Number.isFinite(themeAlpha) ? themeAlpha : 1);
            const blur = typeof entry.blur === 'number' ? entry.blur : (Number.isFinite(themeBlur) ? themeBlur : 0);
            const isOwn = typeof entry.alpha === 'number' || typeof entry.blur === 'number';
            const depth = document.body?.getAttribute('data-depth');
            const seg = [['follow', t('config.glassFollow', 'Follow the theme')], ['own', t('config.glassOwn', 'Own')]].map(([val, label]) =>
                `<button type="button" class="config-choice${(isOwn ? 'own' : 'follow') === val ? ' is-active' : ''}" data-glass-mode="${val}" aria-pressed="${(isOwn ? 'own' : 'follow') === val}">${e(label)}</button>`).join('');
            return `
                <div class="config-panel" data-glass-panel>
                    <h3 class="config-panel-title">${e(t('config.cardGlassTitle', 'Card glass'))}</h3>
                    <p class="config-panel-note">${e(t('config.cardGlassNote', 'How solid a pane is and how far the page is blurred behind it. Panes are only panes at depth Glass, so this shows there.'))}</p>
                    ${depth === 'glass' ? '' : `
                    <div class="config-glass-hint" data-glass-depth-hint>
                        <p class="config-field-hint">${e(t('config.cardGlassDepthHint', 'The theme on screen is not drawn at depth Glass, so nothing changes until it is.'))}</p>
                        <button type="button" class="config-btn config-btn--small" data-glass-action="depth">${e(t('config.cardGlassUseGlass', 'Use depth Glass'))}</button>
                    </div>`}
                    ${this.renderCardGlassLayoutHint(isOwn)}
                    <div class="config-field">
                        <div class="config-choices" role="group">${seg}</div>
                        ${this.infoAff('cardGlassMode')}
                    </div>
                    <div class="config-field config-field--slider">
                        <span class="config-field-label">${e(t('config.cardGlassAlpha', 'Opacity'))}</span>
                        <input type="range" class="config-range" data-glass-range="alpha" min="0.2" max="1" step="0.05" value="${alpha}">
                        <span class="config-range-value" data-glass-out="alpha">${Math.round(alpha * 100)}%</span>
                        ${this.infoAff('cardGlassAlpha')}
                    </div>
                    <div class="config-field config-field--slider">
                        <span class="config-field-label">${e(t('config.cardGlassBlur', 'Blur'))}</span>
                        <input type="range" class="config-range" data-glass-range="blur" min="0" max="30" step="1" value="${blur}">
                        <span class="config-range-value" data-glass-out="blur">${Math.round(blur)}px</span>
                        ${this.infoAff('cardGlassBlur')}
                    </div>
                    <div class="config-field-row">
                        <label class="config-toggle">
                            <input type="checkbox" data-glass-border${entry.border === 'on' ? ' checked' : ''}>
                            <span>${e(t('config.cardGlassBorder', 'A thin edge round the panes'))}</span>
                        </label>
                        ${this.infoAff('cardGlassBorder')}
                    </div>
                    <div class="config-field">
                        <span class="config-field-label">${e(t('config.cardGlassContrast', 'Text on a pane'))}</span>
                        <span class="config-glass-badge" data-glass-contrast></span>
                        ${this.infoAff('cardGlassContrast')}
                    </div>
                </div>`;
        },

        /**
         * What the layout does with card glass, when that is not obvious.
         *
         * Cards and Widgets draw a pane round every category. Default, Compact
         * and Masonry only get one once the reader picks Own numbers, and
         * Terminal, List and Launcher have none at all; without saying so the
         * sliders looked broken.
         */
        renderCardGlassLayoutHint(isOwn) {
            const t = (k, f) => this.t(k, f);
            const e = (v) => esc(this, v);
            const preset = this.dash.settings?.layoutPreset || 'default';
            const presets = window.LayoutUtils?.getLayoutPresets?.()
                || ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets', 'launcher'];
            const name = (p) => t(`config.layoutPresetName.${p}`, p);
            const columns = ['default', 'compact', 'masonry'].includes(preset);
            let text = '';
            if (columns && !isOwn) {
                text = t('config.cardGlassLayoutOwnHint', 'Your layout ({layout}) draws no cards of its own. Choose Own to give each category a glass pane, or pick a layout with cards.');
            } else if (!columns && preset !== 'cards' && preset !== 'widgets') {
                text = t('config.cardGlassLayoutNoneHint', 'Your layout ({layout}) has no panes for glass to work on; only widgets change. Cards and Widgets draw one round every category.');
            }
            // The layout itself, so its effect on the glass can be seen at once.
            // In config it saves like any setting; in the theme browser it is
            // previewed with the look until Apply.
            return `
                ${text ? `<p class="config-field-hint" data-glass-layout-hint>${e(text.replace('{layout}', name(preset)))}</p>` : ''}
                <div class="config-field">
                    <span class="config-field-label">${e(t('config.layoutPresetLabelShort', 'Layout preset'))}</span>
                    <select class="config-select" data-glass-layout>
                        ${presets.map((p) => `<option value="${e(p)}"${p === preset ? ' selected' : ''}>${e(name(p))}</option>`).join('')}
                    </select>
                    ${this.infoAff('layoutPreset')}
                </div>`;
        },

        /**
         * Store one change to the card glass where the scope says it belongs.
         * `patch` holds alpha, blur and border; null takes an answer away.
         */
        setCardGlass(patch) {
            const settings = this.dash.settings;
            if (!settings) return;
            const apply = (entry) => {
                for (const [key, value] of Object.entries(patch)) {
                    if (value === null || value === '' || value === undefined) delete entry[key];
                    else entry[key] = value;
                }
                return entry;
            };
            if (this.surfaceScope() === 'global') {
                settings.cardGlass = apply({ ...(settings.cardGlass || {}) });
            } else {
                const prefs = settings.themeSurfacePrefs || (settings.themeSurfacePrefs = {});
                const id = this.currentThemeId();
                const entry = apply({ ...(prefs[id] || {}) });
                if (Object.keys(entry).length) prefs[id] = entry; else delete prefs[id];
            }
            void this.applyResolvedSurfaces();
        },

        /** The ratio of the text colour to a pane over the backdrop, as a badge. */
        paintGlassContrast(container) {
            const badge = container.querySelector('[data-glass-contrast]');
            if (!badge) return;
            const cs = getComputedStyle(document.documentElement);
            const bg = hexOf(cs.getPropertyValue('--background-primary'));
            const surface = hexOf(cs.getPropertyValue('--background-secondary')) || bg;
            const text = hexOf(cs.getPropertyValue('--text-primary'));
            const accent = hexOf(cs.getPropertyValue('--accent-primary')) || text;
            const ratioOf = window.ThemeBrowser?.contrastRatio;
            if (!bg || !surface || !text || !ratioOf) { badge.textContent = ''; return; }

            const entry = this.cardGlassEntry();
            const own = this.themeOwnSurfaces();
            const alpha = typeof entry.alpha === 'number' ? entry.alpha
                : (Number.isFinite(Number(own.surfaceAlpha)) ? Number(own.surfaceAlpha) : 1);
            const tuning = tuningOf(this);
            // The backdrop averages out to the page colour with a little of the
            // accent in it, scaled by how strong it is drawn; the sliders then
            // lighten, darken and tint it. Close enough to say whether text
            // survives, which is all the badge claims.
            const b = channels(bg);
            const a = channels(accent);
            const k = 0.12 * tuning.strength;
            let under = b.map((v, i) => (v * (1 - k) + a[i] * k) * tuning.brightness);
            under = under.map((v, i) => v * (1 - tuning.tint) + b[i] * tuning.tint);
            const card = channels(surface).map((v, i) => v * alpha + under[i] * (1 - alpha));
            const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
            const ratio = ratioOf(text, toHex(card));
            if (ratio === null) { badge.textContent = ''; return; }
            const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : this.t('config.cardGlassLow', 'low');
            badge.textContent = `${grade} · ${ratio.toFixed(1)}:1`;
            badge.dataset.grade = ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'warn' : 'bad';
        },

        /* ------------------------------------------------------------------ */
        /* Live application                                                   */
        /* ------------------------------------------------------------------ */

        /** Write the tuning to <html>; the seed is not a variable, see changeBackdropSeed. */
        applyBackdropTuning(tuning) {
            const root = document.documentElement;
            for (const [key, [name, fmt]] of Object.entries(TUNING_VARS)) {
                root.style.setProperty(name, fmt(tuning[key]));
            }
        },

        /** The seed lives in /api/theme.css: save it, then fetch that again. */
        async changeBackdropSeed(container, seed) {
            this.dash.settings.backdropTuning = { ...tuningOf(this), seed };
            await this.saveSettingsWithFeedback();
            this.reloadThemeCSS();
            void this.paintBackdropGrid(container, seed);
        },

        /* ------------------------------------------------------------------ */
        /* Binding                                                            */
        /* ------------------------------------------------------------------ */

        bindLookControls(container) {
            // "Follow the theme" is said in the theme's own numbers, which come
            // with the surface meta. It is usually in by now; when it is not,
            // draw once more as soon as it lands.
            const hasLookPanels = container.querySelector('[data-backdrop-panel], [data-glass-panel]');
            if (hasLookPanels && !window.ThemeLoader?.surfaceMetaFor?.(this.displayTheme()) && !this._lookMetaTried) {
                this._lookMetaTried = true;
                void window.ThemeLoader?.loadSurfaceMeta?.().then((meta) => {
                    if (meta) this.repaintAppearanceBody?.();
                });
            }
            container.querySelectorAll('[data-backdrop-mode]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const mode = btn.getAttribute('data-backdrop-mode');
                    if (mode === 'pick') {
                        const own = this.themeOwnSurfaces().backdrop;
                        this.setBackdropChoice(this._lastBackdropPick || own || 'mesh');
                    } else {
                        this.setBackdropChoice(mode);
                    }
                });
            });

            // The thumbnails are painted after the fetch comes back, so the
            // click is caught on the grid that holds them.
            container.querySelectorAll('[data-backdrop-grid]').forEach((grid) => {
                grid.addEventListener('click', (event) => {
                    const btn = event.target.closest('[data-backdrop-recipe]');
                    if (!btn) return;
                    this._lastBackdropPick = btn.getAttribute('data-backdrop-recipe');
                    this.setBackdropChoice(this._lastBackdropPick);
                });
            });
            if (container.querySelector('[data-backdrop-grid]')) {
                void this.paintBackdropGrid(container, tuningOf(this).seed);
            }

            // The sliders: live while dragging, saved when let go. The seed is
            // different: its roll lives in the stylesheet, so letting go saves
            // it and fetches /api/theme.css again.
            container.querySelectorAll('[data-backdrop-tuning]').forEach((input) => {
                const key = input.getAttribute('data-backdrop-tuning');
                const out = container.querySelector(`[data-tuning-out="${key}"]`);
                input.addEventListener('input', () => {
                    const value = Number(input.value);
                    if (out) out.textContent = formatTuning(key, value);
                    const tuning = { ...tuningOf(this), [key]: value };
                    this.dash.settings.backdropTuning = tuning;
                    if (key === 'seed') {
                        void this.paintBackdropGrid(container, value);
                    } else {
                        this.applyBackdropTuning(tuning);
                    }
                    this.paintGlassContrast(container);
                });
                input.addEventListener('change', () => {
                    if (key === 'seed') {
                        void this.changeBackdropSeed(container, Number(input.value));
                    } else {
                        void this.saveSettingsWithFeedback();
                    }
                });
            });
            const roll = container.querySelector('[data-backdrop-roll]');
            if (roll) {
                roll.addEventListener('click', () => {
                    const seed = 1 + Math.floor(Math.random() * 40);
                    const input = container.querySelector('[data-backdrop-tuning="seed"]');
                    if (input) input.value = String(seed);
                    const out = container.querySelector('[data-tuning-out="seed"]');
                    if (out) out.textContent = String(seed);
                    void this.changeBackdropSeed(container, seed);
                });
            }
            const reset = container.querySelector('[data-backdrop-reset]');
            if (reset) {
                reset.addEventListener('click', async () => {
                    const wasSeed = tuningOf(this).seed;
                    this.dash.settings.backdropTuning = { ...DEFAULT_TUNING };
                    this.applyBackdropTuning(DEFAULT_TUNING);
                    await this.saveSettingsWithFeedback();
                    if (wasSeed !== 0) this.reloadThemeCSS();
                    // In the theme browser the tab is drawn again by its own
                    // repaint; in config, the Background tab is.
                    if (this._lookStudio) {
                        this._lookStudio.ui?.repaint();
                        return;
                    }
                    const body = document.getElementById('config-appearance-body');
                    if (body) {
                        body.innerHTML = this.renderAppearanceBackgroundBody();
                        this.bindAppearanceControls(body);
                    }
                });
            }

            // The card glass.
            container.querySelectorAll('[data-glass-mode]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    if (btn.getAttribute('data-glass-mode') === 'follow') {
                        this.setCardGlass({ alpha: null, blur: null });
                    } else {
                        const own = this.themeOwnSurfaces();
                        const alpha = Number(own.surfaceAlpha);
                        const blur = Number(own.surfaceBlur);
                        this.setCardGlass({
                            alpha: Number.isFinite(alpha) ? alpha : 0.6,
                            blur: Number.isFinite(blur) ? blur : 12,
                        });
                    }
                    void this.persistAppearance();
                });
            });
            container.querySelectorAll('[data-glass-range]').forEach((input) => {
                const key = input.getAttribute('data-glass-range');
                const out = container.querySelector(`[data-glass-out="${key}"]`);
                input.addEventListener('input', () => {
                    const value = Number(input.value);
                    if (out) out.textContent = key === 'alpha' ? `${Math.round(value * 100)}%` : `${Math.round(value)}px`;
                    // Moving a slider is choosing an answer of your own, so the
                    // other one is pinned to what the theme has now.
                    const entry = this.cardGlassEntry();
                    const own = this.themeOwnSurfaces();
                    const other = key === 'alpha' ? 'blur' : 'alpha';
                    const otherValue = typeof entry[other] === 'number' ? entry[other]
                        : Number(other === 'alpha' ? own.surfaceAlpha : own.surfaceBlur);
                    this.setCardGlass({ [key]: value, [other]: Number.isFinite(otherValue) ? otherValue : null });
                    this.paintGlassContrast(container);
                });
                input.addEventListener('change', () => { void this.saveSettingsWithFeedback(); });
            });
            // The two ways out of "nothing changes": depth Glass for this theme
            // (through setSurface, so the scope decides where it lands), and the
            // layout. In the theme browser the layout is previewed with the rest
            // of the look, and Cancel puts it back.
            container.querySelectorAll('[data-glass-action]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    this.setSurface('themeDepth', 'glass');
                    // setSurface repaints before <body> says Glass, and the
                    // hint reads <body>: draw again once it does.
                    await this.applyResolvedSurfaces();
                    this.repaintAppearanceBody();
                });
            });
            const layout = container.querySelector('[data-glass-layout]');
            if (layout) {
                layout.addEventListener('change', async () => {
                    await this.setBehavior('layoutPreset', layout.value, 'chromeRender');
                    this.repaintAppearanceBody();
                    // The repaint replaced the select; keep the keyboard on it.
                    container.querySelector('[data-glass-layout]')?.focus();
                });
            }
            const border = container.querySelector('[data-glass-border]');
            if (border) {
                border.addEventListener('change', () => {
                    this.setCardGlass({ border: border.checked ? 'on' : null });
                    void this.saveSettingsWithFeedback();
                });
            }
            this.paintGlassContrast(container);
        },
    });
    global.DashboardConfigLookReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
