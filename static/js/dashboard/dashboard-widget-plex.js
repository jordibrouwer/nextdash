/**
 * The Plex widget: what was added to Plex lately, with posters, read through Tautulli.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js). What is Plex's
 * own is only its words.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'plex',
        name: 'Plex',
        words: {
            notSetUp: ['dashboard.widgetPlexNotSetUp', 'Connect Plex in this widget’s settings.'],
            notAllowed: ['dashboard.widgetPlexNotAllowed',
                'Tautulli is on your local network, and local addresses are not allowed yet. Allow them in Config first.'],
            refused: ['dashboard.widgetPlexRefused', 'Tautulli refused the API key.'],
            noLibraries: ['dashboard.widgetPlexNoLibraries',
                'None of the chosen libraries exist any more. Choose again in the settings.'],
            unreachable: ['dashboard.widgetPlexUnreachable', 'Tautulli, or Plex behind it, could not be reached.'],
            justNow: ['dashboard.widgetPlexJustNow', 'just now'],
            minutesAgo: ['dashboard.widgetPlexMinutesAgo', '{n}m'],
            hoursAgo: ['dashboard.widgetPlexHoursAgo', '{n}h'],
            daysAgo: ['dashboard.widgetPlexDaysAgo', '{n}d'],
            waiting: ['dashboard.widgetPlexWaiting', 'Loading…'],
            nothing: ['dashboard.widgetPlexNothing', 'Nothing new in the chosen libraries.'],
            groupFailed: ['dashboard.widgetPlexLibraryFailed',
                'This library could not be read just now. It is tried again shortly.'],
            open: ['dashboard.widgetPlexOpen', 'Open in Plex'],
            close: ['dashboard.widgetPlexClose', 'Close'],
            actionOpen: ['widgetActionPlexOpen', 'Open in Plex'],
            actionDetails: ['widgetActionPlexDetails', 'Show details'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets.plex = render;
    window.DashboardPlex = {
        targetFor: (...args) => window.DashboardMediaTile.targetFor(...args),
        openDetail: (...args) => window.DashboardMediaTile.openDetail(...args),
    };
})();
