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
        const warn = Number(summary?.duplicateCount || 0)
            + Number(summary?.shortcutConflictCount || 0)
            + Number(summary?.uncheckedCount || 0)
            + Number(summary?.staleCount || 0);
        return { monitorDown, broken, warn };
    }

    // Accepts either the counts object or a bare broken number, so older callers
    // that pass a single count still work.
    function buildHealthPageHref(counts) {
        const c = typeof counts === 'number' ? { broken: counts } : (counts || {});
        if (Number(c.monitorDown) > 0) return '/?hv_filter=monitored#health';
        if (Number(c.broken) > 0) return '/?hv_filter=broken#health';
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

    async function fetchBookmarkHealthSummary() {
        const response = await fetch('/api/bookmark-health');
        if (!response.ok) return null;
        const data = await response.json();
        return data?.summary || {};
    }

    window.HealthBadgeUtils = {
        summarizeHealthCounts,
        buildHealthPageHref,
        createHealthCountBadge,
        applyHealthBadgeToAnchor,
        fetchBookmarkHealthSummary,
    };
})();
