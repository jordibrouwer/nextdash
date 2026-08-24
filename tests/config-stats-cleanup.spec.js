// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openStatsContent(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.locator('[data-stats-tab="content"]').click();
}

test.describe('category effectiveness and concentration', () => {
    test('shows opens per bookmark per category, sorted by the ratio', async ({ page }) => {
        await openStatsContent(page);
        const panel = page.locator('.config-panel', { hasText: /Opens per bookmark/i }).first();
        await expect(panel).toBeVisible();

        // The ratio is what the panel is for; a raw count would just restate size.
        const values = await panel.locator('.config-dist-count').allTextContents();
        expect(values.length).toBeGreaterThan(0);
        const nums = values.map((v) => Number(v));
        expect(nums.every((n) => Number.isFinite(n))).toBe(true);
        const sorted = [...nums].sort((a, b) => b - a);
        expect(nums).toEqual(sorted);
    });

    test('the ratio divides opens by category size', async ({ page }) => {
        await openStatsContent(page);
        const computed = await page.evaluate(() => {
            const s = window.dashboardInstance.config.computeStats();
            return s.categoryEffectiveness.map((c) => ({
                label: c.label, count: c.count, opens: c.opens, per: c.perBookmark,
            }));
        });
        expect(computed.length).toBeGreaterThan(0);
        for (const c of computed) {
            expect(c.per).toBeCloseTo(c.opens / c.count, 5);
        }
    });

    test('concentration reports the share held by the busiest bookmarks', async ({ page }) => {
        await openStatsContent(page);
        await page.evaluate(() => {
            window.dashboardInstance.allBookmarks.slice(0, 3).forEach((bm) => {
                bm.openCount = 10;
                bm.lastOpened = Date.now();
            });
            window.dashboardInstance.config.render();
        });
        const c = await page.evaluate(() => window.dashboardInstance.config.computeStats().concentration);
        expect(c.share).toBeGreaterThanOrEqual(0);
        expect(c.share).toBeLessThanOrEqual(100);
        expect(c.topOpens).toBeLessThanOrEqual(c.totalOpens);

        const panel = page.locator('.config-panel', { hasText: /Where your usage sits/i }).first();
        await expect(panel).toBeVisible();
        await expect(panel).toContainText(`${c.share}%`);
        // Every placeholder substituted.
        await expect(panel).not.toContainText('{');
    });
});

test.describe('cleanup candidates', () => {
    test('lists only rows with something to fix', async ({ page }) => {
        await openStatsContent(page);
        const panel = page.locator('.config-panel', { hasText: /Cleanup candidates/i }).first();
        await expect(panel).toBeVisible();
        const counts = await panel.locator('.config-stat-penalty').allTextContents();
        // A zero row would be a scoreboard entry, not a to-do.
        expect(counts.every((c) => Number(c) > 0)).toBe(true);
    });

    test('Show opens the bookmarks list filtered to those rows', async ({ page }) => {
        await openStatsContent(page);
        const btn = page.locator('[data-cleanup-goto="untagged"]');
        test.skip(!(await btn.count()), 'no untagged bookmarks in this dataset');

        const expected = await page.evaluate(() =>
            window.dashboardInstance.allBookmarks.filter((b) => !(b.tags && b.tags.length)).length);
        await btn.click();

        await expect(page.locator('#config-bm-list')).toBeVisible();
        await expect(page.locator('.config-cleanup-banner')).toContainText(/Without tags/i);
        await expect(page.locator('.config-bm-row')).toHaveCount(expected);
    });

    test('the count in Statistics matches the rows the filter shows', async ({ page }) => {
        await openStatsContent(page);
        const btn = page.locator('[data-cleanup-goto="untagged"]');
        test.skip(!(await btn.count()), 'no untagged bookmarks in this dataset');
        const shown = Number((await btn.locator('xpath=../span[@class="config-stat-penalty"]').textContent()) || 0);

        await btn.click();
        await expect(page.locator('.config-bm-row')).toHaveCount(shown);
    });

    test('clearing the filter restores the full list', async ({ page }) => {
        await openStatsContent(page);
        const btn = page.locator('[data-cleanup-goto="untagged"]');
        test.skip(!(await btn.count()), 'no untagged bookmarks in this dataset');
        await btn.click();
        await expect(page.locator('.config-cleanup-banner')).toBeVisible();

        const total = await page.evaluate(() => window.dashboardInstance.allBookmarks.length);
        await page.locator('[data-cleanup-clear]').click();
        await expect(page.locator('.config-cleanup-banner')).toHaveCount(0);
        await expect(page.locator('.config-bm-row')).toHaveCount(total);
    });

    test('arriving from Statistics drops any earlier search', async ({ page }) => {
        await openStatsContent(page);
        // A leftover query would silently narrow the handed-over list.
        await page.evaluate(() => { window.dashboardInstance.config.bmQuery = 'zzz-no-match'; });
        const btn = page.locator('[data-cleanup-goto="untagged"]');
        test.skip(!(await btn.count()), 'no untagged bookmarks in this dataset');
        await btn.click();

        await expect(page.locator('#config-bm-search')).toHaveValue('');
        const shown = await page.locator('.config-bm-row').count();
        expect(shown).toBeGreaterThan(0);
    });
});
