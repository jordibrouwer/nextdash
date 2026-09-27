const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The Bookmarks view's band carries Health's header: Work through, Rot
 * report, the view's own buttons, Export, ⋯ and ⓘ. The header icon carries
 * Health's badge.
 */

const band = (page) => page.locator('.config-view--library .lvs-header-actions');

test.describe('bookmarks view: the band\'s actions', () => {
  test('every action is there', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    for (const sel of ['[data-bm-work-through]', '[data-bm-rot-report]', '[data-bm-open-structure]',
      '[data-bm-open-health-modal]', '[data-bm-export]', '[data-bm-header-more]', '[data-bm-help]']) {
      await expect(band(page).locator(sel)).toHaveCount(1);
    }
    await expect(band(page).locator('[data-bm-work-through]')).toContainText('Work through');
  });

  test('Work through walks the list as the view has it', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]').click();
    await band(page).locator('[data-bm-work-through]').click();
    await expect(page.locator('.health-focus-overlay')).toBeVisible();
    // The Health view is not what opened: the address stays the Bookmarks view's.
    await expect(page).toHaveURL(/#bookmarks/);
  });

  test('f starts it from the list', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('f');
    await expect(page.locator('.health-focus-overlay')).toBeVisible();
  });

  test('Rot report and ⓘ open their explanations', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await band(page).locator('[data-bm-rot-report]').click();
    await expect(page.locator('#app-modal.show')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal.show')).toHaveCount(0);
    await band(page).locator('[data-bm-help]').click();
    await expect(page.locator('#app-modal.show')).toContainText(/Bookmarks/);
  });

  test('Export downloads the list as it stands', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    const download = page.waitForEvent('download');
    await band(page).locator('[data-bm-export]').click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test('⋯ holds Health settings and a refresh of the report', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await band(page).locator('[data-bm-header-more]').click();
    const menu = band(page).locator('[data-bm-header-menu]');
    await expect(menu).toBeVisible();
    const refreshed = page.waitForRequest((r) => /\/api\/bookmark-health\?refresh=1/.test(r.url()));
    await menu.locator('[data-bm-header-action="refresh"]').click();
    await refreshed;
    await expect(menu.locator('[data-bm-header-action="settings"]')).toHaveCount(1);
  });
});

test('the Bookmarks icon in the header carries the count of problems', async ({ page }) => {
  await openBookmarksWithHealth(page, undefined, { view: 'library' });
  // The helper stubs the report after the page has loaded, so the start-up
  // badge fetch saw the real one: the refresh is run again against the stub,
  // rather than waited for from a poll that comes minutes later.
  await page.evaluate(() => window.dashboardInstance.updateHealthBadge());
  const library = page.locator('.library-link a .health-badge');
  await expect(library).toHaveText('1');
  await expect(library).toHaveText(await page.locator('.health-link a .health-badge').textContent());
});
