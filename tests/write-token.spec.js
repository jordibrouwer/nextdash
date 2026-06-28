// @ts-check
const { test, expect } = require('@playwright/test');
const { WRITE_TOKEN } = require('./e2e-helpers');

test.describe('NEXTDASH_WRITE_TOKEN', () => {
    test('dashboard exposes write token meta when configured', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('meta[name="nextdash-write-token"]')).toHaveAttribute('content', WRITE_TOKEN);
    });

    test('POST /api/settings without token is rejected', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });

        const status = await page.evaluate(async () => {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            return response.status;
        });

        expect(status).toBe(401);
    });

    test('POST /api/settings via nextDashFetch succeeds', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });

        const status = await page.evaluate(async () => {
            const get = await fetch('/api/settings');
            if (!get.ok) {
                return get.status;
            }
            const settings = await get.json();
            const response = await nextDashFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            return response.status;
        });

        expect(status).toBe(200);
    });
});
