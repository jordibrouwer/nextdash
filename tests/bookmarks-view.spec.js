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

test.describe('bookmarks view', () => {
  test('#bookmarks opens the list full size, without Config around it', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await expect(page.locator('#dashboard-layout')).toHaveClass(/library-layout/);
    await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible();
    await expect(page.locator('.config-nav-column')).toHaveCount(0);
    await expect(page.locator('.config-subtabs')).toHaveCount(0);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
  });

  test('a cold load of #bookmarks?health=broken lands filtered', async ({ page }) => {
    await stubHealth(page);
    await coldLoad(page, '#bookmarks?health=broken');
    await expect(page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(1);
  });

  test('a filter picked in the view is written to #bookmarks, not #config', async ({ page }) => {
    await stubHealth(page);
    await coldLoad(page, '#bookmarks');
    await page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]').click();
    await expect(page).toHaveURL(/#bookmarks\?health=broken$/);
  });

  test('Escape leaves the view for the dashboard', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Escape');
    await expect(page.locator('#dashboard-layout')).not.toHaveClass(/library-layout/);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('library');
  });

  test('Config opened from the view has its navigation back', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible();
    await page.evaluate(() => { window.location.hash = '#config/appearance'; });
    await expect(page.locator('.config-nav-column')).toBeVisible();
    await expect(page.locator('#dashboard-layout')).not.toHaveClass(/library-layout/);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
  });
});

test.describe('bookmarks view: the side panel', () => {
  const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
  const row = (page, i) => page.locator('#config-bm-list .config-bm-row').nth(i);

  test('no panel column, and no side panel before a row is picked', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await expect(row(page, 0)).toBeVisible();
    await expect(page.locator('#config-bm-workbench #config-bm-panel')).toHaveCount(0);
    await expect(drawer(page)).toHaveCount(0);
  });

  test('clicking a row opens the side panel with that bookmark', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    const name = (await row(page, 1).locator('.config-bm-title').textContent()).trim();
    await row(page, 1).locator('.config-bm-title').click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).locator('.config-bm-panel-title')).toHaveText(name);
  });

  test('j/k leave the side panel closed, and follow in it once it is open', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await expect(drawer(page)).toHaveCount(0);
    await row(page, 0).locator('.config-bm-title').click();
    await expect(drawer(page)).toBeVisible();
    const second = (await row(page, 1).locator('.config-bm-title').textContent()).trim();
    await page.keyboard.press('j');
    await expect(drawer(page).locator('.config-bm-panel-title')).toHaveText(second);
  });

  test('× and Escape close it', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await row(page, 0).locator('.config-bm-title').click();
    await expect(drawer(page)).toBeVisible();
    await drawer(page).locator('.lvs-drawer-close').click();
    await expect(drawer(page)).toHaveCount(0);
    await row(page, 0).locator('.config-bm-title').click();
    await expect(drawer(page)).toBeVisible();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
  });

  test('ticking two rows opens the bulk form in it', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => document.activeElement?.blur?.());
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('j');
      await page.keyboard.press('x');
    }
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-mode', 'bulk');
  });

  test('leaving the view takes the side panel with it', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await row(page, 0).locator('.config-bm-title').click();
    await expect(drawer(page)).toBeVisible();
    await page.evaluate(() => { window.location.hash = '#config/appearance'; });
    await expect(page.locator('.config-nav-column')).toBeVisible();
    await expect(drawer(page)).toHaveCount(0);
  });

  test('on a phone it fills the screen', async ({ page }) => {
    await coldLoad(page, '#bookmarks');
    await page.setViewportSize({ width: 390, height: 844 });
    await row(page, 0).locator('.config-bm-title').click();
    await expect(drawer(page)).toBeVisible();
    const box = await drawer(page).boundingBox();
    expect(box.width).toBeGreaterThan(360);
  });
});
