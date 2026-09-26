const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Structure → Categories and Pages read like Health's rows: one line each,
 * touching, the name as text until you reach for it, the buttons out of sight
 * until the row is hovered or focused.
 */

async function openStructure(page, tab) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
  await prepareDashboardInteraction(page);
  await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
  if (tab !== 'categories') {
    await page.locator('#config-view-body').getByText('Pages', { exact: true }).first().click();
  }
  await page.waitForSelector(`.config-crud-list--table .config-crud-row`, { timeout: 15_000 });
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur?.());
}

for (const [tab, nameSel] of [['categories', '[data-cat="name"]'], ['pages', '[data-page="name"]']]) {
  test.describe(`structure ${tab} as a table`, () => {
    test('a row is as tall as a Health row, and rows touch', async ({ page }) => {
      await openStructure(page, tab);
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.config-crud-list--table .config-crud-row:not(.config-crud-row--widget)')];
        const a = rows[0].getBoundingClientRect();
        const b = rows[1]?.getBoundingClientRect();
        return { h: Math.round(a.height), gap: b ? Math.round(b.top - a.bottom) : 0 };
      });
      expect(m.h).toBe(46);
      expect(m.gap).toBe(0);
    });

    test('the name reads as text at rest', async ({ page }) => {
      await openStructure(page, tab);
      const name = page.locator(`.config-crud-list--table .config-crud-row:not(.config-crud-row--widget) ${nameSel}`).first();
      const s = await name.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, bg: getComputedStyle(el).backgroundColor, fw: getComputedStyle(el).fontWeight }));
      expect(s.bg).toBe('rgba(0, 0, 0, 0)');
      expect(s.fw).toBe('600');
    });

    test('the buttons show on hover only', async ({ page }) => {
      await openStructure(page, tab);
      const row = page.locator('.config-crud-list--table .config-crud-row:not(.config-crud-row--widget)').first();
      const actions = row.locator('.config-crud-row-actions');
      await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
      await row.hover();
      await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    });
  });
}
