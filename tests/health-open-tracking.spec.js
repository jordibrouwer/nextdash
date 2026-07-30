// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Opening a bookmark from the health view records the open.
 *
 * The report is mocked so the rows are predictable rather than whatever the
 * seeded bookmarks happen to score.
 */
function report(now = Date.now()) {
    const mk = (i, name, lastOpened) => ({
        pageId: 1, index: i, pageName: 'dev', name, url: `https://example.com/${i}`,
        category: 'tools', status: 'broken', score: 40, duplicateCount: 0,
        lastChecked: now - 3600e3, reasons: ['HTTP 500'],
        reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
        ...(lastOpened === null ? {} : { lastOpened, openCount: 3 }),
    });
    return {
        generatedAt: now,
        summary: { totalBookmarks: 5, healthyCount: 0, brokenCount: 5, duplicateCount: 0, uncheckedCount: 0 },
        issues: [
            mk(0, 'Never', null),
            mk(1, 'Seconds', now - 20e3),
            mk(2, 'Hours', now - 4 * 3600e3),
            mk(3, 'Last week', now - 9 * 86400e3),
            mk(4, 'Last year', now - 400 * 86400e3),
        ],
    };
}

async function openHealth(page) {
    // window.open is stubbed before load: a real popup is blocked in the harness
    // and the Open click would hang waiting for a tab that never appears.
    await page.addInitScript(() => {
        window.__opened = [];
        window.open = (url) => { window.__opened.push(url); return null; };
    });
    await page.route('**/api/bookmark-health**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report()) }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

test.describe('health view — opening a row', () => {
    // The bug: opening from health called window.open and nothing else, so the
    // bookmark stayed on openCount 0 forever and the Stale filter and the score
    // went on treating a link you actually use as never opened.
    test('opening a row records the open', async ({ page }) => {
        await openHealth(page);

        let posted = null;
        await page.route('**/api/track-open', async (route) => {
            posted = route.request().postData();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
        });

        const row = page.locator('.health-view-item').first();
        await row.click();
        await page.waitForTimeout(300);
        await row.locator('[data-health-action="open"]').click({ force: true });

        await expect.poll(() => page.evaluate(() => window.__opened.length)).toBeGreaterThan(0);
        await expect.poll(() => posted).not.toBeNull();
        expect(JSON.parse(posted)).toHaveProperty('pageId');
        expect(JSON.parse(posted)).toHaveProperty('index');
    });

    // Re-scoring on click would let a row leave the filtered list you are working
    // through the moment you opened it, shifting the list under your hands.
    test('opening a row does not re-rank the list', async ({ page }) => {
        await openHealth(page);
        await page.route('**/api/track-open', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));

        const order = () => page.evaluate(() =>
            [...document.querySelectorAll('.health-view-item-title')].map((el) => el.textContent.trim()));
        const before = await order();

        const row = page.locator('.health-view-item').first();
        await row.click();
        await page.waitForTimeout(300);
        await row.locator('[data-health-action="open"]').click({ force: true });
        await page.waitForTimeout(700);

        expect(await order()).toEqual(before);
    });
});
