const { test, expect } = require('./fixtures');
const { openConfigBookmarks, bmRow } = require('./helpers/config-bookmarks');

test.describe('config bookmarks redesign: rows', () => {
  test('the row keeps title, domain, tags, opens and last opened; no check mode, added or dot', async ({ page }) => {
    await openConfigBookmarks(page);
    const row = bmRow(page);
    await expect(row.locator('.config-bm-title')).not.toBeEmpty();
    await expect(row.locator('.config-bm-domain')).toHaveCount(1);
    await expect(row.locator('.config-bm-tags')).toHaveCount(1);
    await expect(row.locator('.config-bm-opens')).toHaveCount(1);
    await expect(row.locator('.config-bm-last')).toHaveCount(1);
    await expect(row.locator('.config-bm-checkmode, .config-bm-added, .config-bm-health-dot')).toHaveCount(0);
  });

  test('the glow follows the health state', async ({ page }) => {
    await openConfigBookmarks(page);
    const status = await page.evaluate(() => {
      const cfg = window.dashboardInstance.config;
      const facts = window.HealthFacts;
      const orig = facts.get;
      const at = (bookmark, f) => { facts.get = () => f; return cfg.workbenchRowStatus(bookmark); };
      const checked = { url: 'https://example.com/x', checkStatus: true };
      const out = {
        healthy: at(checked, null),
        monitored: at(checked, { monitor: true }),
        broken: at(checked, { brokenSince: 1 }),
        down: at(checked, { monitor: true, downSince: 1 }),
        unchecked: at({ url: 'https://example.com/y' }, null),
      };
      facts.get = orig;
      return out;
    });
    expect(status).toEqual({ healthy: 'good', monitored: 'info', broken: 'bad', down: 'warn', unchecked: null });
  });

  test('the checkbox rests hidden and shows on hover', async ({ page }) => {
    await openConfigBookmarks(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    const tick = bmRow(page, 2).locator('.config-bm-tick-cell');
    await expect(tick).toBeHidden();
    await bmRow(page, 2).hover();
    await expect(tick).toBeVisible();
  });

  test('a row is as tall as a Health row', async ({ page }) => {
    await openConfigBookmarks(page);
    const h = await bmRow(page).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h).toBe(46);
  });
});

test.describe('config bookmarks redesign: rail and toolbar', () => {
  test('the search field sits in the toolbar and / focuses it', async ({ page }) => {
    await openConfigBookmarks(page);
    await expect(page.locator('.config-bm-toolbar #config-bm-search')).toHaveCount(1);
    await expect(page.locator('.config-bm-rail #config-bm-search')).toHaveCount(0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('/');
    await expect(page.locator('#config-bm-search')).toBeFocused();
  });

  test('the rail groups are not boxed, and the active filter is marked', async ({ page }) => {
    await openConfigBookmarks(page);
    const group = page.locator('.config-bm-rail-group').first();
    const box = await group.evaluate((el) => {
      const c = getComputedStyle(el);
      return { border: c.borderTopWidth, bg: c.backgroundColor };
    });
    expect(box.border).toBe('0px');
    expect(box.bg).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.config-bm-rail-item.is-on').first()).toBeVisible();
  });

  test('the List tab has no intro sentence', async ({ page }) => {
    await openConfigBookmarks(page);
    await expect(page.getByText('Every bookmark you have, from every page')).toHaveCount(0);
  });
});
