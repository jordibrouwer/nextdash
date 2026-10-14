/**
 * The Home Assistant widget: chosen entities per room, with their value, and
 * a safe few switchable from the tile. Drawn by the shared media tile without
 * pictures, in the order the reader chose.
 */
(function () {
    'use strict';

    const render = window.DashboardMediaTile?.register({
        id: 'homeassistant',
        name: 'Home Assistant',
        words: {
            refused: ['dashboard.widgetHomeAssistantRefused', 'Home Assistant refused the token.'],
            noEntities: ['dashboard.widgetHomeAssistantNoEntities', 'Nothing chosen to show. Choose entities in the settings.'],
        },
        emptyGroup: {},
        art: false,
        // A tab per room is how it was chosen to look (13-10).
        defaultLayout: 'strip',
        keepOrder: true,
        minTtl: 15,
        ttl: 30,
    });

    window.DashboardWidgets = window.DashboardWidgets || {};
    if (render) window.DashboardWidgets.homeassistant = render;
})();
