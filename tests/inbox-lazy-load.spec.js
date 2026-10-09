// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The inbox is always on, so its module loads during bootstrap and badges
 * work from the start (dashboard-inbox-loader.js).
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
    test('the inbox module loads during bootstrap', async ({ page }) => {
        const requested = tracksInboxScripts(page);

        await page.goto('/');
        await waitReady(page);
        await page.waitForFunction(
            () => typeof DashboardInbox === 'function'
                && Array.isArray(window.dashboardInstance.inbox.instance?.items),
            null,
            { timeout: 15_000 }
        );

        expect(requested.some((url) => url.includes('dashboard-inbox.js'))).toBe(true);
        expect(requested.some((url) => url.includes('dashboard-inbox-triage.js'))).toBe(true);
    });

    test('opening inbox renders the view after bootstrap', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        await page.waitForFunction(
            () => typeof DashboardInbox === 'function',
            null,
            { timeout: 15_000 }
        );
        await page.evaluate(async () => {
            await window.dashboardInstance.inbox.openInboxView();
        });
        await expect(page.locator('.inbox-layout')).toBeVisible();
    });
});
