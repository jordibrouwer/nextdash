const { prepareDashboardInteraction } = require('../e2e-helpers');

/**
 * Open Config → Bookmarks with a health report stubbed over the fixture's own
 * bookmarks, so the join has real URLs to match. The first bookmark is broken,
 * the second stale, the rest healthy; `shape` can rewrite the issues, and
 * `report` adds fields to the report itself (duplicateGroups, say); `prepare`
 * runs in the page before the bookmarks are read; `view: 'library'` opens the
 * Bookmarks view instead of Config → Bookmarks.
 */
async function openBookmarksWithHealth(page, shape = (issues) => issues, { report = () => ({}), prepare = null, view = 'config' } = {}) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
  if (prepare) await page.evaluate(prepare);
  const bookmarks = await page.evaluate(() => window.dashboardInstance.allBookmarks.map((b, i) => ({
    url: b.url, name: b.name, pageId: b.pageId, index: i, category: b.category || '',
  })));
  const issues = shape(bookmarks.map((b, i) => ({
    ...b,
    status: i === 0 ? 'broken' : 'healthy',
    flags: i === 0 ? ['broken'] : (i === 1 ? ['stale'] : ['healthy']),
    score: i === 0 ? 25 : 100,
    reasons: i === 0 ? ['HTTP 500'] : [],
    reasonDetails: i === 0 ? [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }] : [],
    lastChecked: Date.now(),
  })));
  await page.route('**/api/bookmark-health**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: Date.now(), summary: { totalBookmarks: issues.length, brokenCount: 1 }, issues, ...report(issues),
    }),
  }));
  await prepareDashboardInteraction(page);
  // 'library' is the Bookmarks view (#bookmarks); 'config' is Config → Bookmarks.
  if (view === 'library') await page.evaluate(() => { window.location.hash = '#bookmarks'; });
  else await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
  await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
  return { bookmarks, issues };
}

module.exports = { openBookmarksWithHealth };
