const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Ctrl/Cmd+A and the toolbar button tick every bookmark the filter and the
 * list search show, drawn or not, and clear them again when they are all
 * ticked. A text field keeps the browser's own select-all.
 */

const EXTRA = 160;
const ZEBRAS = 7;

async function open(page) {
  return openBookmarksWithHealth(page, undefined, {
    view: 'library',
    prepare: () => {
      const d = window.dashboardInstance;
      const base = d.allBookmarks[0];
      for (let i = 0; i < 160; i += 1) {
        d.allBookmarks.push({
          ...base,
          url: `https://bulk-${i}.example.test/`,
          name: i < 7 ? `Zebra ${i}` : `Bulkitem ${i}`,
          pinned: false,
          tags: [],
          openLog: [],
        });
      }
    },
  });
}

const total = (page) => page.evaluate(() => window.dashboardInstance.allBookmarks.length);
const selected = (page) => page.evaluate(() => window.dashboardInstance.config.bmSelected.size);
const bar = (page) => page.locator('[data-bm-selbar-count]');
const button = (page) => page.locator('#config-bm-select-all [data-bm-select-all]');

test.describe('bookmarks view: select all', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test('Ctrl+A ticks every bookmark, drawn or not, and again clears', async ({ page }) => {
    await open(page);
    const n = await total(page);
    expect(n).toBeGreaterThan(EXTRA);
    // More rows than the first draw, or this proves nothing about the chunking.
    expect(await page.locator('#config-bm-list .config-bm-row').count()).toBeLessThan(n);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+a');
    await expect(bar(page)).toHaveText(`${n} selected`);
    expect(await selected(page)).toBe(n);
    await expect(page.locator('#config-bm-list .config-bm-row.is-checked').first()).toBeVisible();
    await expect(button(page)).toHaveText('Deselect all');
    await page.keyboard.press('Control+a');
    await expect(page.locator('[data-bm-selbar]')).toBeHidden();
    expect(await selected(page)).toBe(0);
  });

  test('in the search field Ctrl+A is the browser\'s; outside it ticks only the filtered rows', async ({ page }) => {
    await open(page);
    const search = page.locator('#config-bm-search');
    await search.fill('Zebra');
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(ZEBRAS);
    await search.focus();
    await page.keyboard.press('Control+a');
    expect(await selected(page)).toBe(0);
    await expect(page.locator('[data-bm-selbar]')).toBeHidden();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+a');
    await expect(bar(page)).toHaveText(`${ZEBRAS} selected`);
    expect(await selected(page)).toBe(ZEBRAS);
    await expect(button(page)).toHaveText('Deselect all');
  });

  test('the toolbar button does the same, and counts what the filter shows', async ({ page }) => {
    await open(page);
    const n = await total(page);
    await expect(button(page)).toHaveText(`Select all (${n})`);
    await page.locator('#config-bm-search').fill('Zebra');
    await expect(button(page)).toHaveText(`Select all (${ZEBRAS})`);
    await button(page).click();
    await expect(bar(page)).toHaveText(`${ZEBRAS} selected`);
    await expect(button(page)).toHaveText('Deselect all');
    // Widen the filter: the ticked seven are still there, the rest are not.
    await page.locator('#config-bm-search').fill('');
    await expect(button(page)).toHaveText(`Select all (${n})`);
    await button(page).click();
    await expect(bar(page)).toHaveText(`${n} selected`);
    await button(page).click();
    await expect(page.locator('[data-bm-selbar]')).toBeHidden();
    expect(await selected(page)).toBe(0);
  });
});
