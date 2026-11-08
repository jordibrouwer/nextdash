/**
 * An old Shift key that still works says what replaced it.
 *
 * Shift+Y, Shift+M (with nothing selected), Shift+J, Shift+L and Shift+Z moved
 * to Shift+C, Shift+E, Shift+Q, Shift+S and Shift+H. For a couple of releases the old key keeps
 * working, and this puts one line on the screen so the new one gets learned.
 * Once per old/new pair per page load: pressing it ten times is not ten toasts.
 */
(function initShiftKeyAliases(global) {
    'use strict';

    const told = new Set();

    function notice(oldKey, newKey) {
        const pair = `${oldKey}>${newKey}`;
        if (told.has(pair)) return;
        told.add(pair);
        const dash = global.dashboardInstance;
        if (!dash?.showNotification) return;
        dash.showNotification(`${oldKey} is now ${newKey}`, 'info', { duration: 4000 });
    }

    // A Shift letter that used to act on a bookmark and now does something
    // else: one line per key per page load naming the plain letter.
    function rowNotice(shiftKey, text) {
        const pair = `row:${shiftKey}`;
        if (told.has(pair)) return;
        told.add(pair);
        const dash = global.dashboardInstance;
        if (!dash?.showNotification) return;
        dash.showNotification(text, 'info', { duration: 4000 });
    }

    global.ShiftKeyAliases = { notice, rowNotice };
})(window);
