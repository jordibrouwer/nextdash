/*
 * What a Docker host with the manual's seven containers has been through in the
 * last thirty days: crashes, health checks that failed and came back, restarts,
 * and the updates that were pulled. One answer for everything that shows it --
 * the containers' timelines, Config -> Statistics -> Server and the update
 * history -- so the pictures agree with each other.
 *
 * `now` is the moment of the shots, in milliseconds.
 */
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

function dockerHistoryData(now) {
    const ago = (days, minutes = 0) => Math.round(now - days * DAY_MS + minutes * MIN_MS);
    // Per container, oldest first: what the notifier recorded.
    const events = {
        'immich-server': [
            { at: ago(9), kind: 'crash', detail: 'Exited with code 137 (out of memory)' },
            { at: ago(9, 1), kind: 'start' },
            { at: ago(4), kind: 'unhealthy', detail: 'Health check failing (3 in a row)' },
            { at: ago(4, 9), kind: 'healthy' },
            { at: now - 2 * 3_600_000, kind: 'unhealthy', detail: 'Health check failing (3 in a row)' },
        ],
        jellyfin: [
            { at: ago(17, 3), kind: 'restart-loop', count: 3, detail: '3 times in 3 min, last exit code 1' },
            { at: ago(11), kind: 'unhealthy', detail: 'Health check failing (3 in a row)' },
            { at: ago(11, 12), kind: 'healthy' },
        ],
        sonarr: [
            { at: ago(19), kind: 'stop', detail: 'by nextDash' },
            { at: ago(19, 8), kind: 'start' },
            { at: ago(2), kind: 'crash', detail: 'Exited with code 1' },
            { at: ago(2, 1), kind: 'start' },
        ],
        radarr: [
            { at: ago(13), kind: 'unhealthy', detail: 'Health check failing (3 in a row)' },
            { at: ago(13, 20), kind: 'healthy' },
        ],
        paperless: [
            { at: ago(8), kind: 'unhealthy', detail: 'Health check failing (3 in a row)' },
            { at: ago(8, 6), kind: 'healthy' },
            { at: ago(1.2), kind: 'stop', detail: 'by nextDash' },
            { at: ago(1.2, 4), kind: 'start' },
        ],
        vaultwarden: [{ at: ago(24), kind: 'stop', detail: 'by nextDash' }, { at: ago(24, 3), kind: 'start' }],
        nextdash: [{ at: ago(1), kind: 'start' }],
    };
    const update = (container, image, days, fromVersion, toVersion) => ({
        at: ago(days), kind: 'update', container, image,
        fromImageId: `sha256:${container}${fromVersion}`.padEnd(71, '0'),
        toImageId: `sha256:${container}${toVersion}`.padEnd(71, '1'),
        fromVersion, toVersion,
    });
    // Oldest first.
    const updates = [
        update('radarr', 'linuxserver/radarr', 28, '5.9.1', '5.10.4'),
        update('jellyfin', 'jellyfin/jellyfin', 26, '10.10.5', '10.10.6'),
        update('vaultwarden', 'vaultwarden/server', 24, '1.32.3', '1.32.5'),
        update('paperless', 'paperless-ngx/paperless-ngx', 23, '2.12.0', '2.13.2'),
        update('immich-server', 'immich-app/immich-server', 21, 'v1.118.2', 'v1.119.0'),
        update('sonarr', 'linuxserver/sonarr', 12, '4.0.8', '4.0.9'),
        update('jellyfin', 'jellyfin/jellyfin', 5, '10.10.6', '10.10.7'),
        update('radarr', 'linuxserver/radarr', 3, '5.10.4', '5.11.0'),
        update('nextdash', 'jordibrouwer/nextdash', 1, 'v1.21.2', 'v1.21.3'),
    ];
    // One container's timeline, newest first, with its updates folded in.
    const timeline = (name) => [
        ...(events[name] || []),
        ...updates.filter((u) => u.container === name).map((u) => ({ at: u.at, kind: 'update', detail: `${u.fromVersion} → ${u.toVersion}` })),
    ].sort((a, b) => b.at - a.at);
    // Every event of every container, newest first, as /api/docker/history has it.
    const history = Object.entries(events)
        .flatMap(([container, list]) => list.map((e) => ({ container, ...e })))
        .sort((a, b) => b.at - a.at);
    return { events, updates, timeline, history };
}

module.exports = { dockerHistoryData };
