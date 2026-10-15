/**
 * The Jellyfin "Now playing" widget: who watches what right now, where, and
 * how far along.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js), one line per
 * session in the order the server keeps steady. It asks every ten seconds by
 * default; an empty answer is nobody watching, not a failure.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'jellyfin-playing',
        name: 'Jellyfin',
        defaultLayout: 'list',
        keepOrder: true,
        minTtl: 5,
        ttl: 10,
        words: {
            nothing: ['dashboard.widgetJellyfinPlayingNothing', 'Nobody is watching right now.'],
            open: ['dashboard.widgetJellyfinOpen', 'Open in Jellyfin'],
            close: ['dashboard.widgetJellyfinClose', 'Close'],
            actionOpen: ['widgetActionJellyfinOpen', 'Open in Jellyfin'],
            actionDetails: ['widgetActionJellyfinDetails', 'Show details'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets['jellyfin-playing'] = render;
})();
