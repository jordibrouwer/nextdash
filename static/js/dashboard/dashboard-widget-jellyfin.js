/**
 * The Jellyfin widget: what was added to the media server lately, with posters.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js). What is Jellyfin's
 * own is only its words, under the keys it shipped with in v1.19.4 so their
 * translations keep working.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'jellyfin',
        name: 'Jellyfin',
        words: {
            notSetUp: ['dashboard.widgetJellyfinNotSetUp', 'Connect Jellyfin in this widget’s settings.'],
            notAllowed: ['dashboard.widgetJellyfinNotAllowed',
                'Jellyfin is on your local network, and local addresses are not allowed yet. Allow them in Config first.'],
            refused: ['dashboard.widgetJellyfinRefused', 'Jellyfin refused the API key.'],
            noLibraries: ['dashboard.widgetJellyfinNoLibraries',
                'None of the chosen libraries exist any more. Choose again in the settings.'],
            unreachable: ['dashboard.widgetJellyfinUnreachable', 'Jellyfin could not be reached.'],
            justNow: ['dashboard.widgetJellyfinJustNow', 'just now'],
            minutesAgo: ['dashboard.widgetJellyfinMinutesAgo', '{n}m'],
            hoursAgo: ['dashboard.widgetJellyfinHoursAgo', '{n}h'],
            daysAgo: ['dashboard.widgetJellyfinDaysAgo', '{n}d'],
            waiting: ['dashboard.widgetJellyfinWaiting', 'Loading…'],
            nothing: ['dashboard.widgetJellyfinNothing', 'Nothing new in the chosen libraries.'],
            groupFailed: ['dashboard.widgetJellyfinLibraryFailed',
                'This library could not be read just now. It is tried again shortly.'],
            open: ['dashboard.widgetJellyfinOpen', 'Open in Jellyfin'],
            close: ['dashboard.widgetJellyfinClose', 'Close'],
            actionOpen: ['widgetActionJellyfinOpen', 'Open in Jellyfin'],
            actionDetails: ['widgetActionJellyfinDetails', 'Show details'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets.jellyfin = render;
    window.DashboardJellyfin = {
        targetFor: (...args) => window.DashboardMediaTile.targetFor(...args),
        openDetail: (...args) => window.DashboardMediaTile.openDetail(...args),
    };
})();
