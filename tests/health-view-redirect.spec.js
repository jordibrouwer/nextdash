const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The Health view is gone. Its addresses, its key and its header icon lead to
 * the Bookmarks view, on the filter the old address asked for.
 */
async function arrive(page, path) {
  await markWhatsNewSeen(page);
  await page.goto(path);
  await page.waitForFunction(() => window.dashboardInstance?.activeView === 'library', null, { timeout: 20_000 });
}

const where = (page) => page.evaluate(() => ({
  hash: window.location.hash,
  search: window.location.search,
  view: window.dashboardInstance.activeView,
  health: window.dashboardInstance.config.bmHealthFilter || '',
  query: window.dashboardInstance.config.bmQuery || '',
}));

test.describe('the Health view\'s addresses', () => {
  test('#health is the Bookmarks view on Broken, which was Health\'s own start', async ({ page }) => {
    await arrive(page, '/#health');
    const at = await where(page);
    expect(at.hash).toBe('#bookmarks?health=broken');
    expect(at.health).toBe('broken');
  });

  test('a filter and a search in the old address come along, and the old parameters go', async ({ page }) => {
    await arrive(page, '/?hv_filter=monitored&hv_q=git#health');
    const at = await where(page);
    expect(at.health).toBe('monitored');
    expect(at.query).toBe('git');
    expect(at.search).not.toContain('hv_');
  });

  test('#health/monitors is the monitored ones', async ({ page }) => {
    await arrive(page, '/#health/monitors');
    expect((await where(page)).health).toBe('monitored');
  });

  test('All in the old address is no filter', async ({ page }) => {
    await arrive(page, '/?hv_filter=all#health');
    const at = await where(page);
    expect(at.health).toBe('');
    expect(at.hash).toBe('#bookmarks');
  });

  test('going to #health from the dashboard lands in the Bookmarks view', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.location.hash = '#health'; });
    await page.waitForFunction(() => window.dashboardInstance.activeView === 'library', null, { timeout: 15_000 });
    expect((await where(page)).health).toBe('broken');
  });
});

test.describe('the Health view\'s ways in', () => {
  test('Shift+H on the dashboard opens the Bookmarks view', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.keyboard.press('Shift+H');
    await page.waitForFunction(() => window.dashboardInstance.activeView === 'library', null, { timeout: 15_000 });
    expect((await where(page)).hash).toMatch(/^#bookmarks/);
  });

  test('the header has no Health icon; the Bookmarks icon carries the badge', async ({ page }) => {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
      json: { generatedAt: Date.now(), summary: { totalBookmarks: 3, brokenCount: 2 }, issues: [] },
    }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await expect(page.locator('.health-link')).toHaveCount(0);
    await expect(page.locator('.library-link .health-badge')).toBeVisible({ timeout: 10_000 });
  });
});

/*
 * :health, typed in the palette: it lands on the Bookmarks view's own address
 * with every health kind the list can be narrowed by -- a missing preview or a
 * shortcut conflict too, which the redirect used to drop -- and refresh runs
 * the scan it promises instead of losing the request on the way.
 */
test.describe(':health in the palette', () => {
  async function palette(page, typed) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.keyboard.press(':');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.type(typed);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.dashboardInstance?.activeView === 'library', null, { timeout: 15_000 });
  }

  for (const kind of ['missing-preview', 'shortcut-conflict']) {
    test(`:health ${kind} opens the list on that kind`, async ({ page }) => {
      await palette(page, `health ${kind}`);
      const at = await where(page);
      expect(at.hash).toBe(`#bookmarks?health=${kind}`);
      expect(at.health).toBe(kind);
    });
  }

  test('a kind the rail does not draw survives a reload of its address', async ({ page }) => {
    await arrive(page, '/#bookmarks?health=drift');
    expect((await where(page)).health).toBe('drift');
  });

  test(':health refresh opens the list on broken and asks for a fresh scan', async ({ page }) => {
    const scans = [];
    page.on('request', (req) => {
      if (/\/api\/bookmark-health\?refresh=1/.test(req.url())) scans.push(req.url());
    });
    await palette(page, 'health refresh');
    await expect.poll(() => scans.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const at = await where(page);
    expect(at.health).toBe('broken');
    expect(at.search).not.toContain('hv_');
  });
});
