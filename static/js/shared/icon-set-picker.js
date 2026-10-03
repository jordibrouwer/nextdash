/**
 * The app-icon picker: a search over dashboard-icons and selfh.st/icons, and
 * the suggestions under a bookmark's address.
 *
 * Both ask the server, which holds the indexes; the browser only ever sees
 * /data/icon-sets/ addresses. Choosing adopts the icon -- the server copies it
 * into data/icons/ -- and hands the caller the bare file name a bookmark or a
 * container stores, like an upload does.
 *
 * Keyboard: the search field has focus on open; ↓ goes into the grid, the
 * arrows move, ↑ from the top row goes back to the field, Alt+← → picks the
 * variant, Enter chooses, Escape closes and puts focus back where it was.
 */
(function (global) {
    'use strict';

    const COLS = 6;
    const VARIANTS = ['base', 'light', 'dark'];
    let openPicker = null;

    const plainT = (_key, fallback, vars) => String(fallback).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));

    function variantsOf(ref) {
        return VARIANTS.filter((v) => v === 'base' || ref[v]);
    }

    function srcOf(ref, variant) {
        if (variant === 'light') return ref.light || ref.base;
        if (variant === 'dark') return ref.dark || ref.base;
        return ref.base;
    }

    /** The variant the current theme would show. */
    function themeVariant(ref) {
        const dark = global.IconSetAuto?.isDark?.() ?? false;
        if (dark && ref.light) return 'light';
        if (!dark && ref.dark) return 'dark';
        return 'base';
    }

    async function adopt(ref, variant) {
        const res = await global.nextDashFetch('/api/icon-sets/adopt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ set: ref.set, name: ref.name, variant }),
        });
        if (!res.ok) throw new Error(`adopt ${res.status}`);
        const data = await res.json();
        const icon = String(data?.icon || '').trim();
        if (!icon) throw new Error('adopt: no icon');
        return icon;
    }

    function credits(t) {
        const p = document.createElement('p');
        p.className = 'icon-set-picker-credits';
        p.textContent = t('iconSetCredits', 'App icons: dashboard-icons (Apache-2.0) · selfh.st/icons (CC BY 4.0)');
        return p;
    }

    /** Keeps a fixed box inside the viewport, measured, so a transformed ancestor does not throw it off. */
    function place(pop, anchor) {
        const a = anchor.getBoundingClientRect();
        pop.style.left = '0px';
        pop.style.top = '0px';
        const origin = pop.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        let left = a.left;
        let top = a.bottom + 6;
        if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
        if (top + h > window.innerHeight - 8 && a.top - 6 - h > 8) top = a.top - 6 - h;
        pop.style.left = `${left - origin.left}px`;
        pop.style.top = `${top - origin.top}px`;
    }

    /**
     * Opens the picker under anchor.
     * @param {HTMLElement} anchor
     * @param {{query?: string, t?: Function, notify?: Function, container?: HTMLElement, onPick: (icon: string) => void, onClose?: Function}} options
     */
    function open(anchor, options = {}) {
        close();
        const t = typeof options.t === 'function' ? options.t : plainT;
        // Back to what opened it: the menu item that did is hidden by now.
        const returnFocus = anchor;

        const pop = document.createElement('div');
        pop.className = 'icon-set-picker';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', t('iconSetChooseTitle', 'Choose app icon'));
        pop.setAttribute('data-icon-set-popover', '');

        const bar = document.createElement('div');
        bar.className = 'icon-set-picker-search';
        const input = document.createElement('input');
        input.type = 'search';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.className = 'icon-set-picker-input';
        input.setAttribute('aria-label', t('iconSetSearch', 'Search app icons'));
        input.placeholder = t('iconSetSearchPlaceholder', 'Search app icons');
        input.value = String(options.query || '');
        const count = document.createElement('span');
        count.className = 'icon-set-picker-count';
        count.setAttribute('aria-live', 'polite');
        bar.append(input, count);

        const grid = document.createElement('div');
        grid.className = 'icon-set-picker-grid';
        grid.setAttribute('role', 'listbox');
        grid.setAttribute('aria-label', t('iconSetResults', 'App icons'));
        grid.tabIndex = -1;
        const listId = `icon-set-picker-${Date.now().toString(36)}`;
        grid.id = listId;
        input.setAttribute('aria-controls', listId);

        const message = document.createElement('p');
        message.className = 'icon-set-picker-message';
        message.hidden = true;

        const foot = document.createElement('div');
        foot.className = 'icon-set-picker-foot';
        const variantsRow = document.createElement('div');
        variantsRow.className = 'icon-set-picker-variants';
        variantsRow.setAttribute('role', 'radiogroup');
        variantsRow.setAttribute('aria-label', t('iconSetVariant', 'Variant'));
        foot.append(variantsRow);

        pop.append(bar, grid, message, foot, credits(t));

        let results = [];
        let sel = 0;
        let variant = 'base';
        let busy = false;
        let seq = 0;

        const variantLabel = (v) => ({
            base: t('iconSetVariantBase', 'Standard'),
            light: t('iconSetVariantLight', 'For dark backgrounds'),
            dark: t('iconSetVariantDark', 'For light backgrounds'),
        }[v]);

        function renderVariants() {
            variantsRow.replaceChildren();
            const ref = results[sel];
            if (!ref) return;
            const vs = variantsOf(ref);
            if (!vs.includes(variant)) variant = 'base';
            vs.forEach((v) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.tabIndex = -1;
                b.className = `icon-set-picker-variant icon-set-picker-variant--${v}`;
                b.setAttribute('role', 'radio');
                b.setAttribute('aria-checked', String(v === variant));
                b.setAttribute('data-icon-set-variant', v);
                b.title = variantLabel(v);
                b.setAttribute('aria-label', variantLabel(v));
                const img = document.createElement('img');
                img.alt = '';
                img.src = srcOf(ref, v);
                b.appendChild(img);
                b.addEventListener('click', (e) => {
                    e.preventDefault();
                    void choose(ref, v);
                });
                variantsRow.appendChild(b);
            });
        }

        function renderGrid() {
            grid.replaceChildren();
            results.forEach((ref, i) => {
                const o = document.createElement('div');
                o.className = 'icon-set-picker-option';
                o.id = `${listId}-${i}`;
                o.setAttribute('role', 'option');
                o.setAttribute('aria-selected', String(i === sel));
                o.setAttribute('data-icon-set-option', `${ref.set}/${ref.name}`);
                o.title = `${ref.label} · ${ref.set === 'selfhst' ? 'selfh.st/icons' : 'dashboard-icons'}`;
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                img.src = srcOf(ref, themeVariant(ref));
                // An icon the server could not get shows its first letter.
                img.addEventListener('error', () => {
                    const letter = document.createElement('b');
                    letter.className = 'icon-set-picker-letter';
                    letter.textContent = String(ref.label || ref.name || '?').charAt(0).toUpperCase();
                    img.replaceWith(letter);
                }, { once: true });
                const label = document.createElement('span');
                label.textContent = ref.label;
                o.append(img, label);
                o.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus where it is
                o.addEventListener('click', () => {
                    sel = i;
                    void choose(ref, variant);
                });
                grid.appendChild(o);
            });
            if (results.length) {
                grid.setAttribute('aria-activedescendant', `${listId}-${sel}`);
                grid.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
            } else {
                grid.removeAttribute('aria-activedescendant');
            }
            renderVariants();
        }

        function select(i) {
            if (!results.length) return;
            const next = Math.max(0, Math.min(results.length - 1, i));
            if (next !== sel) variant = 'base';
            sel = next;
            renderGrid();
        }

        async function search() {
            const mine = ++seq;
            let data = null;
            try {
                const res = await fetch(`/api/icon-sets/search?q=${encodeURIComponent(input.value.trim())}`);
                data = res.ok ? await res.json() : null;
            } catch {
                data = null;
            }
            if (mine !== seq || !pop.isConnected) return;
            results = Array.isArray(data?.results) ? data.results : [];
            sel = 0;
            variant = 'base';
            renderGrid();
            const unavailable = !data || data.unavailable;
            message.hidden = results.length > 0 || !input.value.trim();
            message.textContent = unavailable
                ? t('iconSetsUnavailable', "Icons are unavailable offline. Upload one, or keep the site's own icon.")
                : t('iconSetsNoResults', "No icon found. Upload one, or keep the site's own icon.");
            if (unavailable) message.hidden = false;
            count.textContent = results.length ? t('iconSetCount', '{count} icons', { count: results.length }) : '';
        }

        async function choose(ref, v) {
            if (busy || !ref) return;
            busy = true;
            pop.setAttribute('aria-busy', 'true');
            try {
                const icon = await adopt(ref, v);
                close();
                options.onPick?.(icon, ref, v);
            } catch {
                options.notify?.(t('iconSetAdoptFailed', 'Could not use this icon.'), 'error');
            } finally {
                busy = false;
                pop.removeAttribute('aria-busy');
            }
        }

        let debounce = 0;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => void search(), 120);
        });

        pop.addEventListener('keydown', (e) => {
            const inField = document.activeElement === input;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (results[sel]) void choose(results[sel], variant);
                return;
            }
            if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                const ref = results[sel];
                if (!ref) return;
                e.preventDefault();
                const vs = variantsOf(ref);
                const step = e.key === 'ArrowRight' ? 1 : -1;
                variant = vs[(vs.indexOf(variant) + step + vs.length) % vs.length];
                renderVariants();
                return;
            }
            // Typing in the grid goes on searching: the key lands in the field.
            if (!inField && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                input.focus();
                return;
            }
            if (inField) {
                if (e.key === 'ArrowDown' && results.length) {
                    e.preventDefault();
                    grid.focus();
                    renderGrid();
                }
                return;
            }
            const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
            if (move === undefined) return;
            e.preventDefault();
            if (e.key === 'ArrowUp' && sel < COLS) {
                input.focus();
                return;
            }
            select(sel + move);
        });

        // Tab stays between the field and the grid: the picker is the
        // innermost thing open, and the form's own trap wraps around it.
        const onOutside = (e) => {
            if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(false);
        };
        const onResize = () => place(pop, anchor);

        openPicker = {
            pop,
            close(restore = true) {
                clearTimeout(debounce);
                document.removeEventListener('pointerdown', onOutside, true);
                window.removeEventListener('resize', onResize);
                pop.remove();
                openPicker = null;
                if (restore && returnFocus?.isConnected) returnFocus.focus();
                options.onClose?.();
            },
        };

        // Beside the anchor by default, so a modal's focus trap still holds
        // it; a caller inside a clipping frame (the container drawer slides
        // in with a transform) hands its own container instead.
        (options.container || anchor.parentElement || document.body).appendChild(pop);
        place(pop, anchor);
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', onResize);
        input.focus();
        input.select();
        void search();
        return openPicker;
    }

    function close(restore = true) {
        openPicker?.close(restore);
    }

    function isOpen() {
        return Boolean(openPicker);
    }

    /**
     * Up to three icons for an address, as chips, with "More…" at the end.
     * Empty -- and the host hidden -- when the sets know nothing for it, or
     * when the icon the bookmark has is already one of them.
     * @param {HTMLElement} host
     * @param {{url: string, currentIcon?: string, t?: Function, notify?: Function, onPick: Function, onMore?: Function}} options
     */
    async function renderSuggestions(host, options = {}) {
        const t = typeof options.t === 'function' ? options.t : plainT;
        const token = String(Date.now() + Math.random());
        host.dataset.iconSetSuggestToken = token;
        let results = [];
        if (options.url) {
            try {
                const res = await fetch(`/api/icon-sets/suggest?url=${encodeURIComponent(options.url)}`);
                const data = res.ok ? await res.json() : null;
                results = Array.isArray(data?.results) ? data.results : [];
            } catch {
                results = [];
            }
        }
        if (host.dataset.iconSetSuggestToken !== token) return null; // a newer address asked since
        host.replaceChildren();
        // An adopted icon is named for its file: sonarr.svg, sonarr-dark.svg, sonarr-2.svg.
        const stem = String(options.currentIcon || '').replace(/\.[a-z0-9]+$/i, '').replace(/-\d+$/, '');
        const already = stem && results.some((r) => [r.base, r.light, r.dark].filter(Boolean)
            .some((u) => u.split('/').pop().replace(/\.[a-z0-9]+$/i, '') === stem));
        if (!results.length || already) {
            host.hidden = true;
            return results;
        }
        host.hidden = false;
        const label = document.createElement('span');
        label.className = 'icon-set-suggest-label';
        label.textContent = t('iconSetSuggested', 'Suggested:');
        host.appendChild(label);
        results.forEach((ref) => {
            const v = themeVariant(ref);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'icon-set-suggest-chip';
            chip.setAttribute('data-icon-set-suggestion', `${ref.set}/${ref.name}`);
            chip.title = `${ref.label} · ${ref.set === 'selfhst' ? 'selfh.st/icons' : 'dashboard-icons'}`;
            const img = document.createElement('img');
            img.alt = '';
            img.src = srcOf(ref, v);
            const text = document.createElement('span');
            text.textContent = ref.label;
            chip.append(img, text);
            chip.addEventListener('click', async (e) => {
                e.preventDefault();
                if (chip.disabled) return;
                chip.disabled = true;
                try {
                    options.onPick?.(await adopt(ref, v), ref, v);
                } catch {
                    options.notify?.(t('iconSetAdoptFailed', 'Could not use this icon.'), 'error');
                } finally {
                    chip.disabled = false;
                }
            });
            host.appendChild(chip);
        });
        if (typeof options.onMore === 'function') {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'icon-set-suggest-chip icon-set-suggest-more';
            more.setAttribute('data-icon-set-more', '');
            more.textContent = t('iconSetMore', 'More…');
            more.addEventListener('click', (e) => {
                e.preventDefault();
                options.onMore(more, results[0]?.name || '');
            });
            host.appendChild(more);
        }
        return results;
    }

    // Opened on purpose, so it owns Escape over the view beneath it.
    global.EscapeOwner?.registerOwner('icon-set-picker', { isOpen, handleEscape: () => close() });

    global.IconSetPicker = { open, close, isOpen, renderSuggestions };
})(window);
