const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Health inside the bookmark list: the Health module's report, loaded without
 * opening the Health view, joined to the bookmarks by URL.
 */
test.describe('bookmarks: the health report joined in', () => {
  test('each bookmark finds its report issue by URL', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const joined = await page.evaluate(async () => {
      const cfg = window.dashboardInstance.config;
      await cfg.bmHealth();
      return window.dashboardInstance.allBookmarks.slice(0, 2).map((b) => cfg.bmHealthIssue(b)?.score ?? null);
    });
    expect(joined).toEqual([25, 100]);
    expect(bookmarks.length).toBeGreaterThan(1);
  });

  test('the Health view is not opened to get there', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await page.evaluate(() => window.dashboardInstance.config.bmHealth());
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    await expect(page.locator('#dashboard-layout')).not.toHaveClass(/health-layout/);
  });

  test('opening the list loads the report on its own', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect.poll(() => page.evaluate(() => {
      const cfg = window.dashboardInstance.config;
      return cfg._bmHealthByUrl?.size || 0;
    })).toBeGreaterThan(0);
  });
});

test.describe('bookmarks: Health filters in the rail', () => {
  const healthItem = (page, key) => page.locator(`#config-bm-rail [data-bm-rail="health"][data-value="${key}"]`);

  test('the rail lists Health\'s filters with their counts', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect(healthItem(page, 'broken').locator('.config-bm-rail-count')).toHaveText('1');
    await expect(healthItem(page, 'stale').locator('.config-bm-rail-count')).toHaveText('1');
    await expect(healthItem(page, 'monitored')).toHaveCount(1);
  });

  test('picking Broken narrows the list to the broken bookmark', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await healthItem(page, 'broken').click();
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(1);
    await expect(page.locator('#config-bm-list .config-bm-title').first()).toHaveText(bookmarks[0].name);
  });

  test('the rail opens with the collection\'s health summary', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect(page.locator('#config-bm-rail [data-bm-health-summary]')).toContainText('%');
  });
});
