// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Escape with the cursor in the bookmark grid takes it out of the grid: no row
 * stays marked, no row link keeps DOM focus (which kept the row lit), and j and
 * k are letters for the search again, not steps through the rows.
 */

async function open(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('.category'), null, { timeout: 10_000 });
}

const cursor = (page) => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex);

test.describe('Escape in the grid', () => {
    test('puts the cursor, the highlight and the focus out of the grid', async ({ page }) => {
        await open(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('j');
        expect(await cursor(page)).toBeGreaterThan(0);
        await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(1);

        await page.keyboard.press('Escape');

        expect(await cursor(page)).toBe(-1);
        await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(0);
        const focusInGrid = await page.evaluate(() => Boolean(document.activeElement?.closest?.('.bookmark-link')));
        expect(focusInGrid).toBe(false);
        await expect(page.locator('.bookmark-link:focus-within')).toHaveCount(0);
    });

    test('cancelling a search that was typed from nowhere does not put the cursor on a row', async ({ page }) => {
        await open(page);
        await page.keyboard.type('jel', { delay: 60 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        expect(await cursor(page)).toBe(-1);
        await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(0);
        // and j is a letter again
        await page.keyboard.type('jo', { delay: 60 });
        await expect(page.locator('#search-query')).toHaveText('jo');
    });

    test('cancelling a search that was opened from a row brings that row back', async ({ page }) => {
        await open(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('j');
        const row = await cursor(page);
        expect(row).toBeGreaterThan(0);
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        expect(await cursor(page)).toBe(row);
    });

    for (const letter of ['j', 'k']) {
        test(`after it, ${letter} opens the search like any letter`, async ({ page }) => {
            await open(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Escape');
            await page.keyboard.type(`${letter}ob`, { delay: 60 });
            await expect(page.locator('#search-query')).toHaveText(`${letter}ob`);
            expect(await cursor(page)).toBe(-1);
        });
    }
});
