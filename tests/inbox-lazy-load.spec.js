// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * When inboxEnabled is false the inbox module is not fetched at all; when enabled
 * it loads during bootstrap so badges still work (dashboard-inbox-loader.js).
 */
async function waitReady(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?.activeView !== undefined, null, { timeout: 5_000 });
}

function tracksInboxScripts(page) {
    /** @type {string[]} */
    const requested = [];
    page.on('request', (req) => {
        const url = req.url();
        if (url.includes('dashboard-inbox.js') || url.includes('dashboard-inbox-triage.js')) {
            requested.push(url);
        }
    });
    return requested;
}

test.describe('inbox lazy load', () => {
    test('the inbox module is not fetched when inbox is disabled', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        await page.evaluate(async () => {
            window.dashboardInstance.settings.inboxEnabled = false;
            await window.dashboardInstance.saveSettings();
        });

        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            const url = req.url();
            if (url.includes('dashboard-inbox.js') || url.includes('dashboard-inbox-triage.js')) {
                requested.push(url);
            }
        });

        await page.goto(`/?_=${Date.now()}`);
        await waitReady(page);

        expect(requested).toEqual([]);
        expect(await page.evaluate(() => typeof DashboardInbox)).toBe('undefined');
        expect(await page.evaluate(() => window.dashboardInstance.inbox.isEnabled())).toBe(false);
    });

    test('the inbox module loads during bootstrap when enabled', async ({ page }) => {
        const requested = tracksInboxScripts(page);

        await page.goto('/');
        await waitReady(page);
        await page.waitForFunction(
            () => typeof DashboardInbox === 'function' && window.dashboardInstance.inbox?.items !== undefined,
            null,
            { timeout: 15_000 }
        );

        expect(requested.some((url) => url.includes('dashboard-inbox.js'))).toBe(true);
        expect(requested.some((url) => url.includes('dashboard-inbox-triage.js'))).toBe(true);
    });

    test('opening inbox renders the view after bootstrap', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
        await expect(page.locator('.inbox-layout')).toBeVisible();
    });
});
