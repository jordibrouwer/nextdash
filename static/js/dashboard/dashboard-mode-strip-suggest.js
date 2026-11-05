/**
 * What the mode strip suggests for the bookmark under the cursor.
 *
 * Pure ranking, no DOM: suggest(ctx) returns at most four { key, verb } items.
 *  1. Context of the row: down (r), no tags (t) or a tag to filter by (f),
 *     pin state (p), not filed anywhere (m), a video (v).
 *  2. Fallbacks e, m, p, t until there are three.
 *  3. One learning slot: a letter the reader has used fewer than LEARN_AFTER
 *     times (counted here, in localStorage, never sent anywhere).
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
    function suggest(ctx = {}) {
        const out = [];
        const add = (key, verb) => { if (!out.some((s) => s.key === key)) out.push({ key, verb }); };

        if (ctx.offline) add('r', 'why it is down');
        if (ctx.unfiled) add('m', 'file it');
        if (ctx.tags?.length) add('f', `filter: ${ctx.tags[0]}`); else add('t', 'add tags');
        add('p', ctx.pinned ? 'unpin' : 'pin');
        if (ctx.video) add('v', 'play');
        ['e', 'm', 't', 'p'].forEach((k) => add(k, { e: 'edit', m: 'move', t: 'tags', p: 'pin' }[k]));
        out.length = Math.min(out.length, 3);

        const used = uses();
        const tip = LEARN_POOL.find((s) => (used[s.key] || 0) < LEARN_AFTER && !out.some((o) => o.key === s.key));
        if (tip) out.push({ ...tip, learn: true });

        return ctx.undo ? [{ key: 'Ctrl/Cmd+Z', verb: 'undo' }, ...out].slice(0, 4) : out;
    }

    window.ModeStripSuggest = { suggest, recordUse, uses, LEARN_AFTER };
})();
