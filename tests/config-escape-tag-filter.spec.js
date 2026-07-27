// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One Escape must do exactly one thing.
 *
 * The tag-filter shortcut and the view-level Escape handlers both listen on
 * document. Config used to listen in the bubble phase without claiming the
 * event, so leaving config also cleared an active tag filter — a second action
 * the user never asked for, with nothing on screen explaining it. Health has
 * always claimed the key in the capture phase; these tests hold config to the
 * same behaviour and keep health honest as the reference.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

/** Apply a tag filter through the same API the tag cloud itself calls. */
async function applyTagFilter(page, tag = 'probe-tag') {
    await page.evaluate(async (t) => {
        await window.dashboardInstance.setTagFilters([t], { animate: false });
    }, tag);
    expect(await page.evaluate(() => window.dashboardInstance._tagFilters)).toEqual([tag]);
}

test.describe('escape leaves an active tag filter alone', () => {
    test('closing config keeps the tag filter', async ({ page }) => {
        await openDashboard(page);
        await applyTagFilter(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 })
            .toBe('config');

        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');

        // Escape closed the view...
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 })
            .toBe('bookmarks');
        // ...and did not also clear the filter on the way out.
        expect(await page.evaluate(() => window.dashboardInstance._tagFilters)).toEqual(['probe-tag']);
    });

    test('closing health keeps the tag filter', async ({ page }) => {
        await openDashboard(page);
        await applyTagFilter(page);
        await page.evaluate(() => window.dashboardInstance.health.openHealthView());
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 })
            .toBe('health');

        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 })
            .toBe('bookmarks');
        expect(await page.evaluate(() => window.dashboardInstance._tagFilters)).toEqual(['probe-tag']);
    });

    test('with no view open, escape still clears the tag filter', async ({ page }) => {
        // The guard must not cost the tag-filter shortcut its own job on the
        // plain dashboard, where nothing is layered on top.
        await openDashboard(page);
        await applyTagFilter(page);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');

        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance._tagFilters), { timeout: 10_000 })
            .toEqual([]);
    });
});
