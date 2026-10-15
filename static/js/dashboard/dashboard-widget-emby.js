/**
 * The Emby widget: what was added to the media server lately, with posters.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js). What is Emby's
 * own is only its words.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'emby',
        name: 'Emby',
        words: {
            notSetUp: ['dashboard.widgetEmbyNotSetUp', 'Connect Emby in this widget’s settings.'],
            notAllowed: ['dashboard.widgetEmbyNotAllowed',
                'Emby is on your local network, and local addresses are not allowed yet. Allow them in Config first.'],
            refused: ['dashboard.widgetEmbyRefused', 'Emby refused the API key.'],
            noLibraries: ['dashboard.widgetEmbyNoLibraries',
                'None of the chosen libraries exist any more. Choose again in the settings.'],
            unreachable: ['dashboard.widgetEmbyUnreachable', 'Emby could not be reached.'],
            justNow: ['dashboard.widgetEmbyJustNow', 'just now'],
            minutesAgo: ['dashboard.widgetEmbyMinutesAgo', '{n}m'],
            hoursAgo: ['dashboard.widgetEmbyHoursAgo', '{n}h'],
            daysAgo: ['dashboard.widgetEmbyDaysAgo', '{n}d'],
            waiting: ['dashboard.widgetEmbyWaiting', 'Loading…'],
            nothing: ['dashboard.widgetEmbyNothing', 'Nothing new in the chosen libraries.'],
            groupFailed: ['dashboard.widgetEmbyLibraryFailed',
                'This library could not be read just now. It is tried again shortly.'],
            open: ['dashboard.widgetEmbyOpen', 'Open in Emby'],
            close: ['dashboard.widgetEmbyClose', 'Close'],
            actionOpen: ['widgetActionEmbyOpen', 'Open in Emby'],
            actionDetails: ['widgetActionEmbyDetails', 'Show details'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets.emby = render;
    window.DashboardEmby = {
        targetFor: (...args) => window.DashboardMediaTile.targetFor(...args),
        openDetail: (...args) => window.DashboardMediaTile.openDetail(...args),
    };
})();
