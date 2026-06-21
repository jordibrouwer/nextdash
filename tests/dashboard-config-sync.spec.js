// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('dashboard config sync reload', () => {
    test('reload with pending structure sync fetches page bookmarks once', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await page.evaluate(() => {
            sessionStorage.setItem(
                'nextdash:pending-dashboard-structure-sync',
                JSON.stringify({
                    type: 'structure-updated',
                    sourceTabId: 'cfg-test-tab',
                    timestamp: Date.now(),
                })
            );
        });

        let pageBookmarkFetches = 0;
        const onRequest = (req) => {
            const url = req.url();
            if (/\/api\/bookmarks\?page=\d+/.test(url)) {
                pageBookmarkFetches += 1;
            }
        };
        page.on('request', onRequest);

        await page.reload();
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        page.off('request', onRequest);

        expect(pageBookmarkFetches).toBeLessThanOrEqual(1);
    });

    test('reload with pending sync does not leave dashboard layout empty', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await page.evaluate(() => {
            sessionStorage.setItem(
                'nextdash:pending-dashboard-structure-sync',
                JSON.stringify({
                    type: 'tags-updated',
                    sourceTabId: 'cfg-test-tab',
                    timestamp: Date.now() + 1000,
                })
            );
        });

        await page.reload();
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await expect(page.locator('#dashboard-layout .empty-state')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();
    });
});
