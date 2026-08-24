// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Stats draws itself from a file that arrives when that section is
 * opened: 32 methods and 77 KB that every other section used to carry.
 *
 * What has to stay true: nothing loads it before it is needed, opening Stats
 * loads it and fills the section in, and every tab renders — the split is only
 * safe if none of the methods left behind calls into it unguarded.
 */

async function config(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForSelector('.config-view-body', { timeout: 20_000 });
    await page.waitForTimeout(600);
}

test.describe('the statistics renderers arrive with the section', () => {
    test('not before it, and every tab draws once they are here', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));

        await config(page, 'overview');
        expect(await page.evaluate(() => Boolean(window.DashboardConfigStatsReady))).toBe(false);
        expect(await page.evaluate(() => performance.getEntriesByType('resource')
            .some((r) => r.name.includes('dashboard-config-stats')))).toBe(false);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
        await expect.poll(() => page.evaluate(() => Boolean(window.DashboardConfigStatsReady)),
            { timeout: 10_000 }).toBe(true);
        // Filled in by itself: the section repaints when the renderers land
        // rather than waiting for the next click.
        await expect.poll(() => page.evaluate(() => document.querySelectorAll(
            '#config-stats-body .config-panel, #config-stats-body .config-tiles').length),
        { timeout: 10_000 }).toBeGreaterThan(0);

        for (const tab of ['overview', 'activity', 'content', 'inbox', 'health']) {
            await page.evaluate((t) => {
                const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
                c.statsTab = t;
                c.repaintStatsBody();
            }, tab);
            await page.waitForTimeout(300);
        }
        expect(errors).toEqual([]);
    });
});
