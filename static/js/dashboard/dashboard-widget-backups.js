/**
 * The backups widget: how old the newest one is, and whether the last run worked.
 *
 * The figure nobody wants and everybody needs. A backup schedule that quietly
 * stopped six weeks ago looks exactly like one that ran this morning, right up
 * until the moment it matters — so the age is the headline and the failure is
 * said out loud rather than left in a log.
 *
 * Behind the write token, like the rest of the backup routes, so this uses the
 * token-carrying fetch and says plainly when this browser is not carrying one
 * rather than rendering an empty tile that reads as "no backups".
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    async function load(dash) {
        if (dash._widgetBackups) return dash._widgetBackups;
        try {
            const res = await U().authFetch('/api/auto-backups');
            if (!res.ok) {
                dash._widgetBackups = { denied: res.status === 401 || res.status === 403 };
                return dash._widgetBackups;
            }
            dash._widgetBackups = await res.json();
            return dash._widgetBackups;
        } catch (_error) {
            return null;
        }
    }

    /** RFC3339 from the server, as a timestamp — 0 when it is absent or unparseable. */
    function stamp(text) {
        const value = Date.parse(String(text || ''));
        return Number.isNaN(value) ? 0 : value;
    }

    function ageLabel(dash, days) {
        if (days === null) return label(dash, 'dashboard.widgetBackupsNever', 'never');
        if (days <= 0) return label(dash, 'dashboard.widgetBackupsToday', 'today');
        if (days === 1) return label(dash, 'dashboard.widgetBackupsYesterday', 'yesterday');
        return label(dash, 'dashboard.widgetBackupsDaysAgo', '{n}d ago').replace('{n}', String(days));
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const panel = u.panel(body);
        const open = () => u.openConfigTab(dash, 'data-backups', 'backups');

        if (data?.denied) {
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.widgetBackupsDenied',
                'This dashboard is not signed in for that.'));
            return;
        }

        const config = widget?.config || {};
        const showList = config.showList !== false;
        const maxRows = u.rowLimit(widget, 3);
        const backups = Array.isArray(data?.backups) ? data.backups : [];
        const keep = Number(data?.keep) || 0;
        const enabled = data?.enabled === true;
        const failure = String(data?.lastRunError || '').trim();

        // Newest first — the age of the newest is the whole question, and every
        // other row is only there to say the schedule has been running.
        const sorted = [...backups].sort((a, b) => stamp(b?.createdAt) - stamp(a?.createdAt));
        const newest = sorted[0] || null;
        const age = newest ? u.daysSince(stamp(newest.createdAt)) : null;

        /*
         * Tone from the age against the schedule, not against a fixed number.
         *
         * A weekly schedule with a six-day-old backup is working exactly as
         * asked; a daily one with the same backup has missed five runs. Without
         * the interval there is no way to tell those apart, and guessing would
         * mean crying wolf on half the installs.
         */
        const interval = Math.max(Number(data?.intervalDays) || 0, 0);
        const overdue = age !== null && interval > 0 && age > interval + 1;
        const tone = failure || age === null ? 'bad' : overdue ? 'warn' : 'good';

        panel.appendChild(u.headline(ageLabel(dash, age), newest
            ? label(dash, 'dashboard.widgetBackupsNewest', 'newest backup')
            : label(dash, 'dashboard.widgetBackupsNoneYet', 'no backup has been made')));

        if (keep > 0) panel.appendChild(u.meter(sorted.length, keep, tone));

        const nextAt = stamp(data?.nextBackupAt);
        const dueIn = nextAt ? Math.max(0, Math.ceil((nextAt - Date.now()) / u.DAY_MS)) : null;

        panel.appendChild(u.statGrid([
            {
                value: keep > 0 ? `${sorted.length}/${keep}` : String(sorted.length),
                label: label(dash, 'dashboard.widgetBackupsKept', 'kept'),
                title: keep > 0
                    ? label(dash, 'dashboard.widgetBackupsKeptAbout',
                        'A new one past {n} pushes the oldest out.').replace('{n}', String(keep))
                    : '',
                onOpen: open,
            },
            {
                value: Number(newest?.bookmarks) || '—',
                label: label(dash, 'dashboard.widgetBackupsBookmarks', 'bookmarks'),
                title: label(dash, 'dashboard.widgetBackupsBookmarksAbout',
                    'What the newest archive actually contains.'),
            },
            {
                value: newest ? u.bytes(newest.size) : '—',
                label: label(dash, 'dashboard.widgetBackupsSize', 'size'),
            },
            {
                value: !enabled
                    ? label(dash, 'dashboard.widgetBackupsOff', 'off')
                    : dueIn === null
                        ? '—'
                        : dueIn === 0
                            ? label(dash, 'dashboard.widgetBackupsDueNow', 'due')
                            : `${dueIn}d`,
                label: label(dash, 'dashboard.widgetBackupsNext', 'next'),
                tone: enabled ? null : 'warn',
                onOpen: open,
            },
        ]));

        if (failure) {
            panel.appendChild(u.footnote(label(dash, 'dashboard.widgetBackupsFailed',
                'The last run failed: {e}').replace('{e}', failure), 'bad'));
        } else if (!enabled) {
            panel.appendChild(u.footnote(label(dash, 'dashboard.widgetBackupsDisabled',
                'Automatic backups are switched off.'), 'warn'));
        } else if (overdue) {
            panel.appendChild(u.footnote(label(dash, 'dashboard.widgetBackupsOverdue',
                'Expected one every {n}d.').replace('{n}', String(interval)), 'warn'));
        }

        if (!showList || !sorted.length) return;

        const list = u.rowList();
        sorted.slice(0, maxRows).forEach((backup) => {
            const made = stamp(backup?.createdAt);
            list.appendChild(u.row(
                made ? new Date(made).toLocaleDateString() : String(backup?.name || ''),
                u.bytes(backup?.size),
                null,
                open));
        });
        u.appendOverflowRow(list, dash, sorted.length - maxRows, open);
        panel.appendChild(list);
    }

    async function render(body, widget, dash) {
        const u = U();
        body.replaceChildren();
        u.say(body, 'dashboard-widget-waiting',
            label(dash, 'dashboard.widgetBackupsWaiting', 'Loading…'));

        const data = await load(dash);
        if (!data) {
            body.replaceChildren();
            u.say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetBackupsUnreachable', 'Could not read the backups.'));
            return;
        }
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.backups = render;
})();
