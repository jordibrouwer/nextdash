/**
 * The bell's row for the Timer widget: a run that ended and was not answered.
 *
 * A quiet row. The sound and the tab title are what call for attention; the row
 * is the catch-up for an alarm that fell due while nobody was looking, and it
 * stays until it is answered. One row for all finished timers, naming the
 * oldest.
 */
(function initTimerBellSource(global) {
    'use strict';

    const ID = 'timer-done';
    let handle = null;

    function t(key, fallback, vars) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        return vars
            ? Object.entries(vars).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), text)
            : text;
    }

    function state() {
        const list = global.DashboardWidgetTimer?.finished?.() || [];
        if (!list.length) return null;
        const first = list[0];
        const name = String(first.entry.cfg?.title || '').trim()
            || global.DashboardWidgetTimer.phaseName(global.dashboardInstance, first.phase);
        return {
            count: list.length,
            // One id per ended run: answering it hides the row until another one ends.
            ids: list.map((item) => `${item.id}@${item.at}`),
            text: list.length === 1
                ? t('bell.timerDone', 'Timer done: {name}', { name })
                : t('bell.timerDoneMany', 'Timer done: {name} and {count} more', { name, count: list.length - 1 }),
            at: first.at,
        };
    }

    function register() {
        if (handle || !global.NotificationBell) return;
        handle = global.NotificationBell.register({
            // silent: the timer rings by itself (its own chime); the row only shakes the bell.
            id: ID, group: 'system', kind: 'quiet', icon: '⏲', no: 'state', silent: true, state,
            actions: [
                { label: () => t('bell.timerStop', 'Stop'), primary: true, name: 'stop', onClick: () => global.DashboardWidgetTimer?.acknowledgeAll?.() },
            ],
        });
    }

    function refresh() {
        register();
        void handle?.refresh();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register, { once: true });
    else register();

    global.TimerBellSource = { refresh };
}(typeof window !== 'undefined' ? window : globalThis));
