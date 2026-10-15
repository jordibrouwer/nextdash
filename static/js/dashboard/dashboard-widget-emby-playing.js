/**
 * The Emby "Now playing" widget: who watches what right now, where, and
 * how far along.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js), one line per
 * session in the order the server keeps steady. It asks every ten seconds by
 * default; an empty answer is nobody watching, not a failure.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'emby-playing',
        name: 'Emby',
        defaultLayout: 'list',
        keepOrder: true,
        minTtl: 5,
        ttl: 10,
        words: {
            nothing: ['dashboard.widgetEmbyPlayingNothing', 'Nobody is watching right now.'],
            open: ['dashboard.widgetEmbyOpen', 'Open in Emby'],
            close: ['dashboard.widgetEmbyClose', 'Close'],
            actionOpen: ['widgetActionEmbyOpen', 'Open in Emby'],
            actionDetails: ['widgetActionEmbyDetails', 'Show details'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets['emby-playing'] = render;
})();
