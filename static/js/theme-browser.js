/**
 * The theme browser.
 *
 * There are 214 built-in themes. The picker they arrived through is a listbox of
 * 214 lines of text, sorted alphabetically — which puts "City Lights [dark]"
 * twenty positions away from its own light half, gives no clue what any of them
 * look like, and cannot be searched. At that size a list is not navigation.
 *
 * So this is a grid instead, and it groups. One card per family with a
 * light/dark switch on it turns 214 items into 107 and makes visible the
 * pairing that Follow system dark mode already relies on — a family is exactly
 * what getPairedThemeVariant swaps between.
 *
 * What it deliberately does NOT reimplement is the preview. The config view
 * already previews a theme on the real dashboard and puts the old one back if
 * you leave without choosing. That logic is handed in as callbacks: this file
 * decides what you are looking at, not what gets applied.
 *
 * Since the look studio it is a panel docked beside the dashboard, with tabs
 * for the backdrop, the surfaces, the category headers and whole looks. The
 * config view draws those tabs from the Appearance controls it already has, so
 * the two cannot drift apart; everything changes live, and Apply stores it in
 * one save.
 */
(function (global) {
    'use strict';

    const SEGMENTS = ['all', 'favorites', 'light', 'dark'];

    /*
     * The archetypes, as their own row of chips.
     *
     * `gloss` used to be a fifth segment beside light and dark, and it tested
     * `sheen > 0`. Once every theme has a character that test matches almost
     * everything and stops distinguishing anything -- so Gloss becomes one
     * chip among twelve, and the row grows with the catalogue rather than
     * needing a segment per kind. Filled from /api/themes/meta, so the server
     * stays the only place the list is written down.
     */
    let ARCHETYPES = [];
    // The collections, in the order the server lists them. A theme names its own.
    let COLLECTIONS = [];
    const FAVORITE_LIMIT = 24;

    /* ── Reading a palette ─────────────────────────────────────────────── */

    function channels(hex) {
        const value = String(hex || '').trim();
        if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
        return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    }

    function luminance(hex) {
        const c = channels(hex);
        if (!c) return null;
        const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }

    function contrastRatio(a, b) {
        const la = luminance(a);
        const lb = luminance(b);
        if (la === null || lb === null) return null;
        const [hi, lo] = la > lb ? [la, lb] : [lb, la];
        return (hi + 0.05) / (lo + 0.05);
    }

    function saturation(hex) {
        const c = channels(hex);
        if (!c) return null;
        const max = Math.max(...c);
        const min = Math.min(...c);
        if (max === min) return 0;
        const l = (max + min) / 2;
        return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    }

    /**
     * Two or three words about a theme, worked out from its own colours.
     *
     * Written descriptions for 214 themes in four languages is 856 pieces of
     * copy, and forty good sentences beside a hundred and seventy of "A dark
     * theme" reads worse than none at all. These cost nothing per theme and are
     * translated once, which also makes the search box useful: "cool", "high
     * contrast" and "muted" are things people actually want to filter on.
     *
     * A written line can still be added later — this leaves room for it rather
     * than standing in its way.
     */
    function deriveTraits(palette, t) {
        const traits = [];
        const bg = channels(palette.backgroundPrimary);
        if (bg) {
            const warmth = bg[0] - bg[2];
            if (warmth > 0.03) traits.push(t('config.themeTraitWarm', 'warm'));
            else if (warmth < -0.03) traits.push(t('config.themeTraitCool', 'cool'));
            else traits.push(t('config.themeTraitNeutral', 'neutral'));
        }
        const ratio = contrastRatio(palette.textPrimary, palette.backgroundPrimary);
        if (ratio !== null) {
            if (ratio >= 12) traits.push(t('config.themeTraitHighContrast', 'high contrast'));
            else if (ratio < 7) traits.push(t('config.themeTraitSoftContrast', 'soft contrast'));
        }
        const sat = saturation(palette.accentPrimary || palette.accentSuccess);
        if (sat !== null) {
            if (sat >= 0.6) traits.push(t('config.themeTraitVivid', 'vivid'));
            else if (sat < 0.32) traits.push(t('config.themeTraitMuted', 'muted'));
        }
        return traits;
    }

    /* ── What the server says about a theme ────────────────────────────
       meta.themes[id] carries the archetype, the written line and the
       surfaces the theme was drawn for. Absent for a custom theme, and absent
       altogether until the fetch lands, so every reader of it copes with
       nothing being there. */
    let META = { themes: {} };

    /**
     * The name an archetype goes by on screen.
     *
     * Translated like every other label, and falling back to the word itself
     * capitalised -- an archetype added to the server before the locale files
     * catch up should read as "Velvet", not as a missing key.
     */
    function archetypeLabel(name, t) {
        const key = `config.themeArchetype.${name}`;
        const fallback = name.charAt(0).toUpperCase() + name.slice(1);
        return t(key, fallback);
    }

    function metaFor(id) {
        return (META.themes && META.themes[id]) || {};
    }

    /** The archetype a theme belongs to, or '' for one that names none. */
    function characterOf(id) {
        return String(metaFor(id).character || '');
    }

    /** The collection a theme belongs to, or '' for one in none. */
    function collectionOf(id) {
        return String(metaFor(id).collection || '');
    }

    /** The name a collection goes by on screen, capitalised when no locale says it. */
    function collectionLabel(name, t) {
        const fallback = name.charAt(0).toUpperCase() + name.slice(1);
        return t(`config.themeCollection.${name}`, fallback);
    }

    /* ── Grouping ──────────────────────────────────────────────────────── */

    /**
     * A family is a theme id without its -dark or -light half.
     *
     * The same split getPairedThemeVariant makes, on purpose: if the two ever
     * disagree, the browser would offer a switch that lands somewhere the auto
     * pairing would not.
     */
    function familyOf(id) {
        if (id === 'light' || id === 'dark') return '__default';
        const match = String(id).match(/^(.*)-(dark|light)$/);
        return match ? match[1] : id;
    }

    function variantOf(id) {
        if (id === 'light' || id === 'dark') return id;
        const match = String(id).match(/^(.*)-(dark|light)$/);
        return match ? match[2] : '';
    }

    /** Strips the "[dark]" the stored name carries, since the card shows it. */
    function familyLabel(name) {
        return String(name || '').replace(/\s*\[(dark|light)\]\s*$/i, '').trim();
    }

    function buildFamilies(palettes, displayName) {
        const families = new Map();
        Object.keys(palettes).forEach((id) => {
            const palette = palettes[id];
            if (!palette) return;
            const key = familyOf(id);
            const variant = variantOf(id) || 'dark';
            if (!families.has(key)) {
                families.set(key, { key, label: '', variants: {} });
            }
            const family = families.get(key);
            family.variants[variant] = { id, palette };
            const label = familyLabel(displayName(id, palette.name));
            if (label && (!family.label || variant === 'dark')) {
                family.label = label;
            }
        });
        return Array.from(families.values())
            .filter((f) => f.variants.dark || f.variants.light)
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    }

    /* ── Rendering ─────────────────────────────────────────────────────── */

    const escapeHtml = window.NextDashHtml.escapeHtml;

    function swatches(palette) {
        const stops = [
            palette.backgroundPrimary,
            palette.backgroundSecondary,
            palette.textPrimary,
            palette.accentPrimary || palette.accentSuccess,
            palette.accentWarning,
            palette.accentError,
        ];
        return stops
            .filter(Boolean)
            .map((colour) => `<span class="theme-browser-swatch" style="background:${escapeHtml(colour)}"></span>`)
            .join('');
    }

    function renderCard(family, state, t) {
        const shown = family.variants[state.variantFor(family.key)] || family.variants.dark || family.variants.light;
        const id = shown.id;
        const traits = deriveTraits(shown.palette, t).join(' · ');
        const isCurrent = id === state.current;
        const isFavorite = state.favorites.includes(id);
        const hasBoth = Boolean(family.variants.dark && family.variants.light);
        const variant = variantOf(id) || 'dark';
        const character = characterOf(id);
        const description = metaFor(id).description || '';
        const isNew = metaFor(id).new === true;

        return `
            <div class="theme-browser-card${isCurrent ? ' is-current' : ''}${character ? ` is-${character}` : ''}"
                 role="option" tabindex="-1"
                 aria-selected="${isCurrent}"
                 data-theme-card="${escapeHtml(family.key)}"
                 data-theme-id="${escapeHtml(id)}">
                <div class="theme-browser-swatches" aria-hidden="true">${swatches(shown.palette)}</div>
                <div class="theme-browser-card-head">
                    <span class="theme-browser-card-name">${escapeHtml(family.label || id)}</span>
                    ${character ? `<span class="theme-browser-badge" data-theme-badge="${escapeHtml(character)}">${escapeHtml(archetypeLabel(character, t))}</span>` : ''}
                    ${isNew ? `<span class="theme-browser-badge theme-browser-badge--new" data-theme-new>${escapeHtml(t('config.themeNew', 'new'))}</span>` : ''}
                    <button type="button" class="theme-browser-star${isFavorite ? ' is-on' : ''}"
                            data-theme-favorite="${escapeHtml(id)}"
                            aria-pressed="${isFavorite}"
                            title="${escapeHtml(t('config.themeFavorite', 'Favourite'))}">★</button>
                </div>
                ${description ? `<p class="theme-browser-card-line">${escapeHtml(description)}</p>` : ''}
                ${traits ? `<p class="theme-browser-card-traits">${escapeHtml(traits)}</p>` : ''}
                <div class="theme-browser-card-foot">
                    ${hasBoth ? `
                        <span class="theme-browser-variants" role="group">
                            <button type="button" class="theme-browser-variant${variant === 'light' ? ' is-on' : ''}"
                                    data-theme-variant="light" data-theme-family="${escapeHtml(family.key)}"
                                    aria-pressed="${variant === 'light'}">${escapeHtml(t('config.themeLight', 'Light'))}</button>
                            <button type="button" class="theme-browser-variant${variant === 'dark' ? ' is-on' : ''}"
                                    data-theme-variant="dark" data-theme-family="${escapeHtml(family.key)}"
                                    aria-pressed="${variant === 'dark'}">${escapeHtml(t('config.themeDark', 'Dark'))}</button>
                        </span>` : `<span class="theme-browser-single">${escapeHtml(variant)}</span>`}
                    ${isCurrent ? `<span class="theme-browser-current">${escapeHtml(t('config.themeInUse', 'in use'))}</span>` : ''}
                </div>
            </div>`;
    }

    function matches(family, state, t) {
        const shown = family.variants[state.variantFor(family.key)] || family.variants.dark || family.variants.light;
        if (state.segment === 'favorites') {
            const ids = Object.values(family.variants).map((v) => v.id);
            if (!ids.some((id) => state.favorites.includes(id))) return false;
        }
        if (state.segment === 'light' && !family.variants.light) return false;
        if (state.segment === 'dark' && !family.variants.dark) return false;
        if (state.archetype
            && !Object.values(family.variants).some((v) => characterOf(v.id) === state.archetype)) {
            return false;
        }
        if (state.collection
            && !Object.values(family.variants).some((v) => collectionOf(v.id) === state.collection)) {
            return false;
        }
        const query = state.query.trim().toLowerCase();
        if (!query) return true;
        // The archetype goes in twice, as its own word and as its translated
        // label, so `velvet` and `fluweel` both narrow the grid. The written
        // line goes in whole: it is the only place a theme says "harbour" or
        // "phosphor", which is what people actually type.
        // The latest collection answers to `new`, in English and in the
        // reader's language, like the archetype does.
        const character = characterOf(shown.id);
        const isNew = metaFor(shown.id).new === true;
        const haystack = [family.label, family.key, deriveTraits(shown.palette, t).join(' '),
            character, character ? archetypeLabel(character, t) : '',
            metaFor(shown.id).description || '',
            isNew ? `new ${t('config.themeNew', 'new')}` : '']
            .join(' ')
            .toLowerCase();
        return query.split(/\s+/).every((word) => haystack.includes(word));
    }

    function renderBody(families, state, t) {
        const visible = families.filter((f) => matches(f, state, t));
        const cards = visible.map((f) => renderCard(f, state, t)).join('');
        const chipButton = (name, label, st) =>
            `<button type="button" class="theme-browser-chip${st.archetype === name ? ' is-on' : ''}"
                     data-theme-character="${escapeHtml(name)}"
                     aria-pressed="${st.archetype === name}">${escapeHtml(label)}</button>`;
        const collectionButton = (name, label, st) =>
            `<button type="button" class="theme-browser-chip${st.collection === name ? ' is-on' : ''}"
                     data-theme-collection="${escapeHtml(name)}"
                     aria-pressed="${st.collection === name}">${escapeHtml(label)}</button>`;
        const segmentButton = (key, label) =>
            `<button type="button" class="theme-browser-segment${state.segment === key ? ' is-on' : ''}"
                     data-theme-segment="${key}" aria-pressed="${state.segment === key}">${escapeHtml(label)}</button>`;

        return `
            <div class="theme-browser" data-theme-browser>
                <div class="theme-browser-bar">
                    <input type="search" class="theme-browser-search" data-theme-search
                           value="${escapeHtml(state.query)}"
                           placeholder="${escapeHtml(t('config.themeSearchPlaceholder', 'Search themes…'))}"
                           aria-label="${escapeHtml(t('config.themeSearchPlaceholder', 'Search themes…'))}">
                    <span class="theme-browser-segments" role="group">
                        ${segmentButton('all', t('config.themeSegmentAll', 'All'))}
                        ${segmentButton('favorites', t('config.themeSegmentFavorites', 'Favourites'))}
                        ${segmentButton('light', t('config.themeSegmentLight', 'Light'))}
                        ${segmentButton('dark', t('config.themeSegmentDark', 'Dark'))}
                    </span>
                </div>
                ${ARCHETYPES.length ? `
                <div class="theme-browser-characters" role="group"
                     aria-label="${escapeHtml(t('config.themeCharacterFilter', 'Character'))}">
                    ${chipButton('', t('config.themeSegmentAll', 'All'), state)}
                    ${ARCHETYPES.map((name) => chipButton(name, archetypeLabel(name, t), state)).join('')}
                </div>` : ''}
                ${COLLECTIONS.length ? `
                <div class="theme-browser-characters" role="group" data-theme-collections
                     aria-label="${escapeHtml(t('config.themeCollectionFilter', 'Collection'))}">
                    ${collectionButton('', t('config.themeSegmentAll', 'All'), state)}
                    ${COLLECTIONS.map((name) => collectionButton(name, collectionLabel(name, t), state)).join('')}
                </div>` : ''}
                <p class="theme-browser-count">${escapeHtml(
                    t('config.themeBrowserCount', '{shown} of {total} themes · {favorites} favourites')
                        .replace('{shown}', String(visible.length))
                        .replace('{total}', String(families.length))
                        .replace('{favorites}', String(state.favorites.length))
                )}</p>
                <div class="theme-browser-grid" role="listbox"
                     aria-label="${escapeHtml(t('config.themeLabel', 'Theme'))}"
                     data-theme-grid>${cards || `<p class="theme-browser-empty">${escapeHtml(
                        t('config.themeBrowserEmpty', 'Nothing matches that.'))}</p>`}</div>
            </div>`;
    }

    /* ── The studio ─────────────────────────────────────────────────────

       A panel docked beside the dashboard rather than a modal over it: what
       is being chosen is how the page looks, so the page stays in view. The
       tabs beyond Themes are drawn and bound by the config view, which owns
       the controls they reuse from Appearance; this file owns the shell, the
       keyboard and the theme grid. */

    const TABS = ['themes', 'backdrop', 'surface', 'heads', 'looks'];

    function tabLabel(tab, t) {
        return {
            themes: t('config.studioTabThemes', 'Themes'),
            backdrop: t('config.studioTabBackdrop', 'Backdrop'),
            surface: t('config.studioTabSurface', 'Surface'),
            heads: t('config.studioTabHeads', 'Headers'),
            looks: t('config.studioTabLooks', 'Looks'),
        }[tab] || tab;
    }

    function renderShell(t) {
        const tabs = TABS.map((tab) => `
            <button type="button" role="tab" class="look-studio-tab" id="look-studio-tab-${tab}"
                    data-studio-tab="${tab}" aria-controls="look-studio-pane" aria-selected="false"
                    tabindex="-1">${escapeHtml(tabLabel(tab, t))}<span class="look-studio-dot" aria-hidden="true"></span></button>`).join('');
        return `
            <aside class="look-studio" data-look-studio role="dialog"
                   aria-labelledby="look-studio-title">
                <header class="look-studio-head">
                    <div class="look-studio-title">
                        <h2 id="look-studio-title">${escapeHtml(t('config.themeBrowserTitle', 'Themes'))}</h2>
                        <span class="look-studio-keys">${escapeHtml(t('config.studioKeys', '←/→ tabs · ⌘/Ctrl+Enter apply · Esc cancel'))}</span>
                    </div>
                    <div class="look-studio-tabs" role="tablist"
                         aria-label="${escapeHtml(t('config.studioTabsLabel', 'What to change'))}">${tabs}</div>
                </header>
                <div class="look-studio-pane" id="look-studio-pane" role="tabpanel" data-studio-pane tabindex="-1"></div>
                <footer class="look-studio-foot">
                    <div class="look-studio-scope">
                        <span>${escapeHtml(t('config.studioScopeLabel', 'Applies to'))}</span>
                        <span class="look-studio-seg" role="group"
                              aria-label="${escapeHtml(t('config.studioScopeLabel', 'Applies to'))}">
                            <button type="button" data-studio-scope="theme" aria-pressed="false">${escapeHtml(t('config.studioScopeTheme', 'This theme'))}</button>
                            <button type="button" data-studio-scope="global" aria-pressed="false">${escapeHtml(t('config.studioScopeAll', 'All themes'))}</button>
                        </span>
                    </div>
                    <button type="button" class="look-studio-btn" data-studio-compare
                            title="${escapeHtml(t('config.studioCompareHint', 'Hold, or hold \\, to see the look from before you opened this'))}">${escapeHtml(t('config.studioCompare', 'Compare'))}</button>
                    <button type="button" class="look-studio-btn" data-studio-reset>${escapeHtml(t('config.studioResetTab', 'Reset tab'))}</button>
                    <button type="button" class="look-studio-btn" data-studio-dice
                            aria-label="${escapeHtml(t('config.studioDice', 'Surprise me'))}"
                            title="${escapeHtml(t('config.studioDice', 'Surprise me'))}">🎲</button>
                    <span class="look-studio-spacer"></span>
                    <button type="button" class="look-studio-btn" data-studio-cancel>${escapeHtml(t('config.studioCancel', 'Cancel'))}</button>
                    <button type="button" class="look-studio-btn look-studio-btn--primary" data-studio-apply>${escapeHtml(t('config.studioApply', 'Apply'))}</button>
                </footer>
            </aside>`;
    }

    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    /** True for a field that wants the arrow keys, Enter or a backslash itself. */
    function ownsKeys(el) {
        if (!el) return false;
        if (el.matches?.('textarea, select, [contenteditable="true"]')) return true;
        if (el.matches?.('input')) {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
        }
        return false;
    }

    let ACTIVE = null;

    function open(options) {
        const opts = options || {};
        if (ACTIVE) {
            ACTIVE.focus();
            return ACTIVE;
        }
        const t = typeof opts.t === 'function' ? opts.t : (key, fallback) => fallback;
        const displayName = typeof opts.displayName === 'function'
            ? opts.displayName
            : (id, name) => name || id;
        const palettes = opts.palettes || {};
        META = opts.meta && opts.meta.themes ? opts.meta : { themes: {} };
        ARCHETYPES = Array.isArray(opts.meta?.archetypes) ? opts.meta.archetypes : [];
        COLLECTIONS = Array.isArray(opts.meta?.collections) ? opts.meta.collections : [];

        const families = buildFamilies(palettes, displayName);
        if (!families.length) return null;

        const currentTheme = () => (typeof opts.current === 'function' ? opts.current() : opts.current) || 'dark';

        const state = {
            query: '',
            segment: 'all',
            // Empty means every archetype. Separate from `segment` because the
            // two narrow along different axes: light/dark is which half of a
            // family you are looking at, an archetype is what kind of thing it
            // is, and wanting "dark velvet" is an ordinary thing to want.
            archetype: '',
            // Empty means every collection; a second axis beside the archetype.
            collection: '',
            get current() { return currentTheme(); },
            favorites: Array.isArray(opts.favorites) ? opts.favorites.slice() : [],
            // Which half of a family the card is showing. Starts at whichever
            // half is currently applied, so the card for the theme in use opens
            // on the theme in use rather than on its opposite.
            variants: {},
            variantFor(key) {
                if (this.variants[key]) return this.variants[key];
                const family = families.find((f) => f.key === key);
                if (!family) return 'dark';
                // Light and Dark say which half you are looking at, not only
                // which families have one: under Light every card shows its
                // light half -- whatever half is in use now.
                if ((this.segment === 'light' || this.segment === 'dark') && family.variants[this.segment]) {
                    return this.segment;
                }
                const current = this.current;
                const currentVariant = variantOf(current);
                if (currentVariant && family.variants[currentVariant]
                    && Object.values(family.variants).some((v) => v.id === current)) {
                    return currentVariant;
                }
                return family.variants.dark ? 'dark' : 'light';
            },
        };

        let tab = TABS.includes(opts.tab) ? opts.tab : 'themes';
        let comparing = false;
        let closed = false;

        const host = document.createElement('div');
        host.innerHTML = renderShell(t).trim();
        const root = host.firstElementChild;
        document.body.appendChild(root);
        const pane = root.querySelector('[data-studio-pane]');

        /*
         * The rest of the page is inert while the studio is open.
         *
         * Focus has to stay in the panel, and a click on the dashboard would
         * otherwise act on a page whose look is only a preview. Inert takes
         * neither the wheel nor the trackpad: the page still scrolls under the
         * pointer, which is what you want when judging a backdrop. That is
         * also why the panel is not aria-modal: scroll-lock.js locks the page
         * for anything that is, and inert already keeps assistive technology
         * inside the panel.
         */
        const madeInert = [];
        Array.from(document.body.children).forEach((el) => {
            if (el === root || el.inert || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
            // The notices say whether a save went through; leave them readable.
            if (el.matches?.('#app-notification, #config-save-state, .theme-backdrop-layer')) return;
            el.inert = true;
            madeInert.push(el);
        });
        document.body.classList.add('look-studio-open');
        const returnFocus = document.activeElement;

        /* ── Themes tab ── */

        const repaintThemes = () => {
            const grid = pane.querySelector('[data-theme-grid]');
            const scroll = grid?.scrollTop ?? 0;
            const active = document.activeElement;
            const hadSearch = active && active.hasAttribute?.('data-theme-search');
            const caret = hadSearch ? active.selectionStart : null;
            const focusedCard = active?.closest?.('[data-theme-card]')?.getAttribute('data-theme-card');
            pane.innerHTML = renderBody(families, state, t);
            bindThemes();
            const fresh = pane.querySelector('[data-theme-grid]');
            if (fresh) fresh.scrollTop = scroll;
            if (hadSearch) {
                const field = pane.querySelector('[data-theme-search]');
                if (field) {
                    field.focus();
                    if (caret !== null) field.setSelectionRange(caret, caret);
                }
            } else if (focusedCard) {
                pane.querySelector(`[data-theme-card="${CSS.escape(focusedCard)}"]`)?.focus();
            }
        };

        const select = (id) => {
            if (!id) return;
            opts.onSelect?.(id);
            refresh();
        };

        const bindThemes = () => {
            pane.querySelector('[data-theme-search]')?.addEventListener('input', (event) => {
                state.query = event.target.value || '';
                repaintThemes();
            });
            pane.querySelectorAll('[data-theme-segment]').forEach((button) => {
                button.addEventListener('click', () => {
                    const segment = button.getAttribute('data-theme-segment');
                    state.segment = SEGMENTS.includes(segment) ? segment : 'all';
                    // A card switched by hand earlier answered the question
                    // before this press asked it again; the segment wins.
                    if (segment === 'light' || segment === 'dark') state.variants = {};
                    repaintThemes();
                });
            });
            pane.querySelectorAll('[data-theme-character]').forEach((button) => {
                button.addEventListener('click', () => {
                    const name = button.getAttribute('data-theme-character') || '';
                    // Clicking the chip that is already on turns it off.
                    state.archetype = state.archetype === name ? '' : name;
                    repaintThemes();
                });
            });
            pane.querySelectorAll('[data-theme-collection]').forEach((button) => {
                button.addEventListener('click', () => {
                    const name = button.getAttribute('data-theme-collection') || '';
                    state.collection = state.collection === name ? '' : name;
                    repaintThemes();
                });
            });
            pane.querySelectorAll('[data-theme-card]').forEach(bindCard);
            // The card in use gets the roving stop, so Tab lands on it.
            const cards = Array.from(pane.querySelectorAll('[data-theme-card]'));
            (cards.find((c) => c.classList.contains('is-current')) || cards[0])?.setAttribute('tabindex', '0');
        };

        const bindCard = (card) => {
            const id = () => card.getAttribute('data-theme-id');

            card.querySelectorAll('[data-theme-variant]').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const key = button.getAttribute('data-theme-family');
                    state.variants[key] = button.getAttribute('data-theme-variant');
                    // Switching the half of the theme in use switches the
                    // theme; on any other card it only changes what it shows.
                    const family = families.find((f) => f.key === key);
                    const shown = family?.variants[state.variantFor(key)];
                    const inUse = family && Object.values(family.variants).some((v) => v.id === state.current);
                    if (shown && inUse) select(shown.id);
                    else repaintThemes();
                    pane.querySelector(`[data-theme-card="${CSS.escape(key)}"] [data-theme-variant="${button.getAttribute('data-theme-variant')}"]`)?.focus();
                });
            });

            card.querySelectorAll('[data-theme-favorite]').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const favoriteId = button.getAttribute('data-theme-favorite');
                    const at = state.favorites.indexOf(favoriteId);
                    if (at >= 0) {
                        state.favorites.splice(at, 1);
                    } else {
                        if (state.favorites.length >= FAVORITE_LIMIT) return;
                        state.favorites.push(favoriteId);
                    }
                    opts.onFavorites?.(state.favorites.slice());
                    // In place rather than by repainting: starring is done
                    // while browsing, often several in a row, and a rebuild
                    // would move the grid out from under the pointer. The
                    // Favourites filter is the exception, where unstarring
                    // removes the card you are looking at.
                    const on = state.favorites.includes(favoriteId);
                    button.classList.toggle('is-on', on);
                    button.setAttribute('aria-pressed', String(on));
                    const count = pane.querySelector('.theme-browser-count');
                    if (count) {
                        count.textContent = t('config.themeBrowserCount', '{shown} of {total} themes · {favorites} favourites')
                            .replace('{shown}', String(pane.querySelectorAll('[data-theme-card]').length))
                            .replace('{total}', String(families.length))
                            .replace('{favorites}', String(state.favorites.length));
                    }
                    if (state.segment === 'favorites' && !on) repaintThemes();
                });
            });

            // A click chooses, live. Nothing is stored until Apply, so there
            // is no separate preview on hover: the page already shows it.
            card.addEventListener('click', () => select(id()));
            card.addEventListener('keydown', (event) => {
                if (event.target !== card) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    select(id());
                    return;
                }
                // Up and down walk the grid; left and right are the tabs'.
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    const cards = Array.from(pane.querySelectorAll('[data-theme-card]'));
                    const at = cards.indexOf(card);
                    const columns = Math.max(1, Math.round(
                        (pane.querySelector('[data-theme-grid]')?.clientWidth || 1) / (card.offsetWidth || 1)));
                    const next = cards[at + (event.key === 'ArrowDown' ? columns : -columns)];
                    if (next) {
                        event.preventDefault();
                        card.setAttribute('tabindex', '-1');
                        next.setAttribute('tabindex', '0');
                        next.focus();
                    }
                }
            });
        };

        /* ── Tabs, dots and the footer ── */

        const paintTab = () => {
            root.querySelectorAll('[data-studio-tab]').forEach((button) => {
                const on = button.getAttribute('data-studio-tab') === tab;
                button.setAttribute('aria-selected', String(on));
                button.setAttribute('tabindex', on ? '0' : '-1');
                button.classList.toggle('is-on', on);
            });
            pane.setAttribute('aria-labelledby', `look-studio-tab-${tab}`);
            pane.setAttribute('data-studio-pane', tab);
            if (tab === 'themes') {
                repaintThemes();
            } else {
                pane.innerHTML = opts.renderTab?.(tab) || '';
                opts.bindTab?.(tab, pane);
            }
            root.querySelector('[data-studio-reset]').disabled = tab === 'looks';
            refresh();
        };

        /** Repaint what depends on the look: the dots, the scope, the grid's "in use". */
        const refresh = () => {
            if (closed) return;
            root.querySelectorAll('[data-studio-tab]').forEach((button) => {
                const name = button.getAttribute('data-studio-tab');
                const dirty = Boolean(opts.isDirty?.(name));
                button.classList.toggle('is-dirty', dirty);
                button.querySelector('.look-studio-dot')?.setAttribute('title', dirty ? t('config.studioChanged', 'Changed') : '');
            });
            const scope = opts.scope?.() || 'theme';
            root.querySelectorAll('[data-studio-scope]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.getAttribute('data-studio-scope') === scope));
            });
            if (tab === 'themes') {
                pane.querySelectorAll('[data-theme-card]').forEach((card) => {
                    const on = card.getAttribute('data-theme-id') === state.current;
                    if (on === card.classList.contains('is-current')) return;
                    const key = card.getAttribute('data-theme-card');
                    const family = families.find((f) => f.key === key);
                    if (!family) return;
                    const hadFocus = card.contains(document.activeElement);
                    card.outerHTML = renderCard(family, state, t);
                    const fresh = pane.querySelector(`[data-theme-card="${CSS.escape(key)}"]`);
                    if (fresh) {
                        bindCard(fresh);
                        if (on) fresh.setAttribute('tabindex', '0');
                        if (hadFocus) fresh.focus();
                    }
                });
            }
        };

        const switchTab = (next) => {
            if (!TABS.includes(next) || next === tab) return;
            tab = next;
            paintTab();
            root.querySelector(`[data-studio-tab="${tab}"]`)?.focus();
        };

        const setComparing = (on) => {
            if (on === comparing || closed) return;
            comparing = on;
            root.classList.toggle('is-comparing', on);
            root.querySelector('[data-studio-compare]')?.setAttribute('aria-pressed', String(on));
            opts.onCompare?.(on);
        };

        const close = () => {
            if (closed) return;
            setComparing(false);
            closed = true;
            ACTIVE = null;
            document.removeEventListener('keydown', onDocumentKey, true);
            document.removeEventListener('keyup', onKeyUp, true);
            document.removeEventListener('focusin', onFocusIn, true);
            window.removeEventListener('blur', onWindowBlur);
            madeInert.forEach((el) => { el.inert = false; });
            document.body.classList.remove('look-studio-open');
            root.remove();
            if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
                returnFocus.focus();
            }
        };

        const cancel = async () => {
            if (closed) return;
            setComparing(false);
            await opts.onCancel?.();
            close();
            opts.onClose?.();
        };

        const apply = async () => {
            if (closed) return;
            setComparing(false);
            const ok = await opts.onApply?.();
            if (ok === false) return;
            close();
            opts.onClose?.();
        };

        root.querySelectorAll('[data-studio-tab]').forEach((button) => {
            button.addEventListener('click', () => switchTab(button.getAttribute('data-studio-tab')));
        });
        root.querySelectorAll('[data-studio-scope]').forEach((button) => {
            button.addEventListener('click', () => {
                opts.setScope?.(button.getAttribute('data-studio-scope'));
                if (tab === 'themes') refresh(); else paintTab();
            });
        });
        root.querySelector('[data-studio-reset]').addEventListener('click', () => {
            opts.onResetTab?.(tab);
            if (tab === 'themes') repaintThemes();
            paintTab();
        });
        root.querySelector('[data-studio-dice]').addEventListener('click', () => {
            if (tab === 'themes') {
                // From what the grid shows, so a filter narrows the roll too.
                const visible = families.filter((f) => matches(f, state, t));
                const family = visible[Math.floor(Math.random() * visible.length)];
                if (!family) return;
                const halves = Object.values(family.variants);
                const pick = halves[Math.floor(Math.random() * halves.length)];
                select(pick.id);
                pane.querySelector(`[data-theme-card="${CSS.escape(family.key)}"]`)?.scrollIntoView({ block: 'nearest' });
                return;
            }
            opts.onDice?.(tab);
            paintTab();
        });
        root.querySelector('[data-studio-cancel]').addEventListener('click', () => { void cancel(); });
        root.querySelector('[data-studio-apply]').addEventListener('click', () => { void apply(); });

        const compareButton = root.querySelector('[data-studio-compare]');
        compareButton.addEventListener('pointerdown', (event) => {
            compareButton.setPointerCapture?.(event.pointerId);
            setComparing(true);
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => {
            compareButton.addEventListener(name, () => setComparing(false));
        });
        // Space or Enter on the button holds as long as the key does.
        compareButton.addEventListener('keydown', (event) => {
            if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                event.preventDefault();
                setComparing(true);
            }
        });
        compareButton.addEventListener('keyup', (event) => {
            if (event.key === ' ' || event.key === 'Enter') setComparing(false);
        });
        compareButton.addEventListener('click', (event) => event.preventDefault());

        // Whatever the studio did not take is the focused control's, and never
        // the dashboard's: its single-letter shortcuts would act on a page that
        // is only a preview. Stopped on the way back up, after the control has
        // had it, so a field still types and a select still opens. The
        // dashboard's capture-phase handlers bow out through isModalOpen.
        root.addEventListener('keydown', (event) => event.stopPropagation());

        // Any change in a tab may have changed what is dirty.
        const later = () => requestAnimationFrame(refresh);
        pane.addEventListener('input', later);
        pane.addEventListener('change', later);
        pane.addEventListener('click', later);

        /* ── Keyboard ── */

        const onDocumentKey = (event) => {
            if (closed) return;
            const target = event.target;
            const inside = root.contains(target);
            if (!inside) {
                // Focus slipped out (to <body>, after a click on the inert
                // page): the key is the studio's all the same.
                root.querySelector('[data-studio-tab][aria-selected="true"]')?.focus();
            }
            const key = event.key;
            if (key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                void cancel();
                return;
            }
            if (key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.stopPropagation();
                void apply();
                return;
            }
            if (key === '\\' && !ownsKeys(target)) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) setComparing(true);
                return;
            }
            if ((key === 'ArrowLeft' || key === 'ArrowRight') && !event.altKey && !event.metaKey
                && !event.ctrlKey && !ownsKeys(target)) {
                event.preventDefault();
                event.stopPropagation();
                const at = TABS.indexOf(tab);
                switchTab(TABS[(at + (key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]);
                return;
            }
            if (key === 'Tab') {
                const items = Array.from(root.querySelectorAll(FOCUSABLE))
                    .filter((el) => el.offsetParent !== null || el === document.activeElement);
                if (!items.length) return;
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || !inside)) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
                    event.preventDefault();
                    first.focus();
                }
            }
            if (!inside) event.stopPropagation();
        };
        const onKeyUp = (event) => {
            if (event.key === '\\') setComparing(false);
        };
        const onFocusIn = (event) => {
            if (closed || root.contains(event.target)) return;
            root.querySelector('[data-studio-tab][aria-selected="true"]')?.focus();
        };
        const onWindowBlur = () => setComparing(false);

        document.addEventListener('keydown', onDocumentKey, true);
        document.addEventListener('keyup', onKeyUp, true);
        document.addEventListener('focusin', onFocusIn, true);
        window.addEventListener('blur', onWindowBlur);

        paintTab();
        const first = tab === 'themes' ? pane.querySelector('[data-theme-search]') : root.querySelector(`[data-studio-tab="${tab}"]`);
        first?.focus();

        ACTIVE = {
            /** Draw the open tab again, from the settings as they are now. */
            repaint: () => { if (!closed) paintTab(); },
            refresh,
            focus: () => root.querySelector('[data-studio-tab][aria-selected="true"]')?.focus(),
            close,
            get tab() { return tab; },
            get open() { return !closed; },
        };
        return ACTIVE;
    }

    global.ThemeBrowser = { open, contrastRatio, isOpen: () => Boolean(ACTIVE) };
})(typeof window !== 'undefined' ? window : globalThis);
