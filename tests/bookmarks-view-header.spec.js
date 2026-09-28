const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Bookmarks as a view of its own: the workbench full size at #bookmarks, with
 * none of Config's navigation around it.
 */

/** Stub the health report over the fixture's bookmarks: the first broken, the rest healthy. */
async function stubHealth(page) {
  await page.route('**/api/bookmark-health**', async (route) => {
    const bookmarks = await page.evaluate(() => (window.dashboardInstance?.allBookmarks || []).map((b, i) => ({
      url: b.url, name: b.name, pageId: b.pageId, index: i, category: b.category || '',
    })));
    const issues = bookmarks.map((b, i) => ({
      ...b,
      status: i === 0 ? 'broken' : 'healthy',
      flags: i === 0 ? ['broken'] : ['healthy'],
      score: i === 0 ? 25 : 100,
      reasons: i === 0 ? ['HTTP 500'] : [],
      reasonDetails: i === 0 ? [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }] : [],
      lastChecked: Date.now(),
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ generatedAt: Date.now(), summary: { totalBookmarks: issues.length, brokenCount: 1 }, issues }),
    });
  });
}

async function coldLoad(page, hash) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
}

test.describe('bookmarks view: the header entry', () => {
  test('the Bookmarks icon in the header opens the view and is marked while it is open', async ({ page }) => {
    await coldLoad(page, '');
    const link = page.locator('.library-link a.library-link-anchor');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/#bookmarks$/);
    await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible();
    await expect(link).toHaveClass(/active/);
    await expect(page.locator('.dashboard-link a.dashboard-link-anchor')).not.toHaveClass(/active/);
    await expect(page.locator('.title')).toHaveText('bookmarks');
  });
});
