/**
 * What the system widgets share.
 *
 * Each tile asks for only its own source, and one endpoint answers with a cache
 * underneath, so several tiles on the same figure are one read rather than
 * several. The rest is the honesty rule: a source that cannot be read says why,
 * and no tile prints a number it did not measure.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /**
     * Why a source is not answering, in a sentence rather than a code.
     *
     * Each of these is a setup step the reader can act on, which is why they
     * name the mount rather than saying "unavailable". nextDash runs in a
     * container: without these mounts it would be reporting on itself.
     */
    function unavailableText(dash, reason) {
        const lines = {
            'no-host-proc': ['dashboard.widgetSystemNoProc',
                'Not reading this machine yet — mount /proc and set NEXTDASH_HOST_PROC.'],
            'unsupported-platform': ['dashboard.widgetSystemUnsupported',
                'This reading is available on Linux hosts.'],
            'no-docker-socket': ['dashboard.widgetSystemNoDocker',
                'Not connected to Docker — mount the socket and set NEXTDASH_DOCKER_SOCKET.'],
            'no-mounts-configured': ['dashboard.widgetSystemNoMounts',
                'No disks chosen yet — name them in this widget’s settings.'],
            'read-failed': ['dashboard.widgetSystemReadFailed',
                'This machine answered with something unreadable.'],
        };
        const entry = lines[reason] || lines['read-failed'];
        return label(dash, entry[0], entry[1]);
    }

    /**
     * Ask for one source.
     *
     * Cached per widget on the dash so a redraw between beats does not re-ask.
     * The refresh timer clears that entry when it is genuinely time again.
     */
    async function fetchMetrics(dash, want, params) {
        dash._widgetSystem = dash._widgetSystem || {};
        const key = params?.cacheKey || want;
        if (dash._widgetSystem[key]) return dash._widgetSystem[key];

        const query = new URLSearchParams({ want });
        if (params?.mounts?.length) query.set('mounts', params.mounts.join(','));
        try {
            const res = await fetch(`/api/system/metrics?${query.toString()}`);
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetSystem[key] = data;
            return data;
        } catch (_error) {
            // Offline, or the server restarting: the tile says it could not
            // read rather than showing a figure from before.
            return null;
        }
    }

    /** Bytes as a person reads them. */
    function formatBytes(size) {
        const n = Number(size) || 0;
        if (n <= 0) return '0 B';
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
        let value = n;
        let at = 0;
        while (value >= 1024 && at < units.length - 1) {
            value /= 1024;
            at += 1;
        }
        return `${value >= 100 || at === 0 ? Math.round(value) : value.toFixed(1)} ${units[at]}`;
    }

    window.DashboardWidgetSystem = { fetchMetrics, unavailableText, formatBytes, label };
}());
