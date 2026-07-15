// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * A retest ends in reloadReport(), and the page can auto-retest from ?refresh=1.
 * If the refresh param survives the run, that pair becomes a retest loop that
 * re-pings every bookmark on every load. These tests pin the counts.
 */

function brokenReport() {
    return {
        score: 40,
        summary: { brokenCount: 1, healthyCount: 0, totalBookmarks: 1 },
        issues: [{
            pageId: 1,
            index: 0,
            pageName: 'Page 1',
            name: 'Flagged',
            url: 'https://example.com/flagged',
            category: 'test',
            status: 'broken',
            reasons: ['HTTP 500'],
            score: 40
        }],
        duplicateGroups: []
    };
}

test.describe('health retest loop guards', () => {
    test('?refresh=1 retests once and does not re-arm across reloads', async ({ page }) => {
        let retestCalls = 0;
        let reportCalls = 0;

        await page.route('**/api/bookmark-health**', async (route) => {
            reportCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(brokenReport())
            });
        });

        await page.route('**/api/health/retest-all**', async (route) => {
            retestCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'completed', count: 1, results: [],
                    skipped: 0, skippedOverLimit: 0, scope: 'all'
                })
            });
        });

        await page.goto('/health?refresh=1');
        await page.waitForSelector('#health-issues .health-row, #health-issues .health-empty', { timeout: 15_000 });

        await expect.poll(() => retestCalls, { timeout: 10_000 }).toBe(1);

        // The param must not survive the run: it auto-clicks retest on load, and
        // retest ends in reloadReport().
        expect(new URL(page.url()).searchParams.get('refresh')).toBeNull();

        // Settle: a loop would keep climbing after the action finished.
        await page.waitForTimeout(2500);
        expect(retestCalls).toBe(1);

        const reportsAfterFirstRun = reportCalls;

        // A plain reload must not resurrect the retest.
        await page.reload();
        await page.waitForSelector('#health-issues .health-row, #health-issues .health-empty', { timeout: 15_000 });
        await page.waitForTimeout(1500);

        expect(retestCalls).toBe(1);
        expect(reportCalls).toBeGreaterThan(reportsAfterFirstRun);
    });

    test('retest button triggers exactly one retest and one reload', async ({ page }) => {
        let retestCalls = 0;

        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(brokenReport())
            });
        });

        await page.route('**/api/health/retest-all**', async (route) => {
            retestCalls += 1;
            const scope = new URL(route.request().url()).searchParams.get('scope');
            // The report has brokenCount > 0, so flagged rows must be included —
            // otherwise a checkStatus=false row can never be cleared from this page.
            expect(scope).toBe('all');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'completed', count: 1, results: [],
                    skipped: 0, skippedOverLimit: 0, scope: 'all'
                })
            });
        });

        await page.goto('/health');
        await page.waitForSelector('#health-issues .health-row, #health-issues .health-empty', { timeout: 15_000 });

        await page.locator('#retest-all-btn').click();

        await expect.poll(() => retestCalls, { timeout: 10_000 }).toBe(1);
        await page.waitForTimeout(2500);
        expect(retestCalls).toBe(1);
    });

    test('a run that tests nothing says so instead of reporting success', async ({ page }) => {
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    score: 100,
                    summary: { brokenCount: 0, healthyCount: 1, totalBookmarks: 1 },
                    issues: [{
                        pageId: 1, index: 0, pageName: 'Page 1', name: 'Unused',
                        url: 'https://example.com/a', category: 'test',
                        status: 'unused', reasons: ['Never opened'], score: 85
                    }],
                    duplicateGroups: []
                })
            });
        });

        await page.route('**/api/health/retest-all**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'completed', count: 0, results: [],
                    skipped: 1, skippedOverLimit: 0, scope: 'checked'
                })
            });
        });

        await page.goto('/health');
        await page.waitForSelector('#health-issues .health-row, #health-issues .health-empty', { timeout: 15_000 });

        await page.locator('#retest-all-btn').click();

        const status = page.locator('#health-bulk-status');
        await expect(status).toBeVisible({ timeout: 5000 });
        await expect(status).toContainText(/nothing to retest/i);
    });
});
