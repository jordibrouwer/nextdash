/**
 * The notifications bell: one place that says what needs you.
 *
 * Every source (an unreachable bookmark, a container update, a privacy tip)
 * registers itself here with a function that reports its current state. The
 * bell asks them all now and then, works out which rows show and which are
 * unread with NotificationBellModel, and keeps the two badges on the button
 * (red for urgent, grey for quiet and tips) and the panel below it in step.
 *
 * What the person has read or answered "No" to is kept by DiscoverabilityState
 * (it persists server-side); nothing is stored here.
 *
 *   NotificationBell.register({ id, group, kind, icon, no, state, actions, onNo, onRead, onReset })
 *     -> { refresh(), unregister() }
 *
 * `state()` resolves to null when there is nothing to report, or to
 * { count, ids?, text, at? }. A state() that throws counts as null, so one
 * broken source never takes the others down.
 *
 * `onNo(row)` is optional: called once, after the "No" mark is written, for a
 * source whose "No" is also an answer something else has to know about (a
 * setting, a promo). A throwing onNo is logged and ignored.
 *
 * `onRead(row)` is optional too, and mirrors it: called once after a read mark
 * is written for a row that was unread, whether from "Mark read", from an
 * action with `marksRead: true` or from "Mark all read". Not called for a row
 * that was already read. A throwing onRead is logged and ignored.
 *
 * The bell also draws the eye: a shake and a pulse when something unread is
 * there on load, a shake, a pulse and a short bell tone when a refresh finds
 * more unread than the one before (the tone follows the `bellSound` setting),
 * and a quiet pulse once a minute until the panel is opened.
 *
 * `onReset()` is optional and undoes what onNo did: called by
 * `NotificationBell.resetDismissed()` for each source whose forever "No" it
 * cleared (and only those), before the bell looks again. A throwing onReset is
 * logged and ignored.
 */
(function (global) {
    'use strict';

    const FIRST_REFRESH_MS = 3000;
    const REFRESH_EVERY_MS = 5 * 60 * 1000;
    const REMINDER_EVERY_MS = 60 * 1000;
    const Model = global.NotificationBellModel;
    const States = () => global.DiscoverabilityState;

    const sources = new Map();   // id -> { source, entry }
    let host = null;
    let button = null;
    let redEl = null;
    let greyEl = null;
    let panel = null;
    let isOpen = false;
    let timer = null;
    let lastUnread = null;     // unread after the previous refresh; null until the first one
    let looked = true;         // the panel was opened since the last shake
    let audioCtx = null;
    let lastAnim = { kind: 'none', at: 0 };   // the last thing that drew the eye, for analytics

    const GROUP_FALLBACK = {
        health: 'Health', cleanup: 'Clean up', system: 'System', privacy: 'Privacy', tips: 'Tips',
    };

    /** Locale lookup with an English fallback, the way neighbouring panels do it. */
    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        if (lang?.t) {
            const full = `bell.${key}`;
            const value = lang.t(full);
            if (value && value !== full) return value;
        }
        return fallback;
    }

    function relativeTime(millis) {
        if (!millis) return '';
        const diff = Math.round((millis - Date.now()) / 1000);
        const abs = Math.abs(diff);
        let rtf;
        try { rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto', style: 'narrow' }); } catch { return ''; }
        if (abs < 60) return rtf.format(diff, 'second');
        if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
        return rtf.format(Math.round(diff / 86400), 'day');
    }

    /** The mark that records "this is how things stood". */
    const markOf = (entry) => ({ count: entry.count, ids: entry.ids || [] });

    /** Rows as the model sees them: the source's state plus what is stored. */
    function rows() {
        const out = [];
        for (const { source, entry } of sources.values()) {
            if (!entry) continue;
            const stored = States()?.getBellRecord(source.id) || {};
            const model = { count: entry.count, ids: entry.ids || [], kind: source.kind, no: source.no && typeof source.no === 'object' ? source.no : undefined };
            const status = Model.rowStatus(model, stored);
            out.push({ source, entry, kind: source.kind, visible: status.visible, unread: status.unread });
        }
        return out;
    }

    function counts() {
        return Model.badge(rows());
    }

    function setBadge(el, n) {
        el.textContent = n > 0 ? String(n) : '';
        el.hidden = n <= 0;
    }

    function updateBadges() {
        if (!button) return;
        const { red, grey } = counts();
        setBadge(redEl, red);
        setBadge(greyEl, grey);
        const total = red + grey;
        const label = t('title', 'Notifications');
        button.setAttribute('aria-label', total > 0 ? `${label} (${total})` : label);
    }

    /*
     * Attention. prefers-reduced-motion is handled by reduced-motion.css, which
     * cuts every animation to a hundredth of a millisecond; the class is still
     * removed on animationend, so nothing is left behind. The sound is not
     * motion and plays regardless.
     */
    function restart(node, className) {
        node.classList.remove(className);
        void node.offsetWidth; // force a reflow so the animation starts over
        node.classList.add(className);
    }

    /** How the bell is used: fixed words and bucketed counts only, never row text. */
    function track(props) {
        try { global.nextdashTrack?.('bell', props); } catch { /* analytics never breaks the bell */ }
    }

    function shake() {
        if (!button) return;
        lastAnim = { kind: 'shake', at: Date.now() };
        restart(button, 'is-shaking');
        looked = false;
    }

    function pulse() {
        [redEl, greyEl].forEach((badge) => { if (badge && !badge.hidden) restart(badge, 'is-pulsing'); });
    }

    /** One shared context, made on first use. */
    function context() {
        if (audioCtx) return audioCtx;
        const Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return null;
        try { audioCtx = new Ctx(); } catch { audioCtx = null; }
        return audioCtx;
    }

    /** A short bell: three sine partials, a quick attack and about a second of decay. */
    function ring(ctx) {
        const now = ctx.currentTime;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(0.2, now + 0.008);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
        master.connect(ctx.destination);
        [[660, 1], [1320, 0.45], [1980, 0.2]].forEach(([freq, level]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.value = level;
            osc.connect(gain);
            gain.connect(master);
            osc.start(now);
            osc.stop(now + 1.2);
        });
    }

    /**
     * Play the bell tone. A browser keeps audio shut until the page has been
     * touched; when the context will not wake, this stays silent.
     */
    async function playSound() {
        try {
            const ctx = context();
            if (!ctx) return;
            if (ctx.state === 'suspended') await ctx.resume();
            if (ctx.state !== 'running') return;
            ring(ctx);
        } catch { /* no sound is not an error */ }
    }

    /** Called after every full refresh with what is unread now. */
    /*
     * What the bell has already announced, as one key per unread row and its
     * state (id, count, ids). Only a key it has not seen before shakes the bell
     * and rings: a row that drops out and comes back unchanged — a source whose
     * state depends on the view, a view switch that refreshes everything — is
     * not new. The first refresh after load fills it silently (it shakes, as
     * agreed, but never rings).
     */
    let announced = null;

    function rowKey(r) {
        return `${r.source.id}|${r.entry.count}|${(r.entry.ids || []).join(',')}`;
    }

    function noticeUnread(unread) {
        lastUnread = unread;
        const keys = rows().filter((r) => r.visible && r.unread && (r.kind === 'urgent' || r.kind === 'quiet' || r.kind === 'tip')).map(rowKey);
        if (announced === null) {
            announced = new Set(keys);
            if (unread > 0) {
                shake();
                pulse();
            }
            return;
        }
        const fresh = keys.filter((k) => !announced.has(k));
        keys.forEach((k) => announced.add(k));
        if (!fresh.length) return;
        shake();
        pulse();
        if (global.dashboardInstance?.settings?.bellSound !== false) global.NotificationBell.playSound();
    }

    function remind() {
        if (document.visibilityState !== 'visible' || looked || isOpen) return;
        const { red, grey } = counts();
        if (red + grey > 0) {
            lastAnim = { kind: 'pulse', at: Date.now() };
            pulse();
        }
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function changed() {
        updateBadges();
        // Also while closed or closing: a row that was answered must not wait,
        // stale, in a hidden panel until the next open.
        renderPanel();
    }

    function answerNo(row) {
        const { source, entry } = row;
        // `forever` belongs to the mark itself; the third argument is only persist options.
        const mark = markOf(entry);
        if (source.no === 'forever') mark.forever = true;
        States().markBellNo(source.id, mark);
        track({ action: 'no', source: source.id });
        try { source.onNo?.(row); } catch (err) { console.warn('bell onNo failed', err); }
        changed();
    }

    /** Write the read mark; tell the source when the row was unread until now. */
    function writeRead(row) {
        States().markBellRead(row.source.id, markOf(row.entry));
        if (!row.unread) return;
        try { row.source.onRead?.(row); } catch (err) { console.warn('bell onRead failed', err); }
    }

    function markRead(row) {
        track({ action: 'read', source: row.source.id });
        writeRead(row);
        changed();
    }

    function markAllRead() {
        const { red, grey } = counts();
        track({ action: 'read-all', total: red + grey });
        rows().filter((r) => r.visible).forEach(writeRead);
        changed();
    }

    /** Slide a row out to the right, then fold its height so the rows below move up. */
    async function leaveRow(li) {
        const still = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            || document.body.classList.contains('no-animations');
        if (still || typeof li.animate !== 'function') return;
        try {
            await li.animate(
                [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(110%)', opacity: 0 }],
                { duration: 220, easing: 'ease-in', fill: 'forwards' },
            ).finished;
            const h = li.getBoundingClientRect().height;
            li.style.overflow = 'hidden';
            await li.animate(
                [{ height: `${h}px`, marginTop: getComputedStyle(li).marginTop, paddingTop: getComputedStyle(li).paddingTop, paddingBottom: getComputedStyle(li).paddingBottom },
                    { height: '0px', marginTop: '0px', paddingTop: '0px', paddingBottom: '0px' }],
                { duration: 180, easing: 'ease-out', fill: 'forwards' },
            ).finished;
        } catch { /* an interrupted animation still ends in the close */ }
    }

    function renderRow(row) {
        const { source, entry } = row;
        const li = el('li', 'notification-bell-row');
        li.dataset.bellId = source.id;
        if (row.unread) li.classList.add('is-unread');
        li.classList.add(`is-${source.kind}`);
        li.appendChild(el('span', 'notification-bell-row-icon', source.icon || ''));

        const body = el('div', 'notification-bell-row-body');
        const line = el('div', 'notification-bell-row-text');
        line.appendChild(el('span', 'notification-bell-row-label', entry.text));
        const when = relativeTime(entry.at);
        if (when) line.appendChild(el('span', 'notification-bell-row-time', when));
        body.appendChild(line);

        const actions = el('div', 'notification-bell-row-actions');
        (source.actions || []).forEach((action, index) => {
            const b = el('button', 'notification-bell-action', typeof action.label === 'function' ? action.label() : action.label);
            b.type = 'button';
            if (action.primary) b.classList.add('is-primary');
            b.addEventListener('click', () => {
                track({ action: 'row-action', source: source.id, name: action.name || (action.primary ? 'primary' : `secondary-${index}`) });
                if (action.marksRead) writeRead(row);
                const run = () => {
                    try { action.onClick(row); } catch (err) { console.warn('bell action failed', err); }
                    changed();
                };
                if (!action.primary) { run(); return; }
                // The coloured answer takes the person somewhere. First the row
                // slides away and the rows below close the gap, then the panel
                // shrinks into the bell, and only then the action runs, so its
                // destination does not open under a panel still on its way out.
                li.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });
                void leaveRow(li).then(() => { close('action'); run(); });
            });
            actions.appendChild(b);
        });
        const dismiss = el('button', 'notification-bell-action notification-bell-dismiss',
            source.kind === 'tip' ? t('markRead', 'Mark read') : t('no', 'No'));
        dismiss.type = 'button';
        dismiss.addEventListener('click', () => (source.kind === 'tip' ? markRead(row) : answerNo(row)));
        actions.appendChild(dismiss);
        body.appendChild(actions);

        li.appendChild(body);
        return li;
    }

    function renderPanel() {
        if (!panel) return;
        panel.textContent = '';
        const head = el('div', 'notification-bell-head');
        head.appendChild(el('strong', 'notification-bell-title', t('title', 'Notifications')));
        const all = el('button', 'notification-bell-action notification-bell-markall', t('markAllRead', 'Mark all read'));
        all.type = 'button';
        all.addEventListener('click', markAllRead);
        head.appendChild(all);
        panel.appendChild(head);

        // The head stays put; only the body scrolls, with its scrollbar hidden,
        // so a small arrow says when there is more below.
        const body = el('div', 'notification-bell-body');
        panel.appendChild(body);
        const more = el('button', 'notification-bell-more');
        more.type = 'button';
        more.hidden = true;
        more.setAttribute('aria-label', t('more', 'More below'));
        more.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
        more.addEventListener('click', () => {
            track({ action: 'more' });
            const reduced = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            body.scrollBy({ top: body.clientHeight, behavior: reduced ? 'auto' : 'smooth' });
        });
        panel.appendChild(more);
        body.addEventListener('scroll', updateMore, { passive: true });
        renderBody(body);
        updateMore();
    }

    /** Show the arrow only while the body can scroll further down. */
    function updateMore() {
        const body = panel?.querySelector('.notification-bell-body');
        const more = panel?.querySelector('.notification-bell-more');
        if (!body || !more) return;
        more.hidden = !(body.scrollTop + body.clientHeight < body.scrollHeight - 2);
    }

    function renderBody(target) {
        const visible = rows().filter((r) => r.visible);
        if (!visible.length) {
            target.appendChild(el('p', 'notification-bell-empty', t('empty', 'Nothing needs you right now.')));
            return;
        }
        Model.GROUP_ORDER.forEach((group) => {
            const inGroup = visible.filter((r) => r.source.group === group);
            if (!inGroup.length) return;
            const section = el('section', 'notification-bell-group');
            section.dataset.bellGroup = group;
            const h = el('h3', 'notification-bell-group-head');
            h.appendChild(el('span', '', t(`group_${group}`, GROUP_FALLBACK[group])));
            h.appendChild(el('span', 'notification-bell-group-count', String(inGroup.length)));
            section.appendChild(h);
            const ul = el('ul', 'notification-bell-list');
            inGroup.forEach((row) => ul.appendChild(renderRow(row)));
            section.appendChild(ul);
            target.appendChild(section);
        });
    }

    /*
     * The panel hangs from the bell's right edge. On a phone the bell is not
     * at the edge of the screen (the row has padding), so a panel as wide as
     * the screen would stick out on the left: slide it back inside, keeping
     * eight pixels to either side.
     */
    function keepOnScreen() {
        if (!panel || panel.hidden) return;
        panel.style.right = '';
        const rect = panel.getBoundingClientRect();
        const edge = 8;
        const width = document.documentElement.clientWidth;
        let shift = 0;
        if (rect.left < edge) shift = edge - rect.left;
        else if (rect.right > width - edge) shift = (width - edge) - rect.right;
        if (shift) panel.style.right = `${-shift}px`;
    }

    function open() {
        if (!panel || isOpen) return;
        isOpen = true;
        looked = true;
        global.CoachNote?.dismiss(INTRO_ID, 'open');
        const { red, grey } = counts();
        const recent = lastAnim.kind !== 'none' && Date.now() - lastAnim.at <= 60 * 1000;
        track({ action: 'open', total: red + grey, rows: rows().filter((r) => r.visible).length, after: recent ? lastAnim.kind : 'none' });
        renderPanel();
        cancelShrink();
        panel.hidden = false;
        keepOnScreen();
        updateMore();
        animatePanel('is-growing');
        button.setAttribute('aria-expanded', 'true');
    }

    /*
     * The panel grows out of the bell and shrinks back into it. The origin is
     * the bell's centre in the panel's own coordinates, measured after
     * keepOnScreen() placed it and before the scale changes its box.
     */
    let shrinkTimer = null;

    function growOrigin() {
        const p = panel.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        panel.style.transformOrigin = `${Math.round(b.left + b.width / 2 - p.left)}px ${Math.round(b.top + b.height / 2 - p.top)}px`;
    }

    function animatePanel(className) {
        panel.classList.remove('is-growing', 'is-shrinking');
        growOrigin();
        void panel.offsetWidth; // start the animation over
        panel.classList.add(className);
    }

    function cancelShrink() {
        clearTimeout(shrinkTimer);
        shrinkTimer = null;
        panel.classList.remove('is-shrinking');
    }

    function finishShrink() {
        if (isOpen) return;
        cancelShrink();
        panel.hidden = true;
    }

    window.addEventListener('resize', () => { if (isOpen) { keepOnScreen(); updateMore(); } });

    /*
     * A mouse that leaves the bell and its panel for a second closes the panel:
     * it was a glance, and the panel should not sit over the dashboard after
     * it. Coming back within the second keeps it open; touch and keyboard
     * never start the countdown.
     */
    const LEAVE_CLOSE_MS = 1000;
    let leaveTimer = null;

    function cancelLeave() {
        clearTimeout(leaveTimer);
        leaveTimer = null;
    }

    function close(via) {
        cancelLeave();
        if (!panel || !isOpen) return;
        if (typeof via === 'string') track({ action: 'close', via });
        isOpen = false;
        button.setAttribute('aria-expanded', 'false');
        animatePanel('is-shrinking');
        // animationend hides it; the timer is the fallback when no animation runs.
        shrinkTimer = setTimeout(finishShrink, 260);
    }

    async function refreshOne(rec) {
        let next = null;
        try { next = await rec.source.state(); } catch { next = null; }
        rec.entry = next && Number.isFinite(next.count) ? next : null;
    }

    async function refreshAll() {
        await Promise.all([...sources.values()].map(refreshOne));
        changed();
        const { red, grey } = counts();
        noticeUnread(red + grey);
    }

    /** Forget every forever "No", tell the sources that had one, and look again. */
    async function resetDismissed() {
        const cleared = States().resetBellNo() || [];
        cleared.forEach((id) => {
            try { sources.get(id)?.source.onReset?.(); } catch (err) { console.warn('bell onReset failed', err); }
        });
        await refreshAll();
        return cleared;
    }

    function register(source) {
        const rec = { source, entry: null };
        sources.set(source.id, rec);
        return {
            async refresh() { await refreshOne(rec); changed(); },
            unregister() { sources.delete(source.id); changed(); },
        };
    }

    const BELL_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

    function build() {
        host = document.getElementById('page-nav-bell-host');
        if (!host) return;
        host.textContent = '';
        host.appendChild(el('span', 'notification-bell-divider'));
        host.lastChild.setAttribute('aria-hidden', 'true');

        button = el('button', 'notification-bell-button');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', t('title', 'Notifications'));
        button.title = t('title', 'Notifications');
        button.innerHTML = BELL_SVG;
        redEl = el('span', 'notification-bell-badge notification-bell-red');
        greyEl = el('span', 'notification-bell-badge notification-bell-grey');
        redEl.hidden = true;
        greyEl.hidden = true;
        button.append(redEl, greyEl);
        button.addEventListener('animationend', (event) => {
            if (event.animationName === 'notification-bell-shake') button.classList.remove('is-shaking');
        });
        [redEl, greyEl].forEach((badge) => badge.addEventListener('animationend', (event) => {
            if (event.target === badge) badge.classList.remove('is-pulsing');
        }));
        /*
         * A short hover over the bell opens it. Someone who meant to click
         * often clicks just after it opened; that click must not close it
         * again, so a click right after a hover-open leaves it open.
         */
        const HOVER_OPEN_MS = 300;
        const CLICK_GRACE_MS = 1000;
        let hoverTimer = null;
        let hoverOpenedAt = 0;
        button.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'mouse' || isOpen) return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
                if (isOpen) return;
                open();
                hoverOpenedAt = Date.now();
            }, HOVER_OPEN_MS);
        });
        button.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
        button.addEventListener('click', () => {
            clearTimeout(hoverTimer);
            if (isOpen && Date.now() - hoverOpenedAt < CLICK_GRACE_MS) {
                hoverOpenedAt = 0;
                return;
            }
            hoverOpenedAt = 0;
            if (isOpen) close('button');
            else open();
        });
        host.appendChild(button);

        panel = el('div', 'notification-bell-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', t('title', 'Notifications'));
        panel.hidden = true;
        panel.addEventListener('animationend', (event) => {
            if (event.target !== panel) return;
            if (event.animationName === 'notification-bell-shrink') finishShrink();
            else panel.classList.remove('is-growing');
        });
        host.appendChild(panel);

        document.addEventListener('pointerdown', (event) => {
            if (isOpen && !host.contains(event.target)) close('outside');
        });
        host.addEventListener('pointerleave', (event) => {
            if (!isOpen || event.pointerType !== 'mouse') return;
            cancelLeave();
            leaveTimer = setTimeout(() => close('leave'), LEAVE_CLOSE_MS);
        });
        host.addEventListener('pointerenter', cancelLeave);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isOpen) { close('escape'); button.focus(); }
        });
    }

    /*
     * The first time the bell is drawn, after an install (once the start guide
     * is done) or an update: a balloon under it that says this is where things
     * that need you arrive, and that they no longer pop up. It is a coach note
     * (coach-note.js), which keeps it to once, ever, waits until no start
     * guide, What's New or other modal is open, and pulses the bell while it
     * shows. "Got it", opening the bell, or Escape put it away.
     */
    const INTRO_ID = 'bell-intro';

    function defineIntro() {
        global.CoachNote?.define({
            id: INTRO_ID,
            localKey: 'nextdash:bell-intro-seen',
            anchor: () => button,
            title: () => t('introTitle', 'Your notifications'),
            body: () => t('introBody', 'New things that need you land here: tips, clean-ups and updates. Read them now and then; they no longer pop up on the dashboard.'),
            okLabel: () => t('introOk', 'Got it'),
            onShown: () => track({ action: 'intro', via: 'shown' }),
            onDone: (via) => track({ action: 'intro', via }),
        });
    }

    function scheduleIntro() {
        global.CoachNote?.schedule(INTRO_ID);
    }

    function startTimers() {
        setTimeout(refreshAll, FIRST_REFRESH_MS);
        const tick = () => { if (document.visibilityState === 'visible') refreshAll(); };
        timer = setInterval(tick, REFRESH_EVERY_MS);
        document.addEventListener('visibilitychange', tick);
        setInterval(remind, REMINDER_EVERY_MS);
    }

    function init() {
        build();
        updateBadges();
        startTimers();
        defineIntro();
        scheduleIntro();
    }

    global.NotificationBell = { register, refreshAll, resetDismissed, open, close, counts, playSound, scheduleIntro };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
