const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Shift+letter is one family: every key in it acts on the row under the cursor,
 * and does nothing when there is no row.
 *
 * Shift+S used to be the exception — share with a row selected, config without
 * one — which is why the row actions live in a capture-phase handler that
 * declines the key rather than swallowing it. Share has moved to Shift+L, so
 * Shift+S now means config wherever you press it, and the decline-rather-than-
 * swallow rule is what keeps the family from eating keys it has no use for.
 */

async function load(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
}

const view = (page) => page.evaluate(() => window.dashboardInstance.activeView);

const clearSelection = (page) => page.evaluate(() =>
    window.dashboardInstance.keyboardNavigation?.clearSelection?.({ restoreFocus: false }));

async function selectFirstRow(page) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.keyboardNavigation?.currentIndex), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(0);
}

test.describe('Shift+S opens config, whatever is selected', () => {
    test('with no bookmark selected', async ({ page }) => {
        await load(page);
        await clearSelection(page);

        await page.keyboard.press('Shift+S');
        await expect.poll(() => view(page), { timeout: 10_000 }).toBe('config');
    });

    test('with a bookmark selected — it no longer shares instead', async ({ page }) => {
        await load(page);
        await selectFirstRow(page);
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
        await expect.poll(() => view(page), { timeout: 10_000 }).toBe('config');
        expect(await page.evaluate(() => window.__shared)).toBe(false);
    });
});

test.describe('Shift+L shares the focused row', () => {
    test('shares when a row is selected, and stays on the dashboard', async ({ page }) => {
        await load(page);
        await selectFirstRow(page);

        await page.evaluate(() => {
            window.__shared = false;
            const cm = window.dashboardInstance.contextMenu;
            const real = cm.shareBookmark?.bind(cm);
            cm.shareBookmark = (...args) => {
                window.__shared = true;
                return real ? real(...args) : undefined;
            };
        });

        await page.keyboard.press('Shift+L');
        await expect.poll(() => page.evaluate(() => window.__shared), { timeout: 5000 }).toBe(true);
        expect(await view(page)).toBe('bookmarks');
    });

    test('does nothing with nothing selected', async ({ page }) => {
        await load(page);
        await clearSelection(page);

        await page.evaluate(() => {
            window.__shared = false;
            const cm = window.dashboardInstance.contextMenu;
            cm.shareBookmark = () => { window.__shared = true; };
        });

        await page.keyboard.press('Shift+L');
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.__shared)).toBe(false);
        expect(await view(page)).toBe('bookmarks');
    });
});

test.describe('the rest of the family', () => {
    // Checked by what they do rather than by watching propagation: an earlier
    // attempt asserted that the event reached a probe listener, which turned out
    // to measure listener registration order — the move popover opened and the
    // probe fired anyway.
    test('Shift+M opens the move popover when a row is selected', async ({ page }) => {
        await load(page);
        await selectFirstRow(page);

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

    test('Shift+E opens the inline editor on the focused row', async ({ page }) => {
        await load(page);
        await selectFirstRow(page);

        await page.keyboard.press('Shift+E');
        await expect(page.locator('.bookmark-inline-input').first()).toBeVisible({ timeout: 5000 });
    });

    test('; still opens it, for anyone who learned that key first', async ({ page }) => {
        await load(page);
        await selectFirstRow(page);

        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-input').first()).toBeVisible({ timeout: 5000 });
    });
});
