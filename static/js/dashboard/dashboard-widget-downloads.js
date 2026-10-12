/**
 * The download widgets (qBittorrent, SABnzbd): what is downloading, paused and
 * finished, with the client's speeds on top. Drawn by the shared media tile,
 * without pictures and in the order the client gave, since that order is the
 * reader's own sort.
 */
(function () {
    'use strict';

    const emptyGroup = {
        active: ['dashboard.widgetDownloadsNothingActive', 'Nothing downloading.'],
        paused: ['dashboard.widgetDownloadsNothingPaused', 'Nothing paused.'],
        done: ['dashboard.widgetDownloadsNothingDone', 'Nothing finished yet.'],
    };

    window.DashboardWidgets = window.DashboardWidgets || {};
    [['qbittorrent', 'qBittorrent'], ['sabnzbd', 'SABnzbd']].forEach(([id, name]) => {
        // qBittorrent usually signs in with a password rather than a key.
        const words = id === 'qbittorrent'
            ? { refused: ['dashboard.widgetMediaRefusedSignIn', '{name} refused the sign-in.'] } : {};
        const render = window.DashboardMediaTile?.register({
            id, name, words, emptyGroup, art: false, keepOrder: true, minTtl: 15, ttl: 30,
        });
        if (render) window.DashboardWidgets[id] = render;
    });
})();
