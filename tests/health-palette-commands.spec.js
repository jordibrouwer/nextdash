// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * :health in the palette, typed the way a reader types it.
 *
 * Every filter lands on the Bookmarks view; `:health page` lists the pages and
 * opens the view on one -- it used to throw before listing anything.
 */

async function palette(page, query) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('>');
    await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
    for (const ch of query) {
        await page.keyboard.press(ch);
        await page.waitForTimeout(30);
    }
    return errors;
}

test.describe(':health page', () => {
    test('lists the pages, and one opens the Bookmarks view on it', async ({ page }) => {
        const errors = await palette(page, ':health page ');
        const first = await page.evaluate(() => window.dashboardInstance.pages[0]);
        const row = page.locator('.search-match', { hasText: first.name || 'Page 1' }).first();
        await expect(row).toBeVisible();
        await row.click();
        await expect(page).toHaveURL(new RegExp(`#bookmarks/${first.id}`));
        expect(errors).toEqual([]);
    });
});
