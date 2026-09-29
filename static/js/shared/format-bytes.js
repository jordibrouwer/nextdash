/*
 * One byte-size formatter for the whole dashboard.
 *
 * There were three: the system widgets' IEC one, config's own KB/MB one, and a
 * stand-in inside config's mount picker for when the widgets had not loaded.
 * The two wordings are both kept -- config's backups and archives have always
 * said "KB" and "MB", the widgets "KiB" and "MiB" -- but they now live in one
 * place, so a fix to one is a fix to both.
 *
 * Loaded from the document head, like escape-html.js: config renders sizes
 * during a synchronous paint, and the widgets are fetched lazily after load.
 */
(function (global) {
    'use strict';

    const IEC_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

    /**
     * Bytes as a person reads them.
     *
     * By default in IEC units up to PiB, with a decimal only where it says
     * something: "0 B", "812 B", "1.5 MiB", "240 GiB".
     *
     * `{ style: 'short' }` is config's wording: bytes, then whole KB, then MB
     * with one decimal however large -- "512 KB", "2048.0 MB".
     */
    function formatBytes(size, options) {
        const n = Number(size) || 0;
        if (options?.style === 'short') {
            if (n < 1024) return `${n} B`;
            if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
            return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        }
        if (n <= 0) return '0 B';
        let value = n;
        let at = 0;
        while (value >= 1024 && at < IEC_UNITS.length - 1) {
            value /= 1024;
            at += 1;
        }
        return `${value >= 100 || at === 0 ? Math.round(value) : value.toFixed(1)} ${IEC_UNITS[at]}`;
    }

    global.NextDashBytes = { formatBytes };
})(window);
