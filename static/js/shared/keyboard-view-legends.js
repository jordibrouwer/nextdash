/**
 * Shared keyboard rows for the inbox views — inline legends and the cheat sheet
 * modal both read from here so keys cannot drift apart.
 */
(function (global) {
    'use strict';

    /** @typedef {{ keys: string, legendKey: string, cheatKey: string, fallback: string, line?: number, more?: boolean }} LegendRow */

    /** @type {LegendRow[]} */
    const INBOX_VIEW = [
        { keys: 'j / k', legendKey: 'inboxKeyMove', cheatKey: 'ivMove', fallback: 'move' },
        { keys: 'Enter', legendKey: 'inboxKeyDetails', cheatKey: 'ivDetails', fallback: 'details' },
        { keys: 'o / Space', legendKey: 'inboxKeyOpen', cheatKey: 'ivOpen', fallback: 'open' },
        { keys: 'p', legendKey: 'inboxKeyPromote', cheatKey: 'ivPromote', fallback: 'promote' },
        { keys: 'n', legendKey: 'inboxKeyNote', cheatKey: 'ivNote', fallback: 'note' },
        // r marks read and Shift+K keeps, here and on triage's card alike.
        { keys: 'r', legendKey: 'inboxKeyMarkRead', cheatKey: 'ivMarkRead', fallback: 'mark read' },
        { keys: 'K', legendKey: 'inboxKeyKeep', cheatKey: 'ivKeep', fallback: 'keep · to Unsorted' },
        { keys: 'z', legendKey: 'inboxKeySnooze', cheatKey: 'ivSnooze', fallback: 'snooze' },
        { keys: 'x', legendKey: 'inboxKeySelect', cheatKey: 'ivSelect', fallback: 'select' },
        { keys: 'Shift+↑ / ↓', legendKey: 'inboxKeySelectRange', cheatKey: 'ivSelectRange', fallback: 'extend selection' },
        { keys: 'Ctrl/Cmd+A', legendKey: 'inboxKeySelectAll', cheatKey: 'ivSelectAll', fallback: 'select all' },
        { keys: 'd', legendKey: 'inboxKeyDelete', cheatKey: 'ivDelete', fallback: 'delete' },
        // Both of these were right-click only, which a phone has not got.
        { keys: 'u', legendKey: 'inboxKeyUnread', cheatKey: 'ivUnread', fallback: 'mark unread' },
        { keys: 't', legendKey: 'inboxKeyTags', cheatKey: 'ivTags', fallback: 'tags' },
        { keys: 'a', legendKey: 'inboxKeyAddOffer', cheatKey: 'ivAddOffer', fallback: 'add suggested tag' },
        { keys: 'R', legendKey: 'inboxKeyRefresh', cheatKey: 'ivRefresh', fallback: 'refresh' },
        { keys: 'g / Home / End', legendKey: 'inboxKeyFirstLast', cheatKey: 'ivFirstLast', fallback: 'first / last' },
        { keys: 'f', legendKey: 'inboxKeyTriage', cheatKey: 'ivTriage', fallback: 'triage' },
        { keys: 'Esc', legendKey: 'inboxKeyEsc', cheatKey: 'ivEsc', fallback: 'clear selection · back to bookmarks' },
    ];

    /**
     * The bookmark grid, in three lines.
     *
     * Health and inbox have carried a legend under the feed since they were
     * built; the dashboard -- the view everyone starts in -- had none, so the
     * keys were discoverable only through the cheat sheet. Ten rows in one
     * paragraph was as tall as a grid of seven bookmarks, so the rows are
     * grouped instead: `line` 1 is the cursor, 2 is finding things, 3 is going
     * somewhere (views, pages) and adding, 4 is what to do with the bookmark
     * under the cursor.
     *
     * `more` rows are the ones that act on a row or presume the keyboard is in
     * use. They stay out of sight until the first cursor move
     * (data-grid-keys on <body>), so a reader who has not touched the keyboard
     * sees the entry points and not the whole manual.
     *
     * Arrows lead, because they are how the cursor gets into the grid: on this
     * view a bare letter is a character the search line is listening for, and
     * j/k only move once a row is selected.
     *
     * @type {LegendRow[]}
     */
    const DASHBOARD_VIEW = [
        // Line 1: the cursor.
        { line: 1, keys: '\u2191 \u2193 \u2190 \u2192', legendKey: 'dashboardKeyMove', cheatKey: 'dvMove', fallback: 'move' },
        { line: 1, keys: 'Enter', legendKey: 'dashboardKeyOpen', cheatKey: 'dvOpen', fallback: 'open' },
        { line: 1, keys: 'x', legendKey: 'dashboardKeySelect', cheatKey: 'dvSelect', fallback: 'select' },
        { line: 1, more: true, keys: '.', legendKey: 'dashboardKeyFoldAll', cheatKey: 'dvFoldAll', fallback: 'fold all' },
        // Line 2: finding things, and the cheat sheet that lists the rest.
        { line: 2, keys: '>', legendKey: 'dashboardKeySearch', cheatKey: 'dvSearch', fallback: 'search' },
        { line: 2, keys: '/', legendKey: 'dashboardKeyTags', cheatKey: 'dvTags', fallback: 'tags' },
        { line: 2, keys: '*', legendKey: 'dashboardKeyRecent', cheatKey: 'dvRecent', fallback: 'recent' },
        { line: 2, keys: '?', legendKey: 'dashboardKeyFinders', cheatKey: 'dvFinders', fallback: 'finders' },
        { line: 2, keys: ':', legendKey: 'dashboardKeyCommands', cheatKey: 'dvCommands', fallback: 'commands' },
        { line: 2, keys: '!', legendKey: 'dashboardKeyCheatSheet', cheatKey: 'dvCheatSheet', fallback: 'all keys' },
        // Line 3: going somewhere, and adding. Views first; the helpers behind them.
        { line: 3, keys: '1\u20139', legendKey: 'dashboardKeyPage', cheatKey: 'dvPage', fallback: 'page' },
        { line: 3, keys: '+', legendKey: 'dashboardKeyAddBookmark', cheatKey: 'dvAddBookmark', fallback: 'add bookmark' },
        { line: 3, keys: 'Shift+B', legendKey: 'dashboardKeyBookmarksView', cheatKey: 'dvBookmarksView', fallback: 'bookmarks' },
        { line: 3, keys: 'Shift+I', legendKey: 'dashboardKeyInbox', cheatKey: 'dvInbox', fallback: 'inbox' },
        { line: 3, keys: ',', legendKey: 'dashboardKeyConfig', cheatKey: 'dvConfig', fallback: 'config' },
        { line: 3, more: true, keys: 'Shift+C', legendKey: 'dashboardKeyContainers', cheatKey: 'dvContainers', fallback: 'containers' },
        { line: 3, more: true, keys: 'Shift+N', legendKey: 'dashboardKeyBell', cheatKey: 'dvBell', fallback: 'notifications' },
        { line: 3, more: true, keys: 'Shift+W', legendKey: 'dashboardKeyNews', cheatKey: 'dvNews', fallback: 'news' },
        { line: 3, more: true, keys: 'Shift+P', legendKey: 'dashboardKeyPages', cheatKey: 'dvPages', fallback: 'pages' },
        { line: 3, more: true, keys: 'Shift+\u2190/\u2192', legendKey: 'dashboardKeyPrevNextPage', cheatKey: 'dvPrevNextPage', fallback: 'prev / next page' },
        { line: 3, more: true, keys: 'Shift+F', legendKey: 'dashboardKeyFilter', cheatKey: 'dvFilter', fallback: 'filter' },
        { line: 3, more: true, keys: 'Shift+K', legendKey: 'dashboardKeyTour', cheatKey: 'dvTour', fallback: 'tour' },
        { line: 3, more: true, keys: 'Shift+H', legendKey: 'dashboardKeyHideLegend', cheatKey: 'dvHideLegend', fallback: 'hide legend' },
        // Line 4: what to do with the bookmark under the cursor. Plain letters,
        // as in the Inbox; Esc hands the letters back to the search line.
        { line: 4, keys: 'e', legendKey: 'dashboardKeyEdit', cheatKey: 'dvEdit', fallback: 'edit' },
        { line: 4, keys: 'm', legendKey: 'dashboardKeyMoveBookmark', cheatKey: 'dvMoveBookmark', fallback: 'move to' },
        { line: 4, keys: 't', legendKey: 'dashboardKeyTag', cheatKey: 'dvTag', fallback: 'tag' },
        { line: 4, keys: 'p', legendKey: 'dashboardKeyPin', cheatKey: 'dvPin', fallback: 'pin' },
        { line: 4, keys: 'Esc', legendKey: 'dashboardKeyEscSearch', cheatKey: 'dvEscSearch', fallback: 'to search' },
        { line: 4, keys: '\u2318/Ctrl+Enter', legendKey: 'dashboardKeyNewTab', cheatKey: 'dvNewTab', fallback: 'new tab' },
        { line: 4, more: true, keys: 'd', legendKey: 'dashboardKeyDelete', cheatKey: 'dvDelete', fallback: 'delete' },
        { line: 4, more: true, keys: 's', legendKey: 'dashboardKeyShare', cheatKey: 'dvShare', fallback: 'share' },
        { line: 4, more: true, keys: 'q', legendKey: 'dashboardKeyQr', cheatKey: 'dvQr', fallback: 'QR code' },
        { line: 4, more: true, keys: 'f', legendKey: 'dashboardKeyFilterTag', cheatKey: 'dvFilterTag', fallback: 'filter by tag' },
        { line: 4, more: true, keys: '#', legendKey: 'dashboardKeyWatchFeed', cheatKey: 'dvWatchFeed', fallback: 'watch feed' },
    ];

    /** @type {LegendRow[]} */
    const INBOX_TRIAGE = [
        { keys: 'j / k', legendKey: 'inboxKeyMove', cheatKey: 'itMove', fallback: 'next / previous' },
        { keys: 'o / Enter / Space', legendKey: 'inboxKeyOpen', cheatKey: 'itOpen', fallback: 'open' },
        { keys: 'p', legendKey: 'inboxKeyPromote', cheatKey: 'itPromote', fallback: 'promote' },
        // The same letters as the list: r reads, Shift+K keeps.
        { keys: 'r', legendKey: 'inboxKeyMarkRead', cheatKey: 'itMarkRead', fallback: 'mark read' },
        { keys: 'K', legendKey: 'inboxKeyKeep', cheatKey: 'itKeep', fallback: 'keep · to Unsorted' },
        { keys: 'z', legendKey: 'inboxKeySnooze', cheatKey: 'itSnooze', fallback: 'snooze' },
        { keys: 'n', legendKey: 'inboxKeyNote', cheatKey: 'itNote', fallback: 'note' },
        { keys: 'd', legendKey: 'inboxKeyDelete', cheatKey: 'itDelete', fallback: 'delete' },
        { keys: 'Esc', legendKey: 'inboxKeyEsc', cheatKey: 'itEsc', fallback: 'close triage' },
    ];

    /**
     * @param {LegendRow[]} rows
     * @param {(legendKey: string, fallback: string) => string} labelFor
     */
    function toLegendPairs(rows, labelFor) {
        return rows.map((row) => [row.keys, labelFor(row.legendKey, row.fallback)]);
    }

    /**
     * @param {LegendRow[]} rows
     * @param {(cheatKey: string, fallback: string) => string} labelFor
     */
    function toCheatSheetItems(rows, labelFor) {
        return rows.map((row) => ({
            keys: row.keys,
            description: labelFor(row.cheatKey, row.fallback),
        }));
    }

    global.KeyboardViewLegends = {
        DASHBOARD_VIEW,
        INBOX_VIEW,
        INBOX_TRIAGE,
        toLegendPairs,
        toCheatSheetItems,
    };
}(typeof window !== 'undefined' ? window : globalThis));
