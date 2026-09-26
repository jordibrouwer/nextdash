const { prepareDashboardInteraction } = require('../e2e-helpers');

async function openConfigBookmarks(page) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
  await prepareDashboardInteraction(page);
  await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
  await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
}

const bmRow = (page, n = 0) => page.locator('#config-bm-list .config-bm-row').nth(n);

module.exports = { openConfigBookmarks, bmRow };
