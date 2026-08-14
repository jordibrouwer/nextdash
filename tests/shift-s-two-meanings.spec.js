const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Shift+S means two things, and which one depends on whether a row is selected.
 *
 * With a bookmark under the cursor it shares that bookmark; with nothing
 * selected it opens config. The row actions live in a capture-phase handler
 * that stops the event, so the split only works while that handler declines the
 * key when there is no row to act on — it used to swallow it either way, and
 * adding share to that block took the config shortcut away entirely.
 *
 * Every key in that block has the same shape, so the guard is tested through
 * Shift+S — the only one with a second meaning, and therefore the only one
 * whose being swallowed is observable at all. Shift+M stands in for the rest:
 * it must still work with a row, and do nothing without one.
 */

async function load(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
}

const view = (page) => page.evaluate(() => window.dashboardInstance.activeView);

const clearSelection = (page) => page.evaluate(() =>
    window.dashboardInstance.keyboardNavigation?.clearSelection?.({ restoreFocus: false }));

test.describe('Shift+S', () => {
    test('opens config when no bookmark is selected', async ({ page }) => {
        await load(page);
        await clearSelection(page);

        await page.keyboard.press('Shift+S');
        await expect.poll(() => view(page), { timeout: 10_000 }).toBe('config');
    });

    test('shares the row when one is selected, and does not open config', async ({ page }) => {
        await load(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.keyboardNavigation?.currentIndex), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(0);

        await page.evaluate(() => {
            window.__shared = false;
            const cm = window.dashboardInstance.contextMenu;
            const real = cm.shareBookmark?.bind(cm);
            cm.shareBookmark = (...args) => {
                window.__shared = true;
                return real ? real(...args) : undefined;
            };
        });

        await page.keyboard.press('Shift+S');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.__shared)).toBe(true);
        expect(await view(page)).toBe('bookmarks');
    });

    // The rest of the block, checked by what they do rather than by watching
    // propagation: an earlier attempt asserted that the event reached a probe
    // listener, which turned out to measure listener registration order — the
    // move popover opened and the probe fired anyway.
    test('Shift+M opens the move popover when a row is selected', async ({ page }) => {
        await load(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.keyboardNavigation?.currentIndex), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(0);

        await page.keyboard.press('Shift+M');
        await expect(page.locator('#move-popover')).toBeVisible();
        expect(await view(page)).toBe('bookmarks');
    });

    test('Shift+M does nothing at all with nothing selected', async ({ page }) => {
        await load(page);
        await clearSelection(page);

        await page.keyboard.press('Shift+M');
        await page.waitForTimeout(400);
        await expect(page.locator('#move-popover')).toHaveCount(0);
        // And it did not take a view with it either.
        expect(await view(page)).toBe('bookmarks');
    });
});
