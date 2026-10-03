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
        ['monitoring', 'Monitoring'],
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
                { path: 'totalCount', label: 'in queue', format: 'count', shape: 'large' },
                { path: 'count', label: 'matched', format: 'count', shape: 'small' },
                { path: 'unknownCount', label: 'unknown', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'radarr', name: 'Radarr', group: 'media',
            sample: 'http://radarr.local:7878',
            path: '/api/v3/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count', shape: 'large' },
                { path: 'count', label: 'matched', format: 'count', shape: 'small' },
                { path: 'unknownCount', label: 'unknown', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'lidarr', name: 'Lidarr', group: 'media',
            sample: 'http://lidarr.local:8686',
            path: '/api/v1/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count', shape: 'large' },
                { path: 'count', label: 'matched', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'readarr', name: 'Readarr', group: 'media',
            // Stopped upstream in June 2025: not offered any more, still read
            // for a widget that was started from it.
            retired: true,
            sample: 'http://readarr.local:8787',
            path: '/api/v1/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count', shape: 'large' },
                { path: 'count', label: 'matched', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'prowlarr', name: 'Prowlarr', group: 'media',
            sample: 'http://prowlarr.local:9696',
            path: '/api/v1/system/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'version', label: 'version', format: 'text', shape: 'small' },
                { path: 'startTime', label: 'up since', format: 'relativeDate', shape: 'small' },
            ],
        },
        {
            id: 'bazarr', name: 'Bazarr', group: 'media',
            sample: 'http://bazarr.local:6767',
            // The badges route counts both kinds of wanted subtitle and the
            // providers that are throttled -- what the sidebar shows.
            path: '/api/badges',
            auth: 'header', authName: 'X-API-KEY',
            note: 'Settings → General → API Key, as an X-API-KEY header.',
            fields: [
                { path: 'episodes', label: 'episodes wanted', format: 'count', shape: 'large' },
                { path: 'movies', label: 'movies wanted', format: 'count' },
                { path: 'providers', label: 'throttled', format: 'count', shape: 'small' },
            ],
        },
        {
            // Overseerr and Jellyseerr became Seerr; the API stayed the same,
            // and so does the id, which widgets already started from it store.
            id: 'overseerr', name: 'Seerr (Overseerr / Jellyseerr)', group: 'media',
            sample: 'http://seerr.local:5055',
            path: '/api/v1/request/count',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'pending', label: 'pending', format: 'count', shape: 'large' },
                { path: 'processing', label: 'processing', format: 'count', shape: 'small' },
                { path: 'available', label: 'available', format: 'count', shape: 'small' },
                { path: 'total', label: 'requests', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'tautulli', name: 'Tautulli', group: 'media',
            sample: 'http://tautulli.local:8181',
            // Tautulli reads the key from an X-Api-Key header as well as from
            // the query string, and a header keeps it out of the address.
            path: '/api/v2?cmd=get_activity',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → Web Interface → API key, as an X-Api-Key header.',
            fields: [
                { path: 'response.data.stream_count', label: 'streams', format: 'count', shape: 'large' },
                { path: 'response.data.stream_count_transcode', label: 'transcoding', format: 'count', shape: 'small' },
                { path: 'response.data.total_bandwidth', label: 'kbps', format: 'count', shape: 'small' },
                { path: 'response.data.wan_bandwidth', label: 'kbps remote', format: 'count', shape: 'small' },
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
                { path: 'EpisodeCount', label: 'episodes', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'plex', name: 'Plex', group: 'media',
            sample: 'http://plex.local:32400',
            path: '/status/sessions',
            // The token is the query parameter; the Accept header is not a
            // secret and is sent for every Plex widget rather than asked for.
            auth: 'query', queryName: 'X-Plex-Token',
            fixedHeaders: { Accept: 'application/json' },
            note: 'The X-Plex-Token from any Plex URL. Plex answers XML unless asked otherwise, so nextDash sends the Accept header for you.',
            fields: [
                { path: 'MediaContainer.size', label: 'streams now', format: 'count', shape: 'large' },
            ],
        },
        {
            id: 'immich', name: 'Immich', group: 'media',
            sample: 'http://immich.local:2283',
            path: '/api/server/statistics',
            auth: 'header', authName: 'x-api-key',
            note: 'Account Settings → API Keys, as an x-api-key header. The statistics are an admin\'s: the key must belong to an admin and include the server.statistics permission.',
            fields: [
                { path: 'photos', label: 'photos', format: 'count', shape: 'large' },
                { path: 'videos', label: 'videos', format: 'count' },
                { path: 'usage', label: 'stored', format: 'bytes', shape: 'small' },
            ],
        },
        {
            id: 'qbittorrent', name: 'qBittorrent (login)', group: 'media',
            sample: 'http://qbittorrent.local:8080',
            path: '/api/v2/transfer/info',
            /*
             * Before 5.2 qBittorrent hands out a session rather than taking a
             * key: there is no API key at all, only a login that answers with
             * a SID cookie -- and that cookie expires. Asking for the cookie was the first
             * attempt and it is a widget that works for an afternoon and then
             * reads 403, so nextDash signs in itself and asks for what does not
             * expire.
             */
            auth: 'session',
            session: {
                loginPath: '/api/v2/auth/login',
                userField: 'username', passField: 'password',
                // qBittorrent refuses a login with no Referer, and the refusal
                // looks exactly like a wrong password.
                referer: true,
            },
            note: 'The username and password you sign in to the Web UI with.',
            ttl: 60,
            fields: [
                { path: 'dl_info_speed', label: 'down/s', format: 'bytes', shape: 'large' },
                { path: 'up_info_speed', label: 'up/s', format: 'bytes' },
                { path: 'dl_info_data', label: 'downloaded', format: 'bytes', shape: 'small' },
            ],
        },
        {
            // qBittorrent 5.2 (Web API 2.14.1) takes an API key, which does not
            // expire and needs no sign-in at all.
            id: 'qbittorrent-key', name: 'qBittorrent (5.2+, API key)', group: 'media',
            sample: 'http://qbittorrent.local:8080',
            path: '/api/v2/transfer/info',
            auth: 'header', authName: 'Authorization', scheme: 'Bearer ',
            note: 'Tools → Options → Web UI → API key, as an Authorization header of "Bearer <key>". On an older version, choose qBittorrent (login).',
            ttl: 60,
            fields: [
                { path: 'dl_info_speed', label: 'down/s', format: 'bytes', shape: 'large' },
                { path: 'up_info_speed', label: 'up/s', format: 'bytes' },
                { path: 'connection_status', label: 'connection', format: 'text', shape: 'small' },
            ],
        },
        {
            id: 'sabnzbd', name: 'SABnzbd', group: 'media',
            sample: 'http://sabnzbd.local:8080',
            path: '/api?mode=queue&output=json',
            auth: 'query', queryName: 'apikey',
            note: 'Config → General → API Key. It goes in the address, which nextDash fills in for you.',
            ttl: 60,
            fields: [
                { path: 'queue.noofslots_total', label: 'in queue', format: 'count', shape: 'large' },
                { path: 'queue.speed', label: 'speed', format: 'text' },
                { path: 'queue.mbleft', label: 'MB left', format: 'text', shape: 'small' },
                { path: 'queue.timeleft', label: 'time left', format: 'text', shape: 'small' },
            ],
        },
        {
            id: 'nzbget', name: 'NZBGet', group: 'media',
            sample: 'http://nzbget.local:6789',
            path: '/jsonrpc/status',
            auth: 'basic',
            note: 'The control username and password, as basic auth. Works with the maintained nzbgetcom/nzbget as well as the original.',
            ttl: 60,
            fields: [
                { path: 'result.DownloadRate', label: 'down/s', format: 'bytes', shape: 'large' },
                { path: 'result.RemainingSizeMB', label: 'MB left', format: 'count', shape: 'small' },
            ],
        },
        {
            // A Sonarr fork (v2) and a Radarr fork (v3, "Eros"): both answer
            // the same queue status.
            id: 'whisparr', name: 'Whisparr', group: 'media',
            sample: 'http://whisparr.local:6969',
            path: '/api/v3/queue/status',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Settings → General → API Key, as an X-Api-Key header.',
            fields: [
                { path: 'totalCount', label: 'in queue', format: 'count', shape: 'large' },
                { path: 'count', label: 'matched', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'lazylibrarian', name: 'LazyLibrarian', group: 'media',
            sample: 'http://lazylibrarian.local:5299',
            // json=1, or the answer is lines of text.
            path: '/api?cmd=showStats&json=1',
            auth: 'query', queryName: 'apikey',
            note: 'Config → Interface → API key (the read-only one is enough), with the API switched on. It goes in the address, which nextDash fills in for you.',
            // Every figure here is a count query over the library.
            ttl: 600,
            fields: [
                { path: 'book_stats.eBooks', label: 'books', format: 'count', shape: 'large' },
                { path: 'book_stats.Wanted', label: 'wanted', format: 'count' },
                { path: 'author_stats.Authors', label: 'authors', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'nzbhydra', name: 'NZBHydra2', group: 'media',
            sample: 'http://nzbhydra.local:5076',
            // One entry per page, so the page tells the total.
            path: '/externalapi/v1/history/downloads?limit=1',
            auth: 'header', authName: 'X-Api-Key',
            note: 'Config → Main → API key, as an X-Api-Key header. A wrong key answers 404, not 401.',
            fields: [
                { path: 'totalElements', label: 'downloads', format: 'count', shape: 'large' },
                { path: 'entries[0].time', label: 'last grab', format: 'relativeDate', shape: 'small' },
            ],
        },
        {
            id: 'komga', name: 'Komga', group: 'media',
            sample: 'http://komga.local:25600',
            path: '/api/v1/series?size=1',
            auth: 'header', authName: 'X-API-Key',
            note: 'Account settings → API keys, as an X-API-Key header.',
            fields: [
                { path: 'totalElements', label: 'series', format: 'count', shape: 'large' },
            ],
        },
        {
            id: 'photoprism', name: 'PhotoPrism', group: 'media',
            sample: 'http://photoprism.local:2342',
            path: '/api/v1/config',
            auth: 'header', authName: 'Authorization', scheme: 'Bearer ',
            note: 'An app password (Settings → Account → Apps and Devices), as an Authorization header of "Bearer <password>". If every figure reads 0, the password was not accepted: PhotoPrism then answers with its public settings.',
            fields: [
                { path: 'count.photos', label: 'photos', format: 'count', shape: 'large' },
                { path: 'count.videos', label: 'videos', format: 'count' },
                { path: 'count.review', label: 'to review', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'jellystat', name: 'Jellystat', group: 'media',
            sample: 'http://jellystat.local:3000',
            // One play per page, so the number of pages is the number of plays.
            path: '/stats/getPlaybackActivity?size=1',
            auth: 'header', authName: 'x-api-token',
            note: 'Settings → API Keys, as an x-api-token header. Counts the plays Jellystat has logged.',
            fields: [
                { path: 'pages', label: 'plays logged', format: 'count', shape: 'large' },
                { path: 'results[0].NowPlayingItemName', label: 'last played', format: 'text', shape: 'small' },
                { path: 'results[0].ActivityDateInserted', label: 'played', format: 'relativeDate', shape: 'small' },
            ],
        },
        {
            id: 'mylar', name: 'Mylar3', group: 'media',
            sample: 'http://mylar.local:8090',
            path: '/api?cmd=getIndex',
            auth: 'query', queryName: 'apikey',
            note: 'Settings → Web Interface → API key, with the API switched on. It goes in the address, which nextDash fills in for you.',
            ttl: 600,
            fields: [
                { path: 'data#', label: 'series', format: 'count', shape: 'large' },
            ],
        },

        // ── Network ──────────────────────────────────────────────────────
        {
            id: 'pihole6', name: 'Pi-hole (v6)', group: 'network',
            sample: 'http://pi.hole',
            path: '/api/stats/summary',
            /*
             * v6 signs in for a session id that lapses after half an hour, so
             * a pasted one was a widget that worked until lunch. nextDash signs
             * in with the password and keeps the id, once, rather than on
             * every refresh -- a login per poll runs out of API seats.
             */
            auth: 'session',
            session: {
                format: 'json', loginPath: '/api/auth',
                userField: '', passField: 'password',
                tokenPath: 'session.sid', tokenHeader: 'X-FTL-SID', tokenPrefix: '',
            },
            note: 'The web interface password, or an app password from Settings → Web interface / API.',
            columns: 2,
            fields: [
                { path: 'queries.total', label: 'queries', format: 'count', shape: 'large' },
                { path: 'queries.blocked', label: 'blocked', format: 'count' },
                { path: 'queries.percent_blocked', label: 'blocked', format: 'percent', shape: 'meter', tone: 'good' },
                { path: 'gravity.domains_being_blocked', label: 'on the list', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'pihole5', name: 'Pi-hole (v5)', group: 'network',
            // v6 removed this API; kept for widgets started from it.
            retired: true,
            sample: 'http://pi.hole',
            path: '/admin/api.php?summaryRaw',
            auth: 'query', queryName: 'auth',
            note: 'Settings → API. It goes in the address, which nextDash fills in for you.',
            columns: 2,
            fields: [
                { path: 'dns_queries_today', label: 'queries today', format: 'count', shape: 'large' },
                { path: 'ads_blocked_today', label: 'blocked today', format: 'count' },
                { path: 'ads_percentage_today', label: 'blocked', format: 'percent', shape: 'meter', tone: 'good' },
                { path: 'domains_being_blocked', label: 'on the list', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'adguard', name: 'AdGuard Home', group: 'network',
            sample: 'http://adguard.local:3000',
            path: '/control/stats',
            auth: 'basic',
            note: 'The web interface username and password, as basic auth.',
            fields: [
                // Over the statistics period set in AdGuard, 24 hours unless changed.
                { path: 'num_dns_queries', label: 'queries', format: 'count', shape: 'large' },
                { path: 'num_blocked_filtering', label: 'blocked', format: 'count' },
                { path: 'avg_processing_time', label: 'avg ms', format: 'ms', shape: 'small' },
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
                { path: 'http.routers.errors', label: 'router errors', format: 'count', shape: 'small' },
                { path: 'http.middlewares.total', label: 'middlewares', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'speedtest', name: 'Speedtest Tracker', group: 'network',
            sample: 'http://speedtest.local:8080',
            path: '/api/v1/results/latest',
            auth: 'header', authName: 'Authorization', scheme: 'Bearer ',
            note: 'An API token with the results:read ability, as an Authorization header of "Bearer <token>".',
            ttl: 3600,
            fields: [
                // bits, not bytes: a line is sold in bits, so this is the
                // figure that can be held against what the contract promised.
                { path: 'data.download_bits', label: 'down', format: 'rate', shape: 'large' },
                { path: 'data.upload_bits', label: 'up', format: 'rate' },
                { path: 'data.ping', label: 'ping ms', format: 'text', shape: 'small' },
                { path: 'data.healthy', label: 'healthy', format: 'text', shape: 'small' },
                { path: 'data.created_at', label: 'last test', format: 'relativeDate', shape: 'small' },
            ],
        },

        {
            id: 'npm', name: 'Nginx Proxy Manager', group: 'network',
            sample: 'http://npm.local:81',
            path: '/api/reports/hosts',
            // A token that lasts a day, from the same sign-in the web
            // interface uses; nextDash signs in again when it lapses.
            auth: 'session',
            session: {
                format: 'json', loginPath: '/api/tokens',
                userField: 'identity', passField: 'secret',
                tokenPath: 'token', tokenHeader: 'Authorization', tokenPrefix: 'Bearer ',
            },
            note: 'The email address and password you sign in with. An account with two-factor sign-in cannot be used here.',
            fields: [
                { path: 'proxy', label: 'proxy hosts', format: 'count', shape: 'large' },
                { path: 'redirection', label: 'redirects', format: 'count' },
                { path: 'dead', label: '404 hosts', format: 'count', shape: 'small' },
            ],
        },
        {
            // Not on your own host: Tailscale's API is a cloud service, so the
            // server needs a way out to the internet for this one.
            id: 'tailscale', name: 'Tailscale', group: 'network',
            sample: 'https://api.tailscale.com',
            path: '/api/v2/tailnet/-/devices',
            auth: 'header', authName: 'Authorization', scheme: 'Bearer ',
            note: 'An API access token from the admin console (Settings → Keys), as an Authorization header of "Bearer <token>". These tokens expire after at most 90 days.',
            fields: [
                { path: 'devices#', label: 'devices', format: 'count', shape: 'large' },
                { path: 'devices[updateAvailable=true]#', label: 'need an update', format: 'count', shape: 'small' },
            ],
        },

        // ── System ───────────────────────────────────────────────────────
        {
            id: 'proxmox', name: 'Proxmox VE', group: 'system',
            sample: 'https://proxmox.local:8006',
            path: '/api2/json/nodes/YOUR_NODE/status',
            fillIn: 'YOUR_NODE',
            auth: 'header', authName: 'Authorization', scheme: 'PVEAPIToken=',
            note: 'An API token, as an Authorization header. Replace YOUR_NODE in the address with your node\'s name — it is in the left-hand tree of the Proxmox web interface.',
            fields: [
                { path: 'data.uptime', label: 'uptime', format: 'duration', shape: 'small' },
                // A share from 0 to 1: read as a percentage it was always ~0%.
                { path: 'data.cpu', label: 'cpu', format: 'share', shape: 'meter', tone: 'bad' },
                { path: 'data.memory.used', label: 'ram used', format: 'bytes' },
            ],
        },
        {
            id: 'truenas', name: 'TrueNAS', group: 'system',
            // The REST API was removed in TrueNAS 26 in favour of a websocket
            // API a widget cannot read; kept for widgets on older versions.
            retired: true,
            sample: 'http://truenas.local',
            path: '/api/v2.0/system/info',
            auth: 'header', authName: 'Authorization', scheme: 'Bearer ',
            note: 'An API key, as an Authorization header of "Bearer <key>".',
            fields: [
                { path: 'uptime_seconds', label: 'uptime', format: 'duration', shape: 'small' },
                { path: 'physmem', label: 'ram', format: 'bytes' },
                { path: 'version', label: 'version', format: 'text', shape: 'small' },
            ],
        },
        {
            id: 'glances', name: 'Glances', group: 'system',
            sample: 'http://glances.local:61208',
            path: '/api/4/quicklook',
            auth: 'none',
            note: 'No credential unless the web server was started with a password; then choose basic auth under Sign-in.',
            ttl: 60,
            columns: 2,
            fields: [
                { path: 'cpu', label: 'cpu', format: 'percent', shape: 'meter', tone: 'bad' },
                { path: 'mem', label: 'memory', format: 'percent', shape: 'meter', tone: 'bad' },
                { path: 'swap', label: 'swap', format: 'percent', shape: 'meter', tone: 'bad' },
                { path: 'load', label: 'load', format: 'percent', shape: 'meter', tone: 'bad' },
            ],
        },
        {
            id: 'syncthing', name: 'Syncthing', group: 'system',
            sample: 'http://syncthing.local:8384',
            path: '/rest/db/completion',
            auth: 'header', authName: 'X-API-Key',
            note: 'Actions → Settings → API Key, as an X-API-Key header.',
            fields: [
                { path: 'completion', label: 'in sync', format: 'percent', shape: 'meter', tone: 'good' },
                { path: 'needItems', label: 'to sync', format: 'count' },
                { path: 'needBytes', label: 'to transfer', format: 'bytes', shape: 'small' },
            ],
        },

        {
            id: 'duplicati', name: 'Duplicati', group: 'system',
            sample: 'http://duplicati.local:8200',
            path: '/api/v1/serverstate',
            // Duplicati 2.1 and later: a password sign-in for a token that
            // lasts a quarter of an hour, renewed when it is refused.
            auth: 'session',
            session: {
                format: 'json', loginPath: '/api/v1/auth/login',
                userField: '', passField: 'Password', extra: { RememberMe: false },
                tokenPath: 'AccessToken', tokenHeader: 'Authorization', tokenPrefix: 'Bearer ',
            },
            note: 'The password of the Duplicati web interface.',
            fields: [
                { path: 'ProgramState', label: 'state', format: 'text', shape: 'large' },
                { path: 'SuggestedStatusIcon', label: 'status', format: 'text' },
                { path: 'HasError', label: 'error', format: 'text', shape: 'small' },
            ],
        },

        // ── Monitoring ───────────────────────────────────────────────────
        {
            id: 'beszel', name: 'Beszel', group: 'monitoring',
            sample: 'http://beszel.local:8090',
            path: '/api/collections/systems/records?perPage=200',
            // PocketBase: the token goes in the Authorization header as it is,
            // with no "Bearer" in front.
            auth: 'session',
            session: {
                format: 'json', loginPath: '/api/collections/users/auth-with-password',
                userField: 'identity', passField: 'password',
                tokenPath: 'token', tokenHeader: 'Authorization', tokenPrefix: '',
            },
            note: 'The email address and password of a Beszel user (a read-only one is enough) that can see the systems.',
            fields: [
                { path: 'totalItems', label: 'systems', format: 'count', shape: 'large' },
                { path: 'items[status=down]#', label: 'down', format: 'count' },
                { path: 'items[status=paused]#', label: 'paused', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'netdata', name: 'Netdata', group: 'monitoring',
            sample: 'http://netdata.local:19999',
            path: '/api/v1/info',
            auth: 'none',
            note: 'No credential on a default agent.',
            ttl: 60,
            fields: [
                { path: 'alarms.critical', label: 'critical', format: 'count', shape: 'large' },
                { path: 'alarms.warning', label: 'warning', format: 'count' },
                { path: 'version', label: 'version', format: 'text', shape: 'small' },
            ],
        },
        {
            id: 'gatus', name: 'Gatus', group: 'monitoring',
            sample: 'http://gatus.local:8080',
            // pageSize=1: only the newest result per endpoint, so [0] is now.
            path: '/api/v1/endpoints/statuses?pageSize=1',
            auth: 'none',
            note: 'No credential unless Gatus is set up with basic security; then choose basic auth under Sign-in.',
            ttl: 60,
            fields: [
                { path: '[results.0.success=false]#', label: 'down', format: 'count', shape: 'large' },
                { path: '#', label: 'endpoints', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'uptimekuma', name: 'Uptime Kuma', group: 'monitoring',
            sample: 'http://uptime-kuma.local:3001',
            path: '/api/status-page/heartbeat/YOUR_SLUG',
            fillIn: 'YOUR_SLUG',
            auth: 'none',
            note: 'Reads a published status page, without a credential. Replace YOUR_SLUG in the address with its slug. One monitor\'s latest ping is heartbeatList.<id>[-1].ping, with the id from the monitor\'s own address.',
            ttl: 60,
            fields: [
                { path: 'heartbeatList#', label: 'monitors', format: 'count', shape: 'large' },
            ],
        },
        {
            id: 'scrutiny', name: 'Scrutiny', group: 'monitoring',
            sample: 'http://scrutiny.local:8080',
            path: '/api/summary',
            fillIn: 'YOUR_WWN',
            auth: 'none',
            note: 'No credential on a default install. Replace YOUR_WWN in the figures with a drive\'s WWN, shown on its detail page (0x…).',
            ttl: 600,
            fields: [
                { path: 'data.summary#', label: 'drives', format: 'count', shape: 'large' },
                // 0 is passed; anything else is a failed S.M.A.R.T. or Scrutiny check.
                { path: 'data.summary.YOUR_WWN.device.device_status', label: 'status', format: 'text' },
                { path: 'data.summary.YOUR_WWN.smart.temp', label: 'temp', format: 'text', shape: 'small' },
            ],
        },
        {
            id: 'healthchecks', name: 'Healthchecks', group: 'monitoring',
            sample: 'https://healthchecks.io',
            // The project badge in JSON: up, late and down counted for you.
            // Its address is the secret, so it is the whole address.
            path: '/badge/YOUR_BADGE',
            fillIn: 'YOUR_BADGE',
            auth: 'none',
            note: 'Paste the JSON badge address (the json3 one, from Settings → Badges) into the address in place of the sample. The address itself is the key.',
            fields: [
                { path: 'status', label: 'status', format: 'text', shape: 'large' },
                { path: 'down', label: 'down', format: 'count' },
                { path: 'grace', label: 'late', format: 'count', shape: 'small' },
                { path: 'total', label: 'checks', format: 'count', shape: 'small' },
            ],
        },

        // ── Apps ─────────────────────────────────────────────────────────
        {
            id: 'nextcloud', name: 'Nextcloud', group: 'apps',
            sample: 'https://nextcloud.local',
            path: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
            // The monitoring token reads the same figures without an admin's
            // password; the OCS header goes with it unasked.
            auth: 'header', authName: 'NC-Token',
            fixedHeaders: { 'OCS-APIRequest': 'true' },
            note: 'The token from Administration settings → System (Monitoring), as an NC-Token header.',
            columns: 2,
            fields: [
                { path: 'ocs.data.nextcloud.storage.num_files', label: 'files', format: 'count', shape: 'large' },
                { path: 'ocs.data.nextcloud.storage.num_users', label: 'users', format: 'count' },
                { path: 'ocs.data.activeUsers.last24hours', label: 'active today', format: 'count', shape: 'small' },
                { path: 'ocs.data.nextcloud.system.freespace', label: 'free', format: 'bytes', shape: 'small' },
            ],
        },
        {
            id: 'paperless', name: 'Paperless-ngx', group: 'apps',
            sample: 'http://paperless.local:8000',
            path: '/api/statistics/',
            auth: 'header', authName: 'Authorization', scheme: 'Token ',
            note: 'An API token, as an Authorization header of "Token <token>".',
            fields: [
                { path: 'documents_total', label: 'documents', format: 'count', shape: 'large' },
                { path: 'documents_inbox', label: 'in the inbox', format: 'count' },
                { path: 'character_count', label: 'characters', format: 'count', shape: 'small' },
                { path: 'tag_count', label: 'tags', format: 'count', shape: 'small' },
            ],
        },
        {
            id: 'homeassistant', name: 'Home Assistant', group: 'apps',
            sample: 'http://homeassistant.local:8123',
            /*
             * The whole state list, not one entity.
             *
             * /api/states/<entity> answers with exactly one thing, so the three
             * figures a tile draws were three properties of the same sensor --
             * its value, its name and when it changed -- where what anyone
             * wants is three different sensors. The list endpoint answers with
             * all of them, and each figure names the one it reads.
             */
            path: '/api/states',
            auth: 'header', authName: 'Authorization', scheme: 'Bearer ',
            fillIn: 'YOUR_SENSOR',
            note: 'A long-lived access token from your profile page. Then replace YOUR_SENSOR in each figure with an entity of your own — Developer tools → States lists them.',
            fields: [
                // The entity's own name, as Home Assistant writes it. The
                // [entity_id=…] form says the same thing and says it in a
                // syntax nobody was told about.
                { path: 'sensor.YOUR_SENSOR', label: 'now', format: 'text', shape: 'large' },
                { path: 'sensor.YOUR_SENSOR.attributes.friendly_name', label: 'sensor', format: 'text' },
                { path: 'sensor.YOUR_SENSOR.last_updated', label: 'updated', format: 'relativeDate', shape: 'small' },
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
                { path: 'version', label: 'version', format: 'text', shape: 'small' },
            ],
        },
        {
            id: 'ntfy', name: 'ntfy', group: 'apps',
            sample: 'http://ntfy.local:8080',
            // The stats route is public as well, and says more than "healthy".
            path: '/v1/stats',
            auth: 'none',
            note: 'The stats route answers without a credential.',
            fields: [
                { path: 'messages', label: 'messages', format: 'count', shape: 'large' },
                { path: 'messages_rate', label: 'per second', format: 'text', shape: 'small' },
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
            /*
             * Two columns only where the figures earn it -- three meters side
             * by side, or four figures that would otherwise stack. It is a
             * request and not an instruction: the grid gives a widget the
             * second column only when the dashboard is showing one, so a
             * reader on a single-column dashboard sees no difference.
             */
            columns: Number(preset.columns) === 2 ? 2 : 1,
            fields: preset.fields.map((field) => ({ ...field })),
        };
    }

    /*
     * The shape a preset asks for on a field it recognises.
     *
     * Widgets saved before shapes existed hold fields with no shape of their
     * own, and rewriting them on load would mean changing stored data nobody
     * asked to have changed. So the shape is worked out at drawing time
     * instead: the widget still knows which preset it came from, and the
     * preset still knows what its own figures are for. Anything the reader
     * chose themselves is already on the field and wins outright.
     */
    function shapeFor(presetId, path) {
        const preset = byId(presetId);
        if (!preset) return null;
        const field = preset.fields.find((entry) => entry.path === String(path));
        if (!field?.shape) return null;
        return { shape: field.shape, tone: field.tone || '' };
    }

    function byId(id) {
        return PRESETS.find((preset) => preset.id === String(id)) || null;
    }

    window.DashboardWidgetPresets = { GROUPS, PRESETS, byId, configFor, addressFor, hasPath, shapeFor };
})();
