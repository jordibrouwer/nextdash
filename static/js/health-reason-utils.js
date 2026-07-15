/**
 * Shared health reason translation for the /health page and the dashboard health view.
 *
 * Both surfaces turn the same server payload into the same human sentences, so the
 * mapping lives here rather than in each of them: a reason code added on the server
 * and taught to only one copy would silently render as a bare code in the other.
 *
 * `language` is passed in rather than read from a global because /health keeps its
 * language object in a module-scoped state object and the dashboard keeps its own.
 */
(function () {
    'use strict';

    function t(language, key, fallback, replacements = {}) {
        const translated = language && typeof language.t === 'function' ? language.t(key) : key;
        let value = translated && translated !== key ? translated : fallback;
        Object.entries(replacements).forEach(([name, replacement]) => {
            value = value.replaceAll(`{${name}}`, String(replacement));
        });
        return value;
    }

    const REASON_KEYS = {
        'Last error recorded': 'health.reasonLastError',
        'Status check has never run': 'health.reasonStatusNeverRun',
        'Status check is stale': 'health.reasonStatusStale',
        'Not opened in over 30 days': 'health.reasonNotOpened30Days',
        'Never opened': 'health.reasonNeverOpened',
        'No preview metadata yet': 'health.reasonNoPreview',
        'Timeout': 'health.errorTimeout',
        'DNS lookup failed': 'health.errorDns',
        'Connection refused': 'health.errorConnectionRefused',
        'TLS error': 'health.errorTls',
        'Too many redirects': 'health.errorTooManyRedirects',
        'Unreachable': 'health.errorUnreachable',
        'Invalid URL': 'health.errorInvalidUrl',
        'ping failed': 'health.errorPingFailed',
        'Request timeout': 'health.errorTimeout',
        'Network error': 'health.errorUnreachable',
    };

    /** Free-text reason (legacy payloads, and the detail inside `last_error`). */
    function translateReason(language, reason) {
        const duplicateMatch = String(reason).match(/^Duplicate URL in (\d+) bookmarks$/);
        if (duplicateMatch) {
            return t(language, 'health.reasonDuplicateUrl', 'Duplicate URL in {count} bookmarks', { count: duplicateMatch[1] });
        }

        const shortcutMatch = String(reason).match(/^Shortcut conflict with (\d+) bookmarks$/);
        if (shortcutMatch) {
            return t(language, 'health.reasonShortcutConflict', 'Shortcut conflict with {count} bookmarks', { count: shortcutMatch[1] });
        }

        const httpMatch = String(reason).match(/^HTTP (\d+)$/);
        if (httpMatch) {
            return t(language, 'health.errorHttp', 'HTTP {status}', { status: httpMatch[1] });
        }

        const trimmed = String(reason || '').trim();
        const key = REASON_KEYS[trimmed];
        if (key) return t(language, key, trimmed);

        const embeddedHttp = trimmed.match(/HTTP\s+(\d{3})/i);
        if (embeddedHttp) {
            return t(language, 'health.errorHttp', 'HTTP {status}', { status: embeddedHttp[1] });
        }

        return trimmed;
    }

    /** Structured reason: `{code, params, detail, penalty}` from the server. */
    function translateReasonDetail(language, item) {
        if (!item || typeof item !== 'object') {
            return translateReason(language, String(item || ''));
        }
        const code = item.code || '';
        const params = item.params || {};
        const detail = item.detail || '';
        switch (code) {
            case 'duplicate_url':
                return t(language, 'health.reasonDuplicateUrl', 'Duplicate URL in {count} bookmarks', { count: params.count || '' });
            case 'shortcut_conflict':
                return t(language, 'health.reasonShortcutConflict', 'Shortcut conflict with {count} bookmarks', { count: params.count || '' });
            case 'status_never_run':
                return t(language, 'health.reasonStatusNeverRun', 'Status check has never run');
            case 'status_stale':
                return t(language, 'health.reasonStatusStale', 'Status check is stale');
            case 'not_opened_30_days':
                return t(language, 'health.reasonNotOpened30Days', 'Not opened in over 30 days');
            case 'never_opened':
                return t(language, 'health.reasonNeverOpened', 'Never opened');
            case 'no_preview':
                return t(language, 'health.reasonNoPreview', 'No preview metadata yet');
            case 'unreachable':
                return t(language, 'health.errorUnreachable', 'Unreachable');
            case 'last_error':
                return translateReason(language, detail) || detail;
            default:
                return detail || translateReason(language, detail) || code;
        }
    }

    function getIssueReasonLabels(language, issue) {
        if (Array.isArray(issue?.reasonDetails) && issue.reasonDetails.length) {
            return issue.reasonDetails.map((item) => translateReasonDetail(language, item));
        }
        return (issue?.reasons || []).map((reason) => translateReason(language, reason));
    }

    /**
     * Reasons paired with the score each one costs. The penalty comes from the server
     * (one source with the arithmetic); rows from an older payload simply carry no
     * penalty and render as a plain reason.
     */
    function getIssueReasonEntries(language, issue) {
        if (Array.isArray(issue?.reasonDetails) && issue.reasonDetails.length) {
            return issue.reasonDetails.map((item) => ({
                label: translateReasonDetail(language, item),
                penalty: Number(item?.penalty) || 0,
            }));
        }
        return (issue?.reasons || []).map((reason) => ({
            label: translateReason(language, reason),
            penalty: 0,
        }));
    }

    /** Score bands. Kept here so /health and the dashboard view cannot disagree. */
    function scoreClass(score) {
        if (score >= 90) return 'good';
        if (score >= 70) return 'warn';
        return 'bad';
    }

    window.HealthReasonUtils = {
        translateReason,
        translateReasonDetail,
        getIssueReasonLabels,
        getIssueReasonEntries,
        scoreClass,
    };
})();
