(function () {
    const STORAGE_KEY = 'nextdash_health_state';
    const HEALTH_OPEN_KEY = 'nextdash_health_open_bookmark';
    const DEFAULT_FILTER = 'broken';

    const healthState = {
        report: null,
        filter: DEFAULT_FILTER,
        sort: 'score',
        query: '',
        pageId: 'all',
        language: null,
        selected: new Set(),
        focusedRowIndex: -1,
        visibleIssues: []
    };

    const EMPTY_FILTER_KEYS = {
        all: 'health.emptyAll',
        broken: 'health.emptyBroken',
        duplicate: 'health.emptyDuplicate',
        'shortcut-conflict': 'health.emptyShortcutConflict',
        unchecked: 'health.emptyUnchecked',
        stale: 'health.emptyStale',
        unused: 'health.emptyUnused',
        'missing-preview': 'health.emptyMissingPreview',
        healthy: 'health.emptyHealthy'
    };

    function syncUrlParams() {
        const params = new URLSearchParams();
        if (healthState.filter && healthState.filter !== 'all') params.set('filter', healthState.filter);
        if (healthState.sort && healthState.sort !== 'score') params.set('sort', healthState.sort);
        if (healthState.pageId && healthState.pageId !== 'all') params.set('page', healthState.pageId);
        if (healthState.query) params.set('q', healthState.query);
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
        const current = `${window.location.pathname}${window.location.search}`;
        if (current !== next) {
            history.replaceState(null, '', next);
        }
    }

    function saveState() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                filter: healthState.filter,
                sort: healthState.sort,
                query: healthState.query,
                pageId: healthState.pageId
            }));
        } catch (e) { /* quota or private mode */ }
        syncUrlParams();
    }

    async function confirmDialog({ title, message, confirmText, cancelText, confirmClass }) {
        if (window.AppModal && typeof window.AppModal.confirm === 'function') {
            return window.AppModal.confirm({
                title: title || '',
                message,
                confirmText: confirmText || t('health.confirm', 'Confirm'),
                cancelText: cancelText || t('health.cancel', 'Cancel'),
                confirmClass: confirmClass || ''
            });
        }
        return window.confirm(message);
    }

    function restoreState() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (filterOrder.includes(saved.filter)) healthState.filter = saved.filter;
            const validSorts = ['score', 'status', 'last-checked', 'last-checked-desc', 'name'];
            if (validSorts.includes(saved.sort)) healthState.sort = saved.sort;
            if (typeof saved.query === 'string') healthState.query = saved.query;
            if (saved.pageId === 'all' || saved.pageId == null || saved.pageId === '') {
                healthState.pageId = 'all';
            } else {
                healthState.pageId = String(saved.pageId);
            }
        } catch (e) { /* malformed JSON */ }
    }

    function applyUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const filter = (params.get('filter') || '').toLowerCase();
        if (filterOrder.includes(filter)) {
            healthState.filter = filter;
        }
        const validSorts = ['score', 'status', 'last-checked', 'last-checked-desc', 'name'];
        const sort = params.get('sort');
        if (sort && validSorts.includes(sort)) {
            healthState.sort = sort;
        }
        const page = params.get('page');
        if (page != null && page !== '') {
            healthState.pageId = page === 'all' ? 'all' : String(page);
        }
        const query = params.get('q');
        if (typeof query === 'string') {
            healthState.query = query;
        }
        return params.get('refresh') === '1';
    }

    const statusFallbacks = {
        broken: 'broken',
        duplicate: 'duplicate',
        'shortcut-conflict': 'shortcut conflict',
        unchecked: 'unchecked',
        stale: 'stale',
        unused: 'unused',
        'missing-preview': 'missing preview',
        healthy: 'healthy'
    };

    function writeJsonHeaders() {
        return typeof nextDashWriteHeaders === 'function'
            ? nextDashWriteHeaders({ 'Content-Type': 'application/json' })
            : { 'Content-Type': 'application/json' };
    }

    function apiFetch(url, init) {
        return typeof nextDashFetch === 'function' ? nextDashFetch(url, init) : fetch(url, init);
    }

    const filterOrder = ['all', 'broken', 'duplicate', 'shortcut-conflict', 'unchecked', 'stale', 'unused', 'missing-preview', 'healthy'];

    const HEALTH_ICONS = {
        external: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6h-2v6H5V5z"></path></svg>',
        dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"></path></svg>',
        fix: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>',
        ping: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"></path></svg>',
        favicon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24l-2.83 2.83H22V4l-4.35 4.35z"></path></svg>',
        more: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"></path></svg>'
    };

    function iconButton(className, attrs, iconKey, tooltip) {
        const tip = tooltip ? ` data-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}"` : '';
        return `<button type="button" class="${className}"${attrs}${tip}>${HEALTH_ICONS[iconKey] || ''}</button>`;
    }

    function labeledButton(className, attrs, iconKey, label) {
        return `<button type="button" class="${className}"${attrs} aria-label="${escapeHtml(label)}"><span class="health-btn-icon">${HEALTH_ICONS[iconKey] || ''}</span><span class="health-btn-label">${escapeHtml(label)}</span></button>`;
    }

    function setButtonBusy(button, busy) {
        if (!button) return;
        button.disabled = busy;
        button.classList.toggle('btn-loading', busy);
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function t(key, fallback, replacements = {}) {
        const translated = healthState.language && typeof healthState.language.t === 'function'
            ? healthState.language.t(key)
            : key;
        let value = translated && translated !== key ? translated : fallback;
        Object.entries(replacements).forEach(([name, replacement]) => {
            value = value.replaceAll(`{${name}}`, String(replacement));
        });
        return value;
    }

    function statusLabel(status) {
        return t(`health.status.${status}`, statusFallbacks[status] || status);
    }

    function translateReason(reason) {
        const duplicateMatch = String(reason).match(/^Duplicate URL in (\d+) bookmarks$/);
        if (duplicateMatch) {
            return t('health.reasonDuplicateUrl', 'Duplicate URL in {count} bookmarks', { count: duplicateMatch[1] });
        }

        const shortcutMatch = String(reason).match(/^Shortcut conflict with (\d+) bookmarks$/);
        if (shortcutMatch) {
            return t('health.reasonShortcutConflict', 'Shortcut conflict with {count} bookmarks', { count: shortcutMatch[1] });
        }

        const httpMatch = String(reason).match(/^HTTP (\d+)$/);
        if (httpMatch) {
            return t('health.errorHttp', 'HTTP {status}', { status: httpMatch[1] });
        }

        const reasonKeys = {
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
            'Network error': 'health.errorUnreachable'
        };
        const trimmed = String(reason || '').trim();
        const key = reasonKeys[trimmed];
        if (key) return t(key, trimmed);

        const embeddedHttp = trimmed.match(/HTTP\s+(\d{3})/i);
        if (embeddedHttp) {
            return t('health.errorHttp', 'HTTP {status}', { status: embeddedHttp[1] });
        }

        return trimmed;
    }

    function translateReasonDetail(item) {
        if (!item || typeof item !== 'object') {
            return translateReason(String(item || ''));
        }
        const code = item.code || '';
        const params = item.params || {};
        const detail = item.detail || '';
        switch (code) {
            case 'duplicate_url':
                return t('health.reasonDuplicateUrl', 'Duplicate URL in {count} bookmarks', { count: params.count || '' });
            case 'shortcut_conflict':
                return t('health.reasonShortcutConflict', 'Shortcut conflict with {count} bookmarks', { count: params.count || '' });
            case 'status_never_run':
                return t('health.reasonStatusNeverRun', 'Status check has never run');
            case 'status_stale':
                return t('health.reasonStatusStale', 'Status check is stale');
            case 'not_opened_30_days':
                return t('health.reasonNotOpened30Days', 'Not opened in over 30 days');
            case 'never_opened':
                return t('health.reasonNeverOpened', 'Never opened');
            case 'no_preview':
                return t('health.reasonNoPreview', 'No preview metadata yet');
            case 'unreachable':
                return t('health.errorUnreachable', 'Unreachable');
            case 'last_error':
                return translateReason(detail) || detail;
            default:
                return detail || translateReason(detail) || code;
        }
    }

    function getIssueReasonLabels(issue) {
        if (Array.isArray(issue?.reasonDetails) && issue.reasonDetails.length) {
            return issue.reasonDetails.map((item) => translateReasonDetail(item));
        }
        return (issue?.reasons || []).map((reason) => translateReason(reason));
    }

    function emptyMessageForFilter(filter) {
        const key = EMPTY_FILTER_KEYS[filter] || 'health.noMatchingIssues';
        const fallbacks = {
            'health.emptyAll': 'No bookmarks match the current filters.',
            'health.emptyBroken': 'No broken bookmarks — nice work.',
            'health.emptyDuplicate': 'No duplicate URLs in this view.',
            'health.emptyShortcutConflict': 'No shortcut conflicts in this view.',
            'health.emptyUnchecked': 'All visible bookmarks have a recent status check.',
            'health.emptyStale': 'No stale bookmarks in this view.',
            'health.emptyUnused': 'No never-opened bookmarks in this view.',
            'health.emptyMissingPreview': 'No missing preview metadata in this view.',
            'health.emptyHealthy': 'No healthy-only rows match the current filters.',
            'health.noMatchingIssues': 'No issues match the current filter.'
        };
        return t(key, fallbacks[key] || fallbacks['health.noMatchingIssues']);
    }

    function issueSelectionKey(issue) {
        return `${issue.pageId}-${issue.index}`;
    }

    function openBookmarkInConfig(issue) {
        if (!issue) return;
        try {
            sessionStorage.setItem(HEALTH_OPEN_KEY, JSON.stringify({
                pageId: issue.pageId,
                index: issue.index,
                url: issue.url || ''
            }));
        } catch (e) { /* quota */ }
        window.location.href = '/config#bookmarks';
    }

    function resolveBookmarkIconSrc(icon) {
        const raw = String(icon || '').trim();
        if (!raw) return '';
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
            return raw;
        }
        return `/data/icons/${raw}`;
    }

    function renderFavicon(issue) {
        const src = resolveBookmarkIconSrc(issue?.icon);
        if (src) {
            return `<img class="health-row-favicon" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" />`;
        }
        return '<span class="health-row-favicon health-row-favicon--empty" aria-hidden="true"></span>';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function buildDashboardDeepLinkHref({ pageId, index, category, url }) {
        if (typeof DashboardDeepLink === 'undefined' || pageId == null) return '/';
        return DashboardDeepLink.buildDashboardDeepLink({
            pageId,
            bookmarkIndex: index,
            categoryId: category || null,
            url: url || null,
        });
    }

    function renderOpenInDashboardAction(issue) {
        const href = buildDashboardDeepLinkHref({
            pageId: issue.pageId,
            index: issue.index,
            category: issue.category,
            url: issue.url,
        });
        const label = t('health.openInDashboard', 'dashboard');
        return `<a class="btn btn-small btn-secondary health-action-link health-btn-with-icon" href="${escapeHtml(href)}" aria-label="${escapeHtml(label)}"><span class="health-btn-icon">${HEALTH_ICONS.dashboard}</span><span class="health-btn-label">${escapeHtml(label)}</span></a>`;
    }

    function shouldShowHealActions(issue) {
        if (!issue?.url) return false;
        return ['broken', 'unchecked', 'missing-preview'].includes(issue.status);
    }

    function issueRowKey(issue) {
        return `${issue.pageId}-${issue.index}`;
    }

    function renderIssueActions(issue) {
        const key = issueRowKey(issue);
        const healable = shouldShowHealActions(issue);
        const openLabel = t('health.openLink', 'Open link');
        const moreLabel = t('health.moreActions', 'More actions');
        const pingLabel = t('health.retestRow', 'Re-check status');
        const faviconLabel = t('health.refreshFavicon', 'favicon');
        const fixLabel = t('health.autoHealOneClick', '1-click fix');

        const primaryFix = healable
            ? labeledButton(
                'btn btn-small btn-primary health-btn-with-icon',
                ` data-heal-fix-page="${escapeHtml(issue.pageId)}" data-heal-fix-index="${escapeHtml(issue.index)}"`,
                'fix',
                fixLabel
            )
            : '';

        const healMenuItems = healable ? `
                <p class="health-actions-menu-label" role="presentation">${escapeHtml(t('health.menuRepair', 'Repair'))}</p>
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-redirect-page="${escapeHtml(issue.pageId)}" data-heal-redirect-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealRedirect', 'detect redirect'))}</button>
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-title-page="${escapeHtml(issue.pageId)}" data-heal-title-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealTitle', 'refresh title'))}</button>
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-archive-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.autoHealArchive', 'archive'))}</button>
            ` : `
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-archive-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.autoHealArchive', 'archive'))}</button>
            `;

        return `
            <div class="health-row-actions" role="group" aria-label="${escapeHtml(t('health.rowActionsLabel', 'Bookmark actions'))}">
                <div class="health-row-actions-primary">
                    ${labeledButton(
                        'btn btn-small btn-secondary health-btn-with-icon',
                        ` data-open-url="${escapeHtml(issue.url)}"`,
                        'external',
                        openLabel
                    )}
                    ${renderOpenInDashboardAction(issue)}
                    ${primaryFix}
                </div>
                <span class="health-actions-divider" aria-hidden="true"></span>
                <div class="health-row-actions-secondary">
                    ${iconButton(
                        'btn btn-small btn-secondary btn-icon-only',
                        ` data-ping-url="${escapeHtml(issue.url)}" data-ping-page="${escapeHtml(issue.pageId)}" data-ping-index="${escapeHtml(issue.index)}"`,
                        'ping',
                        pingLabel
                    )}
                    ${iconButton(
                        'btn btn-small btn-secondary btn-icon-only',
                        ` data-favicon-url="${escapeHtml(issue.url)}" data-favicon-page="${escapeHtml(issue.pageId)}" data-favicon-index="${escapeHtml(issue.index)}"`,
                        'favicon',
                        faviconLabel
                    )}
                    <div class="health-actions-menu-wrap">
                        ${iconButton(
                            'btn btn-small btn-secondary btn-icon-only health-actions-more-btn',
                            ` aria-haspopup="menu" aria-expanded="false" data-menu-toggle="${escapeHtml(key)}"`,
                            'more',
                            moreLabel
                        )}
                        <div class="health-actions-menu" role="menu" hidden data-menu-for="${escapeHtml(key)}">
                            ${healMenuItems}
                            <p class="health-actions-menu-label health-actions-menu-label-danger" role="presentation">${escapeHtml(t('health.menuDanger', 'Remove'))}</p>
                            <button type="button" class="health-actions-menu-item health-actions-menu-item-danger" role="menuitem" data-delete-page="${escapeHtml(issue.pageId)}" data-delete-index="${escapeHtml(issue.index)}" data-delete-name="${escapeHtml(issue.name || issue.url)}">${escapeHtml(t('health.delete', 'delete'))}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function closeAllActionMenus() {
        document.querySelectorAll('.health-actions-menu').forEach((menu) => {
            menu.hidden = true;
        });
        document.querySelectorAll('.health-actions-more-btn').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    function toggleActionMenu(key) {
        const menu = document.querySelector(`.health-actions-menu[data-menu-for="${CSS.escape(key)}"]`);
        const btn = document.querySelector(`.health-actions-more-btn[data-menu-toggle="${CSS.escape(key)}"]`);
        if (!menu || !btn) return;
        const willOpen = menu.hidden;
        closeAllActionMenus();
        if (willOpen) {
            menu.hidden = false;
            menu.classList.remove('health-actions-menu--up');
            btn.setAttribute('aria-expanded', 'true');
            requestAnimationFrame(() => {
                const menuRect = menu.getBoundingClientRect();
                if (menuRect.bottom > window.innerHeight - 8) {
                    menu.classList.add('health-actions-menu--up');
                }
            });
        }
    }

    function pruneSelection() {
        const visible = new Set((healthState.visibleIssues || []).map(issueSelectionKey));
        for (const key of [...healthState.selected]) {
            if (!visible.has(key)) healthState.selected.delete(key);
        }
    }

    function syncSelectionToolbar() {
        const bar = document.getElementById('health-selection-toolbar');
        const countEl = document.getElementById('health-selection-count');
        if (!bar || !countEl) return;
        const count = healthState.selected.size;
        bar.hidden = count === 0;
        countEl.textContent = t('health.selectionCount', '{count} selected', { count });
    }

    function focusRowByIndex(index) {
        const rows = document.querySelectorAll('#health-issues .health-row');
        if (!rows.length) return;
        const clamped = Math.max(0, Math.min(index, rows.length - 1));
        healthState.focusedRowIndex = clamped;
        rows.forEach((row, i) => {
            row.classList.toggle('health-row--focused', i === clamped);
        });
        rows[clamped]?.scrollIntoView({ block: 'nearest' });
    }

    function moveRowFocus(delta) {
        const rows = document.querySelectorAll('#health-issues .health-row');
        if (!rows.length) return;
        const start = healthState.focusedRowIndex < 0 ? 0 : healthState.focusedRowIndex;
        focusRowByIndex(start + delta);
    }

    function findIssueBySelectionKey(key) {
        return (healthState.visibleIssues || []).find((issue) => issueSelectionKey(issue) === key);
    }

    async function bulkDeleteSelected() {
        const keys = [...healthState.selected];
        if (!keys.length) return;
        const confirmed = await confirmDialog({
            title: t('health.bulkDeleteTitle', 'Delete selected'),
            message: t('health.bulkDeleteConfirm', 'Delete {count} bookmark(s) from the dashboard?', { count: keys.length }),
            confirmText: t('health.delete', 'delete'),
            cancelText: t('health.cancel', 'Cancel'),
            confirmClass: 'danger'
        });
        if (!confirmed) return;

        let deleted = 0;
        let failed = 0;
        for (const key of keys) {
            const issue = findIssueBySelectionKey(key);
            if (!issue) continue;
            try {
                const response = await apiFetch('/api/health/delete-bookmark', {
                    method: 'POST',
                    headers: writeJsonHeaders(),
                    body: JSON.stringify({ pageId: issue.pageId, index: issue.index })
                });
                if (response.ok) deleted += 1;
                else failed += 1;
            } catch (e) {
                failed += 1;
                console.warn('Health bulk delete failed for bookmark', issue.pageId, issue.index, e);
            }
        }
        healthState.selected.clear();
        reportBulkOutcome({
            success: deleted,
            total: keys.length,
            failed,
            successKey: 'health.bulkDeleted',
            successFallback: 'Deleted {count} bookmark(s).',
            partialKey: 'health.bulkDeletePartial',
            partialFallback: 'Deleted {success} of {total}; {failed} failed.',
            failedKey: 'health.bulkDeleteFailed',
            failedFallback: 'Could not delete selected bookmarks.'
        });
        await loadReport();
        render();
    }

    async function bulkRefreshFaviconsSelected() {
        const keys = [...healthState.selected];
        if (!keys.length) return;
        let updated = 0;
        let failed = 0;
        for (const key of keys) {
            const issue = findIssueBySelectionKey(key);
            if (!issue?.url) continue;
            try {
                const fetchIcon = window.BookmarkPreviewService?.fetchAndUploadFavicon;
                if (typeof fetchIcon !== 'function') break;
                const iconPath = await fetchIcon(issue.url);
                if (!iconPath) {
                    failed += 1;
                    continue;
                }
                const res = await fetch(`/api/bookmarks?page=${issue.pageId}`);
                if (!res.ok) {
                    failed += 1;
                    continue;
                }
                const bookmarks = await res.json();
                if (!Array.isArray(bookmarks) || !bookmarks[issue.index]) {
                    failed += 1;
                    continue;
                }
                bookmarks[issue.index].icon = iconPath;
                const saveRes = await apiFetch(`/api/bookmarks?page=${issue.pageId}`, {
                    method: 'POST',
                    headers: writeJsonHeaders(),
                    body: JSON.stringify(bookmarks)
                });
                if (saveRes.ok) updated += 1;
                else failed += 1;
            } catch (e) {
                failed += 1;
                console.warn('Health bulk favicon refresh failed for bookmark', issue?.pageId, issue?.index, e);
            }
        }
        reportBulkOutcome({
            success: updated,
            total: keys.length,
            failed,
            successKey: 'health.bulkFaviconsDone',
            successFallback: 'Updated {count} favicon(s).',
            partialKey: 'health.bulkFaviconsPartial',
            partialFallback: 'Updated {success} of {total}; {failed} failed.',
            failedKey: 'health.bulkFaviconsFailed',
            failedFallback: 'Could not refresh favicons for the selection.'
        });
        await loadReport();
        render();
    }

    function fmtDate(value) {
        if (!value) return t('health.never', 'never');
        return new Date(value).toLocaleString(healthState.language?.currentLanguage || undefined);
    }

    function scoreClass(score) {
        if (score >= 90) return 'good';
        if (score >= 70) return 'warn';
        return 'bad';
    }

    function matchesPageFilter(issue, pageId) {
        if (!pageId || pageId === 'all') return true;
        return String(issue.pageId) === String(pageId);
    }

    function getPageFilterOptions(report) {
        const pages = new Map();
        for (const issue of report?.issues || []) {
            if (!pages.has(issue.pageId)) {
                pages.set(issue.pageId, issue.pageName || t('health.pageNumber', 'Page {id}', { id: issue.pageId }));
            }
        }
        return [...pages.entries()].sort((a, b) => a[0] - b[0]);
    }

    function pickBestDuplicateBookmark(bookmarks) {
        if (!bookmarks?.length) return null;
        const sorted = [...bookmarks].sort((a, b) => {
            const openDiff = (b.openCount || 0) - (a.openCount || 0);
            if (openDiff !== 0) return openDiff;
            const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
            if (pinnedDiff !== 0) return pinnedDiff;
            const aCreated = a.createdAt || 0;
            const bCreated = b.createdAt || 0;
            if (aCreated === 0 && bCreated === 0) return 0;
            if (aCreated === 0) return 1;
            if (bCreated === 0) return -1;
            return aCreated - bCreated;
        });
        return sorted[0];
    }

    function orderDuplicateGroupBestFirst(group) {
        if (!group?.bookmarks?.length) return group;
        const best = pickBestDuplicateBookmark(group.bookmarks);
        if (!best) return group;
        const rest = group.bookmarks.filter((bookmark) => bookmark !== best
            && !(bookmark.pageId === best.pageId && bookmark.index === best.index));
        return { ...group, bookmarks: [best, ...rest] };
    }

    function matchesQuery(issue, query) {
        const text = `${issue.name} ${issue.url} ${issue.category} ${issue.pageName} ${issue.shortcut}`.toLowerCase();
        return !query || text.includes(query.toLowerCase());
    }

    function matchesFilter(issue, filter) {
        if (filter === 'all') return true;
        if (filter === 'healthy') return issue.status === 'healthy';
        return issue.status === filter;
    }

    const summaryFilterKeys = {
        healthy: 'healthy',
        broken: 'broken',
        duplicate: 'duplicate',
        shortcutConflicts: 'shortcut-conflict',
        unchecked: 'unchecked',
        stale: 'stale',
        missingPreview: 'missing-preview',
        unused: 'unused'
    };

    function buildSummaryCard(label, value, meta, tone = 'neutral', filterKey = null) {
        const isActive = filterKey && healthState.filter === filterKey;
        const activeClass = isActive ? ' active' : '';
        const metaTitle = meta ? ` title="${escapeHtml(meta)}"` : '';
        if (filterKey) {
            return `
                <button type="button" class="health-card health-card-${tone} health-card-button${activeClass}" data-filter="${escapeHtml(filterKey)}"${metaTitle}>
                    <div class="health-card-label">${escapeHtml(label)}</div>
                    <div class="health-card-value">${escapeHtml(value)}</div>
                    <div class="health-card-meta">${escapeHtml(meta || '')}</div>
                </button>
            `;
        }
        return `
            <article class="health-card health-card-${tone}"${metaTitle}>
                <div class="health-card-label">${escapeHtml(label)}</div>
                <div class="health-card-value">${escapeHtml(value)}</div>
                <div class="health-card-meta">${escapeHtml(meta || '')}</div>
            </article>
        `;
    }

    function renderSummary(report) {
        const summary = report?.summary || {};
        const cards = [
            buildSummaryCard(t('health.summaryTotal', 'Total'), summary.totalBookmarks || 0, t('health.summaryTotalMeta', 'All bookmarks'), 'neutral', 'all'),
            buildSummaryCard(t('health.summaryHealthy', 'Healthy'), summary.healthyCount || 0, t('health.summaryHealthyMeta', 'No active issues'), 'good', summaryFilterKeys.healthy),
            buildSummaryCard(t('health.summaryBroken', 'Broken'), summary.brokenCount || 0, t('health.summaryBrokenMeta', 'Last error recorded'), 'bad', summaryFilterKeys.broken),
            buildSummaryCard(t('health.summaryDuplicates', 'Duplicates'), summary.duplicateCount || 0, t('health.summaryDuplicatesMeta', 'Duplicate URLs'), 'warn', summaryFilterKeys.duplicate),
            buildSummaryCard(t('health.summaryShortcutConflicts', 'Shortcut conflicts'), summary.shortcutConflictCount || 0, t('health.summaryShortcutConflictsMeta', 'Duplicate shortcuts'), 'warn', summaryFilterKeys.shortcutConflicts),
            buildSummaryCard(t('health.summaryUnchecked', 'Unchecked'), summary.uncheckedCount || 0, t('health.summaryUncheckedMeta', 'Status checks missing or stale'), 'warn', summaryFilterKeys.unchecked),
            buildSummaryCard(t('health.summaryStale', 'Stale'), summary.staleCount || 0, t('health.summaryStaleMeta', 'Not opened recently'), 'warn', summaryFilterKeys.stale),
            buildSummaryCard(t('health.summaryMissingPreview', 'Missing preview'), summary.missingPreviewCount || 0, t('health.summaryMissingPreviewMeta', 'No preview metadata yet'), 'neutral', summaryFilterKeys.missingPreview),
            buildSummaryCard(t('health.summaryUnused', 'Unused'), summary.unusedCount || 0, t('health.summaryUnusedMeta', 'Never opened'), 'neutral', summaryFilterKeys.unused)
        ];
        return cards.join('');
    }

    function renderFilterPills(report) {
        const summary = report?.summary || {};
        const counts = {
            all: summary.totalBookmarks || 0,
            broken: summary.brokenCount || 0,
            duplicate: summary.duplicateCount || 0,
            'shortcut-conflict': summary.shortcutConflictCount || 0,
            unchecked: summary.uncheckedCount || 0,
            stale: summary.staleCount || 0,
            unused: summary.unusedCount || 0,
            'missing-preview': summary.missingPreviewCount || 0,
            healthy: summary.healthyCount || 0
        };

        return filterOrder.map((filter) => {
            const isActive = healthState.filter === filter;
            return `
            <button class="health-pill health-period-btn ${isActive ? 'active' : ''}" type="button" data-filter="${filter}" aria-pressed="${isActive ? 'true' : 'false'}">
                ${escapeHtml(filter === 'all' ? t('health.filterAll', 'all') : statusLabel(filter))}
                <span>${counts[filter] || 0}</span>
            </button>
        `;
        }).join('');
    }

    function getFilteredDuplicateGroups(report) {
        const groups = (report?.duplicateGroups || []).map(orderDuplicateGroupBestFirst);
        const query = healthState.query?.toLowerCase();
        const pageId = healthState.pageId;
        return groups.filter((group) => {
            if (pageId && pageId !== 'all') {
                const onPage = (group.bookmarks || []).some((b) => String(b.pageId) === String(pageId));
                if (!onPage) return false;
            }
            if (query) {
                const hay = `${group.url} ${(group.bookmarks || []).map((b) => b.name).join(' ')}`.toLowerCase();
                if (!hay.includes(query)) return false;
            }
            return true;
        }).sort((a, b) => (b.bookmarks?.length || 0) - (a.bookmarks?.length || 0));
    }

    function shouldShowDuplicatesPanel(report) {
        if (!['all', 'duplicate'].includes(healthState.filter)) return false;
        return getFilteredDuplicateGroups(report).length > 0;
    }

    const statusRank = { broken: 0, duplicate: 1, 'shortcut-conflict': 2, unchecked: 3, stale: 4, unused: 5, 'missing-preview': 6, healthy: 7 };

    function sortIssues(issues) {
        const sorted = [...issues];
        switch (healthState.sort) {
            case 'last-checked':
                sorted.sort((a, b) => (a.lastChecked || 0) - (b.lastChecked || 0));
                break;
            case 'last-checked-desc':
                sorted.sort((a, b) => (b.lastChecked || 0) - (a.lastChecked || 0));
                break;
            case 'status':
                sorted.sort((a, b) => (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99) || a.name.localeCompare(b.name));
                break;
            case 'name':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'score':
            default:
                sorted.sort((a, b) => a.score - b.score || (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99) || a.name.localeCompare(b.name));
                break;
        }
        return sorted;
    }

    function renderIssues(report) {
        const issues = sortIssues((report?.issues || []).filter((issue) =>
            matchesFilter(issue, healthState.filter)
            && matchesPageFilter(issue, healthState.pageId)
            && matchesQuery(issue, healthState.query)
        ));

        const resultsCount = document.getElementById('health-results-count');
        if (resultsCount) {
            resultsCount.textContent = t('health.visibleCount', '{count} visible', { count: issues.length });
        }

        healthState.visibleIssues = issues;

        if (!issues.length) {
            return `<div class="health-empty">${escapeHtml(emptyMessageForFilter(healthState.filter))}</div>`;
        }

        return issues.map((issue, rowIndex) => {
            const selKey = issueSelectionKey(issue);
            const isSelected = healthState.selected.has(selKey);
            const isFocused = healthState.focusedRowIndex === rowIndex;
            const openAria = t('health.rowOpenAria', 'Open "{name}" in bookmark editor', { name: issue.name || issue.url });
            return `
            <article class="health-row health-row--${escapeHtml(issue.status)}${isSelected ? ' health-row--selected' : ''}${isFocused ? ' health-row--focused' : ''}" data-row-index="${rowIndex}" data-row-key="${escapeHtml(selKey)}">
                <label class="health-row-select">
                    <input type="checkbox" class="health-row-checkbox" data-select-key="${escapeHtml(selKey)}"${isSelected ? ' checked' : ''} aria-label="${escapeHtml(t('health.selectRow', 'Select bookmark'))}" />
                </label>
                <div class="health-row-leading">
                    ${renderFavicon(issue)}
                    <div class="health-row-score ${scoreClass(issue.score)}" aria-label="${escapeHtml(t('health.scoreLabel', 'Health score {score}', { score: issue.score }))}">${escapeHtml(issue.score)}</div>
                </div>
                <button type="button" class="health-row-main health-row-open" data-open-config="1" aria-label="${escapeHtml(openAria)}">
                    <div class="health-row-head">
                        <h3 class="health-row-name">${escapeHtml(issue.name || issue.url)}</h3>
                        <p class="health-row-url">${escapeHtml(issue.url)}</p>
                    </div>
                    <div class="health-row-meta">
                        <span class="health-row-status">${escapeHtml(statusLabel(issue.status))}</span>
                        <span>${escapeHtml(issue.pageName || t('health.pageNumber', 'Page {id}', { id: issue.pageId }))}</span>
                        <span>${escapeHtml(issue.category || t('dashboard.uncategorized', 'uncategorized'))}</span>
                        ${issue.shortcut ? `<span>${escapeHtml(issue.shortcut)}</span>` : ''}
                        ${issue.pinned ? `<span>${escapeHtml(t('health.pinned', 'pinned'))}</span>` : ''}
                        ${issue.duplicateCount > 1 ? `<span>${escapeHtml(t('health.duplicateCount', '{count}x duplicate', { count: issue.duplicateCount }))}</span>` : ''}
                    </div>
                    <div class="health-row-reasons">
                        ${getIssueReasonLabels(issue).map((label) => `<span>${escapeHtml(label)}</span>`).join('')}
                    </div>
                    <div class="health-row-times">
                        <span>${escapeHtml(t('health.openedCount', 'opened {count}x', { count: issue.openCount || 0 }))}</span>
                        <span>${escapeHtml(t('health.lastOpened', 'last opened {date}', { date: fmtDate(issue.lastOpened) }))}</span>
                        <span>${escapeHtml(t('health.lastChecked', 'last checked {date}', { date: fmtDate(issue.lastChecked) }))}</span>
                    </div>
                </button>
                <div class="health-row-actions-col">
                    ${renderIssueActions(issue)}
                </div>
            </article>
        `;
        }).join('');
    }

    function renderDuplicates(report) {
        const groups = getFilteredDuplicateGroups(report);
        if (!groups.length) {
            return `<div class="health-empty">${escapeHtml(t('health.noDuplicateGroups', 'No duplicate groups found.'))}</div>`;
        }

        const html = groups.map((group, idx) => `
            <article class="health-duplicate-group" data-group-index="${idx}">
                <div class="health-duplicate-header">
                    <div class="health-duplicate-url">${escapeHtml(group.url)}</div>
                    <button class="btn btn-small btn-danger health-keep-first-btn" data-group-index="${idx}" title="${escapeHtml(t('health.keepBestTitle', 'Keep best bookmark (most opens, pinned, oldest)'))}">
                        ${escapeHtml(t('health.keepBest', 'keep best'))}
                    </button>
                </div>
                <div class="health-duplicate-items">
                    ${(group.bookmarks || []).map((bookmark, bIdx) => {
                        const dashHref = buildDashboardDeepLinkHref({
                            pageId: bookmark.pageId,
                            index: bookmark.index,
                            category: bookmark.category,
                            url: group.url,
                        });
                        const dashLabel = t('health.openInDashboard', 'dashboard');
                        const metaParts = [
                            t('health.openedCount', 'opened {count}x', { count: bookmark.openCount || 0 }),
                            bookmark.pinned ? t('health.pinned', 'pinned') : null
                        ].filter(Boolean).join(' · ');
                        return `
                        <span class="${bIdx === 0 ? 'health-duplicate-keep' : 'health-duplicate-remove'}">
                            ${escapeHtml(bookmark.name)}
                            <em>${escapeHtml(t('health.pageLower', 'page'))} ${escapeHtml(String(bookmark.pageId))}</em>
                            <small>${escapeHtml(metaParts)}</small>
                            <a class="health-duplicate-item-link" href="${escapeHtml(dashHref)}">${escapeHtml(dashLabel)}</a>
                            ${bIdx === 0 ? `<span class="health-duplicate-badge keep">${escapeHtml(t('health.keep', 'keep'))}</span>` : `<span class="health-duplicate-badge remove">${escapeHtml(t('health.remove', 'remove'))}</span>`}
                        </span>`;
                    }).join('')}
                </div>
            </article>
        `).join('');

        return html;
    }

    let healthListenersBound = false;

    async function handlePingClick(button) {
        const url = button.getAttribute('data-ping-url');
        const pageId = Number(button.getAttribute('data-ping-page'));
        const index = Number(button.getAttribute('data-ping-index'));
        if (!url) return;
        setButtonBusy(button, true);
        try {
            const response = await apiFetch(`/api/ping?url=${encodeURIComponent(url)}`);
            const result = await response.json();
            const status = result.status === 'online' ? 'online' : 'offline';
            const pingMs = result.ping || 0;
            const errorDetail = (result.errorDetail || '').trim()
                || (status === 'online' ? '' : t('health.errorPingFailed', 'ping failed'));
            const statusMsg = status === 'online'
                ? t('health.onlineMs', 'online {ms}ms', { ms: pingMs })
                : (errorDetail || t('health.offline', 'offline'));
            showBulkStatus(statusMsg);

            await cacheScanResult(url, status, pingMs, errorDetail);
            if (Number.isFinite(pageId) && Number.isFinite(index)) {
                await persistIssueStatus(pageId, index, status, status === 'online' ? '' : errorDetail);
                await loadReport();
                render();
            }
        } catch (error) {
            const failDetail = error.message || t('health.errorPingFailed', 'ping failed');
            showBulkStatus(t('health.failed', 'failed') + ': ' + failDetail);
            await cacheScanResult(url, 'error', 0, failDetail);
            if (Number.isFinite(pageId) && Number.isFinite(index)) {
                await persistIssueStatus(pageId, index, 'offline', failDetail);
                await loadReport();
                render();
            }
        } finally {
            setButtonBusy(button, false);
        }
    }

    function setupHealthEventListeners() {
        if (healthListenersBound) return;
        healthListenersBound = true;

        document.getElementById('health-summary')?.addEventListener('click', (e) => {
            const card = e.target.closest('[data-filter]');
            if (!card || !card.classList.contains('health-card-button')) return;
            healthState.filter = card.getAttribute('data-filter') || 'all';
            healthState.selected.clear();
            healthState.focusedRowIndex = -1;
            saveState();
            render();
        });

        document.getElementById('health-filter-pills')?.addEventListener('click', (e) => {
            const button = e.target.closest('[data-filter]');
            if (!button) return;
            healthState.filter = button.getAttribute('data-filter') || 'all';
            healthState.selected.clear();
            healthState.focusedRowIndex = -1;
            saveState();
            render();
        });

        document.getElementById('health-select-all-btn')?.addEventListener('click', () => {
            (healthState.visibleIssues || []).forEach((issue) => {
                healthState.selected.add(issueSelectionKey(issue));
            });
            render();
        });

        document.getElementById('health-clear-selection-btn')?.addEventListener('click', () => {
            healthState.selected.clear();
            render();
        });

        document.getElementById('health-bulk-delete-btn')?.addEventListener('click', () => {
            void bulkDeleteSelected();
        });

        document.getElementById('health-bulk-favicon-btn')?.addEventListener('click', () => {
            void bulkRefreshFaviconsSelected();
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.health-actions-menu-wrap')) return;
            closeAllActionMenus();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllActionMenus();
                return;
            }
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
                return;
            }
            if (!document.getElementById('health-issues')?.contains(document.activeElement)
                && tag !== 'body'
                && !e.target?.closest('#health-issues')) {
                // still allow when no specific focus inside issues
            }
            if (e.key === 'j' || e.key === 'ArrowDown') {
                e.preventDefault();
                moveRowFocus(1);
                return;
            }
            if (e.key === 'k' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveRowFocus(-1);
                return;
            }
            if (e.key === 'Enter' && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue) {
                    e.preventDefault();
                    openBookmarkInConfig(issue);
                }
                return;
            }
            if ((e.key === 'o' || e.key === 'O') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue?.url) {
                    e.preventDefault();
                    window.open(issue.url, '_blank', 'noopener');
                }
            }
        });

        document.getElementById('health-issues')?.addEventListener('click', async (e) => {
            const checkbox = e.target.closest('.health-row-checkbox');
            if (checkbox) {
                const key = checkbox.getAttribute('data-select-key');
                if (!key) return;
                if (checkbox.checked) healthState.selected.add(key);
                else healthState.selected.delete(key);
                syncSelectionToolbar();
                const row = checkbox.closest('.health-row');
                row?.classList.toggle('health-row--selected', checkbox.checked);
                return;
            }

            const openConfigBtn = e.target.closest('[data-open-config]');
            if (openConfigBtn) {
                const row = openConfigBtn.closest('.health-row');
                const idx = Number(row?.getAttribute('data-row-index'));
                const issue = healthState.visibleIssues[idx];
                if (issue) openBookmarkInConfig(issue);
                return;
            }

            const menuToggle = e.target.closest('[data-menu-toggle]');
            if (menuToggle) {
                e.stopPropagation();
                toggleActionMenu(menuToggle.getAttribute('data-menu-toggle') || '');
                return;
            }

            const button = e.target.closest('button');
            if (!button) return;

            closeAllActionMenus();

            if (button.hasAttribute('data-open-url')) {
                window.open(button.getAttribute('data-open-url'), '_blank', 'noopener');
                return;
            }
            if (button.hasAttribute('data-ping-url')) {
                await handlePingClick(button);
                return;
            }
            if (button.hasAttribute('data-heal-archive-url')) {
                const url = button.getAttribute('data-heal-archive-url');
                if (url) window.open(`https://web.archive.org/web/*/${url}`, '_blank', 'noopener');
                return;
            }
            if (button.hasAttribute('data-heal-redirect-page')) {
                const pageId = Number(button.getAttribute('data-heal-redirect-page'));
                const index = Number(button.getAttribute('data-heal-redirect-index'));
                if (Number.isFinite(pageId) && Number.isFinite(index)) {
                    await handleRedirectDetect(button, pageId, index);
                }
                return;
            }
            if (button.hasAttribute('data-heal-title-page')) {
                const pageId = Number(button.getAttribute('data-heal-title-page'));
                const index = Number(button.getAttribute('data-heal-title-index'));
                if (Number.isFinite(pageId) && Number.isFinite(index)) {
                    await handleTitleRefresh(button, pageId, index);
                }
                return;
            }
            if (button.hasAttribute('data-heal-fix-page')) {
                const pageId = Number(button.getAttribute('data-heal-fix-page'));
                const index = Number(button.getAttribute('data-heal-fix-index'));
                if (Number.isFinite(pageId) && Number.isFinite(index)) {
                    await handleOneClickFix(button, pageId, index);
                }
                return;
            }
            if (button.hasAttribute('data-delete-page')) {
                const pageId = Number(button.getAttribute('data-delete-page'));
                const index = Number(button.getAttribute('data-delete-index'));
                const name = button.getAttribute('data-delete-name') || '';
                if (Number.isFinite(pageId) && Number.isFinite(index)) {
                    await handleDeleteIssue(button, pageId, index, name);
                }
                return;
            }
            if (button.hasAttribute('data-favicon-url')) {
                const url = button.getAttribute('data-favicon-url');
                const pageId = Number(button.getAttribute('data-favicon-page'));
                const index = Number(button.getAttribute('data-favicon-index'));
                if (url && Number.isFinite(pageId) && Number.isFinite(index)) {
                    await handleFaviconRefresh(button, url, pageId, index);
                }
            }
        });

        document.getElementById('health-duplicates')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('.health-keep-first-btn');
            if (!btn) return;
            const idx = parseInt(btn.getAttribute('data-group-index'), 10);
            const groups = getFilteredDuplicateGroups(healthState.report);
            const group = groups[idx];
            if (!group) return;

            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = t('health.removing', 'removing…');
            try {
                await performMergeDuplicates(group);
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });

        const sortSelect = document.getElementById('health-sort-select');
        sortSelect?.addEventListener('change', () => {
            healthState.sort = sortSelect.value;
            saveState();
            render();
        });

        document.getElementById('retest-all-btn')?.addEventListener('click', async (e) => {
            const btn = e.target;
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.textContent = t('health.retesting', 'retesting...');
            try {
                const response = await apiFetch('/api/health/retest-all', {
                    method: 'POST',
                    headers: writeJsonHeaders()
                });
                if (response.ok) {
                    const result = await response.json();
                    showBulkStatus(t('health.retestedBookmarks', 'Retested {count} bookmarks', { count: result.count || 0 }));
                    btn.textContent = t('health.reloading', 'reloading...');
                    await loadReport();
                    render();
                } else {
                    showBulkStatus(t('health.retestFailed', 'Failed to retest all bookmarks'));
                }
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
            } finally {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
                btn.textContent = originalText;
            }
        });

        document.getElementById('open-broken-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget || e.target;
            const OPEN_BROKEN_MAX = 10;
            const totalBroken = Number(healthState.report?.summary?.brokenCount || 0)
                || (healthState.report?.issues || []).filter((issue) => issue.status === 'broken').length;

            if (totalBroken === 0) {
                showBulkStatus(t('health.noBrokenLinks', 'No broken links to open.'));
                return;
            }

            const openCount = Math.min(totalBroken, OPEN_BROKEN_MAX);
            const confirmMessage = t(
                'health.openBrokenConfirm',
                'Open {count} broken link(s) in new tabs? (max {max} at a time; {total} total broken.)',
                { count: openCount, max: OPEN_BROKEN_MAX, total: totalBroken }
            );

            let confirmed = true;
            if (window.AppModal && typeof window.AppModal.confirm === 'function') {
                confirmed = await window.AppModal.confirm({
                    title: t('health.openBrokenTitle', 'Open broken links'),
                    message: confirmMessage,
                    confirmText: t('health.openBrokenConfirmBtn', 'Open links'),
                    cancelText: t('health.cancel', 'Cancel'),
                    confirmClass: 'danger'
                });
            } else if (!window.confirm(confirmMessage)) {
                confirmed = false;
            }
            if (!confirmed) return;

            const originalText = btn.textContent;
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.textContent = t('health.opening', 'opening...');
            try {
                const response = await apiFetch('/api/health/open-broken', {
                    method: 'POST',
                    headers: writeJsonHeaders(),
                    body: JSON.stringify({ limit: OPEN_BROKEN_MAX })
                });
                if (response.ok) {
                    const result = await response.json();
                    const urls = result.urls || [];
                    urls.forEach((url) => {
                        window.open(url, '_blank', 'noopener');
                    });
                    let statusMsg = t('health.openedBrokenLinks', 'Opened {count} broken links', { count: urls.length });
                    const remaining = Math.max(0, (result.totalBroken || totalBroken) - urls.length);
                    if (remaining > 0) {
                        statusMsg += ' ' + t('health.openBrokenRemaining', '({remaining} more in health view.)', { remaining });
                    }
                    showBulkStatus(statusMsg);
                } else {
                    showBulkStatus(t('health.openBrokenFailed', 'Failed to open broken links'));
                }
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
            } finally {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
                btn.textContent = originalText;
            }
        });

        document.getElementById('merge-duplicates-btn')?.addEventListener('click', () => {
            showMergeDuplicatesFlow();
        });
    }

    function showBulkStatus(message) {
        const statusEl = document.getElementById('health-bulk-status');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.hidden = false;
            setTimeout(() => {
                statusEl.hidden = true;
            }, 4000);
        }
    }

    function reportBulkOutcome({ success, total, failed = Math.max(0, total - success), successKey, successFallback, partialKey, partialFallback, failedKey, failedFallback }) {
        if (failed > 0 && success > 0) {
            showBulkStatus(t(partialKey, partialFallback, { success, total, failed }));
            return;
        }
        if (failed > 0 || success === 0 && total > 0) {
            showBulkStatus(t(failedKey, failedFallback));
            return;
        }
        showBulkStatus(t(successKey, successFallback, { count: success }));
    }

    function showMergeDuplicatesFlow() {
        const groups = getFilteredDuplicateGroups(healthState.report);
        if (!groups.length) {
            showBulkStatus(t('health.noDuplicateGroupsToMerge', 'No duplicate groups to merge.'));
            return;
        }
        pickDuplicateGroup(groups).then((group) => {
            if (group) confirmAndMergeDuplicateGroup(group);
        });
    }

    function pickDuplicateGroup(groups) {
        if (!groups.length) return Promise.resolve(null);
        if (groups.length === 1) return Promise.resolve(groups[0]);

        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const itemsHtml = groups.map((group, idx) => {
                const count = (group.bookmarks || []).length;
                const names = (group.bookmarks || []).map((b) => escapeHtml(b.name)).join(', ');
                return `<button type="button" class="health-merge-pick-btn" data-group-index="${idx}">
                    <span class="health-merge-pick-url">${escapeHtml(group.url)}</span>
                    <span class="health-merge-pick-names">${names}</span>
                    <span class="health-merge-pick-meta">${escapeHtml(t('health.duplicateCount', '{count}x duplicate', { count }))}</span>
                </button>`;
            }).join('');

            const htmlMessage = `<p class="health-merge-pick-intro">${escapeHtml(t('health.selectDuplicateGroup', 'Select a duplicate group to merge'))}</p>
                <div class="health-merge-pick-list">${itemsHtml}</div>`;

            if (!window.AppModal || typeof window.AppModal.show !== 'function') {
                showBulkStatus(t('health.mergeModalRequired', 'Open the merge picker from a desktop browser with modals enabled.'));
                finish(null);
                return;
            }

            window.AppModal.show({
                title: t('health.mergeDuplicateTitle', 'Merge duplicate group'),
                htmlMessage,
                showCancel: false,
                confirmText: t('health.cancel', 'Cancel'),
                onConfirm: () => finish(null),
                onHide: () => finish(null),
                modalMaxWidth: '34rem',
                modalClass: 'health-merge-modal'
            });

            requestAnimationFrame(() => {
                document.querySelectorAll('.health-merge-pick-btn').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const idx = parseInt(btn.getAttribute('data-group-index'), 10);
                        finish(groups[idx]);
                        window.AppModal.hide();
                    });
                });
            });
        });
    }

    async function confirmAndMergeDuplicateGroup(group) {
        const ordered = orderDuplicateGroupBestFirst(group);
        if (!ordered?.bookmarks?.length || ordered.bookmarks.length < 2) {
            showBulkStatus(t('health.noDuplicateGroupsToMerge', 'No duplicate groups to merge.'));
            return;
        }

        const target = ordered.bookmarks[0];
        const sources = ordered.bookmarks.slice(1);
        const confirmMessage = t(
            'health.mergeConfirmBest',
            'Merge {count} bookmark(s) with the same URL?\n\nKeeps best: "{keep}" ({opens}x opened{pinned})\nRemoves: {remove} duplicate(s).',
            {
                count: ordered.bookmarks.length,
                keep: target.name,
                opens: target.openCount || 0,
                pinned: target.pinned ? `, ${t('health.pinned', 'pinned')}` : '',
                remove: sources.length
            }
        );

        let confirmed = true;
        if (window.AppModal && typeof window.AppModal.confirm === 'function') {
            confirmed = await window.AppModal.confirm({
                title: t('health.mergeDuplicateTitle', 'Merge duplicate group'),
                message: confirmMessage,
                confirmText: t('health.mergeConfirmBtn', 'Merge duplicates'),
                cancelText: t('health.cancel', 'Cancel'),
                confirmClass: 'danger'
            });
        } else if (!window.confirm(confirmMessage)) {
            confirmed = false;
        }
        if (!confirmed) return;

        await performMergeDuplicates(ordered);
    }

    async function performMergeDuplicates(group) {
        const ordered = orderDuplicateGroupBestFirst(group);
        if (!ordered.bookmarks?.length) return;

        const target = ordered.bookmarks[0];
        const sources = ordered.bookmarks.slice(1);

        try {
            const response = await apiFetch('/api/health/merge-duplicates', {
                method: 'POST',
                headers: writeJsonHeaders(),
                body: JSON.stringify({
                    targetPageId: target.pageId,
                    targetIndex: target.index,
                    sourcePageIds: sources.map(b => b.pageId),
                    sourceIndices: sources.map(b => b.index)
                })
            });

            if (response.ok) {
                const result = await response.json();
                showBulkStatus(t('health.mergedDuplicates', 'Merged {count} duplicates', { count: result.count || 0 }));
                // Reload report
                setTimeout(async () => {
                    await loadReport();
                    render();
                }, 500);
            } else {
                showBulkStatus(t('health.mergeFailed', 'Failed to merge duplicates'));
            }
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        }
    }

    function healthCacheURL(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        if (typeof BookmarkUrlUtils !== 'undefined' && typeof BookmarkUrlUtils.canonicalBookmarkURLKey === 'function') {
            return BookmarkUrlUtils.canonicalBookmarkURLKey(raw);
        }
        return raw;
    }

    async function cacheScanResult(url, status, pingMs, error) {
        try {
            const cacheURL = healthCacheURL(url);
            if (!cacheURL) return;
            await apiFetch('/api/health/cache-scan', {
                method: 'POST',
                headers: writeJsonHeaders(),
                body: JSON.stringify({
                    url: cacheURL,
                    status: status,
                    pingMs: pingMs,
                    error: error
                })
            });
        } catch (e) {
            // Silently fail cache writes
        }
    }

    async function persistIssueStatus(pageId, index, status, error) {
        try {
            await apiFetch('/api/health/update-status', {
                method: 'POST',
                headers: writeJsonHeaders(),
                body: JSON.stringify({ pageId, index, status, error })
            });
        } catch (e) {
            console.warn('Health status persistence failed', pageId, index, e);
            showBulkStatus(t('health.statusPersistFailed', 'Could not save status to disk.'));
        }
    }

    async function fetchAutoHealSuggestion(pageId, index) {
        const response = await apiFetch(
            `/api/health/auto-heal-suggest?pageId=${encodeURIComponent(pageId)}&index=${encodeURIComponent(index)}`
        );
        if (!response.ok) {
            throw new Error('Failed to fetch auto-heal suggestions');
        }
        return response.json();
    }

    async function applyAutoHeal(pageId, index, payload = {}) {
        const response = await apiFetch('/api/health/auto-heal-apply', {
            method: 'POST',
            headers: writeJsonHeaders(),
            body: JSON.stringify({
                pageId,
                index,
                newUrl: payload.newUrl || '',
                refreshTitle: payload.refreshTitle === true
            })
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || 'Auto-heal apply failed');
        }
        return response.json();
    }

    async function handleRedirectDetect(button, pageId, index) {
        setButtonBusy(button, true);
        try {
            const suggestion = await fetchAutoHealSuggestion(pageId, index);
            if (!suggestion.redirectUrl) {
                showBulkStatus(t('health.autoHealNoRedirect', 'No redirect suggestion found.'));
                return;
            }
            const applyNow = await confirmDialog({
                title: t('health.autoHealRedirect', 'detect redirect'),
                message: t('health.autoHealRedirectConfirm', 'Redirect found. Apply URL fix now?'),
                confirmText: t('health.confirm', 'Confirm'),
                cancelText: t('health.cancel', 'Cancel')
            });
            if (!applyNow) {
                showBulkStatus(t('health.autoHealRedirectFound', 'Redirect found: {url}', { url: suggestion.redirectUrl }));
                return;
            }
            await applyAutoHeal(pageId, index, { newUrl: suggestion.redirectUrl, refreshTitle: false });
            showBulkStatus(t('health.autoHealRedirectApplied', 'Redirect URL applied.'));
            await loadReport();
            render();
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function handleTitleRefresh(button, pageId, index) {
        setButtonBusy(button, true);
        try {
            await applyAutoHeal(pageId, index, { refreshTitle: true });
            showBulkStatus(t('health.autoHealTitleApplied', 'Title refreshed.'));
            await loadReport();
            render();
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function handleOneClickFix(button, pageId, index) {
        setButtonBusy(button, true);
        try {
            const suggestion = await fetchAutoHealSuggestion(pageId, index);
            await applyAutoHeal(pageId, index, {
                newUrl: suggestion.redirectUrl || '',
                refreshTitle: true
            });
            showBulkStatus(t('health.autoHealDone', 'Auto-heal applied.'));
            await loadReport();
            render();
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function handleDeleteIssue(button, pageId, index, bookmarkName) {
        const confirmed = await confirmDialog({
            title: t('health.delete', 'delete'),
            message: t('health.deleteConfirm', 'Delete "{name}" from dashboard?', { name: bookmarkName || 'bookmark' }),
            confirmText: t('health.delete', 'delete'),
            cancelText: t('health.cancel', 'Cancel'),
            confirmClass: 'danger'
        });
        if (!confirmed) return;

        setButtonBusy(button, true);
        try {
            const response = await apiFetch('/api/health/delete-bookmark', {
                method: 'POST',
                headers: writeJsonHeaders(),
                body: JSON.stringify({ pageId, index })
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            showBulkStatus(t('health.deleted', 'Bookmark deleted.'));
            await loadReport();
            render();
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function handleFaviconRefresh(button, url, pageId, index) {
        setButtonBusy(button, true);
        try {
            const fetchIcon = window.BookmarkPreviewService?.fetchAndUploadFavicon;
            if (typeof fetchIcon !== 'function') {
                throw new Error('Favicon service not available');
            }

            const iconPath = await fetchIcon(url);
            if (!iconPath) {
                showBulkStatus(t('health.faviconNotFound', 'No favicon found for this URL.'));
                return;
            }

            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) throw new Error('Failed to load bookmarks');
            const bookmarks = await res.json();
            if (!Array.isArray(bookmarks) || !bookmarks[index]) throw new Error('Bookmark not found');
            bookmarks[index].icon = iconPath;
            const saveRes = await apiFetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: writeJsonHeaders(),
                body: JSON.stringify(bookmarks)
            });
            if (!saveRes.ok) throw new Error('Failed to save bookmark');

            showBulkStatus(t('health.faviconRefreshed', 'Favicon updated.'));
            await loadReport();
            render();
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        } finally {
            setButtonBusy(button, false);
        }
    }

    function syncFilterClearButton() {
        const input = document.getElementById('health-search');
        const clearBtn = document.getElementById('health-search-clear');
        if (!input || !clearBtn) return;
        clearBtn.hidden = !input.value.trim();
    }

    function syncPageFilterSelect(report) {
        const select = document.getElementById('health-page-filter');
        if (!select) return;

        const options = getPageFilterOptions(report);
        const allLabel = escapeHtml(t('health.filterPageAll', 'All pages'));
        select.innerHTML = `<option value="all">${allLabel}</option>`
            + options.map(([id, name]) => `<option value="${escapeHtml(String(id))}">${escapeHtml(name)}</option>`).join('');

        const current = String(healthState.pageId);
        if (current === 'all' || options.some(([id]) => String(id) === current)) {
            select.value = current;
        } else {
            healthState.pageId = 'all';
            select.value = 'all';
            saveState();
        }
    }

    function render() {
        const report = healthState.report;
        if (!report) return;

        const summaryEl = document.getElementById('health-summary');
        const pillsEl = document.getElementById('health-filter-pills');
        const issuesEl = document.getElementById('health-issues');
        const duplicatesEl = document.getElementById('health-duplicates');

        if (summaryEl) summaryEl.innerHTML = renderSummary(report);
        if (pillsEl) {
            pillsEl.innerHTML = renderFilterPills(report);
            if (!pillsEl.getAttribute('role')) {
                pillsEl.setAttribute('role', 'group');
                pillsEl.setAttribute('aria-label', t('health.filterGroupLabel', 'Filter by issue type'));
            }
        }
        syncPageFilterSelect(report);
        if (issuesEl) issuesEl.innerHTML = renderIssues(report);
        if (duplicatesEl) duplicatesEl.innerHTML = renderDuplicates(report);

        const dupPanel = document.querySelector('.health-duplicates-panel');
        if (dupPanel) {
            dupPanel.hidden = !shouldShowDuplicatesPanel(report);
        }

        const mergeBtn = document.getElementById('merge-duplicates-btn');
        if (mergeBtn) {
            mergeBtn.disabled = !getFilteredDuplicateGroups(report).length;
        }

        const sortSelect = document.getElementById('health-sort-select');
        if (sortSelect && sortSelect.value !== healthState.sort) {
            sortSelect.value = healthState.sort;
        }

        syncFilterClearButton();
        pruneSelection();
        syncSelectionToolbar();
    }

    async function loadReport() {
        const response = await fetch('/api/bookmark-health');
        if (!response.ok) {
            throw new Error(`Failed to load health report: ${response.status}`);
        }
        healthState.report = await response.json();
    }

    function applyHealthControlTitles() {
        document.querySelectorAll('[data-health-title]').forEach((el) => {
            const key = el.getAttribute('data-health-title');
            if (!key) return;
            el.title = t(key, el.title || '');
        });
        const bulkToolbar = document.querySelector('.health-bulk-toolbar');
        if (bulkToolbar) {
            bulkToolbar.setAttribute('aria-label', t('health.bulkActions', 'Bulk actions'));
        }
    }

    async function main() {
        if (window.PageLayoutSync?.init) {
            await window.PageLayoutSync.init();
        }

        if (typeof ConfigLanguage === 'function') {
            healthState.language = new ConfigLanguage();
            await healthState.language.init(document.documentElement.lang || 'en');
            window.healthLanguage = healthState.language;
            document.title = t('health.pageTitle', 'health beta');
            if (typeof healthState.language.applyTranslations === 'function') {
                healthState.language.applyTranslations();
            }
            applyHealthControlTitles();
        }

        const hadStoredState = Boolean(sessionStorage.getItem(STORAGE_KEY));
        const urlHadFilter = Boolean(new URLSearchParams(window.location.search).get('filter'));
        restoreState();
        const shouldRetest = applyUrlParams();
        if (!hadStoredState && !urlHadFilter) {
            healthState.filter = DEFAULT_FILTER;
            saveState();
        }
        syncUrlParams();

        const searchInput = document.getElementById('health-search');
        const refreshButton = document.getElementById('refresh-health-btn');

        if (searchInput && healthState.query) searchInput.value = healthState.query;

        const pageFilter = document.getElementById('health-page-filter');
        pageFilter?.addEventListener('change', () => {
            healthState.pageId = pageFilter.value || 'all';
            saveState();
            render();
        });

        searchInput?.addEventListener('input', () => {
            healthState.query = searchInput.value.trim();
            saveState();
            syncFilterClearButton();
            render();
        });

        document.getElementById('health-search-clear')?.addEventListener('click', () => {
            if (!searchInput) return;
            searchInput.value = '';
            healthState.query = '';
            saveState();
            syncFilterClearButton();
            render();
            searchInput.focus();
        });

        refreshButton?.addEventListener('click', async () => {
            refreshButton.disabled = true;
            refreshButton.textContent = t('health.refreshing', 'refreshing...');
            try {
                await loadReport();
                render();
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
            } finally {
                refreshButton.disabled = false;
                refreshButton.textContent = t('health.refresh', 'refresh');
            }
        });

        setupHealthEventListeners();

        await loadReport();
        render();

        if (shouldRetest) {
            const retestBtn = document.getElementById('retest-all-btn');
            if (retestBtn) {
                retestBtn.click();
            }
        }

        if (window.SkeletonLoading && typeof window.SkeletonLoading.finish === 'function') {
            window.SkeletonLoading.finish();
        } else {
            document.body.classList.remove('loading');
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        main().catch((error) => {
            console.error(error);
            const summary = document.getElementById('health-summary');
            if (summary) {
                summary.innerHTML = `<div class="health-empty">${escapeHtml(t('health.loadFailed', 'Unable to load the health report.'))}</div>`;
            }
            window.AppNotification?.showErrorWithReload?.(
                t('health.loadFailed', 'Unable to load the health report.')
            );
            if (window.SkeletonLoading && typeof window.SkeletonLoading.finish === 'function') {
                window.SkeletonLoading.finish();
            } else {
                document.body.classList.remove('loading');
            }
        });
    });
})();