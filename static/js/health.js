(function () {
    const STORAGE_KEY = 'nextdash_health_state';

    const healthState = {
        report: null,
        filter: 'all',
        sort: 'score',
        query: '',
        pageId: 'all',
        language: null
    };

    function saveState() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                filter: healthState.filter,
                sort: healthState.sort,
                query: healthState.query,
                pageId: healthState.pageId
            }));
        } catch (e) { /* quota or private mode */ }
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
        return `<a class="btn btn-small btn-secondary health-action-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    }

    function shouldShowHealActions(issue) {
        return Boolean(issue?.url);
    }

    function renderHealActions(issue) {
        if (!shouldShowHealActions(issue)) return '';

        return `
            <div class="health-issue-toolbar health-issue-toolbar-heal">
                <button type="button" class="btn btn-small btn-secondary" data-heal-archive-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.autoHealArchive', 'archive'))}</button>
                <button type="button" class="btn btn-small btn-secondary" data-heal-redirect-page="${escapeHtml(issue.pageId)}" data-heal-redirect-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealRedirect', 'detect redirect'))}</button>
                <button type="button" class="btn btn-small btn-secondary" data-heal-title-page="${escapeHtml(issue.pageId)}" data-heal-title-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealTitle', 'refresh title'))}</button>
                <button type="button" class="btn btn-small btn-primary" data-heal-fix-page="${escapeHtml(issue.pageId)}" data-heal-fix-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealOneClick', '1-click fix'))}</button>
            </div>
        `;
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

    function buildSummaryCard(label, value, meta, tone = 'neutral') {
        return `
            <article class="health-card health-card-${tone}">
                <div class="health-card-label">${escapeHtml(label)}</div>
                <div class="health-card-value">${escapeHtml(value)}</div>
                <div class="health-card-meta">${escapeHtml(meta || '')}</div>
            </article>
        `;
    }

    function renderSummary(report) {
        const summary = report?.summary || {};
        const cards = [
            buildSummaryCard(t('health.summaryTotal', 'Total'), summary.totalBookmarks || 0, t('health.summaryTotalMeta', 'All bookmarks'), 'neutral'),
            buildSummaryCard(t('health.summaryHealthy', 'Healthy'), summary.healthyCount || 0, t('health.summaryHealthyMeta', 'No active issues'), 'good'),
            buildSummaryCard(t('health.summaryBroken', 'Broken'), summary.brokenCount || 0, t('health.summaryBrokenMeta', 'Last error recorded'), 'bad'),
            buildSummaryCard(t('health.summaryDuplicates', 'Duplicates'), summary.duplicateCount || 0, t('health.summaryDuplicatesMeta', 'Duplicate URLs'), 'warn'),
            buildSummaryCard(t('health.summaryShortcutConflicts', 'Shortcut conflicts'), summary.shortcutConflictCount || 0, t('health.summaryShortcutConflictsMeta', 'Duplicate shortcuts'), 'warn'),
            buildSummaryCard(t('health.summaryUnchecked', 'Unchecked'), summary.uncheckedCount || 0, t('health.summaryUncheckedMeta', 'Status checks missing or stale'), 'warn'),
            buildSummaryCard(t('health.summaryStale', 'Stale'), summary.staleCount || 0, t('health.summaryStaleMeta', 'Not opened recently'), 'warn'),
            buildSummaryCard(t('health.summaryMissingPreview', 'Missing preview'), summary.missingPreviewCount || 0, t('health.summaryMissingPreviewMeta', 'No preview metadata yet'), 'neutral'),
            buildSummaryCard(t('health.summaryUnused', 'Unused'), summary.unusedCount || 0, t('health.summaryUnusedMeta', 'Never opened'), 'neutral')
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

        return filterOrder.map((filter) => `
            <button class="health-pill ${healthState.filter === filter ? 'active' : ''}" type="button" data-filter="${filter}">
                ${escapeHtml(filter === 'all' ? t('health.filterAll', 'all') : statusLabel(filter))}
                <span>${counts[filter] || 0}</span>
            </button>
        `).join('');
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

        if (!issues.length) {
            return `<div class="health-empty">${escapeHtml(t('health.noMatchingIssues', 'No issues match the current filter.'))}</div>`;
        }

        return issues.map((issue) => `
            <article class="health-issue health-issue-${escapeHtml(issue.status)}">
                <div class="health-issue-main">
                    <div class="health-issue-head">
                        <div>
                            <h3>${escapeHtml(issue.name || issue.url)}</h3>
                            <p>${escapeHtml(issue.url)}</p>
                        </div>
                        <div class="health-score ${scoreClass(issue.score)}">${escapeHtml(issue.score)}</div>
                    </div>
                    <div class="health-issue-meta">
                        <span>${escapeHtml(issue.pageName || t('health.pageNumber', 'Page {id}', { id: issue.pageId }))}</span>
                        <span>${escapeHtml(issue.category || t('dashboard.uncategorized', 'uncategorized'))}</span>
                        ${issue.shortcut ? `<span>${escapeHtml(issue.shortcut)}</span>` : ''}
                        ${issue.pinned ? `<span>${escapeHtml(t('health.pinned', 'pinned'))}</span>` : ''}
                        <span>${escapeHtml(statusLabel(issue.status))}</span>
                        ${issue.duplicateCount > 1 ? `<span>${escapeHtml(t('health.duplicateCount', '{count}x duplicate', { count: issue.duplicateCount }))}</span>` : ''}
                    </div>
                    <div class="health-reasons">
                        ${(issue.reasons || []).map((reason) => `<span>${escapeHtml(translateReason(reason))}</span>`).join('')}
                    </div>
                    <div class="health-times">
                        <span>${escapeHtml(t('health.openedCount', 'opened {count}x', { count: issue.openCount || 0 }))}</span>
                        <span>${escapeHtml(t('health.lastOpened', 'last opened {date}', { date: fmtDate(issue.lastOpened) }))}</span>
                        <span>${escapeHtml(t('health.lastChecked', 'last checked {date}', { date: fmtDate(issue.lastChecked) }))}</span>
                    </div>
                </div>
                <div class="health-issue-actions">
                    <div class="health-issue-toolbar">
                        ${renderOpenInDashboardAction(issue)}
                        <button type="button" class="btn btn-small btn-secondary" data-open-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.open', 'open'))}</button>
                        <button type="button" class="btn btn-small btn-secondary" data-ping-url="${escapeHtml(issue.url)}" data-ping-page="${escapeHtml(issue.pageId)}" data-ping-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.ping', 'ping'))}</button>
                        <button type="button" class="btn btn-small btn-secondary" data-favicon-url="${escapeHtml(issue.url)}" data-favicon-page="${escapeHtml(issue.pageId)}" data-favicon-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.refreshFavicon', 'favicon'))}</button>
                        <button type="button" class="btn btn-small btn-danger" data-delete-page="${escapeHtml(issue.pageId)}" data-delete-index="${escapeHtml(issue.index)}" data-delete-name="${escapeHtml(issue.name || issue.url)}">${escapeHtml(t('health.delete', 'delete'))}</button>
                    </div>
                    ${renderHealActions(issue)}
                </div>
            </article>
        `).join('');
    }

    function renderDuplicates(report) {
        const groups = (report?.duplicateGroups || []).map(orderDuplicateGroupBestFirst);
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
        button.disabled = true;
        button.textContent = t('health.pinging', 'pinging...');
        try {
            const response = await apiFetch(`/api/ping?url=${encodeURIComponent(url)}`);
            const result = await response.json();
            const status = result.status === 'online' ? 'online' : 'offline';
            const pingMs = result.ping || 0;
            const errorDetail = (result.errorDetail || '').trim()
                || (status === 'online' ? '' : t('health.errorPingFailed', 'ping failed'));
            button.textContent = status === 'online'
                ? t('health.onlineMs', 'online {ms}ms', { ms: pingMs })
                : (errorDetail || t('health.offline', 'offline'));

            await cacheScanResult(url, status, pingMs, errorDetail);
            if (Number.isFinite(pageId) && Number.isFinite(index)) {
                await persistIssueStatus(pageId, index, status, status === 'online' ? '' : errorDetail);
                await loadReport();
                render();
            }
        } catch (error) {
            button.textContent = t('health.failed', 'failed');
            const failDetail = error.message || t('health.errorPingFailed', 'ping failed');
            await cacheScanResult(url, 'error', 0, failDetail);
            if (Number.isFinite(pageId) && Number.isFinite(index)) {
                await persistIssueStatus(pageId, index, 'offline', failDetail);
                await loadReport();
                render();
            }
        } finally {
            setTimeout(() => {
                button.disabled = false;
                button.textContent = t('health.ping', 'ping');
            }, 1200);
        }
    }

    function setupHealthEventListeners() {
        if (healthListenersBound) return;
        healthListenersBound = true;

        document.getElementById('health-filter-pills')?.addEventListener('click', (e) => {
            const button = e.target.closest('[data-filter]');
            if (!button) return;
            healthState.filter = button.getAttribute('data-filter') || 'all';
            saveState();
            render();
        });

        document.getElementById('health-issues')?.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

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
            const group = orderDuplicateGroupBestFirst(healthState.report?.duplicateGroups?.[idx]);
            if (!group) return;

            btn.disabled = true;
            btn.textContent = t('health.removing', 'removing…');
            await performMergeDuplicates(group);
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
            btn.classList.add('is-loading');
            btn.textContent = t('health.retesting', 'retesting...');
            try {
                const response = await apiFetch('/api/health/retest-all', { method: 'POST' });
                if (response.ok) {
                    const result = await response.json();
                    showBulkStatus(t('health.retestedBookmarks', 'Retested {count} bookmarks', { count: result.count || 0 }));
                    btn.textContent = t('health.retesting', 'reloading...');
                    await loadReport();
                    render();
                } else {
                    showBulkStatus(t('health.retestFailed', 'Failed to retest all bookmarks'));
                }
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
            } finally {
                btn.disabled = false;
                btn.classList.remove('is-loading');
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
            btn.classList.add('is-loading');
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
                btn.classList.remove('is-loading');
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
            statusEl.style.display = 'block';
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 3000);
        }
    }

    function showMergeDuplicatesFlow() {
        if (!healthState.report?.duplicateGroups?.length) {
            showBulkStatus(t('health.noDuplicateGroupsToMerge', 'No duplicate groups to merge.'));
            return;
        }
        pickDuplicateGroup(healthState.report.duplicateGroups).then((group) => {
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
                finish(groups[0]);
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
            // Avoid breaking UI when status persistence fails.
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
        const original = button.textContent;
        button.disabled = true;
        button.textContent = t('health.autoHealWorking', 'working...');
        try {
            const suggestion = await fetchAutoHealSuggestion(pageId, index);
            if (!suggestion.redirectUrl) {
                showBulkStatus(t('health.autoHealNoRedirect', 'No redirect suggestion found.'));
                return;
            }
            const applyNow = window.confirm(
                t('health.autoHealRedirectConfirm', 'Redirect found. Apply URL fix now?')
            );
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
            button.disabled = false;
            button.textContent = original;
        }
    }

    async function handleTitleRefresh(button, pageId, index) {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = t('health.autoHealWorking', 'working...');
        try {
            await applyAutoHeal(pageId, index, { refreshTitle: true });
            showBulkStatus(t('health.autoHealTitleApplied', 'Title refreshed.'));
            await loadReport();
            render();
        } catch (error) {
            showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
        } finally {
            button.disabled = false;
            button.textContent = original;
        }
    }

    async function handleOneClickFix(button, pageId, index) {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = t('health.autoHealWorking', 'working...');
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
            button.disabled = false;
            button.textContent = original;
        }
    }

    async function handleDeleteIssue(button, pageId, index, bookmarkName) {
        const confirmed = window.confirm(
            t('health.deleteConfirm', 'Delete "{name}" from dashboard?', { name: bookmarkName || 'bookmark' })
        );
        if (!confirmed) return;

        const original = button.textContent;
        button.disabled = true;
        button.textContent = t('health.deleting', 'deleting...');
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
            button.disabled = false;
            button.textContent = original;
        }
    }

    async function handleFaviconRefresh(button, url, pageId, index) {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = t('health.autoHealWorking', 'working...');
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
            button.disabled = false;
            button.textContent = original;
        }
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
        if (pillsEl) pillsEl.innerHTML = renderFilterPills(report);
        syncPageFilterSelect(report);
        if (issuesEl) issuesEl.innerHTML = renderIssues(report);
        if (duplicatesEl) duplicatesEl.innerHTML = renderDuplicates(report);

        const mergeBtn = document.getElementById('merge-duplicates-btn');
        if (mergeBtn) {
            mergeBtn.disabled = !(report?.duplicateGroups || []).length;
        }

        const sortSelect = document.getElementById('health-sort-select');
        if (sortSelect && sortSelect.value !== healthState.sort) {
            sortSelect.value = healthState.sort;
        }
    }

    async function loadReport() {
        const response = await fetch('/api/bookmark-health');
        if (!response.ok) {
            throw new Error(`Failed to load health report: ${response.status}`);
        }
        healthState.report = await response.json();
    }

    async function main() {
        if (typeof ConfigLanguage === 'function') {
            healthState.language = new ConfigLanguage();
            await healthState.language.init(document.documentElement.lang || 'en');
            window.healthLanguage = healthState.language;
            document.title = t('health.pageTitle', 'health beta');
            document.querySelectorAll('[data-i18n-title]').forEach((element) => {
                const key = element.getAttribute('data-i18n-title');
                const translated = t(key, element.getAttribute('title') || '');
                if (translated) element.setAttribute('title', translated);
            });
        }

        restoreState();
        const shouldRetest = applyUrlParams();

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
            render();
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