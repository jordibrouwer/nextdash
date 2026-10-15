/**
 * The Plex "Now playing" widget: who watches what right now, where, and
 * how far along.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js), one line per
 * session in the order the server keeps steady. It asks every ten seconds by
 * default; an empty answer is nobody watching, not a failure.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'plex-playing',
        name: 'Plex',
        defaultLayout: 'list',
        keepOrder: true,
        minTtl: 5,
        ttl: 10,
        words: {
            nothing: ['dashboard.widgetPlexPlayingNothing', 'Nobody is watching right now.'],
            open: ['dashboard.widgetPlexOpen', 'Open in Plex'],
            close: ['dashboard.widgetPlexClose', 'Close'],
            actionOpen: ['widgetActionPlexOpen', 'Open in Plex'],
            actionDetails: ['widgetActionPlexDetails', 'Show details'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets['plex-playing'] = render;
})();
