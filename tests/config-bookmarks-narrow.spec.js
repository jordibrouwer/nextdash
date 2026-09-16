// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarks } = require('./config-bookmarks-helpers');

const locked = (page) => page.evaluate(() => window.ScrollLock.holders.size);

test.describe('the workbench on a narrow screen', () => {
    test('below 1200px the panel is a drawer that e opens and Escape closes', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toBeHidden();
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(panel).toBeVisible();
        await expect(page.locator('[data-bm-scrim]')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
        await page.locator('#config-bm-panel [data-bm-field="name"]').blur();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        expect(await locked(page)).toBe(0);
        // Escape closed the drawer, not the view.
        await expect(page.locator('#config-bm-list')).toBeVisible();
    });

    test('below 800px the rail is a sheet behind a Filters button', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 800 });
        await openBookmarks(page);
        await expect(page.locator('#config-bm-rail')).toBeHidden();
        await page.click('[data-bm-open-sheet]');
        await expect(page.locator('#config-bm-rail')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
        // Right of the sheet, which covers the scrim's left edge.
        await page.click('[data-bm-scrim]', { position: { x: 680, y: 400 } });
        await expect(page.locator('#config-bm-rail')).toBeHidden();
        expect(await locked(page)).toBe(0);
    });

    test('the Filters button counts what is on', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 800 });
        await openBookmarks(page);
        await page.click('[data-bm-open-sheet]');
        await page.locator('#config-bm-rail [data-bm-rail="page"]').first().click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bm-open-sheet]')).toContainText('1');
    });

    test('leaving config releases the lock', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.click('[data-bm-open-drawer]');
        expect(await locked(page)).toBeGreaterThan(0);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => locked(page)).toBe(0);
    });
});
