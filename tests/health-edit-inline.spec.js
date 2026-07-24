// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Health Edit → dashboard inline editor must stay interactive (fields/buttons clickable).
 */
test.describe('health Edit → inline editor', () => {
    test('Edit opens an interactive inline form on the bookmark page', async ({ page }) => {
        await markWhatsNewSeen(page);

        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const issue = await page.evaluate(() => {
            const row = document.querySelector('.bookmark-link[data-bookmark-index]');
            if (!row) return null;
            return {
                pageId: Number(window.dashboardInstance?.currentPageId) || 1,
                index: Number(row.getAttribute('data-bookmark-index')),
                pageName: 'dev',
                name: row.querySelector('.bookmark-text')?.textContent?.trim() || 'x',
                url: row.getAttribute('data-bookmark-url') || 'https://example.com',
                category: row.getAttribute('data-category-id') || 'tools',
                status: 'broken',
                score: 25,
                duplicateCount: 0,
                lastChecked: Date.now(),
                reasons: ['HTTP 500'],
                reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            };
        });
        expect(issue).toBeTruthy();

        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: {
                        totalBookmarks: 1,
                        healthyCount: 0,
                        brokenCount: 1,
                        duplicateCount: 0,
                        uncheckedCount: 0,
                    },
                    issues: [issue],
                    duplicateGroups: [],
                }),
            });
        });

        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });

        const healthRow = page.locator('.health-view-item').first();
        await healthRow.hover();
        await healthRow.locator('[data-health-action="edit"]').click();

        await expect(page.locator('.bookmark-inline-editing')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/health-layout/);
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === false
        ))).toBe(true);

        // Click a field that is not auto-focused on open (name is).
        const urlInput = page.locator('.bookmark-inline-form input[type="url"]').first();
        await urlInput.click({ timeout: 3000 });
        await expect(urlInput).toBeFocused();
        await urlInput.fill('https://example.com/from-health-edit');
        await expect(urlInput).toHaveValue('https://example.com/from-health-edit');

        await page.locator('.bookmark-inline-form .bookmark-inline-action-btn', { hasText: /cancel/i }).first().click();
        await expect(page.locator('.bookmark-inline-editing')).toHaveCount(0);
    });
});
