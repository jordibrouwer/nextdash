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
        const broken = Number(summary?.brokenCount || 0);
        const warn = Number(summary?.duplicateCount || 0)
            + Number(summary?.shortcutConflictCount || 0)
            + Number(summary?.uncheckedCount || 0)
            + Number(summary?.staleCount || 0);
        return { broken, warn };
    }

    function buildHealthPageHref(brokenCount) {
        return brokenCount > 0 ? '/?hv_filter=broken#health' : '/#health';
    }

    function createHealthCountBadge(count, type, language) {
        const badge = document.createElement('span');
        const n = count > 99 ? '99+' : String(count);
        const isBroken = type === 'broken';
        badge.className = isBroken ? 'health-badge' : 'health-badge health-badge-warn';
        badge.textContent = n;
        const ariaKey = isBroken ? 'dashboard.healthBrokenAria' : 'dashboard.healthWarnAria';
        const ariaFallback = isBroken ? '{count} broken bookmarks' : '{count} bookmarks with warnings';
        const ariaTemplate = t(language, ariaKey, ariaFallback);
        badge.setAttribute('aria-label', ariaTemplate.replace('{count}', n));
        return badge;
    }

    /**
     * `options.keepHref` leaves the anchor's href alone. The dashboard's health icon
     * opens the health view in place, so badge refreshes should not rewrite a custom
     * href set by the caller.
     */
    function applyHealthBadgeToAnchor(anchor, summary, language, options = {}) {
        if (!anchor) return null;
        const { broken, warn } = summarizeHealthCounts(summary);
        anchor.querySelector('.health-badge')?.remove();
        if (!options.keepHref) {
            anchor.href = buildHealthPageHref(broken);
        }
        if (broken > 0) {
            anchor.appendChild(createHealthCountBadge(broken, 'broken', language));
        } else if (warn > 0) {
            anchor.appendChild(createHealthCountBadge(warn, 'warn', language));
        }
        if (typeof options.onApplied === 'function') {
            options.onApplied({ broken, warn });
        }
        return { broken, warn };
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
