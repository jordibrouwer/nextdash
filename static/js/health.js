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
        expandedScores: new Set(),
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
        const wantsRetest = params.get('refresh') === '1';
        if (wantsRetest) {
            // Consume the param here rather than leaving it to the saveState() calls in
            // main(), which strip it only as a side effect of rebuilding the query
            // string. ?refresh=1 auto-clicks retest, and retest ends in reloadReport();
            // if the param ever outlives the run, that pair re-pings every bookmark on
            // each load.
            params.delete('refresh');
            const qs = params.toString();
            history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
        }
        return wantsRetest;
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

    // Reason translation and score banding are shared with the dashboard health
    // view via HealthReasonUtils — see static/js/health-reason-utils.js.
    function translateReason(reason) {
        return window.HealthReasonUtils.translateReason(healthState.language, reason);
    }

    function translateReasonDetail(item) {
        return window.HealthReasonUtils.translateReasonDetail(healthState.language, item);
    }

    function getIssueReasonLabels(issue) {
        return window.HealthReasonUtils.getIssueReasonLabels(healthState.language, issue);
    }

    function getIssueReasonEntries(issue) {
        return window.HealthReasonUtils.getIssueReasonEntries(healthState.language, issue);
    }

    function renderScoreBreakdown(issue) {
        const entries = getIssueReasonEntries(issue);
        if (!entries.length) {
            return `<p class="health-score-perfect">${escapeHtml(t('health.scorePerfect', 'No issues found — full score.'))}</p>`;
        }
        const rows = entries.map((entry) => `
            <li class="health-score-item">
                <span class="health-score-item-label">${escapeHtml(entry.label)}</span>
                ${entry.penalty > 0
                    ? `<span class="health-score-item-cost">−${escapeHtml(entry.penalty)}</span>`
                    : ''}
            </li>`).join('');
        return `
            <p class="health-score-explain-intro">${escapeHtml(t('health.scoreExplainIntro', 'Every bookmark starts at 100. This one loses:'))}</p>
            <ul class="health-score-list">${rows}</ul>
            <p class="health-score-total">
                <span>${escapeHtml(t('health.scoreTotal', 'Score'))}</span>
                <span class="health-score-total-value ${scoreClass(issue.score)}">${escapeHtml(issue.score)}</span>
            </p>`;
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
        // Encode the stored filename so a space, #, ? or similar can't break the
        // URL (matches the dashboard bookmark/category icon renderers).
        return `/data/icons/${encodeURIComponent(raw)}`;
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

        const healMenuItems = healable ? `
                <p class="health-actions-menu-label" role="presentation">${escapeHtml(t('health.menuRepair', 'Repair'))}</p>
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-redirect-page="${escapeHtml(issue.pageId)}" data-heal-redirect-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealRedirect', 'detect redirect'))}</button>
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-title-page="${escapeHtml(issue.pageId)}" data-heal-title-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealTitle', 'refresh title'))}</button>
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-archive-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.autoHealArchive', 'archive'))}</button>
            ` : `
                <button type="button" class="health-actions-menu-item" role="menuitem" data-heal-archive-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.autoHealArchive', 'archive'))}</button>
            `;

        const statusMenuItems = issue.url ? `
                            <p class="health-actions-menu-label" role="presentation">${escapeHtml(t('health.menuStatus', 'Status'))}</p>
                            <button type="button" class="health-actions-menu-item" role="menuitem" data-ping-url="${escapeHtml(issue.url)}" data-ping-page="${escapeHtml(issue.pageId)}" data-ping-index="${escapeHtml(issue.index)}">${escapeHtml(pingLabel)}</button>
            ` : '';

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
                            ${statusMenuItems}
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

    /**
     * Open/close the score breakdown for one row. State lives in healthState so an
     * open panel survives the re-render that follows a ping or retest.
     */
    function toggleScorePanel(key, force) {
        if (!key) return;
        const shouldOpen = typeof force === 'boolean' ? force : !healthState.expandedScores.has(key);
        if (shouldOpen) {
            healthState.expandedScores.add(key);
        } else {
            healthState.expandedScores.delete(key);
        }
        syncScorePanel(key);
    }

    function syncScorePanel(key) {
        const panel = document.querySelector(`[data-score-panel="${CSS.escape(key)}"]`);
        const toggle = document.querySelector(`[data-score-toggle="${CSS.escape(key)}"]`);
        if (!panel || !toggle) return;
        const open = healthState.expandedScores.has(key);
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.closest('.health-row')?.classList.toggle('health-row--score-open', open);
    }

    function syncAllScorePanels() {
        document.querySelectorAll('[data-score-panel]').forEach((panel) => {
            syncScorePanel(panel.getAttribute('data-score-panel') || '');
        });
    }

    /**
     * Roving tabindex, mirroring KeyboardNavigation.syncRovingTabStops on the
     * dashboard: only the current row is a tab stop. Every control inside a row
     * being tabbable meant ~8 stops per row, so reaching the last of 100 bookmarks
     * by keyboard was hundreds of presses. Within a row, j/k/s/x/p/Enter/o do the
     * work; Tab moves between rows.
     */
    function syncRowTabStops({ focus = false } = {}) {
        const rows = document.querySelectorAll('#health-issues .health-row');
        const active = healthState.focusedRowIndex;
        rows.forEach((row, i) => {
            const isCurrent = active >= 0 ? i === active : i === 0;
            row.querySelectorAll('button, a, input, select').forEach((el) => {
                el.tabIndex = -1;
            });
            const main = row.querySelector('.health-row-main');
            if (main) main.tabIndex = isCurrent ? 0 : -1;
        });
        if (focus && active >= 0 && rows[active]) {
            const main = rows[active].querySelector('.health-row-main');
            try {
                main?.focus({ preventScroll: true });
            } catch {
                main?.focus();
            }
        }
    }

    function focusRowByIndex(index, { focus = false } = {}) {
        const rows = document.querySelectorAll('#health-issues .health-row');
        if (!rows.length) return;
        const clamped = Math.max(0, Math.min(index, rows.length - 1));
        healthState.focusedRowIndex = clamped;
        rows.forEach((row, i) => {
            row.classList.toggle('health-row--focused', i === clamped);
        });
        rows[clamped]?.scrollIntoView({ block: 'nearest' });
        syncRowTabStops({ focus });
    }

    function moveRowFocus(delta, options = {}) {
        const rows = document.querySelectorAll('#health-issues .health-row');
        if (!rows.length) return;
        const hadFocus = healthState.focusedRowIndex >= 0;
        const start = hadFocus ? healthState.focusedRowIndex : 0;
        // First j/k lands on row 0 rather than skipping past it.
        focusRowByIndex(hadFocus ? start + delta : 0, options);
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

        // The backend deletes by positional index, so deleting one bookmark
        // shifts every later index on the same page down by one. Resolve the
        // selected issues up front and delete each page's rows from the highest
        // index down, so the still-pending (lower) indices stay valid.
        const issues = keys
            .map((key) => findIssueBySelectionKey(key))
            .filter(Boolean)
            .sort((a, b) => (b.pageId - a.pageId) || (b.index - a.index));

        let deleted = 0;
        let failed = 0;
        for (const issue of issues) {
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
        await reloadReport();
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
        await reloadReport();
    }

    function fmtDate(value) {
        if (!value) return t('health.never', 'never');
        return new Date(value).toLocaleString(healthState.language?.currentLanguage || undefined);
    }

    function scoreClass(score) {
        return window.HealthReasonUtils.scoreClass(score);
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
            // Out of the tab sequence: these KPI tiles duplicate the filter pills
            // below them, and having both cost 9 extra stops before the first row.
            // Still clickable, and the pills give the same filters a keyboard path.
            return `
                <button type="button" class="health-card health-card-${tone} health-card-button${activeClass}" data-filter="${escapeHtml(filterKey)}"${metaTitle} tabindex="-1">
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

        // role="toolbar" (set on the container) means one tab stop with arrow keys
        // inside, not nine separate stops. The active pill carries the stop.
        return filterOrder.map((filter) => {
            const isActive = healthState.filter === filter;
            return `
            <button class="health-pill health-period-btn ${isActive ? 'active' : ''}" type="button" data-filter="${filter}" aria-pressed="${isActive ? 'true' : 'false'}" tabindex="${isActive ? '0' : '-1'}">
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
                    <button type="button"
                            class="health-row-score ${scoreClass(issue.score)}"
                            data-score-toggle="${escapeHtml(selKey)}"
                            aria-expanded="false"
                            aria-controls="health-score-panel-${escapeHtml(selKey)}"
                            aria-label="${escapeHtml(t('health.scoreExplainAria', 'Health score {score}. Show how this score is calculated.', { score: issue.score }))}"
                    >${escapeHtml(issue.score)}</button>
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
                <div class="health-score-panel" id="health-score-panel-${escapeHtml(selKey)}" data-score-panel="${escapeHtml(selKey)}" hidden>
                    ${renderScoreBreakdown(issue)}
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
    let healthRuntime = null;

    function ensureHealthRuntime() {
        if (healthRuntime) return healthRuntime;
        healthRuntime = window.HealthRuntime.create({
            getReport: () => healthState.report,
            setReport: (report) => {
                healthState.report = report;
            },
            fetchReport: async () => {
                const response = await fetch('/api/bookmark-health');
                if (!response.ok) {
                    throw new Error(`Failed to load health report: ${response.status}`);
                }
                return response.json();
            },
            onRender: () => renderView(),
            onBusyChange: (busy) => {
                document.body.classList.toggle('health-action-busy', busy);
                const main = document.getElementById('health-main');
                if (main) {
                    main.setAttribute('aria-busy', busy ? 'true' : 'false');
                }
            },
            onStatus: (message) => {
                if (message) showBulkStatus(message);
            }
        });
        healthRuntime.setSaveStateHandler(saveState);
        return healthRuntime;
    }

    function beginSelectSync(kind) {
        ensureHealthRuntime().beginSelectSync(kind);
    }

    function endSelectSync(kind) {
        ensureHealthRuntime().endSelectSync(kind);
    }

    function scheduleRender() {
        ensureHealthRuntime().scheduleRender();
    }

    function render() {
        ensureHealthRuntime().renderNow();
    }

    async function loadReport() {
        return ensureHealthRuntime().loadReport();
    }

    async function reloadReport() {
        return ensureHealthRuntime().reloadReport();
    }

    function healthFetch(url, init = {}, timeoutMs) {
        return ensureHealthRuntime().apiFetchTimed(apiFetch, url, init, timeoutMs);
    }

    function formatHealthError(error) {
        if (!error) return t('health.errorUnreachable', 'Unreachable');
        if (error.name === 'AbortError') {
            return t('health.errorTimeout', 'Request timeout');
        }
        return error.message || String(error);
    }

    async function runHealthAction(actionId, fn, options = {}) {
        const outcome = await ensureHealthRuntime().runAction(actionId, fn, options);
        if (!outcome.ok && outcome.reason === 'busy') {
            showBulkStatus(t('health.actionBusy', 'Another health action is still running.'));
            return null;
        }
        if (!outcome.ok && outcome.error) {
            throw outcome.error;
        }
        return outcome.result;
    }

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
                await reloadReport();
            }
        } catch (error) {
            const failDetail = error.message || t('health.errorPingFailed', 'ping failed');
            showBulkStatus(t('health.failed', 'failed') + ': ' + failDetail);
            await cacheScanResult(url, 'error', 0, failDetail);
            if (Number.isFinite(pageId) && Number.isFinite(index)) {
                await persistIssueStatus(pageId, index, 'offline', failDetail);
                await reloadReport();
            }
        } finally {
            setButtonBusy(button, false);
        }
    }

    /**
     * A run that tests nothing still returns status "completed"; reporting only the
     * count made that read as success and left the user waiting on a retest that
     * never ran.
     */
    function formatRetestSummary(result) {
        const count = Number(result?.count || 0);
        const overLimit = Number(result?.skippedOverLimit || 0);
        if (count === 0) {
            return t('health.retestedNone', 'Nothing to retest: no bookmarks have status checks enabled.');
        }
        const parts = [t('health.retestedBookmarks', 'Retested {count} bookmarks', { count })];
        if (overLimit > 0) {
            parts.push(t(
                'health.retestLimitReached',
                '{count} not tested (per-run limit) — run again to continue.',
                { count: overLimit }
            ));
        }
        return parts.join(' ');
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

        // Standard toolbar keys: arrows move between pills, Home/End jump to the ends.
        // The pills are one tab stop, so without this they'd be mouse-only.
        document.getElementById('health-filter-pills')?.addEventListener('keydown', (e) => {
            const pills = [...document.querySelectorAll('#health-filter-pills .health-pill')];
            if (!pills.length) return;
            const current = pills.indexOf(document.activeElement);
            if (current < 0) return;
            let next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % pills.length;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + pills.length) % pills.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = pills.length - 1;
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            pills.forEach((pill, i) => { pill.tabIndex = i === next ? 0 : -1; });
            pills[next].focus();
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

        // role="menu" promises arrow-key navigation; wire it up so the menu items are
        // operable now that the more-button is no longer a tab stop.
        document.getElementById('health-issues')?.addEventListener('keydown', (e) => {
            const menu = e.target.closest?.('.health-actions-menu');
            if (!menu || menu.hidden) return;
            const items = [...menu.querySelectorAll('.health-actions-menu-item')];
            if (!items.length) return;
            const current = items.indexOf(document.activeElement);
            let next = null;
            if (e.key === 'ArrowDown') next = (current + 1) % items.length;
            else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = items.length - 1;
            else if (e.key === 'Escape' || e.key === 'Tab') {
                // Hand focus back to the row so j/k keep working after the menu closes.
                closeAllActionMenus();
                const row = menu.closest('.health-row');
                row?.querySelector('.health-row-main')?.focus();
                if (e.key === 'Escape') e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            items[next].focus();
        });

        // Tabbing (or clicking) into a row makes it the current row, so j/k continue
        // from where focus actually is instead of from a stale index.
        document.getElementById('health-issues')?.addEventListener('focusin', (e) => {
            const row = e.target.closest?.('.health-row');
            if (!row) return;
            const index = Number(row.getAttribute('data-row-index'));
            if (!Number.isFinite(index) || index === healthState.focusedRowIndex) return;
            healthState.focusedRowIndex = index;
            document.querySelectorAll('#health-issues .health-row').forEach((el, i) => {
                el.classList.toggle('health-row--focused', i === index);
            });
            syncRowTabStops();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close what is open, innermost first, so one Escape does not wipe
                // both an action menu and every open score panel at once.
                if (document.querySelector('.health-actions-menu:not([hidden])')) {
                    closeAllActionMenus();
                    return;
                }
                if (healthState.expandedScores.size) {
                    healthState.expandedScores.clear();
                    syncAllScorePanels();
                    return;
                }
                closeAllActionMenus();
                return;
            }
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
                return;
            }
            // Tab walks the rows one by one, matching KeyboardNavigation on the
            // dashboard. Roving tabindex leaves a single stop for the whole list, so
            // without this Tab would jump from the current row straight out of it.
            // At the last row (or Shift+Tab at the first) we let Tab through, so the
            // list never becomes a trap.
            if (e.key === 'Tab' && healthState.focusedRowIndex >= 0) {
                const total = healthState.visibleIssues?.length || 0;
                if (!total) return;
                const atLast = healthState.focusedRowIndex === total - 1;
                const atFirst = healthState.focusedRowIndex === 0;
                if ((!e.shiftKey && atLast) || (e.shiftKey && atFirst)) {
                    healthState.focusedRowIndex = -1;
                    document.querySelectorAll('#health-issues .health-row')
                        .forEach((row) => row.classList.remove('health-row--focused'));
                    return;
                }
                e.preventDefault();
                moveRowFocus(e.shiftKey ? -1 : 1, { focus: true });
                return;
            }

            // Never shadow browser or OS chords (Ctrl+F, Cmd+R, Alt+←).
            if (e.ctrlKey || e.metaKey || e.altKey) {
                return;
            }
            // Move DOM focus with the selection so Tab resumes from the current row
            // and screen readers announce the move.
            if (e.key === 'j' || e.key === 'ArrowDown') {
                e.preventDefault();
                moveRowFocus(1, { focus: true });
                return;
            }
            if (e.key === 'k' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveRowFocus(-1, { focus: true });
                return;
            }
            if (e.key === 'g' || e.key === 'Home') {
                e.preventDefault();
                focusRowByIndex(0, { focus: true });
                return;
            }
            if (e.key === 'G' || e.key === 'End') {
                e.preventDefault();
                focusRowByIndex((healthState.visibleIssues?.length || 1) - 1, { focus: true });
                return;
            }
            // Focus sitting on a control inside a row (score badge, an action button,
            // a menu item) means the key belongs to that control. Without this, Enter
            // on the score badge would also fire the row's "edit" shortcut and navigate
            // away, and letter keys would double-fire.
            const onRowControl = Boolean(
                e.target?.closest?.('.health-row')
                && !e.target?.classList?.contains('health-row-main')
                && e.target?.matches?.('button, a, input, select, [role="menuitem"]')
            );

            if (e.key === 'Enter' && healthState.focusedRowIndex >= 0) {
                if (onRowControl) return;
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue) {
                    e.preventDefault();
                    openBookmarkInConfig(issue);
                }
                return;
            }
            // Space/Enter already activate a focused control; letter shortcuts must not
            // also fire while focus is inside one.
            if (onRowControl && /^[a-zA-Z]$/.test(e.key)) {
                return;
            }
            if ((e.key === 'o' || e.key === 'O') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue?.url) {
                    e.preventDefault();
                    window.open(issue.url, '_blank', 'noopener');
                }
                return;
            }
            if ((e.key === 's' || e.key === 'S') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue) {
                    e.preventDefault();
                    toggleScorePanel(issueSelectionKey(issue));
                }
                return;
            }
            if ((e.key === 'x' || e.key === 'X') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue) {
                    e.preventDefault();
                    const key = issueSelectionKey(issue);
                    if (healthState.selected.has(key)) {
                        healthState.selected.delete(key);
                    } else {
                        healthState.selected.add(key);
                    }
                    // Keep the row put: a full render would reset focus and scroll.
                    const row = document.querySelector(`.health-row[data-row-key="${CSS.escape(key)}"]`);
                    const box = row?.querySelector('.health-row-checkbox');
                    const on = healthState.selected.has(key);
                    if (box) box.checked = on;
                    row?.classList.toggle('health-row--selected', on);
                    syncSelectionToolbar();
                }
                return;
            }
            if ((e.key === 'p' || e.key === 'P') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue?.url) {
                    e.preventDefault();
                    const row = document.querySelector(`.health-row[data-row-key="${CSS.escape(issueSelectionKey(issue))}"]`);
                    row?.querySelector('[data-ping-url]')?.click();
                }
                return;
            }
            if ((e.key === 'f' || e.key === 'F') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue?.url) {
                    e.preventDefault();
                    const row = document.querySelector(`.health-row[data-row-key="${CSS.escape(issueSelectionKey(issue))}"]`);
                    row?.querySelector('[data-favicon-url]')?.click();
                }
                return;
            }
            // The row's repair/delete actions live behind the more-menu, which is no
            // longer a tab stop; m is their keyboard entry point. Focus moves into the
            // menu so the arrow keys and Escape take over from there.
            if ((e.key === 'm' || e.key === 'M') && healthState.focusedRowIndex >= 0) {
                const issue = healthState.visibleIssues[healthState.focusedRowIndex];
                if (issue) {
                    e.preventDefault();
                    const row = document.querySelector(`.health-row[data-row-key="${CSS.escape(issueSelectionKey(issue))}"]`);
                    const toggle = row?.querySelector('.health-actions-more-btn');
                    toggle?.click();
                    row?.querySelector('.health-actions-menu:not([hidden]) .health-actions-menu-item')?.focus();
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

            const scoreToggle = e.target.closest('[data-score-toggle]');
            if (scoreToggle) {
                toggleScorePanel(scoreToggle.getAttribute('data-score-toggle') || '');
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
            if (ensureHealthRuntime().isSelectSyncing('sort')) return;
            const nextSort = sortSelect.value;
            if (nextSort === healthState.sort) return;
            healthState.sort = nextSort;
            saveState();
            scheduleRender();
        });

        document.getElementById('retest-all-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget || e.target;
            // Bookmarks with checkStatus off are skipped by the default run. When the
            // report shows flagged rows, test those too so a broken row can go green
            // from this page — there is no checkStatus toggle in the health UI.
            const scope = Number(healthState.report?.summary?.brokenCount || 0) > 0 ? 'all' : 'checked';
            try {
                await runHealthAction('retest-all', async () => {
                    setButtonBusy(btn, true);
                    try {
                        const response = await healthFetch(`/api/health/retest-all?scope=${scope}`, {
                            method: 'POST',
                            headers: writeJsonHeaders()
                        }, 5 * 60 * 1000);
                        if (!response.ok) {
                            throw new Error(t('health.retestFailed', 'Failed to retest all bookmarks'));
                        }
                        const result = await response.json();
                        showBulkStatus(formatRetestSummary(result));
                        await reloadReport();
                    } finally {
                        setButtonBusy(btn, false);
                    }
                }, {
                    busyMessage: t('health.retesting', 'retesting...')
                });
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: formatHealthError(error) }));
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
                    await reloadReport();
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

    async function fetchAutoHealSuggestion(pageId, index, { redirectOnly = false } = {}) {
        const redirectParam = redirectOnly ? '&redirectOnly=1' : '';
        const timeoutMs = redirectOnly
            ? (HealthRuntime.DEFAULT_FETCH_TIMEOUT_MS + 5000)
            : HealthRuntime.DEFAULT_FETCH_TIMEOUT_MS;
        const response = await healthFetch(
            `/api/health/auto-heal-suggest?pageId=${encodeURIComponent(pageId)}&index=${encodeURIComponent(index)}${redirectParam}`,
            {},
            timeoutMs
        );
        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || 'Failed to fetch auto-heal suggestions');
        }
        return response.json();
    }

    async function applyAutoHeal(pageId, index, payload = {}) {
        const response = await healthFetch('/api/health/auto-heal-apply', {
            method: 'POST',
            headers: writeJsonHeaders(),
            body: JSON.stringify({
                pageId,
                index,
                newUrl: payload.newUrl || '',
                refreshTitle: payload.refreshTitle === true,
                suggestedTitle: payload.suggestedTitle || ''
            })
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || 'Auto-heal apply failed');
        }
        return response.json();
    }

    async function handleRedirectDetect(button, pageId, index) {
        closeAllActionMenus();
        try {
            const suggestion = await runHealthAction('redirect-detect', async () => {
                setButtonBusy(button, true);
                try {
                    return await fetchAutoHealSuggestion(pageId, index, { redirectOnly: true });
                } finally {
                    setButtonBusy(button, false);
                }
            }, {
                busyMessage: t('health.autoHealWorking', 'working...')
            });
            if (!suggestion) {
                return;
            }

            const redirectUrl = String(suggestion?.redirectUrl || '').trim();
            if (!redirectUrl) {
                showBulkStatus(t('health.autoHealNoRedirect', 'No redirect suggestion found.'));
                return;
            }
            const applyNow = await confirmDialog({
                title: t('health.autoHealRedirect', 'detect redirect'),
                message: t(
                    'health.autoHealRedirectConfirm',
                    'Redirect found. Apply URL fix now?\n\n{url}',
                    { url: redirectUrl }
                ),
                confirmText: t('health.confirm', 'Confirm'),
                cancelText: t('health.cancel', 'Cancel')
            });
            if (!applyNow) {
                showBulkStatus(t('health.autoHealRedirectFound', 'Redirect found: {url}', { url: redirectUrl }));
                return;
            }

            await runHealthAction('redirect-apply', async () => {
                const applied = await applyAutoHeal(pageId, index, { newUrl: redirectUrl, refreshTitle: false });
                // The server pings the replacement before storing it, so report what it
                // found rather than assuming a changed URL is a working URL.
                showBulkStatus(applied?.verifiedOnline === false && applied?.verifyError
                    ? t(
                        'health.autoHealRedirectUnverified',
                        'Redirect applied, but the new URL still fails: {error}',
                        { error: applied.verifyError }
                    )
                    : t('health.autoHealRedirectApplied', 'Redirect URL applied and verified online.'));
                await reloadReport();
            }, {
                busyMessage: t('health.autoHealWorking', 'working...')
            });
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: formatHealthError(error) }));
        }
    }

    async function handleTitleRefresh(button, pageId, index) {
        closeAllActionMenus();
        try {
            await runHealthAction('title-refresh', async () => {
                setButtonBusy(button, true);
                try {
                    await applyAutoHeal(pageId, index, { refreshTitle: true });
                    showBulkStatus(t('health.autoHealTitleApplied', 'Title refreshed.'));
                    await reloadReport();
                } finally {
                    setButtonBusy(button, false);
                }
            }, {
                busyMessage: t('health.autoHealWorking', 'working...')
            });
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: formatHealthError(error) }));
        }
    }

    async function handleDeleteIssue(button, pageId, index, bookmarkName) {
        closeAllActionMenus();
        const confirmed = await confirmDialog({
            title: t('health.delete', 'delete'),
            message: t('health.deleteConfirm', 'Delete "{name}" from dashboard?', { name: bookmarkName || 'bookmark' }),
            confirmText: t('health.delete', 'delete'),
            cancelText: t('health.cancel', 'Cancel'),
            confirmClass: 'danger'
        });
        if (!confirmed) return;

        try {
            await runHealthAction('delete-issue', async () => {
                setButtonBusy(button, true);
                try {
                    const response = await healthFetch('/api/health/delete-bookmark', {
                        method: 'POST',
                        headers: writeJsonHeaders(),
                        body: JSON.stringify({ pageId, index })
                    });
                    if (!response.ok) {
                        throw new Error(await response.text());
                    }
                    showBulkStatus(t('health.deleted', 'Bookmark deleted.'));
                    await reloadReport();
                } finally {
                    setButtonBusy(button, false);
                }
            }, {
                busyMessage: t('health.autoHealWorking', 'working...')
            });
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: formatHealthError(error) }));
        }
    }

    async function handleFaviconRefresh(button, url, pageId, index) {
        closeAllActionMenus();
        try {
            await runHealthAction('favicon-refresh', async () => {
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
                    const saveRes = await healthFetch(`/api/bookmarks?page=${pageId}`, {
                        method: 'POST',
                        headers: writeJsonHeaders(),
                        body: JSON.stringify(bookmarks)
                    });
                    if (!saveRes.ok) throw new Error('Failed to save bookmark');

                    showBulkStatus(t('health.faviconRefreshed', 'Favicon updated.'));
                    await reloadReport();
                } finally {
                    setButtonBusy(button, false);
                }
            }, {
                busyMessage: t('health.autoHealWorking', 'working...')
            });
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: formatHealthError(error) }));
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
        const signature = options.map(([id, name]) => `${id}:${name}`).join('|');
        const previousPageId = String(healthState.pageId);
        const nextValue = (previousPageId === 'all' || options.some(([id]) => String(id) === previousPageId))
            ? previousPageId
            : 'all';

        const needsRebuild = select.dataset.optionsSig !== signature;
        const needsValueSync = select.value !== nextValue;
        if (!needsRebuild && !needsValueSync) {
            if (nextValue !== previousPageId) {
                healthState.pageId = nextValue;
                ensureHealthRuntime().scheduleSaveState();
            }
            return;
        }

        beginSelectSync('page');
        try {
            if (needsRebuild) {
                const allLabel = t('health.filterPageAll', 'All pages');
                select.replaceChildren();
                const allOption = document.createElement('option');
                allOption.value = 'all';
                allOption.textContent = allLabel;
                select.appendChild(allOption);
                options.forEach(([id, name]) => {
                    const option = document.createElement('option');
                    option.value = String(id);
                    option.textContent = name;
                    select.appendChild(option);
                });
                select.dataset.optionsSig = signature;
            }

            if (needsValueSync) {
                select.value = nextValue;
            }
        } finally {
            endSelectSync('page');
        }

        if (nextValue !== previousPageId) {
            healthState.pageId = nextValue;
            ensureHealthRuntime().scheduleSaveState();
        }
    }

    function renderView() {
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
        // innerHTML rebuilds every row, so re-apply the panels the user had open
        // and the roving tab stop.
        syncAllScorePanels();
        syncRowTabStops();

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
            beginSelectSync('sort');
            try {
                sortSelect.value = healthState.sort;
            } finally {
                endSelectSync('sort');
            }
        }

        syncFilterClearButton();
        pruneSelection();
        syncSelectionToolbar();
    }

    async function refreshHealthView() {
        await reloadReport();
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
            if (ensureHealthRuntime().isSelectSyncing('page')) return;
            const nextPageId = pageFilter.value || 'all';
            if (nextPageId === healthState.pageId) return;
            healthState.pageId = nextPageId;
            saveState();
            scheduleRender();
        });

        searchInput?.addEventListener('input', () => {
            healthState.query = searchInput.value.trim();
            saveState();
            syncFilterClearButton();
            scheduleRender();
        });

        document.getElementById('health-search-clear')?.addEventListener('click', () => {
            if (!searchInput) return;
            searchInput.value = '';
            healthState.query = '';
            saveState();
            syncFilterClearButton();
            scheduleRender();
            searchInput.focus();
        });

        refreshButton?.addEventListener('click', async () => {
            refreshButton.disabled = true;
            refreshButton.textContent = t('health.refreshing', 'refreshing...');
            try {
                await reloadReport();
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: formatHealthError(error) }));
            } finally {
                refreshButton.disabled = false;
                refreshButton.textContent = t('health.refresh', 'refresh');
            }
        });

        setupHealthEventListeners();

        ensureHealthRuntime();
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