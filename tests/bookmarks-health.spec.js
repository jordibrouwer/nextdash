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
