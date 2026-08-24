// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Statistics counted, and left the reader to work out what followed.
 *
 * Five tabs of figures, none of which says what to do about anything. The
 * summary states the three things that do follow — where your opening lands,
 * what is going unread, what is broken — each with the button that acts on it.
 * And the tiles say which way a count moved, from the daily points the health
 * report has been recording all along.
 */

async function openStats(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.openConfigView('stats');
        c.statsTab = 'overview';
        c.render();
    });
    await page.waitForSelector('.config-tiles--overview', { timeout: 15_000 });
}

test.describe('Statistics says what its numbers mean', () => {
    test('with nothing to report, it says nothing', async ({ page }) => {
        await openStats(page);
        // The seeded library has nothing neglected, no opens and no health
        // loaded, so there is no sentence to write. A panel that says "all
        // clear" in a section about what needs doing is noise.
        await expect(page.locator('.config-stats-summary')).toHaveCount(0);
    });

    test('a broken link is stated, with the way through to it', async ({ page }) => {
        await openStats(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            // What the health tab would have loaded.
            c._statsHealth = { broken: 2, monitorDown: 1, healthy: 5, unchecked: 0 };
            c.repaintStatsBody();
            await new Promise((r) => setTimeout(r, 200));
        });

        const summary = page.locator('.config-stats-summary');
        await expect(summary).toBeVisible();
        await expect(summary).not.toContainText('config.stats');
        // Three not answering: broken plus monitors down, counted together
        // because that is what the reader has to deal with.
        await expect(summary).toContainText('3');
        await expect(summary.locator('[data-stats-action="open-health-view"]')).toBeVisible();
    });

    test('the tidy-up line lands in the bookmark list, filtered', async ({ page }) => {
        await openStats(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const stats = c.computeStats();
            // A library with neglected bookmarks, which the seeded one is not.
            const patched = { ...stats, stale90: 12 };
            c.computeStats = () => patched;
            c.repaintStatsBody();
            await new Promise((r) => setTimeout(r, 200));
        });

        const button = page.locator('.config-stats-summary [data-cleanup-goto="never"]');
        await expect(button).toBeVisible();
        await button.click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section), { timeout: 10_000 })
            .toBe('bookmarks');
        expect(await page.evaluate(() => window.dashboardInstance.config.bmCleanupFilter)).toBe('never');
    });

    test('a tile carries the direction it moved, and only when it moved', async ({ page }) => {
        await openStats(page);

        // History as the server records it: one point a week ago, three
        // bookmarks fewer than now.
        const shown = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const total = c.computeStats().total;
            c._statsTrend = [
                { t: Date.now() - 7 * 86400000, n: Math.max(0, total - 3) },
                { t: Date.now(), n: total },
            ];
            c.repaintStatsBody();
            await new Promise((r) => setTimeout(r, 200));
            const delta = document.querySelector('.config-tile-delta');
            return { text: delta ? delta.textContent.replace(/\s+/g, ' ').trim() : null, total };
        });
        expect(shown.text).toMatch(new RegExp(`\\+${Math.min(3, shown.total)}\\b`));

        // A week with no change says nothing rather than "+0", which is noise
        // dressed as information.
        const flat = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const total = c.computeStats().total;
            c._statsTrend = [
                { t: Date.now() - 7 * 86400000, n: total },
                { t: Date.now(), n: total },
            ];
            c.repaintStatsBody();
            await new Promise((r) => setTimeout(r, 200));
            return document.querySelectorAll('.config-tile-delta').length;
        });
        expect(flat).toBe(0);
    });
});
