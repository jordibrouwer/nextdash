const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Bookmarks → View: how the Bookmarks view looks and behaves, as
 * panels of settings the way Behavior draws them.
 */
async function openView(page) {
  await markWhatsNewSeen(page);
  await page.goto('/#config');
  await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
  await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
  await page.locator('[data-bm-tab="view"]').click();
  await page.waitForSelector('.config-bm-view-tab [data-behavior-field]', { timeout: 10_000 });
}

const FIELDS = [
  'bmViewGroup', 'configBookmarksSort', 'configBookmarksPageSize', 'bmViewAddress', 'bmViewRowColors',
  'bmViewColumns', 'bmViewUsageDays', 'bmViewRail', 'bmViewRailBlocks', 'bmViewPanelTab', 'bmViewCloseOutside',
  'bmViewPanelWidth', 'bmViewClick', 'bmViewDblClick', 'bmViewHealthRange', 'bmViewBadge', 'bmViewBadgeCounts', 'bmViewKeyLegend',
];

test.describe('Config → Bookmarks → View', () => {
  test('is the first tab, with every setting, all at their defaults', async ({ page }) => {
    await openView(page);
    const first = await page.locator('[data-bm-tab]').first().getAttribute('data-bm-tab');
    expect(first).toBe('view');
    const missing = await page.evaluate((fields) => fields.filter((f) => !document.querySelector(`.config-bm-view-tab [data-behavior-field="${f}"]`)), FIELDS);
    expect(missing).toEqual([]);
    await expect(page.locator('.config-view-head .config-changed-count')).toContainText(/default/i);
    await expect(page.locator('.config-bm-view-tab [data-bm-open-view]')).toHaveAttribute('href', '#bookmarks');
  });

  test('a change is saved, and marked as changed', async ({ page }) => {
    await openView(page);
    const saved = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/settings/.test(r.url())
      && (r.postData() || '').includes('"bmViewAddress":"domain"'));
    await page.locator('.config-bm-view-tab select[data-behavior-field="bmViewAddress"]').selectOption('domain');
    await saved;
    await expect(page.locator('.config-view-head .config-changed-count')).toContainText(/1 of/);
    // Back to the default, so the shared data dir is left as found.
    await page.locator('.config-bm-view-tab select[data-behavior-field="bmViewAddress"]').selectOption('full');
    await expect(page.locator('.config-view-head .config-changed-count')).toContainText(/default/i);
  });
});

test.describe('Config → Bookmarks → View: the preview', () => {
  test('shows two rows and the panel head, and follows a change', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openView(page);
    const preview = page.locator('[data-bm-view-preview]');
    await expect(preview.locator('.config-bm-row')).toHaveCount(2);
    await expect(preview.locator('.config-bm-panel-head')).toHaveCount(1);
    // A fixed example, not the reader's own most used bookmark.
    await expect(preview.locator('.config-bm-panel-title')).toHaveText('GitHub');
    const domains = () => preview.locator('.config-bm-domain').count();
    expect(await domains()).toBe(2);
    await page.locator('.config-bm-view-tab select[data-behavior-field="bmViewAddress"]').selectOption('hidden');
    try {
      await expect.poll(domains).toBe(0);
    } finally {
      // Back to the default, so the shared data dir is left as found.
      await page.locator('.config-bm-view-tab select[data-behavior-field="bmViewAddress"]').selectOption('full');
      await expect(page.locator('.config-view-head .config-changed-count')).toContainText(/default/i);
    }
  });
});
