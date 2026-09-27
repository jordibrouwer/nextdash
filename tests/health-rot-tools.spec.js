// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The rot report: what has rotted in the collection, from the Bookmarks view's
 * Collection menu.
 */
test.describe('the rot report', () => {
    test('opens with a section per finding, and says so when there is nothing', async ({ page }) => {
        await openBookmarksWithHealth(page);
        await page.locator('.config-view--library [data-bm-header-more]').click();
        await page.locator('[data-bm-header-menu] [data-bm-rot-report]').click();
        const modal = page.locator('.health-rot-modal');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        const headings = await modal.locator('.health-explain-row h4').allTextContents();
        expect(headings.length).toBe(5);
        expect(headings.join(' ')).toMatch(/Gone without saying so/i);
        expect(headings.join(' ')).toMatch(/Failing for over a month/i);
    });
});
