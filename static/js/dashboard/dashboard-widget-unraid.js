/**
 * The Unraid widgets: the server set under Config → Containers → Unraid, read
 * through /api/unraid/area/*. One connection for all of them; a widget only
 * says how it draws.
 *
 * The server does every unit and judgement (unraid_model.go): bytes, tones,
 * which disk is a problem. Here is only drawing. An area the key may not read,
 * or this Unraid version does not have, is left out rather than shown as an
 * error -- except on the tile that is about nothing else.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;
    const bytes = (n) => window.DashboardWidgetSystem.formatBytes(n);
    const label = (dash, key, fallback) => U().label(dash, key, fallback);

    async function fetchArea(area) {
        try {
            const res = await fetch(`/api/unraid/area/${area}`, { cache: 'no-store' });
            if (!res.ok) return { area, status: 'unreachable' };
            return await res.json();
        } catch {
            return { area, status: 'unreachable' };
        }
    }

    /** The sentence a tile shows instead of its figures, or null when it can draw. */
    function unavailable(dash, result) {
        const map = {
            'not-configured': ['dashboard.widgetUnraidNotConnected', 'Not connected. Add the server under Config → Containers → Unraid.'],
            forbidden: ['dashboard.widgetUnraidForbidden', 'This API key may not read this. Give it the permission in Unraid, or hide this widget.'],
            unsupported: ['dashboard.widgetUnraidUnsupported', 'This Unraid version does not offer this in its API.'],
            unauthorized: ['dashboard.widgetUnraidUnauthorized', 'Unraid refused the API key. Check it under Config → Containers → Unraid.'],
        };
        if (result?.status === 'ok') return null;
        if (result?.status === 'unreachable' && result.data) return null; // drawn stale, with a note
        const [key, fallback] = map[result?.status] || ['dashboard.widgetUnraidUnreachable', 'The Unraid server did not answer.'];
        return label(dash, key, fallback);
    }

    function staleNote(dash, result) {
        if (result?.status !== 'unreachable' || !result.lastOkAt) return null;
        const mins = Math.max(1, Math.round((Date.now() - result.lastOkAt) / 60000));
        return U().footnote(label(dash, 'dashboard.widgetUnraidStale', 'did not answer — last reading {age} min ago')
            .replace('{age}', String(mins)), 'bad');
    }

    /*
     * A click that opens a page of the Unraid web UI, or null when there is
     * none to open. The address goes through the same check a bookmark's does,
     * so a base URL that is not http(s) opens nothing rather than anything.
     * The function carries its address, so a row can offer "open in new tab".
     */
    function openUnraid(widget, dash, pagePath) {
        if (widget?.config?.click === 'none') return null;
        const base = dash?._unraidBaseUrl;
        if (!base) return null;
        const href = window.BookmarkUrlUtils?.safeHttpResourceUrl?.(String(base).replace(/\/+$/, '') + pagePath) || '';
        if (!href) return null;
        const open = () => window.open(href, '_blank', 'noopener,noreferrer');
        open.href = href;
        return open;
    }

    /** What a row that opens Unraid says it does, for the menu and the keyboard. */
    function rowAction(dash, open) {
        return {
            dash,
            href: open?.href,
            labelKey: 'dashboard.widgetActionOpenUnraid',
            labelFallback: 'Open in Unraid',
        };
    }

    // Asked until there is an answer: a server added after the page loaded
    // gets its links on the next refresh rather than after a reload.
    async function knowBase(dash) {
        if (dash._unraidBaseUrl) return;
        dash._unraidBaseUrl = null;
        try {
            const res = await fetch('/api/unraid/settings', { cache: 'no-store' });
            const body = await res.json();
            dash._unraidBaseUrl = body?.server?.baseUrl || null;
        } catch { /* links stay off */ }
    }

    function begin(body, widget, dash, result) {
        const u = U();
        const panel = u.panel(body);
        const why = unavailable(dash, result);
        if (why) {
            u.say(panel, 'dashboard-widget-empty', why);
            if (result?.status === 'not-configured') {
                const link = u.row(label(dash, 'dashboard.widgetUnraidSetUp', 'Set up Unraid'), '', null,
                    () => u.openConfigTab(dash, 'containers'), { dash });
                panel.appendChild(link);
            }
            return null;
        }
        const stale = staleNote(dash, result);
        if (stale) panel.appendChild(stale);
        return panel;
    }

    function end(panel, widget, dash, result) {
        const age = U().asOf(dash, result?.fetchedAt, { intervalMs: U().refreshMs(widget, dash) });
        if (age) panel.appendChild(age);
    }

    /** A disk that needs looking at; "full" is a fill colour, not a problem. */
    const isProblem = (d) => !!d.problem && d.problem !== 'full';

    /** Problem disks worst first: bad before warn, then the order of the array. */
    function worstFirst(disks) {
        const rank = (d) => (d.tone === 'bad' ? 0 : 1);
        return disks.filter(isProblem)
            .map((d, i) => ({ d, i }))
            .sort((x, y) => rank(x.d) - rank(y.d) || x.i - y.i)
            .map((x) => x.d);
    }

    /* ── Overview (mockup B: a line per subject) ─────────────────────────── */

    async function renderOverview(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('overview');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const o = result.data || {};
        const u = U();
        const list = u.rowList(false);
        list.classList.add('unraid-columns');
        const L = (key, fallback) => label(dash, key, fallback);
        const add = (name, detail, tone, page, wideOnly) => {
            const open = openUnraid(widget, dash, page);
            const row = u.row(name, detail, tone, open, rowAction(dash, open));
            if (wideOnly) row.classList.add('dashboard-widget-wide-only');
            list.appendChild(row);
        };

        if (o.array) {
            add(L('dashboard.widgetUnraidArray', 'array'),
                o.array.started ? L('dashboard.widgetUnraidStarted', 'started') : String(o.array.state || '').toLowerCase(),
                o.array.started ? 'good' : 'warn', '/Main');
            add(L('dashboard.widgetUnraidUsed', 'used'),
                `${Math.round(o.array.usedPct)}% · ${bytes(o.array.freeBytes)} ${L('dashboard.widgetUnraidFree', 'free')}`,
                o.array.usedPct >= 90 ? 'warn' : 'good', '/Main');
        }
        if (o.parity) {
            const p = o.parity;
            const detail = p.running
                ? L('dashboard.widgetUnraidParityRunning', '{pct}% running').replace('{pct}', p.progress)
                : p.last ? L('dashboard.widgetUnraidParityLast', '{age} · {n} errors')
                    .replace('{age}', ageText(dash, p.last.date)).replace('{n}', p.last.errors)
                    : L('dashboard.widgetUnraidParityNever', 'never run');
            add(L('dashboard.widgetUnraidParity', 'parity'), detail, p.last?.errors > 0 ? 'bad' : (p.running ? 'warn' : 'good'), '/Main');
        }
        if (o.array) {
            const bad = worstFirst(o.array.disks || []);
            const first = bad[0];
            const detail = first
                ? `${first.name} · ${problemText(dash, first)}${bad.length > 1 ? ` +${bad.length - 1}` : ''}`
                : L('dashboard.widgetUnraidDisksFine', '{n} fine').replace('{n}', o.array.diskCount);
            add(L('dashboard.widgetUnraidDisks', 'disks'), detail, first ? first.tone : 'good', '/Main');
        }
        if (o.notifications) {
            const n = o.notifications;
            add(L('dashboard.widgetUnraidAlerts', 'alerts'),
                n.alerts ? L('dashboard.widgetUnraidUnread', '{n} unread').replace('{n}', n.alerts) : L('dashboard.widgetUnraidNone', 'none'),
                n.alerts ? 'bad' : 'good', '/Tools/Notifications');
            const newest = (n.items || []).find((i) => i.importance === 'alert');
            if (newest) add(L('dashboard.widgetUnraidAlert', 'alert'), newest.subject, 'bad', newest.link || '/Tools/Notifications', true);
        }
        if (o.fullestShare) {
            add(L('dashboard.widgetUnraidShare', 'share'), `${o.fullestShare.name} ${Math.round(o.fullestShare.usedPct)}%`,
                o.fullestShare.tone, '/Shares', true);
        }
        if (o.vms) {
            const running = o.vms.filter((v) => v.state === 'running').length;
            add(L('dashboard.widgetUnraidVMs', 'VMs'),
                L('dashboard.widgetUnraidOfRunning', '{n} of {total} running').replace('{n}', running).replace('{total}', o.vms.length),
                o.vms.some((v) => v.state === 'crashed') ? 'bad' : 'good', '/VMs');
        }
        if (o.ups) {
            add(L('dashboard.widgetUnraidUPS', 'UPS'), `${o.ups.charge}% · ${durationText(o.ups.runtimeSec)}`, o.ups.tone, '/Dashboard');
        }
        panel.appendChild(list);
        if (o.info?.name) {
            panel.appendChild(u.footnote([o.info.name, o.info.unraid].filter(Boolean).join(' · ')));
        }
        end(panel, widget, dash, result);
    }

    /* ── Array (mockup A: a row per disk) ────────────────────────────────── */

    async function renderArray(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('array');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const a = result.data || {};
        const u = U();
        const L = (key, fallback) => label(dash, key, fallback);
        const open = openUnraid(widget, dash, '/Main');
        const action = rowAction(dash, open);
        const state = a.started ? L('dashboard.widgetUnraidStartedCap', 'Started') : a.state;

        // Narrow: the headline and the bar. Wide: four figures say the same and more.
        const head = u.headline(state,
            L('dashboard.widgetUnraidUsedOf', '{used} of {total} · {free} free')
                .replace('{used}', bytes(a.usedBytes)).replace('{total}', bytes(a.totalBytes)).replace('{free}', bytes(a.freeBytes)));
        head.classList.add('dashboard-widget-narrow-only');
        panel.appendChild(head);
        const bar = u.meter(a.usedBytes, a.totalBytes, a.usedPct >= 90 ? 'warn' : 'good');
        bar.classList.add('dashboard-widget-narrow-only');
        panel.appendChild(bar);

        const stats = u.statGrid([
            { value: state, label: L('dashboard.widgetUnraidArray', 'array'), tone: a.started ? 'good' : 'warn' },
            { value: bytes(a.freeBytes), label: L('dashboard.widgetUnraidFreeOf', 'free of {total}').replace('{total}', bytes(a.totalBytes)) },
            { value: String(a.problemDisks), label: L('dashboard.widgetUnraidProblemDisks', 'disks with a problem'), tone: a.problemDisks ? 'bad' : 'good' },
            { value: `${a.spinning} / ${a.diskCount}`, label: L('dashboard.widgetUnraidSpinning', 'spinning') },
        ]);
        stats.classList.add('dashboard-widget-wide-only');
        panel.appendChild(stats);

        // Narrow: only the problems, worst first, or "N disks fine".
        const narrow = u.rowList(false);
        narrow.classList.add('dashboard-widget-narrow-only');
        const problems = worstFirst(a.disks || []);
        problems.forEach((d) => narrow.appendChild(u.row(d.name, problemText(dash, d), d.tone, open, action)));
        if (!problems.length) {
            narrow.appendChild(u.row(L('dashboard.widgetUnraidAllFine', '{n} disks fine').replace('{n}', a.diskCount),
                '', 'good', open, action));
        }
        panel.appendChild(narrow);

        // Wide: every disk, grouped as Unraid groups them, down two columns.
        const list = u.rowList(false);
        list.classList.add('unraid-columns');
        let lastGroup = '';
        (a.disks || []).forEach((d) => {
            if (d.group !== lastGroup) {
                const group = document.createElement('div');
                group.className = 'dashboard-widget-group dashboard-widget-wide-only';
                group.textContent = L(`dashboard.widgetUnraidGroup.${d.group}`, d.group);
                list.appendChild(group);
                lastGroup = d.group;
            }
            const right = isProblem(d) ? problemText(dash, d)
                : d.asleep ? L('dashboard.widgetUnraidAsleep', 'asleep')
                : d.tempC != null ? `${d.tempC}°C` : '';
            const fill = d.totalBytes > 0 ? `${Math.round(d.usedPct)}%` : '';
            const row = u.row(d.name, [fill, right].filter(Boolean).join(' · '), d.tone, open, action);
            row.classList.add('unraid-disk-row', 'dashboard-widget-wide-only');
            if (d.totalBytes > 0) {
                const meter = document.createElement('span');
                meter.className = `unraid-disk-bar unraid-disk-bar--${d.usedPct >= 90 ? 'warn' : 'good'}`;
                meter.style.setProperty('--fill', `${Math.round(d.usedPct)}%`);
                row.insertBefore(meter, row.lastChild);
            }
            list.appendChild(row);
        });
        panel.appendChild(list);
        end(panel, widget, dash, result);
    }

    function problemText(dash, d) {
        const L = (key, fallback) => label(dash, key, fallback);
        switch (d.problem) {
            case 'errors': return L('dashboard.widgetUnraidErrors', '{n} errors').replace('{n}', d.errors);
            case 'disabled': return L('dashboard.widgetUnraidDisabled', 'disabled');
            case 'missing': return L('dashboard.widgetUnraidMissing', 'missing');
            case 'hot': return `${d.tempC}°C`;
            case 'full': return `${Math.round(d.usedPct)}%`;
        }
        return '';
    }

    function ageText(dash, iso) {
        const t = Date.parse(iso);
        if (!t) return '';
        const days = Math.round((Date.now() - t) / 86_400_000);
        return days <= 0 ? label(dash, 'dashboard.widgetUnraidToday', 'today')
            : label(dash, 'dashboard.widgetUnraidDaysAgo', '{n} d ago').replace('{n}', days);
    }

    function durationText(sec) {
        const s = Number(sec) || 0;
        if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m`;
        return `${Math.round(s / 60)} min`;
    }

    /* ── Parity, shares, VMs, UPS, notifications ─────────────────────────── */

    async function renderParity(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('parity');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const p = result.data || {};
        const u = U();
        const L = (key, fallback) => label(dash, key, fallback);
        const open = openUnraid(widget, dash, '/Main');
        const action = rowAction(dash, open);
        const errorsText = (n) => L('dashboard.widgetUnraidErrors', '{n} errors').replace('{n}', n);
        if (p.running) {
            panel.appendChild(u.headline(`${p.progress}%`,
                (p.paused ? L('dashboard.widgetUnraidParityPaused', 'check paused') : L('dashboard.widgetUnraidParityCheck', 'check running'))
                + (p.speed ? ` · ${p.speed}` : '')));
            panel.appendChild(u.meter(p.progress, 100, p.paused ? 'warn' : 'good'));
            panel.appendChild(u.statGrid([
                { value: p.paused || !p.leftSec ? '—' : durationText(p.leftSec), label: L('dashboard.widgetUnraidLeft', 'left') },
                { value: String(p.errors), label: L('dashboard.widgetUnraidErrorsSoFar', 'errors so far'), tone: p.errors ? 'bad' : 'good' },
            ]));
        } else if (p.last) {
            panel.appendChild(u.headline(errorsText(p.last.errors),
                L('dashboard.widgetUnraidLastCheck', 'last check {age}').replace('{age}', ageText(dash, p.last.date))));
            panel.appendChild(u.statGrid([
                { value: durationText(p.last.durationSec), label: L('dashboard.widgetUnraidTook', 'took') },
                { value: p.last.speed || '—', label: L('dashboard.widgetUnraidAverage', 'average') },
            ]));
        } else {
            u.say(panel, 'dashboard-widget-empty', L('dashboard.widgetUnraidParityNeverLong', 'No parity check has run yet.'));
        }
        if ((p.history || []).length) {
            // Wide only: the narrow tile has no room for a history under the figures.
            const list = u.rowList(false);
            list.classList.add('dashboard-widget-wide-only');
            p.history.forEach((h) => {
                const when = new Date(h.date).toLocaleDateString([], { day: 'numeric', month: 'short' });
                list.appendChild(u.row(when,
                    [durationText(h.durationSec), h.speed, errorsText(h.errors)].filter(Boolean).join(' · '),
                    h.errors > 0 ? 'bad' : 'good', open, action));
            });
            panel.appendChild(list);
        }
        end(panel, widget, dash, result);
    }

    async function renderShares(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('shares');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const u = U();
        const shares = result.data || [];
        const limit = u.rowLimit(widget, 5);
        const open = openUnraid(widget, dash, '/Shares');
        const action = rowAction(dash, open);
        const list = u.rowList(false);
        shares.slice(0, limit).forEach((s) => {
            const row = u.row(s.name, `${Math.round(s.usedPct)}%`, s.tone, open, action);
            // Wide adds what the percentage alone leaves out.
            const extra = document.createElement('span');
            extra.className = 'dashboard-widget-wide-only dashboard-widget-row-extra';
            extra.textContent = ` · ${bytes(s.freeBytes)} ${label(dash, 'dashboard.widgetUnraidFree', 'free')}${s.cache ? ` · ${label(dash, 'dashboard.widgetUnraidCache', 'cache')}` : ''}`;
            row.querySelector('.dashboard-widget-row-detail')?.appendChild(extra);
            // The same bar the array rows carry, between the name and the reading.
            const meter = document.createElement('span');
            meter.className = `unraid-disk-bar unraid-disk-bar--${s.usedPct >= 90 ? 'warn' : 'good'}`;
            meter.style.setProperty('--fill', `${Math.round(s.usedPct)}%`);
            row.classList.add('unraid-disk-row');
            row.insertBefore(meter, row.lastChild);
            list.appendChild(row);
        });
        u.appendOverflowRow(list, dash, Math.max(0, shares.length - limit), open);
        panel.appendChild(list);
        end(panel, widget, dash, result);
    }

    async function renderVMs(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('vms');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const u = U();
        const vms = result.data || [];
        const running = vms.filter((v) => v.state === 'running').length;
        panel.appendChild(u.headline(String(running),
            label(dash, 'dashboard.widgetUnraidOfTotalRunning', 'of {total} running').replace('{total}', vms.length)));
        const limit = u.rowLimit(widget, 6);
        const open = openUnraid(widget, dash, '/VMs');
        const action = rowAction(dash, open);
        const list = u.rowList(true);
        vms.slice(0, limit).forEach((v) => {
            list.appendChild(u.row(v.name, label(dash, `dashboard.widgetUnraidVmState.${v.state}`, v.state), v.tone, open, action));
        });
        u.appendOverflowRow(list, dash, Math.max(0, vms.length - limit), open);
        panel.appendChild(list);
        end(panel, widget, dash, result);
    }

    async function renderUPS(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('ups');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const u = U();
        const L = (key, fallback) => label(dash, key, fallback);
        const ups = result.data || {};
        const head = u.headline(`${ups.charge}%`,
            ups.onBattery ? L('dashboard.widgetUnraidOnBattery', 'on battery') : L('dashboard.widgetUnraidOnLine', 'on line power'));
        if (ups.onBattery) head.querySelector('.dashboard-widget-headline-value')?.classList.add('dashboard-widget-headline-value--warn');
        panel.appendChild(head);
        panel.appendChild(u.meter(ups.charge, 100, ups.tone));
        panel.appendChild(u.statGrid([
            { value: durationText(ups.runtimeSec), label: L('dashboard.widgetUnraidRuntime', 'runtime'), tone: ups.onBattery ? 'warn' : undefined },
            { value: `${ups.loadPct}%`, label: L('dashboard.widgetUnraidLoad', 'load · {w} W').replace('{w}', ups.watts) },
        ]));
        if (ups.model) panel.appendChild(u.footnote(ups.model));
        end(panel, widget, dash, result);
    }

    async function renderNotifications(body, widget, dash) {
        await knowBase(dash);
        const result = await fetchArea('notifications');
        const panel = begin(body, widget, dash, result);
        if (!panel) return;
        const u = U();
        const L = (key, fallback) => label(dash, key, fallback);
        const n = result.data || {};
        const items = n.items || [];
        const limit = u.rowLimit(widget, 5);
        const tone = { alert: 'bad', warning: 'warn', info: 'good' };
        if (!items.length) {
            u.say(panel, 'dashboard-widget-empty', L('dashboard.widgetUnraidNoNotifications', 'Nothing unread.'));
        } else {
            const list = u.rowList(false);
            items.slice(0, limit).forEach((item) => {
                const link = String(item.link || '/Tools/Notifications');
                const open = openUnraid(widget, dash, link.startsWith('/') ? link : `/${link}`);
                list.appendChild(u.row(item.subject, item.at ? agoText(dash, item.at) : '',
                    tone[item.importance] || '', open, rowAction(dash, open)));
            });
            u.appendOverflowRow(list, dash, Math.max(0, items.length - limit),
                openUnraid(widget, dash, '/Tools/Notifications'));
            panel.appendChild(list);
        }
        if (n.alerts || n.warnings) {
            panel.appendChild(u.footnote(L('dashboard.widgetUnraidNotifCounts', 'alerts {a} · warnings {w} unread')
                .replace('{a}', n.alerts || 0).replace('{w}', n.warnings || 0)));
        }
        end(panel, widget, dash, result);
    }

    /** How long ago a moment in ms was: minutes, hours, then days. */
    function agoText(dash, ms) {
        const mins = Math.round((Date.now() - ms) / 60000);
        const L = (key, fallback) => label(dash, key, fallback);
        if (mins < 60) return L('dashboard.widgetUnraidMinutes', '{n} min').replace('{n}', Math.max(1, mins));
        if (mins < 1440) return L('dashboard.widgetUnraidHours', '{n} h').replace('{n}', Math.round(mins / 60));
        return L('dashboard.widgetUnraidDays', '{n} d').replace('{n}', Math.round(mins / 1440));
    }

    window.DashboardUnraid = { fetchArea, unavailable, openUnraid, rowAction, begin, end, knowBase, problemText, ageText, durationText };
    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.unraid = renderOverview;
    window.DashboardWidgets.unraidArray = renderArray;
    window.DashboardWidgets.unraidParity = renderParity;
    window.DashboardWidgets.unraidShares = renderShares;
    window.DashboardWidgets.unraidVms = renderVMs;
    window.DashboardWidgets.unraidUps = renderUPS;
    window.DashboardWidgets.unraidNotifications = renderNotifications;
}());
