/**
 * App icons from the icon sets, as the page shows them.
 *
 * The server says which app a container or a bookmark is and hands over up to
 * three addresses under /data/icon-sets/: the base icon, a variant for a dark
 * background ("light") and one for a light background ("dark"). Which one
 * shows is decided here, from the theme's --ink-dir, and changes with the
 * theme without a reload.
 *
 * Rows of bookmarks without an icon ask the server once per render, in one
 * batch, and keep the answers for the session; a letter stays where nothing
 * matched, and comes back if an icon fails to load.
 */
(function (global) {
    'use strict';

    const ATTR = 'data-icon-set-base';
    const matchCache = new Map(); // url -> ref | null

    function isDark() {
        const host = document.body || document.documentElement;
        const ink = getComputedStyle(host).getPropertyValue('--ink-dir').trim();
        if (ink === '1') return true;
        if (ink === '-1') return false;
        return Boolean(global.matchMedia?.('(prefers-color-scheme: dark)').matches);
    }

    /** The address to show for this ref under the current theme. */
    function pickVariant(ref) {
        if (!ref) return '';
        return (isDark() ? ref.light : ref.dark) || ref.base || '';
    }

    function setRef(img, ref) {
        img.setAttribute(ATTR, ref.base || '');
        if (ref.light) img.dataset.iconSetLight = ref.light; else delete img.dataset.iconSetLight;
        if (ref.dark) img.dataset.iconSetDark = ref.dark; else delete img.dataset.iconSetDark;
    }

    function refOf(img) {
        return { base: img.getAttribute(ATTR), light: img.dataset.iconSetLight, dark: img.dataset.iconSetDark };
    }

    /**
     * An <img> for a ref. onFail builds what replaces it when it cannot load
     * (the letter), so a missing file never leaves an empty box.
     */
    function makeImg(ref, { className = '', onFail = null } = {}) {
        const img = document.createElement('img');
        if (className) img.className = className;
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        setRef(img, ref);
        img.src = pickVariant(ref);
        // A variant that cannot be had falls back to the base drawing first,
        // and only then to the letter.
        const failed = () => {
            if (ref.base && img.getAttribute('src') !== ref.base) {
                img.src = ref.base;
                return;
            }
            img.removeEventListener('error', failed);
            const replacement = typeof onFail === 'function' ? onFail() : null;
            if (replacement && img.isConnected) img.replaceWith(replacement);
        };
        img.addEventListener('error', failed);
        return img;
    }

    /** Re-picks the variant of every set icon under root, after a theme change. */
    function refresh(root = document) {
        root.querySelectorAll(`img[${ATTR}]`).forEach((img) => {
            const next = pickVariant(refOf(img));
            if (next && img.getAttribute('src') !== next) img.src = next;
        });
    }

    async function fetchMatches(urls) {
        const ask = urls.filter((u) => !matchCache.has(u));
        // In batches of 500, what the server reads per request: past that it
        // stopped without saying, and the rest were remembered as "no app".
        for (let i = 0; i < ask.length; i += 500) {
            const batch = ask.slice(i, i + 500);
            try {
                const res = await fetch('/api/icon-sets/match', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls: batch }),
                });
                // A refused or failed answer is not "no app": nothing is
                // remembered, and the next render asks again.
                if (!res.ok) return;
                const data = await res.json();
                const matches = data?.matches || {};
                // An answer without the address is "no app": remembered too,
                // so the next render does not ask again.
                batch.forEach((u) => matchCache.set(u, matches[u] || null));
            } catch {
                return; // offline: the letters stay, and the next render asks again
            }
        }
    }

    /**
     * Swaps the letter of every bookmark row under root that has no icon of
     * its own for the app's set icon, where the sets know the app.
     */
    async function applyToRows(root = document) {
        await applyToLetters([...root.querySelectorAll('[data-icon-auto-url]')]);
    }

    async function applyToLetters(letters) {
        if (!letters.length) return;
        const urls = [...new Set(letters.map((el) => el.getAttribute('data-icon-auto-url')))];
        await fetchMatches(urls);
        letters.forEach((letter) => {
            const ref = matchCache.get(letter.getAttribute('data-icon-auto-url'));
            if (!ref || !letter.parentNode) return;
            letter.removeAttribute('data-icon-auto-url');
            const img = makeImg(ref, {
                className: 'bookmark-icon bookmark-icon--set',
                onFail: () => letter,
            });
            letter.replaceWith(img);
        });
    }

    /*
     * Rows are built in many places -- the grid, Recent, a row re-drawn
     * after an edit -- so each one queues its letter, and one batch per
     * turn of the event loop asks for all of them.
     */
    const queued = new Set();
    let flushTimer = 0;
    function queue(letter) {
        if (!letter) return;
        queued.add(letter);
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = 0;
            const batch = [...queued];
            queued.clear();
            void applyToLetters(batch);
        }, 0);
    }

    /** Forget the answers, after a bookmark's address or the sets changed. */
    function forget(url) {
        if (url) matchCache.delete(url); else matchCache.clear();
    }

    /** The picker, fetched the first time anyone opens it. */
    async function loadPicker() {
        if (global.IconSetPicker) return global.IconSetPicker;
        await global.LazyScript.loadScriptOnce('js/shared/icon-set-picker.js', 'iconSetPickerScript',
            () => typeof global.IconSetPicker !== 'undefined');
        return global.IconSetPicker;
    }

    document.addEventListener('theme-changed', () => refresh(document));

    /** Whether the sets already answered with an app for this address. */
    function known(url) {
        return Boolean(url && matchCache.get(url));
    }

    global.IconSetAuto = { isDark, pickVariant, makeImg, refresh, applyToRows, queue, forget, loadPicker, known };
})(window);
