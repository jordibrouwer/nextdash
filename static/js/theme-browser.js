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
 * already previews a theme on the real dashboard while you move through the
 * list, and puts the old one back if you leave without choosing. That logic is
 * handed in as callbacks: this file decides what you are looking at, not what
 * gets applied.
 */
(function (global) {
    'use strict';

    const SEGMENTS = ['all', 'favorites', 'light', 'dark'];
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

        return `
            <div class="theme-browser-card${isCurrent ? ' is-current' : ''}"
                 role="option" tabindex="-1"
                 aria-selected="${isCurrent}"
                 data-theme-card="${escapeHtml(family.key)}"
                 data-theme-id="${escapeHtml(id)}">
                <div class="theme-browser-swatches" aria-hidden="true">${swatches(shown.palette)}</div>
                <div class="theme-browser-card-head">
                    <span class="theme-browser-card-name">${escapeHtml(family.label || id)}</span>
                    <button type="button" class="theme-browser-star${isFavorite ? ' is-on' : ''}"
                            data-theme-favorite="${escapeHtml(id)}"
                            aria-pressed="${isFavorite}"
                            title="${escapeHtml(t('config.themeFavorite', 'Favourite'))}">★</button>
                </div>
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
        const query = state.query.trim().toLowerCase();
        if (!query) return true;
        const haystack = [family.label, family.key, deriveTraits(shown.palette, t).join(' ')]
            .join(' ')
            .toLowerCase();
        return query.split(/\s+/).every((word) => haystack.includes(word));
    }

    function renderBody(families, state, t) {
        const visible = families.filter((f) => matches(f, state, t));
        const cards = visible.map((f) => renderCard(f, state, t)).join('');
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

    /* ── The modal ─────────────────────────────────────────────────────── */

    function open(options) {
        const opts = options || {};
        const t = typeof opts.t === 'function' ? opts.t : (key, fallback) => fallback;
        const displayName = typeof opts.displayName === 'function'
            ? opts.displayName
            : (id, name) => name || id;
        const palettes = opts.palettes || {};
        if (!global.AppModal?.show) return;

        const families = buildFamilies(palettes, displayName);
        if (!families.length) return;

        const state = {
            query: '',
            segment: 'all',
            current: opts.current || 'dark',
            favorites: Array.isArray(opts.favorites) ? opts.favorites.slice() : [],
            // Which half of a family the card is showing. Starts at whichever
            // half is currently applied, so the card for the theme in use opens
            // on the theme in use rather than on its opposite.
            variants: {},
            variantFor(key) {
                if (this.variants[key]) return this.variants[key];
                const family = families.find((f) => f.key === key);
                if (!family) return 'dark';
                const currentVariant = variantOf(this.current);
                if (currentVariant && family.variants[currentVariant]
                    && Object.values(family.variants).some((v) => v.id === this.current)) {
                    return currentVariant;
                }
                return family.variants.dark ? 'dark' : 'light';
            },
        };

        // Set once a card is chosen. Until then, closing the modal by any route
        // has to put back what was on screen — and a modal with a search field
        // and four filter buttons has a lot of routes.
        let picked = false;

        /*
         * Show a theme on the real dashboard, but never after one was chosen.
         *
         * Choosing is not instant: it posts the settings and only then paints,
         * and the modal is torn down without waiting for that. Focus and the
         * pointer both land somewhere during the teardown, and whatever card
         * they land on used to fire its own preview -- which arrived while the
         * choice was still in flight and won. Choose Moss & Stone, get
         * Marigold Dusk, until the page is reloaded.
         *
         * Gated here rather than at the three call sites, so a preview added
         * later cannot reintroduce it.
         */
        const preview = (id) => {
            if (picked || !id) return;
            opts.onPreview?.(id);
        };

        const repaint = () => {
            const root = document.querySelector('[data-theme-browser]');
            if (!root) return;
            const active = document.activeElement;
            const hadSearch = active && active.hasAttribute?.('data-theme-search');
            const caret = hadSearch ? active.selectionStart : null;
            // Rebuilding the grid resets its scroll to the top, which throws
            // away where you were in a list of a hundred cards.
            const scroll = root.querySelector('[data-theme-grid]')?.scrollTop ?? 0;
            root.outerHTML = renderBody(families, state, t);
            bind();
            const grid = document.querySelector('[data-theme-grid]');
            if (grid) grid.scrollTop = scroll;
            if (hadSearch) {
                const field = document.querySelector('[data-theme-search]');
                if (field) {
                    field.focus();
                    if (caret !== null) field.setSelectionRange(caret, caret);
                }
            }
        };

        const bind = () => {
            const root = document.querySelector('[data-theme-browser]');
            if (!root) return;

            root.querySelector('[data-theme-search]')?.addEventListener('input', (event) => {
                state.query = event.target.value || '';
                repaint();
            });

            root.querySelectorAll('[data-theme-segment]').forEach((button) => {
                button.addEventListener('click', () => {
                    const segment = button.getAttribute('data-theme-segment');
                    state.segment = SEGMENTS.includes(segment) ? segment : 'all';
                    repaint();
                });
            });

            root.querySelectorAll('[data-theme-card]').forEach(bindCard);
        };

        /*
         * Rebuild one card, in place.
         *
         * Switching a family between its light and dark half changes that card
         * and nothing else, so repainting the grid for it would move a hundred
         * other cards — and move this one out from under the pointer that just
         * clicked it. Same reasoning as starring: touch what changed.
         */
        const refreshCard = (key) => {
            const card = document.querySelector(`[data-theme-card="${CSS.escape(key)}"]`);
            const family = families.find((f) => f.key === key);
            if (!card || !family) return;
            card.outerHTML = renderCard(family, state, t);
            const replacement = document.querySelector(`[data-theme-card="${CSS.escape(key)}"]`);
            if (replacement) bindCard(replacement);
            return replacement;
        };

        const bindCard = (card) => {
            const id = () => card.getAttribute('data-theme-id');

            card.querySelectorAll('[data-theme-variant]').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const key = button.getAttribute('data-theme-family');
                    state.variants[key] = button.getAttribute('data-theme-variant');
                    const replacement = refreshCard(key);
                    // Show the half that was just switched to, without choosing
                    // it — and keep the keyboard where the click left it.
                    const family = families.find((f) => f.key === key);
                    const shown = family?.variants[state.variantFor(key)];
                    if (shown) preview(shown.id);
                    const sameButton = replacement?.querySelector(
                        `[data-theme-variant="${button.getAttribute('data-theme-variant')}"]`);
                    if (sameButton && document.activeElement === document.body) sameButton.focus();
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
                    /*
                     * Updated in place rather than by repainting.
                     *
                     * Starring is something you do while browsing, often
                     * several in a row, and a rebuild would move the grid and
                     * the card out from under the pointer. Only two things
                     * changed on screen — this star and the count — so only
                     * those two are touched.
                     *
                     * The exception is the Favourites filter, where unstarring
                     * removes the card you are looking at: leaving it there
                     * would show something the filter says is not in the list.
                     */
                    const on = state.favorites.includes(favoriteId);
                    button.classList.toggle('is-on', on);
                    button.setAttribute('aria-pressed', String(on));
                    const count = document.querySelector('.theme-browser-count');
                    if (count) {
                        count.textContent = t('config.themeBrowserCount', '{shown} of {total} themes · {favorites} favourites')
                            .replace('{shown}', String(document.querySelectorAll('[data-theme-card]').length))
                            .replace('{total}', String(families.length))
                            .replace('{favorites}', String(state.favorites.length));
                    }
                    if (state.segment === 'favorites' && !on) {
                        repaint();
                    }
                });
            });

            card.addEventListener('mouseenter', () => preview(id()));
            card.addEventListener('focus', () => preview(id()));
            card.addEventListener('click', () => {
                picked = true;
                opts.onPick?.(id());
                global.AppModal.hide();
            });
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    card.click();
                }
            });
        };

        global.AppModal.show({
            title: t('config.themeBrowserTitle', 'Themes'),
            htmlMessage: renderBody(families, state, t),
            showCancel: false,
            confirmText: t('dashboard.close', 'Close'),
            modalClass: 'modal--theme-browser',
            modalMaxWidth: '64rem',
            initialFocusSelector: '[data-theme-search]',
            onHide: () => {
                if (!picked) opts.onRevert?.();
            },
        });

        bind();
    }

    global.ThemeBrowser = { open };
})(typeof window !== 'undefined' ? window : globalThis);
