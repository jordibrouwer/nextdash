/**
 * The bell's outage row: monitored bookmarks that are not responding.
 *
 * It reads what the red count on the Bookmarks tab reads (the health summary
 * dashboard-visual keeps on the dashboard after each badge refresh, and the
 * facts the same response filled), so the two never disagree and no request
 * of its own is made. Like the tab badge, the count includes bookmarks muted
 * for alerts: muting silences a notification, not the fact that it is down.
 *
 * A health row never counts on the bell; it only lists the outage. "No" holds
 * until another bookmark goes down.
 */
(function initHealthBellSource(global) {
    'use strict';

    let handle = null;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const lang = dash()?.language;
        let text = fallback;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        return vars
            ? Object.entries(vars).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), text)
            : text;
    }

    /** { count, ids, text } while something is down, else null. */
    function state() {
        const summary = dash()?.healthSummary;
        const count = Number(summary?.monitorDownCount || 0);
        if (!count) return null;
        return {
            count,
            ids: global.HealthFacts?.downKeys || [],
            text: t('dashboard.healthMonitorDownAria', '{count} monitored bookmarks not responding', { count }),
        };
    }

    /** The Bookmarks view on the filter the tab's red badge leads to. */
    function openMonitored() {
        const d = dash();
        if (!d?.config) return;
        history.replaceState(history.state, '', `${global.location.pathname}${global.location.search}#bookmarks?health=monitored`);
        void d.config.openLibraryView();
    }

    function register() {
        if (handle || !global.NotificationBell) return;
        handle = global.NotificationBell.register({
            id: 'health-outage',
            group: 'health',
            kind: 'health',
            icon: '\u{1F534}',
            no: 'state',
            state,
            actions: [
                { label: () => t('bell.healthView', 'View'), primary: true, onClick: openMonitored },
            ],
        });
        void handle.refresh();
    }

    /** Called whenever the tab badge has been refreshed. */
    function refresh() {
        void handle?.refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register, { once: true });
    } else {
        register();
    }

    global.HealthBellSource = { state, refresh };
}(typeof window !== 'undefined' ? window : globalThis));
