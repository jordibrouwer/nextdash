/**
 * Shared keyboard rows for health/inbox views — inline legends and the cheat sheet
 * modal both read from here so keys cannot drift apart.
 */
(function (global) {
    'use strict';

    /** @typedef {{ keys: string, legendKey: string, cheatKey: string, fallback: string }} LegendRow */

    /** @type {LegendRow[]} */
    const HEALTH_VIEW = [
        { keys: 'j / k', legendKey: 'healthKeyMove', cheatKey: 'hvMove', fallback: 'move' },
        { keys: 's', legendKey: 'healthKeyScore', cheatKey: 'hvScore', fallback: 'score' },
        { keys: 'i', legendKey: 'healthKeyStats', cheatKey: 'hvStats', fallback: 'statistics' },
        { keys: 'p', legendKey: 'healthKeyRecheck', cheatKey: 'hvRecheck', fallback: 're-check' },
        { keys: 'R / ?', legendKey: 'healthKeyRefresh', cheatKey: 'hvRefresh', fallback: 'refresh report' },
        { keys: 'c', legendKey: 'healthKeyCheckMode', cheatKey: 'hvCheckMode', fallback: 'checking' },
        { keys: 'm', legendKey: 'healthKeyMore', cheatKey: 'hvMore', fallback: 'more actions' },
        { keys: 'x', legendKey: 'healthKeySelect', cheatKey: 'hvSelect', fallback: 'select' },
        { keys: 'Enter / Space', legendKey: 'healthKeyOpen', cheatKey: 'hvOpen', fallback: 'open' },
        { keys: 'g / G / Home / End', legendKey: 'healthKeyFirstLast', cheatKey: 'hvFirstLast', fallback: 'first / last' },
        { keys: 'Esc', legendKey: 'healthKeyClose', cheatKey: 'hvClose', fallback: 'back to bookmarks' },
    ];

    /** @type {LegendRow[]} */
    const INBOX_VIEW = [
        { keys: 'j / k', legendKey: 'inboxKeyMove', cheatKey: 'ivMove', fallback: 'move' },
        { keys: 'Enter / Space', legendKey: 'inboxKeyOpen', cheatKey: 'ivOpen', fallback: 'open' },
        { keys: 'p', legendKey: 'inboxKeyPromote', cheatKey: 'ivPromote', fallback: 'promote' },
        { keys: 'n', legendKey: 'inboxKeyNote', cheatKey: 'ivNote', fallback: 'note' },
        { keys: 'r', legendKey: 'inboxKeyKeep', cheatKey: 'ivKeep', fallback: 'mark read' },
        { keys: 'z', legendKey: 'inboxKeySnooze', cheatKey: 'ivSnooze', fallback: 'snooze' },
        { keys: 'x', legendKey: 'inboxKeySelect', cheatKey: 'ivSelect', fallback: 'select' },
        { keys: 'd', legendKey: 'inboxKeyDelete', cheatKey: 'ivDelete', fallback: 'delete' },
        { keys: 'g / G / Home / End', legendKey: 'inboxKeyFirstLast', cheatKey: 'ivFirstLast', fallback: 'first / last' },
        { keys: 't', legendKey: 'inboxKeyTriage', cheatKey: 'ivTriage', fallback: 'triage' },
        { keys: 'Esc', legendKey: 'inboxKeyEsc', cheatKey: 'ivEsc', fallback: 'clear selection · back to bookmarks' },
    ];

    /** @type {LegendRow[]} */
    const INBOX_TRIAGE = [
        { keys: 'j / k', legendKey: 'inboxKeyMove', cheatKey: 'itMove', fallback: 'next / previous' },
        { keys: 'o / Enter', legendKey: 'inboxKeyOpen', cheatKey: 'itOpen', fallback: 'open' },
        { keys: 'p', legendKey: 'inboxKeyPromote', cheatKey: 'itPromote', fallback: 'promote' },
        { keys: 'r / Space', legendKey: 'inboxKeyKeep', cheatKey: 'itKeep', fallback: 'keep · mark read' },
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
        HEALTH_VIEW,
        INBOX_VIEW,
        INBOX_TRIAGE,
        toLegendPairs,
        toCheatSheetItems,
    };
}(typeof window !== 'undefined' ? window : globalThis));
