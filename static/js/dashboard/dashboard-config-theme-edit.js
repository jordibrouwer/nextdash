/**
 * The theme editor inside the look studio.
 *
 * The editor is Appearance's own (renderThemeColorEditor and its binders);
 * this file puts it on the studio's Themes tab and adds the one section the
 * studio gives it: the look a theme of the reader's own brings along. Colour
 * saves are held by saveColorsData while the studio is open, so everything
 * here previews and lands on Apply like the other tabs.
 */
(function (global) {
    'use strict';

    const copy = (value) => JSON.parse(JSON.stringify(value));

    Object.assign(global.DashboardConfig.prototype, {

        renderStudioThemeEditor(id) {
            this._themeSelected = id;
            const e = (v) => this.dash.escapeHtml(String(v));
            if (!this.themeById(id)) return '';
            return `
                <div class="look-studio-editor" data-studio-editor="${e(id)}">
                    <button type="button" class="theme-browser-chip look-studio-back" data-studio-edit-back>← ${e(this.t('config.studioTabThemes', 'Themes'))}</button>
                    ${this.renderThemeColorEditor(id, { studio: true })}
                    ${this.isCustomTheme(id) ? this.renderThemeLookSection(id) : ''}
                </div>`;
        },

        bindStudioThemeEditor(id, host) {
            this._themeSelected = id;
            this.bindThemeColorInputs(host);
            this.updateThemeContrastHint(id);
            // The other half of a pair opens in the same editor.
            host.querySelectorAll('[data-theme-pair] [data-theme-edit]').forEach((button) => {
                button.addEventListener('click', () => this._lookStudio?.ui?.edit?.(button.getAttribute('data-theme-edit')));
            });
            if (this.isCustomTheme(id)) this.bindThemeLookSection(id, host);
        },

        renderThemeLookSection(id) {
            const e = (v) => this.dash.escapeHtml(String(v));
            const look = this.themeLookOf(id);
            return `
                <div class="config-panel config-theme-look" data-theme-look-section>
                    <h3 class="config-panel-title">${e(this.t('config.themeLookTitle', 'This theme’s look'))}</h3>
                    <p class="config-panel-note">${e(this.t('config.themeLookNote', 'What the Looks tab sets: backdrop, card glass, depth, headers, type and spacing. Picking this theme brings it along.'))}</p>
                    <p class="config-theme-look-parts" data-theme-look-parts>${e(this.describeThemeLook(look))}</p>
                    <div class="config-actions">
                        <button type="button" class="config-btn" data-theme-look-take>${e(this.t('config.themeLookTake', 'Take the look on screen'))}</button>
                        <button type="button" class="config-btn" data-theme-look-clear ${look ? '' : 'disabled'}>${e(this.t('config.themeLookClear', 'Clear'))}</button>
                    </div>
                </div>`;
        },

        bindThemeLookSection(id, host) {
            const repaint = () => {
                const look = this.themeLookOf(id);
                const parts = host.querySelector('[data-theme-look-parts]');
                if (parts) parts.textContent = this.describeThemeLook(look);
                const clear = host.querySelector('[data-theme-look-clear]');
                if (clear) clear.disabled = !look;
            };
            host.querySelector('[data-theme-look-take]')?.addEventListener('click', () => {
                this.setThemeLook(id, this.currentLookAnswers());
                repaint();
            });
            host.querySelector('[data-theme-look-clear]')?.addEventListener('click', () => {
                this.setThemeLook(id, null);
                repaint();
            });
        },

        /**
         * The look on screen now, in the shape a theme stores: what a built-in
         * look sets, read from where the scope keeps it. "Follow the theme"
         * is left out, so the theme's own answer stands.
         */
        currentLookAnswers() {
            const s = this.dash.settings || {};
            const own = s.themeSurfacePrefs?.[this.currentThemeId()] || {};
            const glass = this.surfaceScope() === 'global' ? (s.cardGlass || {}) : own;
            const backdrop = this.backdropChoice();
            const depth = this.surfaceSelectValue('themeDepth');
            const look = {
                tuning: { ...(s.backdropTuning || {}) },
                heads: {
                    categoryHeaderStyle: s.categoryHeaderStyle,
                    categoryHeaderSize: s.categoryHeaderSize,
                    showCategoryIcon: s.showCategoryIcon,
                    showCategoryCount: s.showCategoryCount,
                    categoryHeaderAccentLine: s.categoryHeaderAccentLine,
                },
                text: { fontPreset: s.fontPreset, densityMode: s.densityMode, categorySpacing: s.categorySpacing },
            };
            if (backdrop && backdrop !== 'follow' && backdrop !== 'on') look.backdrop = backdrop;
            if (depth && depth !== 'follow') look.depth = depth;
            const g = {};
            if (glass.alpha != null) g.alpha = glass.alpha;
            if (glass.blur != null) g.blur = glass.blur;
            if (glass.border) g.border = glass.border;
            if (Object.keys(g).length) look.glass = g;
            return copy(look);
        },

        /** A theme's look, written to both halves of its pair. */
        setThemeLook(id, look) {
            const data = this._colorsData;
            if (!data?.custom?.[id]) return;
            const other = this.themePairOf(id).other;
            [id, other].filter((x) => x && data.custom[x]).forEach((x) => {
                if (look) data.custom[x].look = copy(look);
                else delete data.custom[x].look;
            });
            void this.saveColorsData();
        },

        /** One line naming what a stored look holds; every part is optional. */
        describeThemeLook(look) {
            const t = (k, f) => this.t(k, f);
            if (!look) return t('config.themeLookNone', 'None yet: picking this theme leaves your look as it is.');
            const parts = [];
            if (look.backdrop === 'off') parts.push(t('config.lookPartNoBackdrop', 'No backdrop'));
            else if (look.backdrop) parts.push(t('config.lookPartBackdrop', 'Backdrop {recipe}').replace('{recipe}', look.backdrop));
            if (look.glass?.alpha != null) {
                parts.push((look.glass.alpha >= 1
                    ? t('config.lookPartSolid', 'Solid cards')
                    : t('config.lookPartGlass', 'Glass {alpha}%, blur {blur}')
                        .replace('{alpha}', String(Math.round(look.glass.alpha * 100)))
                        .replace('{blur}', String(look.glass.blur ?? 0)))
                    + (look.glass.border === 'on' ? t('config.lookPartEdge', ', edged') : ''));
            }
            const style = look.heads?.categoryHeaderStyle;
            if (style && style !== 'theme') {
                const name = {
                    clean: t('config.categoryHeaderClean', 'Clean'),
                    underlined: t('config.categoryHeaderUnderlined', 'Underlined'),
                    boxed: t('config.categoryHeaderBoxed', 'Boxed'),
                    label: t('config.categoryHeaderLabel', 'Label'),
                    group: t('config.categoryHeaderGroupCard', 'Group card'),
                }[style] || style;
                parts.push(t('config.lookPartHeaders', '{style} headers').replace('{style}', name)
                    + (look.heads.showCategoryCount ? t('config.lookPartCount', ' with counts') : ''));
            }
            if (look.text?.fontPreset) parts.push(this.fontPresetLabel(look.text.fontPreset));
            return parts.join(' · ') || t('config.themeLookSome', 'Backdrop sliders and spacing');
        },

        studioColorsDirty() {
            return Boolean(this._lookStudio?.colorsHeld);
        },
    });
    global.DashboardConfigThemeEditReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
