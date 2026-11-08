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
        { key: 'x', verb: 'select' }, { key: 'Shift+S', verb: 'mode strip' },
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

    // The Bookmarks view has the same letters except the ones that need a dashboard
    // (the preview card, the feed watch, reveal): the same two-plus-one-plus-one shape.
    const ALL_LIBRARY = [
        { key: 'e', verb: 'edit' }, { key: 'm', verb: 'move' }, { key: 't', verb: 'tags' },
        { key: 'p', verb: 'pin' }, { key: 'f', verb: 'filter by tag' }, { key: 'c', verb: 'checking' },
        { key: 's', verb: 'share' }, { key: 'q', verb: 'QR code' }, { key: 'd', verb: 'delete' },
        { key: 'i', verb: 'panel' }, { key: 'x', verb: 'select' }, { key: 'u', verb: 'work through' },
        { key: 'y', verb: 'find tags' }, { key: 'b', verb: 'only this category' }, { key: 'w', verb: 'only this page' },
        { key: 'Shift+S', verb: 'mode strip' },
    ];
    const LEARN_LIBRARY = [
        { key: 's', verb: 'share' }, { key: 'q', verb: 'QR code' }, { key: 'c', verb: 'checking' },
        { key: 'i', verb: 'panel' }, { key: 'u', verb: 'work through' },
        { key: 'y', verb: 'find tags' }, { key: 'b', verb: 'only this category' },
    ];

    /** @param {{tags?: string[], pinned?: boolean, issue?: boolean, undo?: boolean}} ctx */
    function suggestLibrary(ctx = {}, seed = 0) {
        const out = [];
        const add = (key, verb) => { if (!out.some((s) => s.key === key)) out.push({ key, verb }); };
        if (ctx.issue) add('r', 're-check');
        if (ctx.tags?.length) add('f', `filter: ${ctx.tags[0]}`); else add('t', 'add tags');
        add('p', ctx.pinned ? 'unpin' : 'pin');
        out.length = Math.min(out.length, 2);
        const n = Math.max(0, seed | 0);
        for (let i = 0; i < ALL_LIBRARY.length; i += 1) {
            const s = ALL_LIBRARY[(n + i) % ALL_LIBRARY.length];
            if (!out.some((o) => o.key === s.key)) { out.push({ ...s }); break; }
        }
        const used = uses();
        const unlearned = LEARN_LIBRARY.filter((s) => (used[s.key] || 0) < LEARN_AFTER && !out.some((o) => o.key === s.key));
        if (unlearned.length) out.push({ ...unlearned[n % unlearned.length], learn: true });
        return out;
    }

    // The Inbox: the same shape, with the letters of its rows.
    const ALL_INBOX = [
        { key: 'p', verb: 'promote' }, { key: 'm', verb: 'keep' }, { key: 'r', verb: 'mark read' },
        { key: 'n', verb: 'note' }, { key: 'z', verb: 'snooze' }, { key: 't', verb: 'tags' },
        { key: 's', verb: 'share' }, { key: 'q', verb: 'QR code' }, { key: 'y', verb: 'copy link' },
        { key: 'd', verb: 'delete' }, { key: 'x', verb: 'select' }, { key: 'f', verb: 'triage' },
        { key: 'Shift+S', verb: 'mode strip' },
    ];
    const LEARN_INBOX = [
        { key: 's', verb: 'share' }, { key: 'q', verb: 'QR code' }, { key: 'y', verb: 'copy link' },
        { key: 'z', verb: 'snooze' }, { key: 'n', verb: 'note' }, { key: 'f', verb: 'triage' },
    ];

    /** @param {{unread?: boolean, offer?: boolean, tags?: boolean, kept?: boolean}} ctx */
    function suggestInbox(ctx = {}, seed = 0) {
        const out = [];
        const add = (key, verb) => { if (!out.some((s) => s.key === key)) out.push({ key, verb }); };
        if (ctx.offer) add('a', 'add suggested tag');
        add('p', 'promote');
        if (ctx.unread) add('r', 'mark read'); else add('u', 'mark unread');
        out.length = Math.min(out.length, 2);
        const n = Math.max(0, seed | 0);
        for (let i = 0; i < ALL_INBOX.length; i += 1) {
            const s = ALL_INBOX[(n + i) % ALL_INBOX.length];
            if (!out.some((o) => o.key === s.key) && !(s.key === 'm' && ctx.kept === false)) { out.push({ ...s }); break; }
        }
        const used = uses();
        const unlearned = LEARN_INBOX.filter((s) => (used[s.key] || 0) < LEARN_AFTER && !out.some((o) => o.key === s.key));
        if (unlearned.length) out.push({ ...unlearned[n % unlearned.length], learn: true });
        return out;
    }

    // Containers: its own verbs, in the same shape.
    const ALL_CONTAINER = [
        { key: 'l', verb: 'logs' }, { key: 's', verb: 'start / stop' }, { key: 'r', verb: 'restart' },
        { key: 'p', verb: 'pause' }, { key: 'u', verb: 'update' }, { key: 'm', verb: 'mute' },
        { key: 'w', verb: 'web UI' }, { key: 'y', verb: 'copy ID' }, { key: 'd', verb: 'remove' },
        { key: 'x', verb: 'select' }, { key: 'Shift+S', verb: 'mode strip' },
    ];
    const LEARN_CONTAINER = [
        { key: 'l', verb: 'logs' }, { key: 'm', verb: 'mute' }, { key: 'y', verb: 'copy ID' }, { key: 'w', verb: 'web UI' },
    ];

    /** @param {{running?: boolean, canControl?: boolean, update?: boolean, webui?: boolean, self?: boolean}} ctx */
    function suggestContainer(ctx = {}, seed = 0) {
        const out = [];
        const add = (key, verb) => { if (!out.some((s) => s.key === key)) out.push({ key, verb }); };
        if (ctx.update && ctx.canControl) add('u', 'update');
        if (ctx.canControl) add('s', ctx.running ? 'stop' : 'start');
        add('l', 'logs');
        out.length = Math.min(out.length, 2);
        const n = Math.max(0, seed | 0);
        for (let i = 0; i < ALL_CONTAINER.length; i += 1) {
            const s = ALL_CONTAINER[(n + i) % ALL_CONTAINER.length];
            const skip = (!ctx.canControl && ['s', 'r', 'p', 'u', 'd'].includes(s.key)) || (s.key === 'w' && !ctx.webui) || (ctx.self && ['d', 's', 'm'].includes(s.key));
            if (!out.some((o) => o.key === s.key) && !skip) { out.push({ ...s }); break; }
        }
        const used = uses();
        const unlearned = LEARN_CONTAINER.filter((s) => (used[s.key] || 0) < LEARN_AFTER && !out.some((o) => o.key === s.key) && !(s.key === 'w' && !ctx.webui));
        if (unlearned.length) out.push({ ...unlearned[n % unlearned.length], learn: true });
        return out;
    }

    /**
     * Config: a row of a list, with whatever letters that list's rows answer.
     * The first two letters are the row's own (edit, then the next), one more
     * rotates with every new row, and one is a letter not yet used.
     * @param {{key: string, verb: string}[]} actions
     */
    function suggestConfigRow(actions = [], seed = 0) {
        const out = actions.slice(0, 2).map((a) => ({ ...a }));
        // The strip's own switch turns up among the rest, like any other letter.
        const rest = [...actions.slice(2), { key: 'Shift+S', verb: 'mode strip' }];
        const n = Math.max(0, seed | 0);
        out.push({ ...rest[n % rest.length] });
        const used = uses();
        const unlearned = rest.filter((a) => (used[a.key] || 0) < LEARN_AFTER && !out.some((o) => o.key === a.key));
        if (unlearned.length) out.push({ ...unlearned[n % unlearned.length], learn: true });
        return out.slice(0, 4);
    }

    window.ModeStripSuggest = { suggest, suggestLibrary, suggestInbox, suggestContainer, suggestConfigRow, recordUse, uses, LEARN_AFTER };
})();
