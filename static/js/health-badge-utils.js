/**
 * Shared health badge helpers for dashboard and config headers.
 */
(function () {
    'use strict';

    function t(language, key, fallback) {
        if (language && typeof language.t === 'function') {
            const result = language.t(key);
            if (result && result !== key) return result;
        }
        return fallback;
    }

    function summarizeHealthCounts(summary) {
        const monitorDown = Number(summary?.monitorDownCount || 0);
        const broken = Number(summary?.brokenCount || 0);
        // Drift belongs in the warning tier, not the red one: a drifted link
        // still returns 200 and looks fine, which is exactly why it never
        // reached the dashboard — it was findable only by opening Health and
        // selecting the drift filter on purpose.
        const warn = Number(summary?.duplicateCount || 0)
            + Number(summary?.shortcutConflictCount || 0)
            + Number(summary?.uncheckedCount || 0)
            + Number(summary?.staleCount || 0)
            + Number(summary?.driftCount || 0);
        return { monitorDown, broken, warn, drift: Number(summary?.driftCount || 0) };
    }

    // Accepts either the counts object or a bare broken number, so older callers
    // that pass a single count still work.
    function buildHealthPageHref(counts) {
        const c = typeof counts === 'number' ? { broken: counts } : (counts || {});
        if (Number(c.monitorDown) > 0) return '/?hv_filter=monitored#health';
        if (Number(c.broken) > 0) return '/?hv_filter=broken#health';
        // Drift is the one warning class with a filter of its own worth landing
        // on, and the one that needs a human decision.
        if (Number(c.drift) > 0) return '/?hv_filter=drift#health';
        return '/#health';
    }

    // The three badge kinds in descending severity. Down shares broken's red —
    // an outage is not a milder thing than a dead link — and is set apart by the
    // header animation instead, so a badge of 1.15em does not have to carry two
    // near-identical reds.
    const BADGE_META = {
        down: { cls: 'health-badge health-badge-down', ariaKey: 'dashboard.healthMonitorDownAria', ariaFallback: '{count} monitored bookmarks not responding' },
        broken: { cls: 'health-badge', ariaKey: 'dashboard.healthBrokenAria', ariaFallback: '{count} broken bookmarks' },
        warn: { cls: 'health-badge health-badge-warn', ariaKey: 'dashboard.healthWarnAria', ariaFallback: '{count} bookmarks with warnings' },
    };

    function createHealthCountBadge(count, type, language) {
        const badge = document.createElement('span');
        const n = count > 99 ? '99+' : String(count);
        const meta = BADGE_META[type] || BADGE_META.broken;
        badge.className = meta.cls;
        badge.textContent = n;
        badge.setAttribute('aria-label', t(language, meta.ariaKey, meta.ariaFallback).replace('{count}', n));
        return badge;
    }

    /**
     * `options.keepHref` leaves the anchor's href alone. The dashboard's health icon
     * opens the health view in place, so badge refreshes should not rewrite a custom
     * href set by the caller.
     */
    function applyHealthBadgeToAnchor(anchor, summary, language, options = {}) {
        if (!anchor) return null;
        const counts = summarizeHealthCounts(summary);
        const { monitorDown, broken, warn } = counts;
        anchor.querySelector('.health-badge')?.remove();
        if (!options.keepHref) {
            anchor.href = buildHealthPageHref(counts);
        }
        // One badge, most severe first: a down monitor is the most urgent thing
        // the header can report, then a dead link, then housekeeping warnings.
        if (monitorDown > 0) {
            anchor.appendChild(createHealthCountBadge(monitorDown, 'down', language));
        } else if (broken > 0) {
            anchor.appendChild(createHealthCountBadge(broken, 'broken', language));
        } else if (warn > 0) {
            anchor.appendChild(createHealthCountBadge(warn, 'warn', language));
        }
        if (typeof options.onApplied === 'function') {
            options.onApplied(counts);
        }
        return counts;
    }

    /**
     * What the health report knows about one bookmark, kept per URL.
     *
     * The report carries a row for every bookmark, not only the broken ones,
     * and the dashboard has always fetched the whole thing for the badge and
     * then read twelve counts out of it. Uptime, a certificate about to expire
     * and how long something has been failing were in that payload all along
     * and were thrown away — so the preview card had to ask for them again, or
     * go without. This keeps the four facts worth carrying and drops the rest.
     */
    let healthCertificates = {};
    const healthFacts = new Map();
    let healthFactsAt = 0;

    function factsKey(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        const utils = window.BookmarkUrlUtils;
        if (typeof utils?.canonicalBookmarkURLKey === 'function') {
            return utils.canonicalBookmarkURLKey(raw);
        }
        // Same shape as status.js falls back to, so a browser without the
        // shared helper still matches rows to facts rather than silently
        // matching none of them.
        let t = raw.toLowerCase();
        const hash = t.indexOf('#');
        if (hash >= 0) t = t.slice(0, hash);
        return t.replace(/\/+$/, '');
    }

    /**
     * Index one report. Rows with nothing to report are skipped: a healthy
     * bookmark that is not monitored has no uptime, no certificate and no
     * failure, so storing it would be a map the size of the collection saying
     * nothing.
     */
    function rememberHealthFacts(report) {
        // Two shapes, one index: `rows` is the compact view the badge asks for,
        // `issues` the full report the health view loads. Whichever arrives
        // last is the freshest, and both say the same four things.
        const rows = Array.isArray(report?.rows) ? report.rows : null;
        const issues = Array.isArray(report?.issues) ? report.issues : [];
        const certificates = report?.certificates || {};
        /*
         * The map by host, beside the per-bookmark facts.
         *
         * A certificate belongs to a host, not to any one bookmark: ten
         * bookmarks on one domain share one expiry. The loop below attaches it
         * per bookmark for the preview card, which asks about one link; the
         * certificates widget asks the other question -- what expires soon,
         * anywhere -- and that needs the map itself.
         */
        healthCertificates = certificates;
        healthFacts.clear();
        (rows || issues).forEach((entry) => {
            const key = factsKey(entry?.url);
            if (!key) return;
            const samples = rows
                ? Number(entry?.uptime30dSamples || 0)
                : Number(entry?.monitorStats?.uptime30d?.samples || 0);
            const ratio = rows
                ? Number(entry?.uptime30d || 0)
                : Number(entry?.monitorStats?.uptime30d?.ratio || 0);
            const cert = entry?.certHost ? certificates[entry.certHost] : null;
            const facts = {
                monitor: Boolean(entry?.monitor),
                uptime30d: samples > 0 ? ratio : null,
                uptimeSamples: samples,
                certExpiresAt: Number(cert?.expiresAt || 0) || 0,
                brokenSince: Number(entry?.brokenSince || 0) || 0,
                lastError: String(entry?.lastError || '').trim(),
            };
            if (facts.uptime30d === null && !facts.certExpiresAt && !facts.brokenSince) return;
            healthFacts.set(key, facts);
        });
        healthFactsAt = Date.now();
    }

    function getHealthFacts(url) {
        const key = factsKey(url);
        return key ? healthFacts.get(key) || null : null;
    }

    async function fetchBookmarkHealthSummary() {
        // The counts, plus the few bookmarks with something to report. The full
        // report is a row per bookmark — name, tags, score, reasons — and this
        // runs on every dashboard load, so on a large collection it was
        // hundreds of kilobytes fetched to read twelve numbers.
        const response = await fetch('/api/bookmark-health?view=facts');
        if (!response.ok) return null;
        const data = await response.json();
        // What it does carry is kept rather than dropped on the floor: the
        // preview card reads uptime and certificate expiry from here.
        rememberHealthFacts(data);
        return data?.summary || {};
    }

    window.HealthBadgeUtils = {
        summarizeHealthCounts,
        buildHealthPageHref,
        createHealthCountBadge,
        applyHealthBadgeToAnchor,
        fetchBookmarkHealthSummary,
    };

    /** Read by the preview card, and by anything else on the dashboard that
     *  wants what health knows without asking the server for it again. */
    window.HealthFacts = {
        get: getHealthFacts,
        remember: rememberHealthFacts,
        /** Certificates by host, as the last report described them. */
        get certificates() { return healthCertificates; },
        get size() { return healthFacts.size; },
        get updatedAt() { return healthFactsAt; },
    };
})();
