// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

function largeReport(count) {
    const issues = Array.from({ length: count }, (_, i) => ({
        pageId: 1,
        index: i,
        pageName: 'dev',
        name: `Issue ${i + 1}`,
        url: `https://example.com/item-${i}`,
        category: 'tools',
        status: i % 3 === 0 ? 'broken' : 'healthy',
        score: i % 3 === 0 ? 20 : 95,
        duplicateCount: 0,
        lastChecked: Date.now(),
        reasons: i % 3 === 0 ? ['HTTP 500'] : [],
        reasonDetails: i % 3 === 0 ? [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }] : [],
    }));
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: count,
            healthyCount: issues.filter((i) => i.status === 'healthy').length,
            brokenCount: issues.filter((i) => i.status === 'broken').length,
            duplicateCount: 0,
            uncheckedCount: 0,
        },
        issues,
        duplicateGroups: [],
    };
}

async function openHealthWithReport(page, count) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(largeReport(count)),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-feed', { timeout: 15_000 });
}

test.describe('health feed paging', () => {
    test('uses the page scroll without a nested feed scrollbar', async ({ page }) => {
        await openHealthWithReport(page, 120);

        await expect(page.locator('.health-view-feed--virtual')).toHaveCount(0);
        const feedOverflow = await page.locator('.health-view-feed').evaluate((el) => getComputedStyle(el).overflowY);
        expect(feedOverflow).toBe('visible');

        // Default filter is "broken" (~⅓ of issues); paging caps at 50 visible rows.
        const mounted = await page.locator('.health-view-item').count();
        expect(mounted).toBeLessThanOrEqual(50);
        expect(mounted).toBeGreaterThan(0);

        await page.evaluate(() => {
            window.dashboardInstance.health.filter = 'all';
            window.dashboardInstance.health._resetFeedPaging();
            window.dashboardInstance.health.render();
        });
        await expect(page.locator('.health-view-item')).toHaveCount(50);
    });

    test('loads more rows when scrolling the page', async ({ page }) => {
        await openHealthWithReport(page, 120);

        await page.evaluate(() => {
            window.dashboardInstance.health.filter = 'all';
            window.dashboardInstance.health._resetFeedPaging();
            window.dashboardInstance.health.render();
        });
        await page.waitForSelector('.health-view-load-sentinel');

        await page.evaluate(() => {
            const sentinel = document.querySelector('.health-view-load-sentinel');
            sentinel?.scrollIntoView({ block: 'end' });
        });

        await expect.poll(() => page.locator('.health-view-item').count(), { timeout: 10_000 })
            .toBeGreaterThan(50);
    });

    test('Shift+G selects the last filtered row', async ({ page }) => {
        await openHealthWithReport(page, 80);

        await page.evaluate(() => {
            window.dashboardInstance.health.filter = 'all';
            window.dashboardInstance.health._resetFeedPaging();
            window.dashboardInstance.health.render();
        });
        await page.locator('#dashboard-layout.health-layout').focus();
        await page.keyboard.press('Shift+G');

        await expect.poll(() => page.evaluate(() => {
            const health = window.dashboardInstance.health;
            const filtered = health.getFilteredIssues();
            const lastKey = health.issueKey(filtered[filtered.length - 1]);
            return health.selectedKey === lastKey && health.visibleLimit >= filtered.length;
        }), { timeout: 10_000 }).toBe(true);
    });
});
