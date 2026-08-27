/**
 * Pre-filled Custom widgets for services people actually run.
 *
 * The alternative was a widget per service, and the comment on WidgetTypeCustom
 * already says why not: a dashboard that grows a codepath per upstream ends up
 * maintaining one thing per release it does not control. Everything a dedicated
 * widget would need is already built — a server that fetches, a credential store
 * that keeps the key out of the browser, a cache, a path reader, a formatter —
 * so what was actually missing was never code. It was knowing that Sonarr keeps
 * the queue size at `totalCount` under `/api/v3/queue/status`.
 *
 * So a preset is data: an address to append, the figures worth reading, and a
 * line about which credential to make. Nothing here executes, nothing here is
 * sent anywhere, and a service that changes its API next month is one line in
 * this file rather than a Go handler and a release.
 *
 * Each preset fills the form and then gets out of the way. The address is left
 * editable and the figures are ordinary rows afterwards, because the point is a
 * starting position, not a locked one.
 *
 * `sample` is only used when the widget has no address yet: applying a preset
 * to a widget that already points somewhere keeps that host and replaces the
 * path, which is what makes switching Sonarr → Radarr on the same box one click.
 */
(function () {
    'use strict';

    /*
     * Groups, in the order the picker offers them.
     *
     * By what someone is looking at rather than alphabetically: whoever wants
     * the *arr queue wants it beside the download client, not between AdGuard
     * and Bazarr.
     */
    const GROUPS = [
        ['media', 'Media & downloads'],
        ['network', 'Network'],
        ['system', 'System'],
        ['apps', 'Apps'],
    ];

    const PRESETS = [
        // ── Media & downloads ────────────────────────────────────────────
        {
            id: 'sonarr', name: 'Sonarr', group: 'media',
            sample: 'http://sonarr.local:8989',
            path: '/api/v3/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count' },
                { path: 'count', label: 'downloading', format: 'count' },
                { path: 'unknownCount', label: 'unknown', format: 'count' },
            ],
        },
        {
            id: 'radarr', name: 'Radarr', group: 'media',
            sample: 'http://radarr.local:7878',
            path: '/api/v3/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count' },
                { path: 'count', label: 'downloading', format: 'count' },
                { path: 'unknownCount', label: 'unknown', format: 'count' },
            ],
        },
        {
            id: 'lidarr', name: 'Lidarr', group: 'media',
            sample: 'http://lidarr.local:8686',
            path: '/api/v1/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count' },
                { path: 'count', label: 'downloading', format: 'count' },
            ],
        },
        {
            id: 'readarr', name: 'Readarr', group: 'media',
            sample: 'http://readarr.local:8787',
            path: '/api/v1/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count' },
                { path: 'count', label: 'downloading', format: 'count' },
            ],
        },
        {
            id: 'prowlarr', name: 'Prowlarr', group: 'media',
            sample: 'http://prowlarr.local:9696',
            path: '/api/v1/system/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'version', label: 'version', format: 'text' },
                { path: 'startTime', label: 'up since', format: 'relativeDate' },
            ],
        },
        {
            id: 'bazarr', name: 'Bazarr', group: 'media',
            sample: 'http://bazarr.local:6767',
            path: '/api/episodes/wanted?start=0&length=1',
            auth: 'header', authName: 'X-API-KEY',
            note: 'Settings → General → API Key, as an X-API-KEY header.',
            fields: [
                { path: 'total', label: 'subtitles wanted', format: 'count' },
            ],
        },
        {
            id: 'overseerr', name: 'Overseerr / Jellyseerr', group: 'media',
            sample: 'http://overseerr.local:5055',
            path: '/api/v1/request/count',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'pending', label: 'pending', format: 'count' },
                { path: 'processing', label: 'processing', format: 'count' },
                { path: 'available', label: 'available', format: 'count' },
            ],
        },
        {
            id: 'tautulli', name: 'Tautulli', group: 'media',
            sample: 'http://tautulli.local:8181',
            // Tautulli takes its key in the query string and offers no header
            // form. That is why widget addresses are withheld from the blocks
            // route: this URL is a credential.
            path: '/api/v2?apikey=YOUR_KEY&cmd=get_activity',
            auth: 'query',
            note: 'The API key goes in the address here — Tautulli has no header form.',
            fields: [
                { path: 'response.data.stream_count', label: 'streams', format: 'count' },
                { path: 'response.data.stream_count_transcode', label: 'transcoding', format: 'count' },
                { path: 'response.data.total_bandwidth', label: 'kbps', format: 'count' },
            ],
        },
        {
            id: 'jellyfin', name: 'Jellyfin / Emby', group: 'media',
            sample: 'http://jellyfin.local:8096',
            path: '/Items/Counts',
            auth: 'header', authName: 'X-Emby-Token',
            note: 'Dashboard → API Keys, as an X-Emby-Token header.',
            fields: [
                { path: 'MovieCount', label: 'films', format: 'count' },
                { path: 'SeriesCount', label: 'series', format: 'count' },
                { path: 'EpisodeCount', label: 'episodes', format: 'count' },
            ],
        },
        {
            id: 'plex', name: 'Plex', group: 'media',
            sample: 'http://plex.local:32400',
            path: '/status/sessions?X-Plex-Token=YOUR_TOKEN',
            auth: 'header', authName: 'Accept',
            note: 'Plex answers XML unless asked otherwise: add an Accept header of application/json.',
            fields: [
                { path: 'MediaContainer.size', label: 'streams now', format: 'count' },
            ],
        },
        {
            id: 'immich', name: 'Immich', group: 'media',
            sample: 'http://immich.local:2283',
            path: '/api/server/statistics',
            auth: 'header', authName: 'x-api-key',
            note: 'Account Settings → API Keys, as an x-api-key header.',
            fields: [
                { path: 'photos', label: 'photos', format: 'count' },
                { path: 'videos', label: 'videos', format: 'count' },
                { path: 'usage', label: 'stored', format: 'bytes' },
            ],
        },
        {
            id: 'qbittorrent', name: 'qBittorrent', group: 'media',
            sample: 'http://qbittorrent.local:8080',
            path: '/api/v2/transfer/info',
            auth: 'cookie',
            note: 'qBittorrent signs in for a session: send the SID as a Cookie header.',
            ttl: 60,
            fields: [
                { path: 'dl_info_speed', label: 'down/s', format: 'bytes' },
                { path: 'up_info_speed', label: 'up/s', format: 'bytes' },
                { path: 'dl_info_data', label: 'downloaded', format: 'bytes' },
            ],
        },
        {
            id: 'sabnzbd', name: 'SABnzbd', group: 'media',
            sample: 'http://sabnzbd.local:8080',
            path: '/api?mode=queue&output=json&apikey=YOUR_KEY',
            auth: 'query',
            note: 'The API key goes in the address; SABnzbd takes no header form.',
            ttl: 60,
            fields: [
                { path: 'queue.noofslots_total', label: 'in queue', format: 'count' },
                { path: 'queue.speed', label: 'speed', format: 'text' },
                { path: 'queue.mbleft', label: 'MB left', format: 'text' },
            ],
        },
        {
            id: 'nzbget', name: 'NZBGet', group: 'media',
            sample: 'http://nzbget.local:6789',
            path: '/jsonrpc/status',
            auth: 'basic',
            note: 'The control username and password, as basic auth.',
            ttl: 60,
            fields: [
                { path: 'result.DownloadRate', label: 'down/s', format: 'bytes' },
                { path: 'result.RemainingSizeMB', label: 'MB left', format: 'count' },
            ],
        },

        // ── Network ──────────────────────────────────────────────────────
        {
            id: 'pihole6', name: 'Pi-hole (v6)', group: 'network',
            sample: 'http://pi.hole',
            path: '/api/stats/summary',
            auth: 'header', authName: 'X-FTL-SID',
            note: 'v6 signs in for a session id: send it as an X-FTL-SID header.',
            fields: [
                { path: 'queries.total', label: 'queries', format: 'count' },
                { path: 'queries.blocked', label: 'blocked', format: 'count' },
                { path: 'queries.percent_blocked', label: 'blocked', format: 'percent' },
                { path: 'gravity.domains_being_blocked', label: 'on the list', format: 'count' },
            ],
        },
        {
            id: 'pihole5', name: 'Pi-hole (v5)', group: 'network',
            sample: 'http://pi.hole',
            path: '/admin/api.php?summaryRaw&auth=YOUR_TOKEN',
            auth: 'query',
            note: 'v5 takes the API token in the address — Settings → API.',
            fields: [
                { path: 'dns_queries_today', label: 'queries today', format: 'count' },
                { path: 'ads_blocked_today', label: 'blocked today', format: 'count' },
                { path: 'ads_percentage_today', label: 'blocked', format: 'percent' },
                { path: 'domains_being_blocked', label: 'on the list', format: 'count' },
            ],
        },
        {
            id: 'adguard', name: 'AdGuard Home', group: 'network',
            sample: 'http://adguard.local:3000',
            path: '/control/stats',
            auth: 'basic',
            note: 'The web interface username and password, as basic auth.',
            fields: [
                { path: 'num_dns_queries', label: 'queries', format: 'count' },
                { path: 'num_blocked_filtering', label: 'blocked', format: 'count' },
                { path: 'avg_processing_time', label: 'avg ms', format: 'text' },
            ],
        },
        {
            id: 'traefik', name: 'Traefik', group: 'network',
            sample: 'http://traefik.local:8080',
            path: '/api/overview',
            auth: 'none',
            note: 'No credential when the API is exposed on the internal network.',
            fields: [
                { path: 'http.routers.total', label: 'routers', format: 'count' },
                { path: 'http.services.total', label: 'services', format: 'count' },
                { path: 'http.routers.errors', label: 'router errors', format: 'count' },
            ],
        },
        {
            id: 'speedtest', name: 'Speedtest Tracker', group: 'network',
            sample: 'http://speedtest.local:8080',
            path: '/api/v1/results/latest',
            auth: 'header', authName: 'Authorization',
            note: 'A Sanctum token, as an Authorization header of "Bearer <token>".',
            ttl: 3600,
            fields: [
                { path: 'data.download', label: 'down', format: 'bytes' },
                { path: 'data.upload', label: 'up', format: 'bytes' },
                { path: 'data.ping', label: 'ping ms', format: 'text' },
            ],
        },

        // ── System ───────────────────────────────────────────────────────
        {
            id: 'proxmox', name: 'Proxmox VE', group: 'system',
            sample: 'https://proxmox.local:8006',
            path: '/api2/json/nodes/YOUR_NODE/status',
            auth: 'header', authName: 'Authorization',
            note: 'An API token, as an Authorization header of "PVEAPIToken=user@pam!id=secret".',
            fields: [
                { path: 'data.uptime', label: 'uptime', format: 'duration' },
                { path: 'data.cpu', label: 'cpu', format: 'percent' },
                { path: 'data.memory.used', label: 'ram used', format: 'bytes' },
            ],
        },
        {
            id: 'truenas', name: 'TrueNAS', group: 'system',
            sample: 'http://truenas.local',
            path: '/api/v2.0/system/info',
            auth: 'header', authName: 'Authorization',
            note: 'An API key, as an Authorization header of "Bearer <key>".',
            fields: [
                { path: 'uptime_seconds', label: 'uptime', format: 'duration' },
                { path: 'physmem', label: 'ram', format: 'bytes' },
                { path: 'version', label: 'version', format: 'text' },
            ],
        },
        {
            id: 'glances', name: 'Glances', group: 'system',
            sample: 'http://glances.local:61208',
            path: '/api/4/quicklook',
            auth: 'none',
            note: 'No credential unless the web server was started with one.',
            ttl: 60,
            fields: [
                { path: 'cpu', label: 'cpu', format: 'percent' },
                { path: 'mem', label: 'memory', format: 'percent' },
                { path: 'swap', label: 'swap', format: 'percent' },
            ],
        },
        {
            id: 'syncthing', name: 'Syncthing', group: 'system',
            sample: 'http://syncthing.local:8384',
            path: '/rest/db/completion',
            auth: 'header', authName: 'X-API-Key',
            note: 'Actions → Settings → API Key, as an X-API-Key header.',
            fields: [
                { path: 'completion', label: 'in sync', format: 'percent' },
                { path: 'needItems', label: 'to sync', format: 'count' },
                { path: 'needBytes', label: 'to transfer', format: 'bytes' },
            ],
        },

        // ── Apps ─────────────────────────────────────────────────────────
        {
            id: 'nextcloud', name: 'Nextcloud', group: 'apps',
            sample: 'https://nextcloud.local',
            path: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
            auth: 'basic',
            note: 'An app password as basic auth, plus an OCS-APIRequest header of "true".',
            fields: [
                { path: 'ocs.data.nextcloud.storage.num_files', label: 'files', format: 'count' },
                { path: 'ocs.data.nextcloud.storage.num_users', label: 'users', format: 'count' },
                { path: 'ocs.data.activeUsers.last24hours', label: 'active today', format: 'count' },
                { path: 'ocs.data.nextcloud.system.freespace', label: 'free', format: 'bytes' },
            ],
        },
        {
            id: 'paperless', name: 'Paperless-ngx', group: 'apps',
            sample: 'http://paperless.local:8000',
            path: '/api/statistics/',
            auth: 'header', authName: 'Authorization',
            note: 'An API token, as an Authorization header of "Token <token>".',
            fields: [
                { path: 'documents_total', label: 'documents', format: 'count' },
                { path: 'documents_inbox', label: 'in the inbox', format: 'count' },
                { path: 'character_count', label: 'characters', format: 'count' },
            ],
        },
        {
            id: 'homeassistant', name: 'Home Assistant', group: 'apps',
            sample: 'http://homeassistant.local:8123',
            path: '/api/states/sensor.YOUR_SENSOR',
            auth: 'header', authName: 'Authorization',
            note: 'A long-lived access token, as an Authorization header of "Bearer <token>".',
            fields: [
                { path: 'state', label: 'now', format: 'text' },
                { path: 'attributes.friendly_name', label: 'sensor', format: 'text' },
                { path: 'last_updated', label: 'updated', format: 'relativeDate' },
            ],
        },
        {
            id: 'grafana', name: 'Grafana', group: 'apps',
            sample: 'http://grafana.local:3000',
            path: '/api/health',
            auth: 'none',
            note: 'The health route answers without a credential.',
            fields: [
                { path: 'database', label: 'database', format: 'text' },
                { path: 'version', label: 'version', format: 'text' },
            ],
        },
        {
            id: 'ntfy', name: 'ntfy', group: 'apps',
            sample: 'http://ntfy.local:8080',
            path: '/v1/health',
            auth: 'none',
            note: 'The health route answers without a credential.',
            fields: [
                { path: 'healthy', label: 'healthy', format: 'text' },
            ],
        },
    ];

    /**
     * The address a preset produces for a widget that may already have one.
     *
     * The host someone already typed is the part that was work; the path is the
     * part this file knows. Keeping the first and replacing the second is what
     * makes moving a widget from Sonarr to Radarr on the same box a single
     * choice rather than a retype.
     */
    /*
     * The scheme and authority of an address, exactly as it was written.
     *
     * Not `new URL(x).origin`, which normalises a port away when it is the
     * scheme's default: `http://box:80` comes back as `http://box`, and
     * `https://box:443` as `https://box`. Both address the same service, so
     * nothing breaks -- but a port typed on purpose disappearing from the box
     * it was typed into reads as the field refusing what was entered. Taken
     * from the text so what someone wrote is what they keep.
     *
     * Parsed with URL first all the same: this returns the literal authority,
     * and it should only do so for something that is an address at all.
     */
    function originOf(raw) {
        try {
            new URL(raw);
        } catch (_error) {
            return null;
        }
        const match = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]+)/i.exec(raw);
        return match ? `${match[1]}//${match[2]}` : null;
    }

    /*
     * Whether an address already names something past its host.
     *
     * A bare trailing slash does not count: `http://box/` and `http://box`
     * reach the same front page, and someone who typed either meant the host
     * rather than a path. A query does count -- nobody types one by accident.
     */
    function hasPath(raw) {
        try {
            const parsed = new URL(raw);
            return parsed.pathname !== '/' || parsed.search !== '';
        } catch (_error) {
            return false;
        }
    }

    function addressFor(preset, current) {
        const base = String(current || '').trim();
        if (base) {
            const origin = originOf(base);
            if (origin) return `${origin}${preset.path}`;
            // Not a URL yet — fall through to the sample rather than
            // pasting a path onto something that is not an address.
        }
        return `${preset.sample}${preset.path}`;
    }

    /** Everything a preset writes into a widget's config, in one object. */
    function configFor(preset, current) {
        return {
            // Which service this was started from, kept so the panel can say
            // so when it is opened again rather than looking untouched.
            presetId: preset.id,
            url: addressFor(preset, current),
            method: 'GET',
            ttl: Number(preset.ttl) || 300,
            fields: preset.fields.map((field) => ({ ...field })),
        };
    }

    function byId(id) {
        return PRESETS.find((preset) => preset.id === String(id)) || null;
    }

    window.DashboardWidgetPresets = { GROUPS, PRESETS, byId, configFor, addressFor, hasPath };
})();
