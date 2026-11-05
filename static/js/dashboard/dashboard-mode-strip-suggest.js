/**
 * What the mode strip suggests for the bookmark under the cursor.
 *
 * Pure ranking, no DOM: suggest(ctx) returns at most four { key, verb } items.
 *  1. Up to two from the row's context: down (r), not filed anywhere (m),
 *     no tags (t) or a tag to filter by (f), pin state (p), a video (v).
 *  2. One that rotates: every new row shows another letter from the whole
 *     set, so the keys get met one after the other instead of the same four.
 *  3. One learning slot: a letter the reader has used fewer than LEARN_AFTER
 *     times (counted here, in localStorage, never sent anywhere); it rotates
 *     too while several are still unlearned.
 * An undo hint (Ctrl/Cmd+Z) goes in front while a pin or move can be undone.
 */
(function () {
    const STORE = 'nextdash:row-letter-uses';
    const LEARN_AFTER = 3;
    const LEARN_POOL = [
        { key: 's', verb: 'share' },
        { key: 'q', verb: 'QR code' },
        { key: 'r', verb: 'show in list' },
        { key: 'v', verb: 'preview' },
        { key: 'c', verb: 'checking' },
        { key: 'w', verb: 'watch feed' },
    ];
    // Every row letter, for the slot that rotates.
    const ALL = [
        { key: 'e', verb: 'edit' }, { key: 'm', verb: 'move' }, { key: 't', verb: 'tags' },
        { key: 'p', verb: 'pin' }, { key: 'f', verb: 'filter by tag' }, { key: 'c', verb: 'checking' },
        { key: 'r', verb: 'show in list' }, { key: 'v', verb: 'preview' }, { key: 's', verb: 'share' },
        { key: 'q', verb: 'QR code' }, { key: 'w', verb: 'watch feed' }, { key: 'd', verb: 'delete' },
        { key: 'x', verb: 'select' },
    ];

    function uses() {
        try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_e) { return {}; }
    }

    function recordUse(letter) {
        try {
            const all = uses();
            all[letter] = (all[letter] || 0) + 1;
            localStorage.setItem(STORE, JSON.stringify(all));
        } catch (_e) { /* private mode: no learning, nothing breaks */ }
    }

    /** @param {{tags?: string[], pinned?: boolean, offline?: boolean, video?: boolean, unfiled?: boolean, undo?: boolean}} ctx */
    function suggest(ctx = {}, seed = 0) {
        const out = [];
        const add = (key, verb) => { if (!out.some((s) => s.key === key)) out.push({ key, verb }); };

        if (ctx.offline) add('r', 'why it is down');
        if (ctx.unfiled) add('m', 'file it');
        if (ctx.tags?.length) add('f', `filter: ${ctx.tags[0]}`); else add('t', 'add tags');
        add('p', ctx.pinned ? 'unpin' : 'pin');
        if (ctx.video) add('v', 'play');
        out.length = Math.min(out.length, 2);

        // The rotating slot: another letter for every new row.
        const n = Math.max(0, seed | 0);
        for (let i = 0; i < ALL.length; i += 1) {
            const s = ALL[(n + i) % ALL.length];
            if (!out.some((o) => o.key === s.key)) { out.push({ ...s }); break; }
        }

        const used = uses();
        const unlearned = LEARN_POOL.filter((s) => (used[s.key] || 0) < LEARN_AFTER && !out.some((o) => o.key === s.key));
        if (unlearned.length) out.push({ ...unlearned[n % unlearned.length], learn: true });

        return ctx.undo ? [{ key: 'Ctrl/Cmd+Z', verb: 'undo' }, ...out].slice(0, 4) : out;
    }

    window.ModeStripSuggest = { suggest, recordUse, uses, LEARN_AFTER };
})();
