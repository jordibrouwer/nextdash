const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * When the server itself has no connection its failed checks are held back, and
 * the Bookmarks view says so in one calm line in the health tile; the line is
 * gone with the next normal report.
 */

const line = (page) => page.locator('#config-bm-rail .config-bm-health-netdown');

test.describe('bookmarks view: server offline line', () => {
  test('the tile says checks are paused and nothing was marked broken', async ({ page }) => {
    const since = new Date(2026, 10, 2, 9, 41).getTime();
    await openBookmarksWithHealth(page, undefined, {
      report: () => ({ networkDown: { since, lastSweepAt: since + 60_000 } }),
    });
    await expect(line(page)).toBeVisible();
    await expect(line(page)).toContainText('No connection from this server since');
    await expect(line(page)).toContainText('Checks are paused and nothing was marked broken.');
    // The time is filled in, not left as a placeholder.
    await expect(line(page)).not.toContainText('{time}');
  });

  test('no line while the report carries no networkDown', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect(page.locator('#config-bm-rail .config-bm-health-summary')).toBeVisible();
    await expect(line(page)).toHaveCount(0);
  });

  test('Retest all says the checks were held, not "Nothing to re-check"', async ({ page }) => {
    const since = new Date(2026, 10, 2, 9, 41).getTime();
    await openBookmarksWithHealth(page, undefined, {
      report: () => ({ networkDown: { since, lastSweepAt: since + 60_000 } }),
    });
    await page.route('**/api/health/retest-all**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'completed', count: 0, results: [], tested: 0, heldOffline: 12, networkDown: true }),
    }));
    await page.evaluate(() => {
      const d = window.dashboardInstance;
      window.__notes = [];
      const show = d.showNotification.bind(d);
      d.showNotification = (msg, ...rest) => { window.__notes.push(String(msg)); return show(msg, ...rest); };
    });
    await page.evaluate(() => window.dashboardInstance.health.retestAll());
    const notes = await page.evaluate(() => window.__notes);
    expect(notes.some((m) => m.includes('No connection from this server since') && m.includes('nothing was marked broken'))).toBe(true);
    expect(notes.some((m) => /Nothing to re-check/.test(m))).toBe(false);
  });
});
