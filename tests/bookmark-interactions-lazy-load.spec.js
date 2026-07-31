// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Inline edit and the bookmark context menu load together on first long-press or
 * right-click (dashboard-bookmark-interactions-loader.js).
 */
async function waitReady(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

function tracksInteractionScripts(page) {
    /** @type {string[]} */
    const requested = [];
    page.on('request', (req) => {
        const url = req.url();
        if (url.includes('dashboard-inline-edit.js') || url.includes('dashboard-context-menu.js')) {
            requested.push(url);
        }
    });
    return requested;
}

test.describe('bookmark interactions lazy load', () => {
    test('interaction modules are not fetched on a plain dashboard load', async ({ page }) => {
        const requested = tracksInteractionScripts(page);

        await page.goto('/');
        await waitReady(page);

        expect(requested).toEqual([]);
        expect(await page.evaluate(() => typeof window.DashboardInlineEdit)).toBe('undefined');
        expect(await page.evaluate(() => typeof window.DashboardContextMenu)).toBe('undefined');
        expect(await page.evaluate(() => Boolean(window.dashboardInstance.inlineEdit))).toBe(true);
        expect(await page.evaluate(() => Boolean(window.dashboardInstance.contextMenu))).toBe(true);
    });

    test('right-click fetches both modules once and opens the menu', async ({ page }) => {
        const requested = tracksInteractionScripts(page);

        await page.goto('/');
        await waitReady(page);

        const row = page.locator('.bookmark-link').first();
        await row.click({ button: 'right' });

        await page.waitForSelector('#bookmark-context-menu', { timeout: 15_000 });
        expect(await page.evaluate(() => typeof window.DashboardInlineEdit)).toBe('function');
        expect(await page.evaluate(() => typeof window.DashboardContextMenu)).toBe('function');
        expect(requested.filter((url) => url.includes('dashboard-inline-edit.js'))).toHaveLength(1);
        expect(requested.filter((url) => url.includes('dashboard-context-menu.js'))).toHaveLength(1);

        await page.keyboard.press('Escape');
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        expect(requested.filter((url) => url.includes('dashboard-inline-edit.js'))).toHaveLength(1);
        expect(requested.filter((url) => url.includes('dashboard-context-menu.js'))).toHaveLength(1);
    });

    test('keyboard edit loads the inline editor', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        await prepareDashboardInteraction(page);
        await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.updateNavigableElements?.();
            kn.currentIndex = 0;
            kn.highlightCurrentElement?.({ keyboardNav: true });
        });
        await page.keyboard.press(';');

        await expect(page.locator('.bookmark-inline-editing')).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => typeof window.DashboardInlineEdit)).toBe('function');
    });
});
