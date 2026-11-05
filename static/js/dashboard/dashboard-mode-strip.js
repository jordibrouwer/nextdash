/**
 * The mode strip: a small line on the page-name line that says what the keys do
 * right now. It shows only when the keys do something other than search --
 * the cursor is on a bookmark, rows are ticked, edit mode is on, or a g chord
 * is armed -- and is gone otherwise.
 *
 * window.ModeStrip.set(state, detail) is the whole API:
 *   state  'cursor' | 'multi' | 'edit' | 'chord' | null
 *   detail { count } for 'multi'
 * The keys are untranslated; only the words are strings (dashboard.modeStrip*).
 *
 * It is placed by CSS as the centre cell of a three-column grid on the page
 * name's line (only where the name has a line of its own, the classic clock
 * layout). It shortens to "Cursor · Esc" and then disappears when it would
 * crowd the page name; below 900px it is not shown.
 */
(function () {
    const STATES = ['cursor', 'multi', 'edit', 'chord'];

    const word = (key, fallback, vars) => {
        const lang = window.dashboardInstance?.language;
        let text = fallback;
        try {
            const value = lang?.t ? lang.t(`dashboard.${key}`) : null;
            if (value && value !== `dashboard.${key}`) text = value;
        } catch (_error) { /* fall back to English */ }
        Object.entries(vars || {}).forEach(([name, value]) => { text = text.replace(`{${name}}`, String(value)); });
        return text;
    };

    const el = () => document.getElementById('mode-strip');

    function add(parent, tag, text, cls) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        node.textContent = text;
        parent.appendChild(node);
        return node;
    }
    const dot = (parent) => add(parent, 'span', '', 'mode-strip-dot');
    const sep = (parent) => add(parent, 'em', '·');
    const keys = (parent, list) => list.forEach((k) => add(parent, 'kbd', k));

    /** The strip's content: the full line, or the short one. */
    function fill(host, state, detail, short) {
        host.textContent = '';
        dot(host);
        if (state === 'cursor') {
            add(host, 'b', word('modeStripCursor', 'Cursor'));
            sep(host);
            if (!short) {
                keys(host, ['e', 'm', 't', 'p']);
                add(host, 'em', '…');
                sep(host);
            }
            keys(host, ['Esc']);
            if (!short) add(host, 'em', word('modeStripToSearch', 'to search'));
        } else if (state === 'multi') {
            add(host, 'b', word('modeStripSelected', '{count} selected', { count: detail?.count ?? 0 }));
            sep(host);
            if (!short) {
                keys(host, ['m', 'd']);
                sep(host);
                keys(host, ['Ctrl/Cmd+Enter']);
                add(host, 'em', word('modeStripOpen', 'open'));
                sep(host);
            }
            keys(host, ['Esc']);
        } else if (state === 'edit') {
            add(host, 'b', word('modeStripEdit', 'Edit mode'));
            sep(host);
            keys(host, ['Shift+E']);
            if (!short) add(host, 'em', word('modeStripToFinish', 'to finish'));
        } else if (state === 'chord') {
            add(host, 'b', 'g…');
            sep(host);
            keys(host, ['b', 'i', 'c', '1']);
            add(host, 'em', '–');
            keys(host, ['9']);
        }
    }

    /** Full line if it fits beside the page name, else short, else nothing. */
    function fit(host, state, detail) {
        const wrap = host.parentElement;
        const title = wrap?.querySelector('.title');
        // The text's own width: the h1 fills its grid column, so its box says nothing.
        let name = 0;
        if (title) {
            const range = document.createRange();
            range.selectNodeContents(title);
            name = range.getBoundingClientRect().width;
        }
        const room = wrap ? wrap.clientWidth - (2 * name) - 32 : 0;
        host.style.maxWidth = 'none';
        host.hidden = false;
        fill(host, state, detail, false);
        if (host.scrollWidth <= room) return true;
        fill(host, state, detail, true);
        if (host.scrollWidth <= room) return true;
        host.hidden = true;
        return false;
    }

    let current = { state: null, detail: null };


    function set(state, detail) {
        const host = el();
        const next = { state: STATES.includes(state) ? state : null, detail: detail || null };
        // Unchanged: leave the line alone. Rewriting it on every arrow key made
        // the live region announce it again each time.
        const same = next.state === current.state
            && (next.detail?.count ?? null) === (current.detail?.count ?? null)
            && host && host.dataset.fitW === String(host.parentElement?.clientWidth || 0);
        current = next;
        if (same) return;
        if (host) host.dataset.fitW = String(host.parentElement?.clientWidth || 0);
        if (!host) return;
        if (!current.state) {
            host.hidden = true;
            host.removeAttribute('data-state');
            host.textContent = '';
            return;
        }
        host.setAttribute('data-state', current.state);
        fit(host, current.state, current.detail);
    }

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => set(current.state, current.detail), 120);
    });

    window.ModeStrip = { set, current: () => ({ ...current }) };
})();
