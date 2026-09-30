// @ts-check
const { test, expect } = require('./fixtures');
const { openConfigBookmarks, bmRow } = require('./helpers/config-bookmarks');

/**
 * Ticking rows in the Bookmarks view shows the selection bar above the list,
 * as Inbox and Containers do, and leaves the side panel shut: the panel is
 * for a bookmark you open. Edit in the bar opens the form for the selection.
 */
const drawerOpen = (page) => page.evaluate(() => Boolean(window.dashboardInstance.config.instance._libDrawer?.isOpen?.()));
const bar = (page) => page.locator('[data-bm-selbar]');

async function tick(page, n) {
    await bmRow(page, n).hover();
    await bmRow(page, n).locator('.config-bm-tick').check();
}

test('one ticked row shows the bar, not the panel', async ({ page }) => {
    await openConfigBookmarks(page);
    await tick(page, 1);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).locator('[data-bm-selbar-count]')).toHaveText('1 selected');
    expect(await drawerOpen(page)).toBe(false);
});

test('several ticked rows: the bar counts them, Edit opens the shared form', async ({ page }) => {
    await openConfigBookmarks(page);
    await tick(page, 1);
    await tick(page, 2);
    await expect(bar(page).locator('[data-bm-selbar-count]')).toHaveText('2 selected');
    expect(await drawerOpen(page)).toBe(false);
    await bar(page).locator('[data-bm-selbar-action="edit"]').click();
    await expect.poll(() => drawerOpen(page)).toBe(true);
    await expect(page.locator('#config-bm-panel [data-bm-bulk-field="page"]')).toBeVisible();
});

test('Clear selection hides the bar', async ({ page }) => {
    await openConfigBookmarks(page);
    await tick(page, 1);
    await bar(page).locator('[data-bm-selbar-action="clear"]').click();
    await expect(bar(page)).toBeHidden();
});

test('a click on a row still opens its panel', async ({ page }) => {
    await openConfigBookmarks(page);
    await bmRow(page, 1).locator('.config-bm-title').click();
    await expect.poll(() => drawerOpen(page)).toBe(true);
});
