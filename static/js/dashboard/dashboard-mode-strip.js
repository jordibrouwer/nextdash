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
    const STATES = ['cursor', 'multi', 'edit', 'chord', 'idle'];

    /**
     * With no cursor, no ticked rows, no edit mode and no chord, the strip still
     * says which mode the keys are in: the grid searches as you type, the other
     * views are browsed. No letters: those belong to the cursor.
     */
    function idleMode() {
        const d = window.dashboardInstance;
        if (!d) return null;
        if (['library', 'inbox', 'docker', 'tags', 'config', 'glances'].includes(d.activeView)) return 'browse';
        return d.isBookmarksView?.() ? 'search' : null;
    }

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
    function fill(host, state, detail, short, bare = false) {
        host.textContent = '';
        dot(host);
        if (state === 'cursor') {
            add(host, 'b', word('modeStripCursor', 'Cursor'));
            sep(host);
            if (!short) {
                const list = detail?.suggestions?.length ? detail.suggestions : [
                    { key: 'e' }, { key: 'm' }, { key: 't' }, { key: 'p' }];
                list.forEach((s) => {
                    const chip = add(host, 'kbd', s.key);
                    if (s.learn) chip.classList.add('is-tip');
                    // Verbs are the first thing to go when the line is tight.
                    if (s.verb && !bare) add(host, 'em', s.verb);
                });
                if (!detail?.suggestions?.length) add(host, 'em', '…');
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
        } else if (state === 'idle') {
            if (detail?.mode === 'browse') {
                add(host, 'b', word('modeStripBrowse', 'Browse'));
            } else {
                add(host, 'b', word('modeStripSearch', 'Search'));
                if (!short) add(host, 'em', word('modeStripSearchHint', 'type to find'));
            }
        } else if (state === 'chord') {
            add(host, 'b', 'g…');
            sep(host);
            keys(host, ['b', 'i', 'c', '1']);
            add(host, 'em', '–');
            keys(host, ['9']);
        }
    }

    /** The strip coming back from hidden rises in, rather than appearing. */
    function enter(host, wasHidden) {
        if (!wasHidden) return;
        host.classList.remove('is-entering');
        // Restarts the animation when it is entered again straight away.
        void host.offsetWidth;
        host.classList.add('is-entering');
        host.addEventListener('animationend', () => host.classList.remove('is-entering'), { once: true });
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
        const wasHidden = host.hidden;
        host.hidden = false;
        fill(host, state, detail, false);
        if (host.scrollWidth <= room) { enter(host, wasHidden); return true; }
        fill(host, state, detail, false, true);
        if (host.scrollWidth <= room) { enter(host, wasHidden); return true; }
        fill(host, state, detail, true);
        if (host.scrollWidth <= room) { enter(host, wasHidden); return true; }
        host.hidden = true;
        return false;
    }

    let current = { state: null, detail: null };
    // The strip is for the keyboard. A mouse press hides it, and it comes back with
    // the next key: a state set meanwhile is kept, only not shown.
    let mouseMode = false;


    /** Whether the strip may show at all: one setting for every view. */
    const enabled = () => window.dashboardInstance?.settings?.showModeStrip !== false;

    /*
     * Sticky: when the page name has scrolled out of the window the strip
     * stays at the top of it (CSS, body.mode-strip-stuck). Watched with one
     * observer on the line it normally sits on.
     */
    let watched = null;
    function watchStuck() {
        const host = el();
        const line = host?.parentElement;
        if (!line || watched === line || typeof IntersectionObserver !== 'function') return;
        watched = line;
        new IntersectionObserver(([entry]) => {
            document.body.classList.toggle('mode-strip-stuck', !entry.isIntersecting && entry.boundingClientRect.bottom < 0);
        }).observe(line);
    }

    function set(state, detail) {
        watchStuck();
        const host = el();
        let next = { state: STATES.includes(state) ? state : null, detail: detail || null };
        // Nothing to say about the cursor: say which mode the keys are in.
        if (!next.state || next.state === 'idle') {
            const mode = idleMode();
            next = mode ? { state: 'idle', detail: { mode } } : { state: null, detail: null };
        }
        // Switched off: the state is kept so it comes straight back, but nothing shows.
        if (!enabled()) {
            current = next;
            if (host) { host.hidden = true; host.removeAttribute('data-state'); host.textContent = ''; delete host.dataset.fitW; }
            return;
        }
        // Unchanged: leave the line alone. Rewriting it on every arrow key made
        // the live region announce it again each time.
        if (mouseMode) {
            current = next;
            if (host) { host.hidden = true; delete host.dataset.fitW; }
            return;
        }
        const same = next.state === current.state
            && JSON.stringify(next.detail) === JSON.stringify(current.detail)
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

    // Held while the coach note that explains the strip is up: a click on the
    // note's own buttons must not take away the thing it points at.
    let held = false;

    /** Show the strip again after a mouse press, for the note that points at it. */
    function reveal() {
        if (!mouseMode) return;
        mouseMode = false;
        const host = el();
        if (host) delete host.dataset.fitW;
        set(current.state, current.detail);
    }

    function hold(on) {
        held = Boolean(on);
        if (held) reveal();
    }

    document.addEventListener('pointerdown', (e) => {
        if (held) return;
        if (e.pointerType && e.pointerType !== 'mouse') return;
        mouseMode = true;
        const host = el();
        if (host) { host.hidden = true; delete host.dataset.fitW; }
    }, true);
    document.addEventListener('keydown', (e) => {
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
        if (!mouseMode) return;
        mouseMode = false;
        // The key handlers run after this one and set the state they mean; if
        // none does, the last state comes back.
        queueMicrotask(() => { if (!mouseMode) set(current.state, current.detail); });
    }, true);

    /**
     * Shift+S: the strip off and on, in every view at once. The same stored
     * value as Behavior -> Keyboard -> Show the mode strip.
     */
    async function toggle() {
        const d = window.dashboardInstance;
        if (!d) return;
        d.settings = d.settings || {};
        const was = enabled();
        d.settings.showModeStrip = !was;
        try {
            if ((await d.saveSettings()) === false) throw new Error('not saved');
        } catch (_err) {
            d.settings.showModeStrip = was;
            d.showNotification?.(word('modeStripToggleFailed', 'Could not save the mode strip setting'), 'error');
            return;
        }
        // Shown again where it was: the keys' own state is kept in `current`.
        mouseMode = false;
        delete (el() || {}).dataset?.fitW;
        set(current.state, current.detail);
        d.showNotification?.(word(was ? 'modeStripOff' : 'modeStripOn', was ? 'Mode strip off' : 'Mode strip on'), 'success', { duration: 2000 });
    }

    document.addEventListener('keydown', (e) => {
        if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.code !== 'KeyS' || e.isComposing) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        const d = window.dashboardInstance;
        if (!d || d.searchComponent?.isActive?.() || d.isModalOpen?.() || d.isInlineEditActive?.()) return;
        if (document.querySelector('[data-look-studio]') || document.body?.classList.contains('bookmark-inline-edit-active')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) { window.nextdashRecordKey?.('Shift + S'); void toggle(); }
    }, true);

    /*
     * After two seconds with nothing touched, the strip fades away; any key,
     * mouse move, click, scroll or touch brings it back. It is a line for
     * someone who is using the page, not a sign that stays on.
     */
    const IDLE_MS = 2000;
    let idleTimer = 0;
    let idleNow = false;
    let lastPoke = 0;

    function armIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            // Held for the note that points at it: not while someone is reading that.
            if (held) { armIdle(); return; }
            idleNow = true;
            el()?.classList.add('is-idle');
        }, IDLE_MS);
    }

    function poke() {
        const now = Date.now();
        if (!idleNow && now - lastPoke < 200) return;
        lastPoke = now;
        if (idleNow) {
            idleNow = false;
            el()?.classList.remove('is-idle');
        }
        armIdle();
    }

    ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'scroll', 'focusin'].forEach((name) => {
        document.addEventListener(name, poke, { capture: true, passive: true });
    });
    armIdle();

    window.ModeStrip = { set, toggle, reveal, hold, isEnabled: enabled, current: () => ({ ...current }) };
})();
