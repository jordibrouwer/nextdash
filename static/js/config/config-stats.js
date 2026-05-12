/**
 * Config "Stats" tab: library counts, open activity, search/status snapshot.
 */
class ConfigStats {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
    }

    yn(val) {
        return val ? this.t('config.statsYes') : this.t('config.statsNo');
    }

    tf(key, fallback, replacements = {}) {
        const raw = this.t(key);
        let text = raw && raw !== key ? raw : fallback;
        Object.entries(replacements).forEach(([name, value]) => {
            text = text.replaceAll(`{${name}}`, String(value));
        });
        return text;
    }

    setText(id, text) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = text;
        }
    }

    pageName(pages, pageId) {
        const id = Number(pageId);
        const p = pages.find((x) => Number(x.id) === id);
        return p && p.name ? String(p.name) : (Number.isFinite(id) ? `Page ${id}` : '');
    }

    formatWhen(ts, locale) {
        const n = Number(ts);
        if (!n) {
            return '—';
        }
        try {
            return new Date(n).toLocaleString(locale || undefined, {
                dateStyle: 'short',
                timeStyle: 'short'
            });
        } catch (e) {
            return '—';
        }
    }

    clearTable(tbodyId) {
        const tb = document.getElementById(tbodyId);
        if (tb) {
            tb.textContent = '';
        }
    }

    appendRow(tbodyId, cells) {
        const tb = document.getElementById(tbodyId);
        if (!tb) {
            return;
        }
        const tr = document.createElement('tr');
        cells.forEach((text) => {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
        });
        tb.appendChild(tr);
    }

    createActionButton(label, onClick, className = 'btn btn-secondary btn-small') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    setInsights(items) {
        const el = document.getElementById('stats-insights-list');
        if (!el) {
            return;
        }
        el.textContent = '';
        const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
        if (safeItems.length === 0) {
            const li = document.createElement('li');
            li.textContent = this.t('config.statsNoData');
            el.appendChild(li);
            return;
        }
        safeItems.forEach((item) => {
            const li = document.createElement('li');
            const text = typeof item === 'string' ? item : String(item.text || '');
            li.textContent = text;
            if (item && item.actionId) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-secondary btn-small stats-insight-action';
                button.textContent = String(item.actionLabel || this.tf('config.statsActionOpen', 'Open'));
                button.setAttribute('data-insight-action', String(item.actionId));
                li.appendChild(document.createTextNode(' '));
                li.appendChild(button);
            }
            el.appendChild(li);
        });
        this.bindInsightActions();
    }

    bindInsightActions() {
        document.querySelectorAll('[data-insight-action]').forEach((button) => {
            button.addEventListener('click', async () => {
                const actionId = button.getAttribute('data-insight-action');
                if (!actionId) return;
                await this.handleInsightAction(actionId);
            });
        });
    }

    async openBookmarksForPage(pageId) {
        if (!this.lastManager) {
            return;
        }
        const manager = this.lastManager;
        window.location.hash = '#bookmarks';
        await manager.loadPageBookmarks(pageId);
        const pageSelector = document.getElementById('page-selector');
        if (pageSelector) {
            pageSelector.value = String(pageId);
        }
    }

    async focusNeverOpened(pageId) {
        if (!this.lastManager) {
            return;
        }
        const manager = this.lastManager;
        await this.openBookmarksForPage(pageId);
        const indexes = manager.bookmarksData
            .map((b, idx) => ({ b, idx }))
            .filter(({ b }) => !(Number(b?.openCount || 0) > 0) && !(Number(b?.lastOpened || 0) > 0))
            .map(({ idx }) => idx);
        if (indexes.length === 0) {
            manager.ui?.showNotification?.(this.tf('config.statsActionNeverOpenedNoop', 'No never-opened bookmarks found on this page.'), 'info');
            return;
        }
        manager.currentBookmarksCategoryFilter = '__all__';
        manager.bookmarks.selectedBookmarkIndexes = new Set(indexes);
        manager.refreshBookmarksList({ skipFlush: true, focusIndex: indexes[0], highlightIndex: indexes[0] });
        manager.ui?.showNotification?.(
            this.tf('config.statsActionNeverOpenedDone', '{count} never-opened bookmarks selected on this page.', { count: indexes.length }),
            'success'
        );
    }

    async enableStatusChecksForPage(pageId) {
        if (!this.lastManager) {
            return;
        }
        const manager = this.lastManager;
        await this.openBookmarksForPage(pageId);
        let updated = 0;
        manager.bookmarksData.forEach((bookmark) => {
            if (!bookmark.checkStatus) {
                bookmark.checkStatus = true;
                updated += 1;
            }
        });
        manager.refreshBookmarksList({ skipFlush: true });
        if (updated > 0) {
            manager.markDirty();
            manager.ui?.showNotification?.(
                this.tf('config.statsActionStatusDone', 'Enabled status checks for {count} bookmarks on this page.', { count: updated }),
                'success'
            );
        } else {
            manager.ui?.showNotification?.(this.tf('config.statsActionStatusNoop', 'All bookmarks on this page already have status checks enabled.'), 'info');
        }
    }

    async openBookmarkFromStats(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url) {
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    async jumpToBookmarkPage(bookmark) {
        if (!this.lastManager) {
            return;
        }
        const pageId = Number(bookmark?.pageId) || 0;
        if (pageId <= 0) {
            return;
        }
        const manager = this.lastManager;
        await this.openBookmarksForPage(pageId);
        const pageBookmarks = Array.isArray(manager.bookmarksData) ? manager.bookmarksData : [];
        const targetName = String(bookmark?.name || '');
        const targetUrl = String(bookmark?.url || '').trim();
        const targetIndex = pageBookmarks.findIndex((b) => String(b?.url || '').trim() === targetUrl && String(b?.name || '') === targetName);
        if (targetIndex >= 0) {
            manager.currentBookmarksCategoryFilter = '__all__';
            manager.refreshBookmarksList({
                skipFlush: true,
                focusIndex: targetIndex,
                highlightIndex: targetIndex
            });
        }
    }

    async handleInsightAction(actionId) {
        if (!this.lastManager || !this.currentInsightContext) {
            return;
        }
        const ctx = this.currentInsightContext;
        if (actionId === 'open-top-page' && Number(ctx.topPageId) > 0) {
            await this.openBookmarksForPage(ctx.topPageId);
            return;
        }
        if (actionId === 'review-never-opened' && Number(ctx.neverOpenPageId) > 0) {
            await this.focusNeverOpened(ctx.neverOpenPageId);
            return;
        }
        if (actionId === 'enable-status-coverage' && Number(ctx.lowCoveragePageId) > 0) {
            await this.enableStatusChecksForPage(ctx.lowCoveragePageId);
            return;
        }
        if (actionId === 'open-top-bookmark' && Number(ctx.topBookmarkPageId) > 0 && Number.isInteger(ctx.topBookmarkIndex)) {
            await this.openBookmarksForPage(ctx.topBookmarkPageId);
            const manager = this.lastManager;
            manager.currentBookmarksCategoryFilter = '__all__';
            manager.refreshBookmarksList({
                skipFlush: true,
                focusIndex: ctx.topBookmarkIndex,
                highlightIndex: ctx.topBookmarkIndex
            });
            manager.ui?.showNotification?.(
                this.tf('config.statsActionTopBookmarkDone', 'Focused top bookmark on this page.'),
                'success'
            );
        }
    }

    refresh(manager) {
        this.lastManager = manager;
        const bookmarks = Array.isArray(manager.allBookmarksData) ? manager.allBookmarksData : [];
        const pages = Array.isArray(manager.pagesData) ? manager.pagesData : [];
        const settings = manager.settingsData || {};
        const locale = settings.language || undefined;

        const withUrl = bookmarks.filter((b) => String(b?.url || '').trim() !== '').length;
        const withShortcut = bookmarks.filter((b) => String(b?.shortcut || '').trim() !== '').length;
        const categoryKeys = new Set();
        bookmarks.forEach((b) => {
            const pid = Number(b.pageId) || 0;
            const cat = String(b.category || '').trim();
            categoryKeys.add(`${pid}::${cat}`);
        });

        const statusCheckCount = bookmarks.filter((b) => b?.checkStatus === true).length;
        const neverOpened = bookmarks.filter(
            (b) => Number(b?.openCount || 0) === 0 && !(Number(b?.lastOpened || 0) > 0)
        ).length;

        this.setText('stats-pages-count', String(pages.length));
        this.setText('stats-categories-count', String(categoryKeys.size));
        this.setText('stats-bookmarks-total', String(bookmarks.length));
        this.setText('stats-with-url', String(withUrl));
        this.setText('stats-without-url', String(Math.max(0, bookmarks.length - withUrl)));
        this.setText('stats-with-shortcut', String(withShortcut));
        this.setText('stats-without-shortcut', String(Math.max(0, bookmarks.length - withShortcut)));
        this.setText('stats-never-opened', String(neverOpened));
        // Average opens per bookmark
        const totalOpens = bookmarks.reduce((sum, b) => sum + Number(b?.openCount || 0), 0);
        const avg = bookmarks.length > 0 ? (totalOpens / bookmarks.length) : 0;
        this.setText('stats-avg-opens', String(Math.round(avg * 10) / 10));

        const top = [...bookmarks]
            .filter((b) => Number(b?.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
            .slice(0, 20);

        this.clearTable('stats-top-opens-body');
        if (top.length === 0) {
            this.appendRow('stats-top-opens-body', [this.t('config.statsNoData'), '', '', '']);
        } else {
            top.forEach((b) => {
                this.appendRow('stats-top-opens-body', [
                    String(b.name || '—'),
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                    this.formatWhen(b.lastOpened, locale)
                ]);
            });
        }

        const recent = [...bookmarks]
            .filter((b) => Number(b?.lastOpened || 0) > 0)
            .sort((a, b) => Number(b.lastOpened || 0) - Number(a.lastOpened || 0))
            .slice(0, 20);

        this.clearTable('stats-recent-opens-body');
        if (recent.length === 0) {
            this.appendRow('stats-recent-opens-body', [this.t('config.statsNoData'), '', '', '']);
        } else {
            recent.forEach((b) => {
                this.appendRow('stats-recent-opens-body', [
                    String(b.name || '—'),
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                    this.formatWhen(b.lastOpened, locale)
                ]);
            });
        }

        const idxKnown = Object.prototype.hasOwnProperty.call(settings, 'searchIndexed');
        this.setText(
            'stats-search-indexed',
            idxKnown ? this.yn(Boolean(settings.searchIndexed)) : this.t('config.statsUnknown')
        );
        this.setText('stats-interleave', this.yn(Boolean(settings.interleaveMode)));
        this.setText('stats-fuzzy', this.yn(Boolean(settings.enableFuzzySuggestions)));
        this.setText('stats-show-status', this.yn(Boolean(settings.showStatus)));
        this.setText('stats-status-check-count', String(statusCheckCount));

        const insights = [];
        const context = {
            topPageId: 0,
            neverOpenPageId: 0,
            lowCoveragePageId: 0,
            topBookmarkPageId: 0,
            topBookmarkIndex: -1
        };
        const total = bookmarks.length;
        if (total > 0) {
            const byPage = new Map();
            bookmarks.forEach((b) => {
                const pid = Number(b?.pageId) || 0;
                const prev = byPage.get(pid) || { count: 0, opens: 0, neverOpenCount: 0, uncheckedCount: 0 };
                prev.count += 1;
                prev.opens += Number(b?.openCount || 0);
                if (!(Number(b?.openCount || 0) > 0) && !(Number(b?.lastOpened || 0) > 0)) {
                    prev.neverOpenCount += 1;
                }
                if (!b?.checkStatus) {
                    prev.uncheckedCount += 1;
                }
                byPage.set(pid, prev);
            });
            let busiestPageId = 0;
            let busiestOpens = -1;
            let neverOpenPageId = 0;
            let neverOpenCount = -1;
            let lowCoveragePageId = 0;
            let lowCoverageRatio = -1;
            byPage.forEach((value, pid) => {
                if (value.opens > busiestOpens) {
                    busiestOpens = value.opens;
                    busiestPageId = pid;
                }
                if (value.neverOpenCount > neverOpenCount) {
                    neverOpenCount = value.neverOpenCount;
                    neverOpenPageId = pid;
                }
                const coverageRatio = value.count > 0 ? (value.uncheckedCount / value.count) : 0;
                if (coverageRatio > lowCoverageRatio) {
                    lowCoverageRatio = coverageRatio;
                    lowCoveragePageId = pid;
                }
            });
            context.topPageId = busiestPageId;
            context.neverOpenPageId = neverOpenPageId;
            context.lowCoveragePageId = lowCoveragePageId;

            if (busiestOpens > 0) {
                insights.push({
                    text: this.tf('config.statsInsightTopPage', 'Most activity happens on {page} with {opens} opens.', {
                        page: this.pageName(pages, busiestPageId),
                        opens: busiestOpens
                    }),
                    actionId: 'open-top-page',
                    actionLabel: this.tf('config.statsActionOpenTopPage', 'Open page')
                });
            }

            const topBookmark = [...bookmarks]
                .sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0))[0];
            if (topBookmark && Number(topBookmark?.openCount || 0) > 0) {
                const topBookmarkPageId = Number(topBookmark?.pageId) || 0;
                const topBookmarkName = String(topBookmark.name || '—');
                const topBookmarkCount = Number(topBookmark.openCount || 0);
                context.topBookmarkPageId = topBookmarkPageId;
                const pageBookmarks = Array.isArray(manager.pagesData)
                    ? ((manager.pagesData.find((p) => Number(p?.id) === topBookmarkPageId) || {}).bookmarks || [])
                    : [];
                const topBookmarkIndex = pageBookmarks.findIndex((b) => String(b?.url || '').trim() === String(topBookmark?.url || '').trim() && String(b?.name || '') === topBookmarkName);
                if (topBookmarkIndex >= 0) {
                    context.topBookmarkIndex = topBookmarkIndex;
                }

                const topBookmarkText = this.tf('config.statsInsightTopBookmark', 'Top bookmark is "{name}" with {count} opens.', {
                    name: topBookmarkName,
                    count: topBookmarkCount
                });
                if (topBookmarkPageId > 0 && topBookmarkIndex >= 0) {
                    insights.push({
                        text: topBookmarkText,
                        actionId: 'open-top-bookmark',
                        actionLabel: this.tf('config.statsActionOpenTopBookmark', 'Open bookmark')
                    });
                } else {
                    insights.push(topBookmarkText);
                }
            }

            const neverOpenRatio = Math.round((neverOpened / total) * 100);
            const neverOpenText = this.tf('config.statsInsightNeverOpened', '{percent}% ({count}/{total}) of bookmarks are never opened yet.', {
                percent: neverOpenRatio,
                count: neverOpened,
                total
            });
            if (neverOpenCount > 0 && Number(neverOpenPageId) > 0) {
                insights.push({
                    text: neverOpenText,
                    actionId: 'review-never-opened',
                    actionLabel: this.tf('config.statsActionReviewNeverOpened', 'Review')
                });
            } else {
                insights.push(neverOpenText);
            }

            const statusRatio = Math.round((statusCheckCount / total) * 100);
            const statusText = this.tf('config.statsInsightStatusCoverage', 'Status checks are enabled for {percent}% ({count}/{total}) of bookmarks.', {
                percent: statusRatio,
                count: statusCheckCount,
                total
            });
            if (Number(lowCoveragePageId) > 0 && lowCoverageRatio > 0) {
                insights.push({
                    text: statusText,
                    actionId: 'enable-status-coverage',
                    actionLabel: this.tf('config.statsActionEnableStatus', 'Enable on page')
                });
            } else {
                insights.push(statusText);
            }

            const recent48h = bookmarks.filter((b) => Number(b?.lastOpened || 0) > (Date.now() - 48 * 60 * 60 * 1000)).length;
            if (recent48h > 0) {
                insights.push(this.tf('config.statsInsightRecentActivity', '{count} bookmarks were opened in the last 48 hours.', {
                    count: recent48h,
                    total
                }));
            } else {
                insights.push(this.tf('config.statsInsightNoRecent', 'No bookmark opens recorded in the last 48 hours.'));
            }
        }
        this.currentInsightContext = context;
        this.setInsights(insights.slice(0, 6));

        // Render charts / tables
        this.renderCharts(bookmarks, pages, locale);
    }

    renderCharts(bookmarks, pages, locale) {
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

        // Table: Most clicked (top 20)
        this.renderMostClickedTable(bookmarks, pages, locale);

        // Chart: Top pages by bookmark count
        this.renderTopPagesChart(bookmarks, pages);

        // Chart 2: Stale bookmarks (unused >30 days)
        this.renderStaleChart(bookmarks, thirtyDaysAgo);

        // Table: Latest added (recently added bookmarks)
        this.renderLatestAddedTable(bookmarks, pages, locale);
    }

    renderMostClickedTable(bookmarks, pages, locale) {
        const tbodyId = 'stats-most-clicked-body';
        this.clearTable(tbodyId);

        const top20 = [...bookmarks]
            .filter((b) => Number(b?.openCount || 0) > 0)
            .sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0))
            .slice(0, 20);

        if (top20.length === 0) {
            this.appendRow(tbodyId, [this.t('config.statsNoData'), '', '', '']);
            return;
        }

        top20.forEach((b) => {
            this.appendRow(tbodyId, [
                String(b.name || '—'),
                String(Number(b.openCount || 0)),
                this.pageName(pages, b.pageId),
                this.formatWhen(b.lastOpened, locale)
            ]);
        });
    }

    renderTopPagesChart(bookmarks, pages) {
        const canvas = document.getElementById('chart-top-pages');
        if (!canvas || !Array.isArray(pages)) return;

        const byPage = new Map();
        pages.forEach((p) => byPage.set(Number(p.id), 0));
        bookmarks.forEach((b) => {
            const pid = Number(b?.pageId) || 0;
            byPage.set(pid, (byPage.get(pid) || 0) + 1);
        });

        const entries = Array.from(byPage.entries()).map(([pid, count]) => ({ pid, count }));
        const top = entries.sort((a, b) => b.count - a.count).slice(0, 10);

        if (top.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = 'block';

        const ctx = canvas.getContext('2d');
        const isDark = document.body.classList.contains('dark') || document.body.getAttribute('data-theme')?.includes('dark');
        const textColor = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)';
        const barColor = isDark ? 'rgba(255, 205, 86, 0.7)' : 'rgba(255, 159, 64, 0.7)';

        if (window.topPagesChart) {
            window.topPagesChart.destroy();
        }

        window.topPagesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: top.map(e => this.pageName(pages, e.pid)),
                datasets: [{
                    label: this.t('config.statsColPage'),
                    data: top.map(e => e.count),
                    backgroundColor: barColor,
                    borderColor: isDark ? 'rgba(255, 205, 86, 1)' : 'rgba(255, 159, 64, 1)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: textColor } },
                    y: { ticks: { color: textColor } }
                }
            }
        });
    }

    renderStaleChart(bookmarks, thirtyDaysAgo) {
        const canvas = document.getElementById('chart-stale');
        if (!canvas) return;

        const stale = bookmarks.filter(b => {
            const lastOpened = Number(b?.lastOpened || 0);
            return lastOpened > 0 && lastOpened < thirtyDaysAgo;
        });
        const recent = bookmarks.filter(b => {
            const lastOpened = Number(b?.lastOpened || 0);
            return lastOpened >= thirtyDaysAgo;
        });
        const neverOpened = bookmarks.filter(b => Number(b?.lastOpened || 0) === 0);

        const ctx = canvas.getContext('2d');
        const isDark = document.body.classList.contains('dark') || document.body.getAttribute('data-theme')?.includes('dark');
        const textColor = isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';

        if (window.staleChart) {
            window.staleChart.destroy();
        }

        window.staleChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [
                    this.tf('config.statsChartStaleUnused', 'Stale (30+ days)'),
                    this.tf('config.statsChartStaleRecent', 'Recent'),
                    this.tf('config.statsChartStaleNeverOpened', 'Never opened')
                ],
                datasets: [{
                    data: [stale.length, recent.length, neverOpened.length],
                    backgroundColor: [
                        isDark ? 'rgba(255, 107, 107, 0.7)' : 'rgba(220, 53, 69, 0.7)',
                        isDark ? 'rgba(107, 255, 107, 0.7)' : 'rgba(40, 167, 69, 0.7)',
                        isDark ? 'rgba(255, 193, 7, 0.7)' : 'rgba(255, 193, 7, 0.7)'
                    ],
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, padding: 15 }
                    },
                    tooltip: {
                        backgroundColor: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                        titleColor: isDark ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)',
                        bodyColor: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                        callbacks: {
                            label: (ctx) => {
                                const value = ctx.raw;
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const percent = total > 0 ? Math.round((value / total) * 100) : 0;
                                return `${value} (${percent}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderLatestAddedTable(bookmarks, pages, locale) {
        const tbodyId = 'stats-latest-added-body';
        this.clearTable(tbodyId);

        if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
            this.appendRow(tbodyId, [this.t('config.statsNoData'), '', '', '']);
            return;
        }

        const latest = [...bookmarks]
            .map((bookmark, idx) => ({ bookmark, idx }))
            .sort((a, b) => {
                const aTime = Number(a.bookmark?.addedAt || a.bookmark?.createdAt || a.bookmark?.created || a.bookmark?.added || 0);
                const bTime = Number(b.bookmark?.addedAt || b.bookmark?.createdAt || b.bookmark?.created || b.bookmark?.added || 0);
                if (aTime !== bTime) {
                    return bTime - aTime;
                }
                return b.idx - a.idx;
            })
            .slice(0, 20);

        latest.forEach((entry, idx) => {
            const b = entry.bookmark;
            let addedText = '—';
            const ms = Number(b?.addedAt || b?.createdAt || b?.created || b?.added || 0);
            if (ms && Number.isFinite(ms) && ms > 0) {
                addedText = this.formatWhen(ms, locale);
            }

            this.appendRow(tbodyId, [
                String(b.name || '—'),
                this.pageName(pages, b.pageId),
                String(b.category || '—'),
                addedText
            ]);
        });
    }
}

window.ConfigStats = ConfigStats;
