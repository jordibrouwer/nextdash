// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The header's tag-filter chip never showed anything.
 *
 * #tag-filter-indicator sits in the header with a full set of styles behind it,
 * but updateTagFilterIndicator had been reduced to a teardown that emptied the
 * element and hid it on every call. The in-grid banner covers the grid itself,
 * and lives inside #dashboard-layout — so the moment another view took the
 * screen, an active tag filter had no visible trace at all.
 *
 * The chip is deliberately hidden while that banner is on screen: two copies of
 * the same chips, one above the other, is worse than one.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** A tag that is actually on a bookmark, so the count is real. */
async function pickTag(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const pool = [...(d.bookmarks || []), ...(d.allBookmarks || [])];
        for (const bookmark of pool) {
            const tag = (bookmark?.tags || [])[0];
            if (tag) return String(tag);
        }
        return '';
    });
}

const applyFilter = (page, tag) => page.evaluate((t) => {
    const d = window.dashboardInstance;
    d._tagFilters = [t];
    d.renderDashboard();
}, tag);

const indicator = (page) => page.locator('#tag-filter-indicator');

test.describe('the header tag-filter chip', () => {
    test('stays hidden while the grid shows its own banner', async ({ page }) => {
        await openDashboard(page);
        const tag = await pickTag(page);
        test.skip(!tag, 'fixture has no tagged bookmarks');

        await applyFilter(page, tag);
        await expect(page.locator('#tag-filter-banner')).toHaveCount(1);
        await expect(indicator(page)).toBeHidden();
    });

    test('appears in a view that has no banner, naming the tag and the count', async ({ page }) => {
        await openDashboard(page);
        const tag = await pickTag(page);
        test.skip(!tag, 'fixture has no tagged bookmarks');

        await applyFilter(page, tag);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForFunction(
            () => window.dashboardInstance.activeView === 'config', null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.updateTagFilterIndicator());

        await expect(indicator(page)).toBeVisible();
        await expect(indicator(page).locator('.tag-filter-indicator-tag')).toHaveText(tag);
        // The count of matches, which is what makes the chip worth showing.
        await expect(indicator(page).locator('.tag-filter-indicator-summary')).not.toBeEmpty();
    });

    test('carries the chips but not a second copy of the bulk toolbar', async ({ page }) => {
        await openDashboard(page);
        const tag = await pickTag(page);
        test.skip(!tag, 'fixture has no tagged bookmarks');

        await applyFilter(page, tag);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForFunction(
            () => window.dashboardInstance.activeView === 'config', null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.updateTagFilterIndicator());

        await expect(indicator(page).locator('.tag-filter-bulk-toolbar')).toHaveCount(0);
        await expect(indicator(page).locator('.tag-filter-indicator-chip')).toHaveCount(1);
    });

    test('clearing the filter empties it again', async ({ page }) => {
        await openDashboard(page);
        const tag = await pickTag(page);
        test.skip(!tag, 'fixture has no tagged bookmarks');

        await applyFilter(page, tag);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForFunction(
            () => window.dashboardInstance.activeView === 'config', null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.updateTagFilterIndicator());
        await expect(indicator(page)).toBeVisible();

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d._tagFilters = [];
            d.updateTagFilterIndicator();
        });

        await expect(indicator(page)).toBeHidden();
        await expect(indicator(page).locator('.tag-filter-indicator-chip')).toHaveCount(0);
    });
});
