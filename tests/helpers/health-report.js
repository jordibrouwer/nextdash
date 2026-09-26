const { prepareDashboardInteraction } = require('../e2e-helpers');

// A small report covering each row kind the redesign draws differently:
// broken, drifted (warn), monitored (info), ignored-for-alerts (muted), healthy.
function redesignReport() {
  return {
    generatedAt: Date.now(),
    summary: { totalBookmarks: 5, healthyCount: 2, brokenCount: 1, duplicateCount: 0, uncheckedCount: 0, staleCount: 0, unusedCount: 0 },
    issues: [
      {
        pageId: 1, index: 0, pageName: 'dev', name: 'Broken one', url: 'https://example.com/broken', category: 'tools',
        status: 'broken', score: 25, duplicateCount: 0, lastChecked: 1752000000000,
        reasons: ['HTTP 500'], reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
      },
      {
        pageId: 1, index: 1, pageName: 'dev', name: 'Drifted one', url: 'https://example.com/drift', category: 'tools',
        status: 'healthy', score: 70, duplicateCount: 0, lastChecked: 1752000000000, watchDrift: true, driftNoticed: 'content',
        reasons: ['Content changed'], reasonDetails: [{ code: 'drift', penalty: 30 }],
      },
      {
        pageId: 1, index: 2, pageName: 'dev', name: 'Monitored one', url: 'https://example.com/monitored', category: 'tools',
        status: 'healthy', score: 100, duplicateCount: 0, lastChecked: 1752000000000, monitor: true, checkStatus: true,
        reasons: [], reasonDetails: [],
      },
      {
        pageId: 1, index: 3, pageName: 'dev', name: 'Muted one', url: 'https://example.com/muted', category: 'tools',
        status: 'healthy', score: 95, duplicateCount: 0, lastChecked: 1752000000000, notifyMuted: true,
        reasons: [], reasonDetails: [],
      },
      {
        pageId: 1, index: 4, pageName: 'dev', name: 'Healthy one', url: 'https://example.com/ok', category: 'tools',
        status: 'healthy', score: 100, duplicateCount: 0, lastChecked: 1752000000000,
        reasons: [], reasonDetails: [],
      },
    ],
  };
}

async function openHealthWith(page, report = redesignReport()) {
  await page.route('**/api/bookmark-health**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(report),
  }));
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
  await prepareDashboardInteraction(page);
  await page.click('.health-link a.health-link-anchor');
  await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
  // Every row, whatever the view opened on.
  await page.locator('[data-health-filter="all"]').click();
  await page.waitForSelector('.health-view-item', { timeout: 15_000 });
}

const row = (page, name) => page.locator('.health-view-item', { has: page.locator('.health-view-item-title', { hasText: name }) });

module.exports = { redesignReport, openHealthWith, row };
