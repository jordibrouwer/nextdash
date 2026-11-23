/**
 * Timer: a kitchen timer and a pomodoro timer, kept entirely in the browser.
 *
 * A run is stored as the moment it ends (endsAt, epoch ms), never as a count of
 * ticks, so a throttled background tab, a sleeping laptop or a reload cannot
 * make it drift. The runs live in this device's localStorage, by widget id, and
 * carry a copy of the settings they started with: that is what lets the end of
 * a run be settled when its widget is not on the page (another page of the
 * dashboard, a tab that was closed and came back). The widget's current
 * settings ride along as `nextCfg` and are taken over at the next phase, so a
 * change never touches the phase that is going.
 *
 * Three looks (ring, bar, row) draw the same state; only the draw differs.
 *
 * The end of a run is settled by one module-level timeout set for the earliest
 * endsAt, plus a check on load, on visibilitychange and on a storage event from
 * another tab. The one-second tick only repaints the figure while a widget is
 * on screen. The alarm rings once per run across tabs (a claim in
 * localStorage, the same shape as the bell's urgent rows).
 */
(function () {
    'use strict';

    const STORE = 'nextdash-timer';
    const RUNG = 'nextdash-timer-rung';
    const EVENT = 'nextdash-timer-change';
    const MIN = 60000;
    const MAX_TIMEOUT = 2147000000;
    // A run nobody has touched for this long, and that is not going, is dropped.
    const STALE_MS = 30 * 24 * 3600 * 1000;

    const DEFAULTS = {
        mode: 'timer', look: 'ring', presets: [1, 5, 10, 15],
        focus: 25, short: 5, long: 15, rounds: 4,
        autoNext: false, sound: true, notify: false,
    };

    const U = () => window.DashboardWidgetUtils;
    const label = (dash, key, fallback) => U().label(dash, key, fallback);
    const dashNow = () => window.dashboardInstance || null;

    /* ---------- Settings ---------- */

    function wholeMinutes(value, min, max, fallback) {
        const n = Math.floor(Number(value));
        return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
    }

    /** The settings of a widget with the defaults filled in. */
    function cfgOf(widget) {
        const c = widget?.config || {};
        let presets = (Array.isArray(c.presets) ? c.presets : [])
            .map((p) => wholeMinutes(p, 1, 600, 0)).filter(Boolean);
        presets = presets.filter((p, i) => presets.indexOf(p) === i).slice(0, 6);
        return {
            mode: c.mode === 'pomodoro' ? 'pomodoro' : 'timer',
            look: ['ring', 'bar', 'row'].includes(c.look) ? c.look : DEFAULTS.look,
            presets: presets.length ? presets : DEFAULTS.presets.slice(),
            focus: wholeMinutes(c.focusMinutes, 1, 180, DEFAULTS.focus),
            short: wholeMinutes(c.shortBreakMinutes, 1, 60, DEFAULTS.short),
            long: wholeMinutes(c.longBreakMinutes, 1, 90, DEFAULTS.long),
            rounds: wholeMinutes(c.rounds, 2, 8, DEFAULTS.rounds),
            autoNext: c.autoNext === true,
            sound: c.sound !== false,
            notify: c.notify === true,
            title: String(widget?.title || '').trim(),
        };
    }

    /** The settings that count now: the run's own, overlaid with the widget's latest. */
    function live(entry) {
        return entry.nextCfg ? { ...entry.cfg, ...entry.nextCfg } : entry.cfg;
    }

    /* ---------- Store ---------- */

    let memory = {};

    function readStore() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
            return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        } catch {
            return memory;
        }
    }

    function writeStore(all) {
        memory = all;
        try {
            localStorage.setItem(STORE, JSON.stringify(all));
        } catch { /* a timer without storage lives in memory until the page goes */ }
    }

    function dayOf(ms) {
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /* ---------- Phases (pure) ---------- */

    function lengthOf(entry, phase) {
        const c = entry.cfg;
        if (phase === 'focus') return c.focus * MIN;
        if (phase === 'short') return c.short * MIN;
        if (phase === 'long') return c.long * MIN;
        return (entry.m || c.presets[0] || 10) * MIN;
    }

    function fresh(cfg, today, now) {
        const entry = {
            mode: cfg.mode, phase: cfg.mode === 'pomodoro' ? 'focus' : 'timer', round: 0,
            m: cfg.presets[0], total: 0, left: 0, endsAt: 0, finished: false, endedAt: 0,
            day: today ? today.day : '', today: today ? today.count : 0, cfg, touched: now || Date.now(),
        };
        entry.total = entry.left = lengthOf(entry, entry.phase);
        return entry;
    }

    /**
     * Which phase follows the one that ended. `round` counts focus rounds done in
     * this cycle: it stays at the full count through the long break, so the dots
     * are all lit there, and starts again with the next focus. A skipped focus
     * phase is not a round done.
     */
    function phaseAfter(entry, skipped) {
        if (entry.mode !== 'pomodoro') return { phase: 'timer', round: 0 };
        if (entry.phase === 'focus') {
            if (skipped) return { phase: 'short', round: entry.round };
            const rounds = live(entry).rounds;
            const round = entry.round + 1;
            return round >= rounds ? { phase: 'long', round: rounds } : { phase: 'short', round };
        }
        return { phase: 'focus', round: entry.phase === 'long' ? 0 : entry.round };
    }

    /** Move to the next phase, idle, or running from startAt when one is given. */
    function advance(entry, startAt, skipped) {
        const next = phaseAfter(entry, skipped);
        // The settings as they are now, taken over at the start of a phase.
        entry.cfg = live(entry);
        delete entry.nextCfg;
        entry.phase = next.phase;
        entry.round = next.round;
        entry.total = entry.left = lengthOf(entry, next.phase);
        entry.finished = false;
        entry.endsAt = startAt ? startAt + entry.total : 0;
    }

    function rollDay(entry, ms) {
        const day = dayOf(ms);
        if (entry.day !== day) {
            entry.day = day;
            entry.today = 0;
        }
    }

    /**
     * Settle every phase whose end has passed. A pomodoro that goes on by itself
     * can have ended several phases while the laptop slept; they are all walked
     * and the last one that ended is reported once, and kept as `unseen` until
     * somebody looks, because nothing else marks it when the chain runs on.
     */
    function settle(entry, now) {
        let ended = null;
        for (let guard = 0; guard < 500 && entry.endsAt && entry.endsAt <= now; guard += 1) {
            ended = { phase: entry.phase, at: entry.endsAt };
            entry.endedAt = entry.endsAt;
            if (entry.phase === 'focus') {
                rollDay(entry, entry.endsAt);
                entry.today += 1;
            }
            if (entry.mode === 'pomodoro' && live(entry).autoNext) {
                advance(entry, entry.endsAt);
            } else {
                entry.finished = true;
                entry.left = 0;
                entry.endsAt = 0;
            }
        }
        if (ended && !entry.finished) entry.unseen = { phase: ended.phase, at: ended.at };
        return ended;
    }

    function remaining(entry, now) {
        return entry.endsAt ? Math.max(0, entry.endsAt - now) : entry.left;
    }

    function stateOf(entry) {
        if (entry.finished) return 'done';
        if (entry.endsAt) return 'run';
        return entry.left < entry.total ? 'pause' : 'idle';
    }

    /** State that cannot be real (a clock set back, a hand-edited store) starts over. */
    function sane(entry, now) {
        if (!entry || typeof entry !== 'object' || !entry.cfg || !entry.total) return false;
        if (entry.endsAt && entry.endsAt - now > entry.total + 5000) return false;
        // A little over is a clock set back a moment, and is clamped on load.
        return Number.isFinite(entry.left) && entry.left >= 0 && entry.left <= entry.total + 5000;
    }

    function start(entry, now) {
        if (entry.finished) return;
        if (entry.left <= 0) entry.left = entry.total;
        entry.endsAt = now + entry.left;
    }

    function pause(entry, now) {
        entry.left = Math.max(1000, entry.endsAt - now);
        entry.endsAt = 0;
    }

    function reset(entry) {
        entry.finished = false;
        entry.endsAt = 0;
        entry.total = entry.left = lengthOf(entry, entry.phase);
    }

    /** Answer a finished run: the next phase, waiting for a click. */
    function acknowledge(entry) {
        delete entry.unseen;
        if (!entry.finished) return;
        advance(entry, 0);
    }

    /* ---------- Alarm ---------- */

    /** One claim per run end, the last thirty kept, so two runs ending together do not hide each other. */
    let rungMemory = [];

    function claimRung(key) {
        let list = rungMemory;
        try {
            const raw = JSON.parse(localStorage.getItem(RUNG) || '[]');
            if (Array.isArray(raw)) list = raw;
        } catch { /* this page's own list */ }
        if (list.includes(key)) return false;
        list = list.concat(key).slice(-30);
        rungMemory = list;
        try {
            localStorage.setItem(RUNG, JSON.stringify(list));
        } catch { /* without storage this page rings for itself */ }
        return true;
    }

    const PHASE_NAMES = {
        timer: ['dashboard.widgetTimerPhaseTimer', 'Timer'],
        focus: ['dashboard.widgetTimerPhaseFocus', 'Focus'],
        short: ['dashboard.widgetTimerPhaseShort', 'Short break'],
        long: ['dashboard.widgetTimerPhaseLong', 'Long break'],
    };

    function phaseName(dash, phase) {
        const entry = PHASE_NAMES[phase] || PHASE_NAMES.timer;
        return label(dash, entry[0], entry[1]);
    }

    function ring(id, entry, ended) {
        if (!claimRung(`${id}|${ended.at}`)) return;
        const settings = live(entry);
        if (settings.sound) {
            // `free`: the timer's own chime does not use up the bell's five-minute tone slot.
            try { void window.NotificationBell?.playSound?.('chime', [`timer|${id}|${ended.at}`], { free: true }); } catch { /* silent */ }
        }
        if (settings.notify && typeof Notification === 'function' && Notification.permission === 'granted') {
            try {
                const dash = dashNow();
                const name = settings.title || phaseName(dash, ended.phase);
                new Notification(label(dash, 'dashboard.widgetTimerDone', 'Time is up'), {
                    body: name, tag: `nextdash-timer-${id}`,
                });
            } catch { /* a refused notification is not an error */ }
        }
    }

    /** The runs that ended and wait for an answer, oldest first: a finished one, or a chain that ran on unseen. */
    function finished() {
        const all = readStore();
        return Object.keys(all)
            .filter((id) => all[id] && (all[id].finished || all[id].unseen))
            .map((id) => {
                const entry = all[id];
                return entry.finished
                    ? { id, entry, at: entry.endedAt, phase: entry.phase }
                    : { id, entry, at: entry.unseen.at, phase: entry.unseen.phase };
            })
            .sort((a, b) => a.at - b.at);
    }

    // When the tab went hidden: only what ended since then marks the title. A tab
    // that starts hidden counts everything that is waiting.
    let hiddenAt = document.hidden ? 0 : Infinity;
    let lastAlarmKey = null;

    function paintAlarm() {
        const list = finished();
        const unseenByReader = list.filter((item) => item.at >= hiddenAt).length;
        window.FeedWatchTabBadge?.setAlarm?.(document.hidden ? unseenByReader : 0);
        // The bell panel is rebuilt by a refresh, so ask only when the waiting set changed.
        const key = list.map((item) => `${item.id}@${item.at}`).join(',');
        if (key !== lastAlarmKey && window.TimerBellSource) {
            lastAlarmKey = key;
            window.TimerBellSource.refresh();
        }
    }

    /* ---------- Settling, scheduling, repaint ---------- */

    let timeout = 0;

    function emit() {
        window.dispatchEvent(new Event(EVENT));
    }

    /**
     * Settle what has ended. `fromTick` is the one-second repaint of a widget on
     * screen: it only settles, and leaves the end timeout and the alarm alone
     * unless something changed, so it costs a read and nothing else.
     */
    function settleAll(fromTick) {
        const now = Date.now();
        const all = readStore();
        let changed = false;
        Object.keys(all).forEach((id) => {
            const entry = all[id];
            if (!entry) return;
            if (!entry.endsAt && !entry.finished && !entry.unseen && now - (entry.touched || now) > STALE_MS) {
                delete all[id];
                changed = true;
                return;
            }
            if (entry.endsAt && entry.endsAt <= now) {
                const ended = settle(entry, now);
                changed = true;
                if (ended) ring(id, entry, ended);
            }
        });
        if (changed) {
            writeStore(all);
            emit();
        }
        if (changed || !fromTick) {
            schedule();
            paintAlarm();
        }
    }

    function schedule() {
        clearTimeout(timeout);
        timeout = 0;
        const now = Date.now();
        const all = readStore();
        const next = Object.keys(all).reduce((soon, id) => {
            const at = all[id]?.endsAt;
            return at && (!soon || at < soon) ? at : soon;
        }, 0);
        if (!next) return;
        timeout = setTimeout(() => settleAll(), Math.min(MAX_TIMEOUT, Math.max(50, next - now + 20)));
    }

    /** Save one entry and let every widget and the alarm know. */
    function commit(id, entry) {
        entry.touched = Date.now();
        const all = readStore();
        all[id] = entry;
        writeStore(all);
        emit();
        schedule();
        paintAlarm();
    }

    /** The widget is gone: its run goes with it. */
    function forget(id) {
        const all = readStore();
        if (!all[id]) return;
        delete all[id];
        writeStore(all);
        // No repaint: a widget still drawn for a moment would start a new run under its id.
        schedule();
        paintAlarm();
    }

    /* ---------- Drawing ---------- */

    const bodies = new Set();
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const R = 66;
    const C = 2 * Math.PI * R;

    function format(ms) {
        const secs = Math.ceil(ms / 1000);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(className, text, onClick, aria) {
        const b = el('button', className, text);
        b.type = 'button';
        if (aria) b.setAttribute('aria-label', aria);
        b.addEventListener('click', onClick);
        return b;
    }

    /**
     * Load this widget's run and bring it in step with the widget. Kept as it is
     * while it goes (also when the kind of timer was changed: the new kind starts
     * at the next idle draw), started over when it is missing or unreal. The
     * store is written only when something actually changed, so two tabs that
     * differ cannot keep rewriting each other's copy.
     */
    function loadEntry(id, cfg, now) {
        const all = readStore();
        let entry = all[id];
        const before = JSON.stringify(entry || null);
        const today = entry && entry.day === dayOf(now) ? { day: entry.day, count: entry.today } : { day: dayOf(now), count: 0 };
        if (!sane(entry, now) || (entry.mode !== cfg.mode && stateOf(entry) === 'idle')) {
            entry = fresh(cfg, today, now);
        } else {
            entry.left = Math.min(entry.left, entry.total);
            entry.nextCfg = cfg;
            const state = stateOf(entry);
            if (state === 'idle') {
                entry.cfg = cfg;
                entry.total = entry.left = lengthOf(entry, entry.phase);
            } else if (state === 'pause') {
                entry.cfg = { ...cfg };
            } else {
                entry.cfg = { ...entry.cfg, title: cfg.title, look: cfg.look };
            }
        }
        // A chain that ran on while nobody looked is seen once the widget is drawn in a visible tab.
        if (!document.hidden) delete entry.unseen;
        if (JSON.stringify(entry) !== before) {
            all[id] = entry;
            writeStore(all);
        }
        return entry;
    }

    function drawTimer(body, widget, dash) {
        const id = String(widget?.id || '');
        // Before anything else, so a repaint from the settling below draws this widget.
        body._ndTimerRedraw = () => drawTimer(body, widget, dash);
        // Settle first: a run that ended repaints every widget through the store event.
        if (id) settleAll();
        const panel = U().panel(body);
        bodies.add(body);
        if (!id) {
            U().say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.widgetTimerNoId', 'Save the widget first.'));
            return;
        }
        const cfg = cfgOf(widget);
        const now = Date.now();
        let entry = loadEntry(id, cfg, now);
        const state = stateOf(entry);
        const pomodoro = entry.mode === 'pomodoro';
        const wrap = el('div', `dashboard-timer is-${cfg.look} is-${state}`);
        wrap.dataset.timerState = state;
        wrap.dataset.timerPhase = entry.phase;

        const save = () => commit(id, entry);
        /** A click: settle what ended on the way, read the run fresh, change it, save it. */
        const act = (fn) => () => {
            settleAll();
            const at = Date.now();
            entry = readStore()[id] || entry;
            fn(at, stateOf(entry));
            save();
            body.querySelector('[data-timer-primary]')?.focus();
        };

        const name = el('div', 'dashboard-timer-phase', entry.finished
            ? label(dash, 'dashboard.widgetTimerDoneLine', '{phase} is done').replace('{phase}', phaseName(dash, entry.phase))
            : phaseName(dash, entry.phase));
        name.setAttribute('role', 'status');
        const figure = el('div', 'dashboard-timer-figure', format(remaining(entry, now)));
        figure.setAttribute('role', 'timer');

        const progress = () => (entry.total ? Math.min(100, Math.max(0, (1 - remaining(entry, Date.now()) / entry.total) * 100)) : 0);

        const primaryText = { idle: ['dashboard.widgetTimerStart', 'Start'], run: ['dashboard.widgetTimerPause', 'Pause'], pause: ['dashboard.widgetTimerResume', 'Resume'], done: ['dashboard.widgetTimerStop', 'Stop alarm'] }[state];
        const primaryLabel = label(dash, primaryText[0], primaryText[1]);
        const primaryAction = act((at, st) => {
            if (st === 'idle' || st === 'pause') {
                start(entry, at);
                if (live(entry).notify && typeof Notification === 'function' && Notification.permission === 'default') {
                    try { void Notification.requestPermission(); } catch { /* ignored */ }
                }
            } else if (st === 'run') pause(entry, at);
            else if (st === 'done') acknowledge(entry);
        });
        const resetAction = act(() => reset(entry));
        const skipAction = act(() => advance(entry, 0, true));

        const symbol = { idle: '▶', run: '❚❚', pause: '▶', done: '■' }[state];
        const primary = cfg.look === 'row'
            ? button('dashboard-timer-round is-primary', symbol, primaryAction, primaryLabel)
            : button('dashboard-timer-btn is-primary', primaryLabel, primaryAction);
        primary.dataset.timerPrimary = '1';

        const secondary = (text, key, fallback, action, glyph) => (cfg.look === 'row'
            ? button('dashboard-timer-round', glyph, action, label(dash, key, fallback))
            : button('dashboard-timer-btn', label(dash, key, fallback), action));
        const extras = [];
        if (pomodoro && state !== 'done') {
            extras.push(secondary('skip', 'dashboard.widgetTimerSkip', 'Skip', skipAction, '⏭'));
        }
        if (state === 'run' || state === 'pause') {
            extras.push(secondary('reset', 'dashboard.widgetTimerReset', 'Reset', resetAction, '↺'));
        }

        let dots = null;
        if (pomodoro) {
            dots = el('div', 'dashboard-timer-rounds');
            const row = el('div', 'dashboard-timer-dots');
            const total = entry.cfg.rounds;
            for (let i = 0; i < total; i += 1) {
                row.appendChild(el('span', `dashboard-timer-dot${i < entry.round ? ' is-on' : ''}`));
            }
            const today = entry.day === dayOf(now) ? entry.today : 0;
            const shown = Math.min(total, Math.max(1, entry.round + (entry.phase === 'focus' ? 1 : 0)));
            const line = el('div', 'dashboard-timer-count', label(dash, 'dashboard.widgetTimerRoundLine', 'round {round} of {rounds} · {today} today')
                .replace('{round}', String(shown)).replace('{rounds}', String(total)).replace('{today}', String(today)));
            dots.append(row, line);
        }

        let presets = null;
        let bar = null;
        let ringArc = null;
        const paint = () => {
            figure.textContent = format(remaining(entry, Date.now()));
            const pct = progress();
            if (ringArc) ringArc.setAttribute('stroke-dashoffset', String(C * (1 - pct / 100)));
            if (bar) bar.style.width = `${pct}%`;
        };
        if (!pomodoro && state === 'idle') {
            presets = el('div', 'dashboard-timer-presets');
            const choose = (minutes) => act(() => {
                entry.m = minutes;
                entry.total = entry.left = minutes * MIN;
            });
            entry.cfg.presets.forEach((m) => {
                const chip = button(`dashboard-timer-chip${m === entry.m ? ' is-on' : ''}`, `${m} ${label(dash, 'dashboard.widgetTimerMin', 'min')}`, choose(m));
                chip.setAttribute('aria-pressed', String(m === entry.m));
                presets.appendChild(chip);
            });
            const input = el('input', 'dashboard-timer-custom');
            input.type = 'number';
            input.min = '1';
            input.max = '600';
            input.placeholder = label(dash, 'dashboard.widgetTimerCustom', 'own');
            input.setAttribute('aria-label', label(dash, 'dashboard.widgetTimerCustomLabel', 'Minutes'));
            // Quietly: the field loses focus on the mousedown of Start, and a redraw
            // there would swap the button out from under the click.
            input.addEventListener('change', () => {
                const minutes = wholeMinutes(input.value, 1, 600, 0);
                if (!minutes) return;
                entry = readStore()[id] || entry;
                if (stateOf(entry) !== 'idle') return;
                entry.m = minutes;
                entry.total = entry.left = minutes * MIN;
                entry.touched = Date.now();
                const all = readStore();
                all[id] = entry;
                writeStore(all);
                presets.querySelectorAll('.dashboard-timer-chip').forEach((chip) => {
                    chip.classList.remove('is-on');
                    chip.setAttribute('aria-pressed', 'false');
                });
                paint();
            });
            presets.appendChild(input);
        }

        const buttons = el('div', 'dashboard-timer-buttons');
        buttons.append(primary, ...extras);

        if (cfg.look === 'ring') {
            const box = el('div', 'dashboard-timer-ring');
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('viewBox', '0 0 150 150');
            svg.setAttribute('aria-hidden', 'true');
            const track = document.createElementNS(SVG_NS, 'circle');
            const arc = document.createElementNS(SVG_NS, 'circle');
            [track, arc].forEach((c, i) => {
                c.setAttribute('cx', '75'); c.setAttribute('cy', '75'); c.setAttribute('r', String(R));
                c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '6');
                c.setAttribute('class', i ? 'dashboard-timer-arc' : 'dashboard-timer-track');
            });
            arc.setAttribute('stroke-linecap', 'round');
            arc.setAttribute('stroke-dasharray', String(C));
            svg.append(track, arc);
            const inner = el('div', 'dashboard-timer-inner');
            inner.append(name, figure);
            box.append(svg, inner);
            ringArc = arc;
            wrap.append(box);
        } else if (cfg.look === 'bar') {
            bar = el('i');
            const track = el('div', 'dashboard-timer-bar');
            track.appendChild(bar);
            wrap.append(name, figure, track);
        } else {
            bar = el('i');
            const mini = el('div', 'dashboard-timer-mini');
            mini.appendChild(bar);
            const grow = el('div', 'dashboard-timer-grow');
            grow.append(figure, name, mini);
            if (dots) grow.appendChild(dots);
            wrap.append(primary, grow, ...extras);
        }
        if (cfg.look !== 'row') {
            if (dots) wrap.appendChild(dots);
            if (presets) wrap.appendChild(presets);
            wrap.appendChild(buttons);
        } else if (presets) {
            wrap.appendChild(presets);
        }

        paint();
        panel.appendChild(wrap);

        const ticker = window.DashboardWidgetTime;
        if (state === 'run' && ticker) {
            ticker.keepTicking(body, 1000, () => {
                settleAll(true);
                const current = readStore()[id];
                // Gone from the store: its widget was deleted, and a repaint would start a new run.
                if (!current) { ticker.stopTicking(body); return; }
                if (stateOf(current) !== 'run') { drawTimer(body, widget, dash); return; }
                entry = current;
                paint();
            });
        } else if (ticker) {
            ticker.stopTicking(body);
        }
    }

    function redrawAll() {
        bodies.forEach((body) => {
            if (!body.isConnected) { bodies.delete(body); return; }
            body._ndTimerRedraw?.();
        });
    }

    window.addEventListener(EVENT, redrawAll);
    window.addEventListener('storage', (event) => {
        if (event.key !== STORE) return;
        schedule();
        paintAlarm();
        redrawAll();
    });
    document.addEventListener('visibilitychange', () => {
        hiddenAt = document.hidden ? Date.now() : Infinity;
        settleAll();
        if (!document.hidden) redrawAll();
    });
    // The tab badge and the bell load after this file: look again once everything is there.
    window.addEventListener('load', () => { lastAlarmKey = null; paintAlarm(); }, { once: true });

    /** Answer every waiting run, from the bell row. */
    function acknowledgeAll() {
        const all = readStore();
        Object.keys(all).forEach((id) => { if (all[id]) acknowledge(all[id]); });
        writeStore(all);
        emit();
        paintAlarm();
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.timer = drawTimer;
    // For the tests and the bell row: the arithmetic apart from the drawing.
    window.DashboardWidgetTimer = {
        cfgOf, fresh, settle, advance, phaseAfter, remaining, stateOf, sane, start, pause, reset, acknowledge,
        format, finished, acknowledgeAll, phaseName, settleAll, forget,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => settleAll(), { once: true });
    else settleAll();
}());
