/**
 * The bell's row for reminders: links the reader asked to be reminded of, whose
 * time has come.
 *
 * It reads the bookmarks the dashboard already holds, so it asks the server for
 * nothing and says nothing until they are loaded. One row, not one per link:
 * it names the oldest due reminder and counts the rest, and the three buttons
 * work on that one. Answering it brings the next into view, which keeps the
 * bell a short list however many reminders fall due in one morning.
 *
 * A quiet row. The reminder is the reader's own and stays until it is answered;
 * the push (internal/app/reminder.go) is what calls for attention, and the bell
 * still shakes once when the row first appears.
 */
(function initReminderBellSource(global) {
    'use strict';

    const ID = 'reminders-due';
    let handle = null;
    let timer = null;

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

    function due() {
        return dash()?.reminders?.due?.() || [];
    }

    async function state() {
        await dash()?.reminders?.refreshDue?.();
        const list = due();
        if (!list.length) return null;
        const first = list[0];
        const name = String(first.name || first.url || '').trim();
        return {
            count: list.length,
            // Only the one the row is about. The bell hides a row once it was
            // answered and shows it again only when an id it has not seen
            // appears: with every due reminder listed here, answering the first
            // would leave the second hidden, since its id was already there.
            ids: [`${first.url}@${first.remindAt}`],
            text: list.length === 1
                ? t('bell.reminderOne', 'Reminder: {name}', { name })
                : t('bell.reminderMany', 'Reminder: {name} and {count} more', { name, count: list.length - 1 }),
            at: first.remindAt,
        };
    }

    function ref() {
        const first = due()[0];
        if (!first) return null;
        const d = dash();
        return { bookmark: first, pageId: d?.reminders?.pageIdOf?.(first) || 0 };
    }

    function open() {
        const target = ref();
        if (!target) return;
        global.open(target.bookmark.url, '_blank', 'noopener,noreferrer');
        // The list comes from the server and holds no row of its own: count the
        // open on the dashboard's copy of the bookmark when it has one.
        const held = dash()?.reminders?._everyBookmark?.().find((b) => b.url === target.bookmark.url
            && (!b.pageId || Number(b.pageId) === Number(target.pageId)));
        if (held) dash()?.recordBookmarkOpened?.(held, undefined, 'reminder');
    }

    function postpone() {
        const target = ref();
        const anchor = document.querySelector(`[data-bell-id="${ID}"]`);
        if (target && anchor) dash()?.reminders?.openMenu(target, anchor);
    }

    function done() {
        const target = ref();
        if (target) void dash()?.reminders?.set(target, 0, { quiet: true });
    }

    function register() {
        if (handle || !global.NotificationBell) return;
        handle = global.NotificationBell.register({
            id: ID, group: 'system', kind: 'quiet', icon: '⏰', no: 'state', state,
            actions: [
                { label: () => t('bell.reminderDone', 'Done'), primary: true, name: 'done', onClick: done },
                { label: () => t('bell.reminderPostpone', 'Later'), name: 'postpone', onClick: postpone },
                { label: () => t('bell.reminderOpen', 'Open'), name: 'open', onClick: open },
            ],
        });
        // A reminder falls due while the page is open: look again once a minute,
        // which is as fine as a time can be chosen.
        // A hidden tab waits: the bell looks again itself when the tab returns.
        if (!timer) timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    }

    /** Ask the bell to look again, after a reminder was set, moved or cleared. */
    function refresh() {
        void handle?.refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register, { once: true });
    } else {
        register();
    }

    global.ReminderBellSource = { refresh };
}(typeof window !== 'undefined' ? window : globalThis));
