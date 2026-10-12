/**
 * The Seerr widget (Overseerr, Jellyseerr): requests, by whom, and whether
 * they have arrived. Drawn by the shared media tile; its tabs are the three
 * states a request can be in, and each says in its own words when it is empty.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'seerr',
        name: 'Seerr',
        words: {},
        emptyGroup: {
            pending: ['dashboard.widgetSeerrNothingPending', 'No pending requests.'],
            approved: ['dashboard.widgetSeerrNothingApproved', 'Nothing approved is on its way.'],
            available: ['dashboard.widgetSeerrNothingAvailable', 'Nothing requested has arrived yet.'],
        },
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets.seerr = render;
})();
