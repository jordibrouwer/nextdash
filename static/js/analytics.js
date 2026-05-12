/**
 * Bookmark Analytics & Insights
 * Track opens, show usage statistics, unused bookmarks
 */

class BookmarkAnalytics {
    constructor(configManager) {
        this.configManager = configManager;
        this.analytics = null;
        this.duplicates = null;
    }

    async loadAnalytics() {
        try {
            const response = await fetch('/api/analytics');
            if (response.ok) {
                this.analytics = await response.json();
                return this.analytics;
            }
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
        return null;
    }

    async checkDuplicates() {
        try {
            const response = await fetch('/api/duplicates');
            if (response.ok) {
                this.duplicates = await response.json();
                return this.duplicates;
            }
        } catch (error) {
            console.error('Error checking duplicates:', error);
        }
        return null;
    }

    async trackBookmarkOpen(pageId, index) {
        const payload = JSON.stringify({ pageId, index });

        // sendBeacon is the most reliable during navigation/unload.
        if (navigator.sendBeacon) {
            try {
                const blob = new Blob([payload], { type: 'application/json' });
                const queued = navigator.sendBeacon('/api/track-open', blob);
                if (queued) {
                    return;
                }
            } catch (error) {
                // Fall through to fetch keepalive fallback.
            }
        }

        try {
            await fetch('/api/track-open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true
            });
        } catch (error) {
            console.error('Error tracking open:', error);
        }
    }

    renderAnalyticsTab() {
        return `
            <div class="tab-content" data-tab-content="analytics">
                <div class="config-section">
                    <h3>📊 Bookmark Statistics</h3>
                    
                    <div class="analytics-grid">
                        <div class="analytics-card">
                            <div class="analytics-label">Total Bookmarks</div>
                            <div class="analytics-value">${this.analytics?.totalBookmarks || 0}</div>
                        </div>
                        <div class="analytics-card">
                            <div class="analytics-label">Unused Bookmarks</div>
                            <div class="analytics-value analytics-warning">${this.analytics?.unusedCount || 0}</div>
                        </div>
                    </div>

                    <h4>Most Opened Bookmarks</h4>
                    <div class="analytics-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Opens</th>
                                    <th>URL</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.analytics?.mostOpened?.slice(0, 10).map(bm => `
                                    <tr>
                                        <td>${bm.name}</td>
                                        <td>${bm.openCount}</td>
                                        <td class="url-cell">${bm.url}</td>
                                    </tr>
                                `).join('') || '<tr><td colspan="3">No data</td></tr>'}
                            </tbody>
                        </table>
                    </div>

                    <h4>Least Used Bookmarks</h4>
                    <div class="analytics-suggestion">
                        <p>Consider removing or archiving bookmarks with 0 opens after 30 days.</p>
                    </div>
                </div>
            </div>
        `;
    }

    renderDuplicatesWarning() {
        if (!this.duplicates?.duplicateUrls?.length) return '';

        return `
            <div class="duplicates-warning">
                <h4>⚠️ Duplicate Bookmarks Detected</h4>
                <div class="duplicates-list">
                    ${this.duplicates.duplicateUrls.map(group => `
                        <div class="duplicate-group">
                            <div class="duplicate-url">${group.url}</div>
                            <div class="duplicate-items">
                                ${group.bookmarks.map(bm => `
                                    <span class="duplicate-item">${bm.name}</span>
                                `).join('')}
                            </div>
                            <button class="btn btn-small btn-secondary" data-merge-duplicates="${group.url}">
                                Merge
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
}
