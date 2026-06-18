// @ts-check
const { test, expect } = require('@playwright/test');

async function gotoHealth(page) {
    await page.goto('/health');
    await page.waitForSelector('#health-issues .health-row, #health-issues .health-empty', { timeout: 15_000 });
}

test.describe('health redirect detect', () => {
    test('detect redirect uses redirectOnly and keeps UI responsive', async ({ page }) => {
        let suggestCalls = 0;

        await page.route('**/api/bookmark-health', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    score: 50,
                    summary: { brokenCount: 1, healthyCount: 0 },
                    issues: [{
                        pageId: 1,
                        index: 0,
                        pageName: 'Page 1',
                        name: 'Example',
                        url: 'https://example.com/old',
                        category: 'test',
                        status: 'broken',
                        reasons: ['HTTP 404'],
                        score: 10
                    }],
                    duplicateGroups: []
                })
            });
        });

        await page.route('**/api/health/auto-heal-suggest**', async (route) => {
            suggestCalls += 1;
            const url = new URL(route.request().url());
            expect(url.searchParams.get('redirectOnly')).toBe('1');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    pageId: 1,
                    index: 0,
                    currentUrl: 'https://example.com/old',
                    redirectUrl: 'https://example.com/new',
                    archiveUrl: 'https://web.archive.org/web/*/https://example.com/old',
                    suggestedTitle: ''
                })
            });
        });

        await page.route('**/api/health/auto-heal-apply', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ appliedUrl: true, appliedTitle: false, url: 'https://example.com/new' })
            });
        });

        await gotoHealth(page);

        const hasRow = await page.locator('#health-issues .health-row').count();
        test.skip(hasRow === 0, 'needs at least one health row');

        await page.evaluate(() => {
            window.AppModal = {
                confirm: async () => false
            };
        });

        await page.locator('#health-issues .health-actions-more-btn').first().click();
        const redirectItem = page.locator('[data-heal-redirect-page]').first();
        await expect(redirectItem).toBeVisible({ timeout: 3000 });

        await redirectItem.click();

        await expect.poll(() => suggestCalls).toBe(1);

        await expect.poll(async () => (
            page.evaluate(() => document.body.classList.contains('health-action-busy'))
        ), { timeout: 10_000 }).toBe(false);

        const status = page.locator('#health-bulk-status');
        await expect(status).toBeVisible({ timeout: 5000 });
        await expect(status).toContainText('example.com/new');
    });

    test('health runtime blocks concurrent actions', async ({ page }) => {
        await gotoHealth(page);
        const ok = await page.evaluate(async () => {
            if (!window.HealthRuntime) return false;
            const runtime = window.HealthRuntime.create({
                getReport: () => ({}),
                setReport: () => {},
                fetchReport: async () => ({}),
                onRender: () => {},
                onBusyChange: () => {},
                onStatus: () => {}
            });
            const first = runtime.runAction('a', async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                return 'done';
            });
            const second = runtime.runAction('b', async () => 'blocked');
            const outcomes = await Promise.all([first, second]);
            return outcomes[0].ok === true && outcomes[1].ok === false && outcomes[1].reason === 'busy';
        });
        expect(ok).toBe(true);
    });
});
