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
 *   NotificationBell.register({ id, group, kind, icon, no, state, actions })
 *     -> { refresh(), unregister() }
 *
 * `state()` resolves to null when there is nothing to report, or to
 * { count, ids?, text, at? }. A state() that throws counts as null, so one
 * broken source never takes the others down.
 */
(function (global) {
    'use strict';

    const FIRST_REFRESH_MS = 3000;
    const REFRESH_EVERY_MS = 5 * 60 * 1000;
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

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function changed() {
        updateBadges();
        if (isOpen) renderPanel();
    }

    function answerNo(row) {
        const { source, entry } = row;
        // `forever` belongs to the mark itself; the third argument is only persist options.
        const mark = markOf(entry);
        if (source.no === 'forever') mark.forever = true;
        States().markBellNo(source.id, mark);
        changed();
    }

    function markRead(row) {
        States().markBellRead(row.source.id, markOf(row.entry));
        changed();
    }

    function markAllRead() {
        rows().filter((r) => r.visible).forEach((r) => States().markBellRead(r.source.id, markOf(r.entry)));
        changed();
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
        (source.actions || []).forEach((action) => {
            const b = el('button', 'notification-bell-action', typeof action.label === 'function' ? action.label() : action.label);
            b.type = 'button';
            if (action.primary) b.classList.add('is-primary');
            b.addEventListener('click', () => {
                if (action.marksRead) States().markBellRead(source.id, markOf(entry));
                try { action.onClick(row); } catch (err) { console.warn('bell action failed', err); }
                changed();
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

        const visible = rows().filter((r) => r.visible);
        if (!visible.length) {
            panel.appendChild(el('p', 'notification-bell-empty', t('empty', 'Nothing needs you right now.')));
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
            panel.appendChild(section);
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
        renderPanel();
        panel.hidden = false;
        keepOnScreen();
        button.setAttribute('aria-expanded', 'true');
    }

    window.addEventListener('resize', () => { if (isOpen) keepOnScreen(); });

    function close() {
        if (!panel || !isOpen) return;
        isOpen = false;
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

    async function refreshOne(rec) {
        let next = null;
        try { next = await rec.source.state(); } catch { next = null; }
        rec.entry = next && Number.isFinite(next.count) ? next : null;
    }

    async function refreshAll() {
        await Promise.all([...sources.values()].map(refreshOne));
        changed();
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
        button.addEventListener('click', () => (isOpen ? close() : open()));
        host.appendChild(button);

        panel = el('div', 'notification-bell-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', t('title', 'Notifications'));
        panel.hidden = true;
        host.appendChild(panel);

        document.addEventListener('pointerdown', (event) => {
            if (isOpen && !host.contains(event.target)) close();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isOpen) { close(); button.focus(); }
        });
    }

    function startTimers() {
        setTimeout(refreshAll, FIRST_REFRESH_MS);
        const tick = () => { if (document.visibilityState === 'visible') refreshAll(); };
        timer = setInterval(tick, REFRESH_EVERY_MS);
        document.addEventListener('visibilitychange', tick);
    }

    function init() {
        build();
        updateBadges();
        startTimers();
    }

    global.NotificationBell = { register, refreshAll, open, close, counts };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
