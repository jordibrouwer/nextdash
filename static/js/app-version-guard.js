// Stale-shell guard.
//
// Forces a single fresh load when the page is either:
//   1. restored from the back/forward cache (a tab left open, then navigated
//      back to), or
//   2. running an HTML shell older than the server — e.g. a tab open across a
//      deploy, where the browser kept serving a cached document with old ?v=
//      asset URLs.
//
// The shell embeds the current asset fingerprint in a <meta> tag; this script
// compares it against /api/app-version (served no-store) and reloads once if
// they differ. The reload is guarded via sessionStorage so it can never loop.
(function () {
    'use strict';

    // bfcache restore: the DOM is frozen from an earlier load; reload to be current.
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) window.location.reload();
    });

    try {
        var baked = document.querySelector('meta[name="nextdash-app-version"]');
        var have = baked ? baked.getAttribute('content') : '';
        if (!have) return;

        fetch('/api/app-version', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || !d.version || d.version === have) return;
                // Server is newer than this shell — reload once.
                var key = 'nextdash-version-reload';
                if (sessionStorage.getItem(key) === d.version) return;
                sessionStorage.setItem(key, d.version);
                window.location.reload();
            })
            .catch(function () { /* offline / best-effort */ });
    } catch (_) {
        /* no-op */
    }
})();
