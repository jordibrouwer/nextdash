/**
 * What a bookmark shortcut has to share the keyboard with.
 *
 * Two different things can make a letter a poor choice, and until now only one
 * of them was ever mentioned. The server checks whether another bookmark on the
 * page already carries it. Nothing checked whether the dashboard itself uses it:
 * with a row selected, `j` and `k` move the cursor, `x` ticks the row, `g` arms
 * the jump chord and `c` adds a category — so a bookmark on one of those letters
 * is only reachable while no row is selected, and `c` never is.
 *
 * That is knowable at the moment someone picks the letter, which is the only
 * moment it is cheap to change. Every field that takes a shortcut reads from
 * here, so the advice cannot drift between the three of them.
 */
(function (global) {
    'use strict';

    /**
     * Letters the bookmark grid claims for itself while a row is selected.
     *
     * `c` is the odd one out: it acts whether or not a row is selected, so a
     * bookmark on `c` can never be reached by its own letter.
     */
    const GRID_KEYS = {
        C: { always: true, labelKey: 'shortcutKeyUseCategory', fallback: 'adds a category' },
        G: { always: false, labelKey: 'shortcutKeyUseJump', fallback: 'jump chord (gg, g1–g9)' },
        J: { always: false, labelKey: 'shortcutKeyUseDown', fallback: 'moves the cursor down' },
        K: { always: false, labelKey: 'shortcutKeyUseUp', fallback: 'moves the cursor up' },
        X: { always: false, labelKey: 'shortcutKeyUseSelect', fallback: 'ticks the row' },
    };

    /** The first letter is what decides: only that keystroke reaches the grid. */
    function gridKeyFor(shortcut) {
        const first = String(shortcut || '').trim().toUpperCase().charAt(0);
        return GRID_KEYS[first] ? { key: first, ...GRID_KEYS[first] } : null;
    }

    /**
     * A sentence about the letter, or '' when there is nothing to say.
     *
     * `t(key, fallback)` is the caller's translator, so this file carries no
     * language of its own.
     */
    function gridKeyNote(shortcut, t) {
        const hit = gridKeyFor(shortcut);
        if (!hit) return '';
        const say = typeof t === 'function' ? t : (_k, fallback) => fallback;
        const use = say(`dashboard.${hit.labelKey}`, hit.fallback);
        return hit.always
            ? say('dashboard.shortcutKeyTakenAlways', `The dashboard uses ${hit.key} — it ${use}, so this bookmark cannot be reached by its letter.`)
                .replace('{key}', hit.key).replace('{use}', use)
            : say('dashboard.shortcutKeyTakenInGrid', `The dashboard uses ${hit.key} while a row is selected — it ${use}. The bookmark still opens when nothing is selected.`)
                .replace('{key}', hit.key).replace('{use}', use);
    }

    /** Shortcuts already spoken for on this page, upper-cased and sorted. */
    function usedShortcuts(bookmarks, options = {}) {
        const { pageId = null, exceptUrl = null } = options;
        const seen = new Set();
        (bookmarks || []).forEach((bookmark) => {
            if (!bookmark) return;
            if (pageId != null && String(bookmark.pageId) !== String(pageId)) return;
            if (exceptUrl && bookmark.url === exceptUrl) return;
            const value = String(bookmark.shortcut || '').trim().toUpperCase();
            if (value) seen.add(value);
        });
        return [...seen].sort();
    }

    /**
     * The "already taken" line under a shortcut field.
     *
     * Capped, because a page with two hundred bookmarks would otherwise print a
     * paragraph where a hint belongs — and the number is the useful part once
     * the list is that long.
     */
    function usedShortcutsNote(bookmarks, t, options = {}) {
        const used = usedShortcuts(bookmarks, options);
        if (!used.length) return '';
        const say = typeof t === 'function' ? t : (_k, fallback) => fallback;
        const limit = Number(options.limit) || 24;
        const shown = used.slice(0, limit).join(' ');
        return used.length > limit
            ? say('dashboard.shortcutKeysInUseMore', `In use: ${shown} … and ${used.length - limit} more`)
                .replace('{keys}', shown).replace('{count}', String(used.length - limit))
            : say('dashboard.shortcutKeysInUse', `In use: ${shown}`).replace('{keys}', shown);
    }

    global.ShortcutKeys = { GRID_KEYS, gridKeyFor, gridKeyNote, usedShortcuts, usedShortcutsNote };
}(typeof window !== 'undefined' ? window : globalThis));
