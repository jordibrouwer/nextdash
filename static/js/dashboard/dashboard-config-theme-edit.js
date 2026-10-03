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

        /**
         * Save as theme…: a dialog over the panel. The new theme is saved at
         * once, picked like any card (stored on Apply), and opened in the editor.
         */
        openSaveAsThemeDialog() {
            const studio = this._lookStudio;
            const host = document.querySelector('[data-look-studio]');
            if (!studio || !host) return;
            const e = (v) => this.dash.escapeHtml(String(v));
            const current = this.dash.settings.theme || 'dark';
            const theme = this.themeById(current) || {};
            const taken = Object.values(this._colorsData?.custom || {}).map((t) => t.name);
            const base = this.themeDisplayName(current, theme.name || '').replace(/\s*\[(dark|light)\]\s*$/i, '');
            const name = global.DashboardConfig.uniqueNameFrom(
                this.t('config.saveThemeDefaultName', '{name} — mine').replace('{name}', base), taken);
            const pair = this.realOtherHalf(current);
            const other = this.halfOf(current) === 'light' ? 'dark' : 'light';
            host.querySelector('[data-save-theme-dialog]')?.remove();
            host.insertAdjacentHTML('beforeend', `
                <div class="look-studio-dialog" data-save-theme-dialog data-studio-dialog role="dialog" aria-modal="true" aria-labelledby="save-theme-title">
                    <div class="look-studio-dialog-box">
                        <h3 id="save-theme-title">${e(this.t('config.saveThemeTitle', 'Save as a theme of your own'))}</h3>
                        <input type="text" class="config-text" data-save-theme-name value="${e(name)}" aria-label="${e(this.t('config.saveThemeName', 'Name'))}">
                        <label class="look-studio-check"><input type="checkbox" data-save-theme-look checked>
                            <span>${e(this.t('config.saveThemeWithLook', 'Bring this look along'))}<small>${e(this.describeThemeLook(this.currentLookAnswers()))}</small></span></label>
                        <label class="look-studio-check"><input type="checkbox" data-save-theme-pair ${pair ? 'checked' : ''}>
                            <span>${e(other === 'light'
                                ? this.t('config.saveThemeWithPairLight', 'Make the light half too')
                                : this.t('config.saveThemeWithPairDark', 'Make the dark half too'))}</span></label>
                        <p class="config-field-warning" data-save-theme-error hidden></p>
                        <div class="look-studio-dialog-actions">
                            <button type="button" class="look-studio-btn" data-save-theme-cancel>${e(this.t('config.studioCancel', 'Cancel'))}</button>
                            <button type="button" class="look-studio-btn look-studio-btn--primary" data-save-theme-submit>${e(this.t('config.saveThemeSubmit', 'Save and edit'))}</button>
                        </div>
                    </div>
                </div>`);
            const dialog = host.querySelector('[data-save-theme-dialog]');
            const opener = host.querySelector('[data-studio-save-theme]');
            const close = () => {
                dialog.remove();
                opener?.focus();
            };
            const submit = dialog.querySelector('[data-save-theme-submit]');
            dialog.querySelector('[data-save-theme-cancel]').addEventListener('click', close);
            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                } else if (event.key === 'Enter' && event.target.matches('[data-save-theme-name]')) {
                    event.preventDefault();
                    submit.click();
                }
            });
            submit.addEventListener('click', async () => {
                submit.disabled = true;
                const id = await this.saveCurrentAsTheme({
                    name: dialog.querySelector('[data-save-theme-name]').value.trim() || name,
                    withLook: dialog.querySelector('[data-save-theme-look]').checked,
                    withPair: dialog.querySelector('[data-save-theme-pair]').checked,
                });
                if (!id) {
                    submit.disabled = false;
                    const err = dialog.querySelector('[data-save-theme-error]');
                    err.hidden = false;
                    err.textContent = this.t('config.saveThemeFailed', 'The theme could not be saved. Try again.');
                    return;
                }
                dialog.remove();
            });
            const field = dialog.querySelector('[data-save-theme-name]');
            field.focus();
            field.select();
        },

        /** Which half a theme is, from its id or else its background. */
        halfOf(id) {
            const m = String(id || '').match(/-(dark|light)$/);
            if (m) return m[1];
            if (id === 'light' || id === 'dark') return id;
            const lum = window.ColorValueUtils?.relativeLuminance?.(String(this.themeById(id)?.backgroundPrimary || '').trim());
            return lum != null && lum >= 0.4 ? 'light' : 'dark';
        },

        /** The other half of a theme when one exists, packaged or the reader's own. */
        realOtherHalf(id) {
            const m = String(id || '').match(/^(.*)-(dark|light)$/);
            if (m) {
                const other = `${m[1]}-${m[2] === 'dark' ? 'light' : 'dark'}`;
                return this.themeById(other) ? other : null;
            }
            if (id === 'light' || id === 'dark') return id === 'light' ? 'dark' : 'light';
            return null;
        },

        /**
         * The theme on screen as a new theme of the reader's own: its colours
         * (a recolour included) and character, and the look when asked. The
         * other half comes from the theme's real other half when it has one,
         * else from makeThemePair. Posted now, from the snapshot plus what is
         * new, so colour edits made in the studio stay held until Apply.
         */
        async saveCurrentAsTheme({ name, withLook, withPair }) {
            const studio = this._lookStudio;
            const data = this._colorsData;
            if (!studio || !data) return null;
            if (!data.custom) data.custom = {};
            const current = this.dash.settings.theme || 'dark';
            const fresh = (sourceId, themeName) => {
                const theme = copy(this.themeById(sourceId) || data.dark || {});
                // The collection is the set a packaged theme ships in, and a
                // look is the reader's own to give.
                delete theme.collection;
                delete theme.look;
                theme.name = themeName;
                if (withLook) theme.look = this.currentLookAnswers();
                // A built-in's backdrop is mostly chosen by its id; the copy has
                // a new one, and drew another recipe than the one on screen.
                if (!theme.backdrop) theme.backdrop = this.themeBackdropOf?.(sourceId) || theme.backdrop;
                return theme;
            };
            const wasHeld = studio.colorsHeld;
            const before = new Set(Object.keys(data.custom));
            const half = this.halfOf(current);
            const pair = withPair ? this.realOtherHalf(current) : null;
            let ownId;
            if (pair) {
                const base = global.DashboardConfig.newThemeId();
                const other = half === 'dark' ? 'light' : 'dark';
                ownId = `${base}-${half}`;
                data.custom[ownId] = fresh(current, `${name} [${half}]`);
                data.custom[`${base}-${other}`] = fresh(pair, `${name} [${other}]`);
            } else {
                ownId = global.DashboardConfig.newThemeId();
                data.custom[ownId] = fresh(current, name);
                if (withPair) {
                    await this.makeThemePair(ownId);
                    ownId = this._themeSelected || ownId;
                }
            }
            const added = Object.keys(data.custom).filter((k) => !before.has(k));
            const body = copy(studio.colorsBefore || data);
            body.custom = body.custom || {};
            added.forEach((k) => { body.custom[k] = copy(data.custom[k]); });

            studio.colorsPosting = true;
            let ok = false;
            try {
                const res = await this.writeFetch('/api/colors', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                });
                ok = res.ok;
            } catch (_) { ok = false; }
            studio.colorsPosting = false;
            studio.colorsHeld = wasHeld;
            if (!ok) {
                added.forEach((k) => { delete data.custom[k]; });
                this.syncCustomThemeIds?.();
                return null;
            }
            studio.colorsBefore = body;
            this.syncCustomThemeIds?.();
            this.reloadThemeCSS?.();
            this._themeList = null;
            this._themeMeta = null;
            // ThemeLoader's copy too: the new id was missing from it, and the
            // glass panes vanished the moment the editor opened on it.
            await window.ThemeLoader?.refreshSurfaceMeta?.();
            const meta = await this.loadThemeMeta();
            const palettes = {};
            added.forEach((k) => { palettes[k] = data.custom[k]; });
            studio.ui?.setPalettes?.(palettes, meta);
            studio.ui?.edit?.(ownId);
            return ownId;
        },

        studioColorsDirty() {
            return Boolean(this._lookStudio?.colorsHeld);
        },
    });
    global.DashboardConfigThemeEditReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
