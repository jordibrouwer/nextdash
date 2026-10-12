/**
 * The Sonarr and Radarr widgets: what is coming, and what is downloading.
 *
 * Drawn by the shared media tile (dashboard-media-tile.js). Their groups are
 * Upcoming and Queue, and each says in its own words when it is empty.
 */
(function () {
    'use strict';

    const emptyGroup = {
        upcoming: ['dashboard.widgetArrNothingUpcoming', 'Nothing coming up in the next {days} days.'],
        queue: ['dashboard.widgetArrNothingQueued', 'Nothing in the queue.'],
    };

    window.DashboardWidgets = window.DashboardWidgets || {};
    [['sonarr', 'Sonarr'], ['radarr', 'Radarr']].forEach(([id, name]) => {
        const render = window.DashboardMediaTile?.register({ id, name, words: {}, emptyGroup });
        if (render) window.DashboardWidgets[id] = render;
    });
})();
