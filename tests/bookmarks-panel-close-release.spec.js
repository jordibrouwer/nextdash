// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Closing the side panel with the mouse lets the row go: left as the cursor,
 * it kept the arrow keys and Space, and the page would not scroll until
 * Escape. Closed from the keyboard, the cursor stays where the keys left it.
 */
test('a press beside the panel closes it and lets the row go', async ({ page }) => {
    await openBookmarksWithHealth(page);
    const row = page.locator('#config-bm-list .config-bm-row').nth(1);
    await row.click();
    await expect(page.locator('#config-bm-panel')).toBeVisible();
    await page.locator('.lvs-rail, .config-bm-rail').first().click({ position: { x: 10, y: 10 } });
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.instance._libDrawer?.isOpen?.())).toBe(false);
    expect(await page.evaluate(() => window.dashboardInstance.config.instance._bmKeyboardKey)).toBeNull();
    await expect(page.locator('#config-bm-list .config-bm-row.keyboard-selected')).toHaveCount(0);
});

test('Escape closes the panel and keeps the cursor', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await page.locator('#config-bm-list .config-bm-row').nth(1).click();
    await expect(page.locator('#config-bm-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.instance._libDrawer?.isOpen?.())).toBe(false);
    expect(await page.evaluate(() => window.dashboardInstance.config.instance._bmKeyboardKey)).not.toBeNull();
});
