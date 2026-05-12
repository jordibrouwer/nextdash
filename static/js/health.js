(function () {
    const healthState = {
        report: null,
        filter: 'all',
        query: '',
        language: null
    };

    const statusFallbacks = {
        broken: 'broken',
        duplicate: 'duplicate',
        unchecked: 'unchecked',
        stale: 'stale',
        unused: 'unused',
        'missing-preview': 'missing preview',
        healthy: 'healthy'
    };

    const filterOrder = ['all', 'broken', 'duplicate', 'unchecked', 'stale', 'unused', 'missing-preview', 'healthy'];

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

        const reasonKeys = {
            'Last error recorded': 'health.reasonLastError',
            'Status check has never run': 'health.reasonStatusNeverRun',
            'Status check is stale': 'health.reasonStatusStale',
            'Not opened in over 30 days': 'health.reasonNotOpened30Days',
            'Never opened': 'health.reasonNeverOpened',
            'No preview metadata yet': 'health.reasonNoPreview'
        };
        const key = reasonKeys[reason];
        return key ? t(key, reason) : reason;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
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

    function renderIssues(report) {
        const issues = (report?.issues || []).filter((issue) => matchesFilter(issue, healthState.filter) && matchesQuery(issue, healthState.query));

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
                    <button type="button" class="health-action" data-open-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.open', 'open'))}</button>
                    <button type="button" class="health-action" data-ping-url="${escapeHtml(issue.url)}" data-ping-page="${escapeHtml(issue.pageId)}" data-ping-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.ping', 'ping'))}</button>
                    <button type="button" class="health-action health-action-danger" data-delete-page="${escapeHtml(issue.pageId)}" data-delete-index="${escapeHtml(issue.index)}" data-delete-name="${escapeHtml(issue.name || issue.url)}">${escapeHtml(t('health.delete', 'delete'))}</button>
                    ${issue.status === 'broken' ? `
                        <button type="button" class="health-action" data-heal-archive-url="${escapeHtml(issue.url)}">${escapeHtml(t('health.autoHealArchive', 'archive'))}</button>
                        <button type="button" class="health-action" data-heal-redirect-page="${escapeHtml(issue.pageId)}" data-heal-redirect-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealRedirect', 'detect redirect'))}</button>
                        <button type="button" class="health-action" data-heal-title-page="${escapeHtml(issue.pageId)}" data-heal-title-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealTitle', 'refresh title'))}</button>
                        <button type="button" class="health-action" data-heal-fix-page="${escapeHtml(issue.pageId)}" data-heal-fix-index="${escapeHtml(issue.index)}">${escapeHtml(t('health.autoHealOneClick', '1-click fix'))}</button>
                    ` : ''}
                </div>
            </article>
        `).join('');
    }

    function renderDuplicates(report) {
        const groups = report?.duplicateGroups || [];
        if (!groups.length) {
            return `<div class="health-empty">${escapeHtml(t('health.noDuplicateGroups', 'No duplicate groups found.'))}</div>`;
        }

        return groups.map((group) => `
            <article class="health-duplicate-group">
                <div class="health-duplicate-url">${escapeHtml(group.url)}</div>
                <div class="health-duplicate-items">
                    ${(group.bookmarks || []).map((bookmark) => `
                        <span>${escapeHtml(bookmark.name)} <em>${escapeHtml(t('health.pageLower', 'page'))} ${escapeHtml(bookmark.pageId)}</em></span>
                    `).join('')}
                </div>
            </article>
        `).join('');
    }

    function bindActions() {
        document.querySelectorAll('[data-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                healthState.filter = button.getAttribute('data-filter') || 'all';
                render();
            });
        });

        document.querySelectorAll('[data-open-url]').forEach((button) => {
            button.addEventListener('click', () => {
                window.open(button.getAttribute('data-open-url'), '_blank', 'noopener');
            });
        });

        document.querySelectorAll('[data-ping-url]').forEach((button) => {
            button.addEventListener('click', async () => {
                const url = button.getAttribute('data-ping-url');
                const pageId = Number(button.getAttribute('data-ping-page'));
                const index = Number(button.getAttribute('data-ping-index'));
                if (!url) return;
                button.disabled = true;
                button.textContent = t('health.pinging', 'pinging...');
                try {
                    const response = await fetch(`/api/ping?url=${encodeURIComponent(url)}`);
                    const result = await response.json();
                    const status = result.status === 'online' ? 'online' : 'offline';
                    const pingMs = result.ping || 0;
                    button.textContent = status === 'online'
                        ? t('health.onlineMs', 'online {ms}ms', { ms: pingMs })
                        : t('health.offline', 'offline');
                    
                    // Cache the result
                    await cacheScanResult(url, status, pingMs, '');
                    if (Number.isFinite(pageId) && Number.isFinite(index)) {
                        await persistIssueStatus(pageId, index, status, status === 'online' ? '' : 'ping failed');
                        await loadReport();
                        render();
                    }
                } catch (error) {
                    button.textContent = t('health.failed', 'failed');
                    await cacheScanResult(url, 'error', 0, error.message);
                    if (Number.isFinite(pageId) && Number.isFinite(index)) {
                        await persistIssueStatus(pageId, index, 'offline', error.message || 'ping failed');
                        await loadReport();
                        render();
                    }
                } finally {
                    setTimeout(() => {
                        button.disabled = false;
                        button.textContent = t('health.ping', 'ping');
                    }, 1200);
                }
            });
        });

        document.querySelectorAll('[data-heal-archive-url]').forEach((button) => {
            button.addEventListener('click', () => {
                const url = button.getAttribute('data-heal-archive-url');
                if (!url) return;
                window.open(`https://web.archive.org/web/*/${url}`, '_blank', 'noopener');
            });
        });

        document.querySelectorAll('[data-heal-redirect-page]').forEach((button) => {
            button.addEventListener('click', async () => {
                const pageId = Number(button.getAttribute('data-heal-redirect-page'));
                const index = Number(button.getAttribute('data-heal-redirect-index'));
                if (!Number.isFinite(pageId) || !Number.isFinite(index)) return;
                await handleRedirectDetect(button, pageId, index);
            });
        });

        document.querySelectorAll('[data-heal-title-page]').forEach((button) => {
            button.addEventListener('click', async () => {
                const pageId = Number(button.getAttribute('data-heal-title-page'));
                const index = Number(button.getAttribute('data-heal-title-index'));
                if (!Number.isFinite(pageId) || !Number.isFinite(index)) return;
                await handleTitleRefresh(button, pageId, index);
            });
        });

        document.querySelectorAll('[data-heal-fix-page]').forEach((button) => {
            button.addEventListener('click', async () => {
                const pageId = Number(button.getAttribute('data-heal-fix-page'));
                const index = Number(button.getAttribute('data-heal-fix-index'));
                if (!Number.isFinite(pageId) || !Number.isFinite(index)) return;
                await handleOneClickFix(button, pageId, index);
            });
        });

        document.querySelectorAll('[data-delete-page]').forEach((button) => {
            button.addEventListener('click', async () => {
                const pageId = Number(button.getAttribute('data-delete-page'));
                const index = Number(button.getAttribute('data-delete-index'));
                const name = button.getAttribute('data-delete-name') || '';
                if (!Number.isFinite(pageId) || !Number.isFinite(index)) return;
                await handleDeleteIssue(button, pageId, index, name);
            });
        });

        // Bulk action buttons
        document.getElementById('retest-all-btn')?.addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = t('health.retesting', 'retesting...');
            try {
                const response = await fetch('/api/health/retest-all', { method: 'POST' });
                if (response.ok) {
                    const result = await response.json();
                    showBulkStatus(t('health.retestedBookmarks', 'Retested {count} bookmarks', { count: result.count || 0 }));
                    // Reload report after delay
                    setTimeout(async () => {
                        await loadReport();
                        render();
                    }, 500);
                } else {
                    showBulkStatus(t('health.retestFailed', 'Failed to retest all bookmarks'));
                }
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
            } finally {
                e.target.disabled = false;
                e.target.textContent = t('health.retestAllChecked', 'Retest all checked');
            }
        });

        document.getElementById('open-broken-btn')?.addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = t('health.opening', 'opening...');
            try {
                const response = await fetch('/api/health/open-broken', { method: 'POST' });
                if (response.ok) {
                    const result = await response.json();
                    const urls = result.urls || [];
                    urls.forEach((url) => {
                        window.open(url, '_blank', 'noopener');
                    });
                    showBulkStatus(t('health.openedBrokenLinks', 'Opened {count} broken links', { count: urls.length }));
                } else {
                    showBulkStatus(t('health.openBrokenFailed', 'Failed to open broken links'));
                }
            } catch (error) {
                showBulkStatus(t('health.errorMessage', 'Error: {message}', { message: error.message }));
            } finally {
                e.target.disabled = false;
                e.target.textContent = t('health.openBrokenLinks', 'Open broken links');
            }
        });

        document.getElementById('merge-duplicates-btn')?.addEventListener('click', async (e) => {
            showMergeDuplicatesModal();
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

    function showMergeDuplicatesModal() {
        if (!healthState.report?.duplicateGroups?.length) {
            alert(t('health.noDuplicateGroupsToMerge', 'No duplicate groups to merge.'));
            return;
        }

        const groups = healthState.report.duplicateGroups;
        let html = `<h3>${escapeHtml(t('health.selectDuplicateGroup', 'Select a duplicate group to merge'))}</h3><div style="max-height:400px;overflow-y:auto;">`;
        
        groups.forEach((group, idx) => {
            html += `<div style="border:1px solid #ccc;padding:10px;margin:5px 0;cursor:pointer;" data-group-index="${idx}">
                <strong>${escapeHtml(group.url)}</strong>
                <p>${(group.bookmarks || []).map(b => escapeHtml(b.name)).join(', ')}</p>
            </div>`;
        });
        html += '</div>';

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `<div style="background:white;padding:20px;border-radius:8px;max-width:500px;width:90%;">${html}</div>`;
        
        modal.querySelectorAll('[data-group-index]').forEach((el) => {
            el.addEventListener('click', async () => {
                const groupIdx = parseInt(el.getAttribute('data-group-index'));
                const group = groups[groupIdx];
                document.body.removeChild(modal);
                await performMergeDuplicates(group);
            });
        });

        document.body.appendChild(modal);
    }

    async function performMergeDuplicates(group) {
        if (!group.bookmarks?.length) return;

        // Keep first, delete rest
        const target = group.bookmarks[0];
        const sources = group.bookmarks.slice(1);

        try {
            const response = await fetch('/api/health/merge-duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    async function cacheScanResult(url, status, pingMs, error) {
        try {
            await fetch('/api/health/cache-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
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
            await fetch('/api/health/update-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, index, status, error })
            });
        } catch (e) {
            // Avoid breaking UI when status persistence fails.
        }
    }

    async function fetchAutoHealSuggestion(pageId, index) {
        const response = await fetch(`/api/health/auto-heal-suggest?pageId=${encodeURIComponent(pageId)}&index=${encodeURIComponent(index)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch auto-heal suggestions');
        }
        return response.json();
    }

    async function applyAutoHeal(pageId, index, payload = {}) {
        const response = await fetch('/api/health/auto-heal-apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            const response = await fetch('/api/health/delete-bookmark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    function render() {
        const report = healthState.report;
        if (!report) return;

        const summaryEl = document.getElementById('health-summary');
        const pillsEl = document.getElementById('health-filter-pills');
        const issuesEl = document.getElementById('health-issues');
        const duplicatesEl = document.getElementById('health-duplicates');

        if (summaryEl) summaryEl.innerHTML = renderSummary(report);
        if (pillsEl) pillsEl.innerHTML = renderFilterPills(report);
        if (issuesEl) issuesEl.innerHTML = renderIssues(report);
        if (duplicatesEl) duplicatesEl.innerHTML = renderDuplicates(report);
        bindActions();
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
            document.title = t('health.pageTitle', 'health beta');
            document.querySelectorAll('[data-i18n-title]').forEach((element) => {
                const key = element.getAttribute('data-i18n-title');
                const translated = t(key, element.getAttribute('title') || '');
                if (translated) element.setAttribute('title', translated);
            });
        }

        const searchInput = document.getElementById('health-search');
        const refreshButton = document.getElementById('refresh-health-btn');

        searchInput?.addEventListener('input', () => {
            healthState.query = searchInput.value.trim();
            render();
        });

        refreshButton?.addEventListener('click', async () => {
            refreshButton.disabled = true;
            refreshButton.textContent = t('health.refreshing', 'refreshing...');
            try {
                await loadReport();
                render();
            } finally {
                refreshButton.disabled = false;
                refreshButton.textContent = t('health.refresh', 'refresh');
            }
        });

        await loadReport();
        render();
        document.body.classList.remove('loading');
    }

    window.addEventListener('DOMContentLoaded', () => {
        main().catch((error) => {
            console.error(error);
            const summary = document.getElementById('health-summary');
            if (summary) {
                summary.innerHTML = `<div class="health-empty">${escapeHtml(t('health.loadFailed', 'Unable to load the health report.'))}</div>`;
            }
            document.body.classList.remove('loading');
        });
    });
})();