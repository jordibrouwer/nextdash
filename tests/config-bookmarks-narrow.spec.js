// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarks } = require('./config-bookmarks-helpers');

const locked = (page) => page.evaluate(() => window.ScrollLock.holders.size);

/**
 * The Bookmarks view on a phone: the rail is a sheet behind a Filters button.
 * (The side panel is the shared one at every width; its specs are the view's.)
 * Opened at desktop width through the header's icon, then narrowed.
 */
async function openNarrow(page) {
    await openBookmarks(page);
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.locator('[data-bm-open-sheet]')).toBeVisible();
}

test.describe('the Bookmarks view on a narrow screen', () => {
    test('below 800px the rail is a sheet behind a Filters button', async ({ page }) => {
        await openNarrow(page);
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
        await openNarrow(page);
        await page.click('[data-bm-open-sheet]');
        await page.locator('#config-bm-rail [data-bm-rail="page"]').first().click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bm-open-sheet]')).toContainText('1');
    });

    test('leaving the view releases the sheet\'s lock', async ({ page }) => {
        await openNarrow(page);
        await page.click('[data-bm-open-sheet]');
        expect(await locked(page)).toBeGreaterThan(0);
        await page.evaluate(() => { window.location.hash = '#inbox'; });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
        await expect.poll(() => locked(page)).toBe(0);
    });
});
