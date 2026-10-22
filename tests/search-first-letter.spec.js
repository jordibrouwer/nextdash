// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Typing on the dashboard opens the search with what was typed.
 *
 * Two things went wrong with the first letter: it was put into the line as the
 * upper-case reading the key checks use ("Immich", not "immich"), and with the
 * cursor already in the grid a first j or k walked a row instead and the word
 * lost it ("ellyfin", "ube").
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

const query = (page) => page.locator('#search-query');

test.describe('the first letter of a search', () => {
    test('is kept as typed, not turned into a capital', async ({ page }) => {
        await open(page);
        await page.keyboard.type('immich', { delay: 60 });
        await expect(query(page)).toHaveText('immich');
    });

    test('a capital the reader typed stays one', async ({ page }) => {
        await open(page);
        await page.keyboard.type('Immich', { delay: 60 });
        await expect(query(page)).toHaveText('Immich');
    });

    for (const word of ['jelly', 'kube']) {
        test(`${word}: a j or k right after the cursor entered the grid is not lost`, async ({ page }) => {
            await open(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.type(word, { delay: 60 });
            await expect(query(page)).toHaveText(word);
        });
    }

    test('a j on its own still walks the grid', async ({ page }) => {
        await open(page);
        await page.keyboard.press('ArrowDown');
        const before = await page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex);
        await page.keyboard.press('j');
        await page.waitForTimeout(600);
        const after = await page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex);
        expect(after).toBe(before + 1);
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });
});
