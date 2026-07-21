/**
 * Availability checking as one three-state choice, shared by every place that
 * offers it: the health view row popover and the dashboard right-click menu.
 *
 * Only the write and the wording live here. Each surface keeps its own menu
 * chrome — the health view uses its row menus, the context menu uses the
 * `.move-popover` surface — because a menu that looks foreign to the list it
 * hangs off is worse than a little duplicated markup. What must not diverge is
 * the endpoint, the stale-row handling and the words the user reads, so those
 * have exactly one home.
 */
const CheckMode = {
    OFF: 'off',
    PERIODIC: 'periodic',
    MONITOR: 'monitor',

    /** Translate with a dashboard.* key, falling back to plain English. */
    t(key, fallback, params) {
        const lang = window.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = `dashboard.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : text;
    },

    /** The mode a bookmark is in. The two flags are mutually exclusive. */
    of(bookmark) {
        if (bookmark?.monitor) return CheckMode.MONITOR;
        if (bookmark?.checkStatus) return CheckMode.PERIODIC;
        return CheckMode.OFF;
    },

    /**
     * Label, explanations and CSS modifier for one mode.
     *
     * `body` is the sentence shown beside an option in a menu; `hint` is the
     * shorter tooltip used where the mode is only labelled. `badge` differs from
     * `label` for "off" alone: a menu option reads "Off", but a badge on a row
     * has to say what is off, hence "Not checked".
     */
    meta(mode) {
        if (mode === CheckMode.MONITOR) {
            return {
                cls: 'is-monitor',
                label: CheckMode.t('healthBadgeMonitor', 'Monitor'),
                badge: CheckMode.t('healthBadgeMonitor', 'Monitor'),
                body: CheckMode.t('healthCheckModeMonitorBody', 'Checked on its own interval, with uptime, heartbeat and outages.'),
                hint: CheckMode.t('healthBadgeMonitorHint', 'Checked on its own interval, with uptime history'),
            };
        }
        if (mode === CheckMode.PERIODIC) {
            return {
                cls: 'is-periodic',
                label: CheckMode.t('healthBadgePeriodic', 'Periodic'),
                badge: CheckMode.t('healthBadgePeriodic', 'Periodic'),
                body: CheckMode.t('healthCheckModePeriodicBody', 'Checked about once a day. Catches breakage, keeps no history.'),
                hint: CheckMode.t('healthBadgePeriodicHint', 'Checked about once a day; no uptime history'),
            };
        }
        return {
            cls: 'is-off',
            label: CheckMode.t('healthCheckModeOff', 'Off'),
            badge: CheckMode.t('healthBadgeOff', 'Not checked'),
            body: CheckMode.t('healthCheckModeOffBody', 'Never tested, and never flagged as broken.'),
            hint: CheckMode.t('healthBadgeOffHint', 'This bookmark is never tested for availability'),
        };
    },

    /**
     * Write a mode onto an in-memory bookmark, mirroring what the server stores.
     *
     * Callers need this because the dashboard keeps the same bookmark in several
     * arrays, and a reload refreshes only some of them. Kept beside `apply()` so
     * the local copy and the persisted record cannot disagree about what a mode
     * means — a freshly chosen monitor gets an explicit interval here too.
     */
    assign(bookmark, mode) {
        if (!bookmark) return bookmark;
        if (mode === CheckMode.MONITOR) {
            bookmark.monitor = true;
            bookmark.checkStatus = false;
            if (!bookmark.monitorIntervalMinutes) bookmark.monitorIntervalMinutes = 15;
        } else if (mode === CheckMode.PERIODIC) {
            bookmark.monitor = false;
            bookmark.checkStatus = true;
            bookmark.monitorIntervalMinutes = 0;
        } else {
            bookmark.monitor = false;
            bookmark.checkStatus = false;
            bookmark.monitorIntervalMinutes = 0;
        }
        return bookmark;
    },

    /** The three options in the order every surface presents them. */
    options() {
        return [CheckMode.OFF, CheckMode.PERIODIC, CheckMode.MONITOR].map((mode) => ({
            mode,
            ...CheckMode.meta(mode),
        }));
    },

    /**
     * Write one bookmark's mode.
     *
     * The URL travels with the index because the caller's copy of the bookmark
     * list can be stale — the health report is cached for minutes, and the
     * dashboard's array survives edits made in another tab. The server answers
     * 409 rather than rewriting the wrong bookmark, and callers refresh.
     *
     * Returns 'changed', 'stale' or 'failed' so each surface can refresh itself
     * the way it needs to; the notification is raised here, since the wording is
     * the part that must stay identical.
     */
    async apply({ pageId, index, url, mode, name }) {
        const d = window.dashboardInstance;
        const target = String(url || '').trim();
        const page = Number(pageId);
        if (!target || !Number.isFinite(page) || !mode) return 'failed';

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/check-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: page, index, url: target, mode }),
            });
            if (res.status === 409) {
                d?.showNotification?.(
                    CheckMode.t('healthCheckModeStale', 'This bookmark changed — the list has been refreshed. Try again.'),
                    'warning',
                    { duration: 4000 }
                );
                return 'stale';
            }
            if (!res.ok) throw new Error(`check-mode HTTP ${res.status}`);

            const label = CheckMode.meta(mode).label;
            const shown = String(name || target);
            d?.showNotification?.(
                mode === CheckMode.OFF
                    ? CheckMode.t('healthCheckModeOffDone', 'Checking turned off for "{name}"', { name: shown })
                    : CheckMode.t('healthCheckModeSet', '"{name}" is now set to {mode}', { name: shown, mode: label }),
                'success',
                { duration: 3000 }
            );
            return 'changed';
        } catch (err) {
            console.error('Failed to change check mode:', err);
            d?.showNotification?.(
                CheckMode.t('healthCheckModeFailed', 'Could not change availability checking'),
                'error'
            );
            return 'failed';
        }
    },
};

window.CheckMode = CheckMode;
