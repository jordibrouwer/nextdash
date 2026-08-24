// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The settings in Config → Bookmarks sat behind the list.
 *
 * Fifty rows by default and up to five hundred as the infinite scroll loads
 * more — which also meant you could not reach them by jumping to the bottom,
 * because the bottom moved as you approached it. They are on a sub-tab now, the
 * same strip Behavior, Pages & tags, Appearance, Stats, Data & backups and Help
 * already use.
 *
 * Registering the section in SUB_TABS / SUB_TAB_STATE / SUB_TAB_ATTR /
 * SUB_TAB_SECTION is what gives it the deep link, the remembered location and
 * the arrow-key walk for free — so those are tested here too, since a missing
 * registration is silent.
 */

async function openBookmarks(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.waitForSelector('[data-bm-tab]', { timeout: 15_000 });
}

const activeTab = (page) => page.evaluate(
    () => document.querySelector('[data-bm-tab].is-active')?.getAttribute('data-bm-tab') || null);

test.describe('Config → Bookmarks has a sub-tab strip', () => {
    test('it opens on the list, with the settings one click away', async ({ page }) => {
        await openBookmarks(page);

        await expect(page.locator('[data-bm-tab]')).toHaveCount(2);
        expect(await activeTab(page)).toBe('list');
        await expect(page.locator('#config-bm-list')).toBeVisible();
        // The settings are not merely scrolled out of sight — they are not in
        // the document at all until their tab is open.
        await expect(page.locator('#config-bm-body .config-panel-title')).toHaveCount(0);
    });

    test('the settings tab holds the settings, and drops the list', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="settings"]').click();

        expect(await activeTab(page)).toBe('settings');
        await expect(page.locator('#config-bm-list')).toHaveCount(0);
        // Every setting that used to sit under the list is reachable here.
        const controls = await page.evaluate(() => document.querySelectorAll(
            '#config-bm-body input, #config-bm-body select, #config-bm-body textarea').length);
        expect(controls).toBeGreaterThanOrEqual(8);
    });

    test('the list still works after coming back to it', async ({ page }) => {
        await openBookmarks(page);
        const rowsBefore = await page.locator('.config-bm-row').count();
        expect(rowsBefore).toBeGreaterThan(0);

        await page.locator('[data-bm-tab="settings"]').click();
        await expect(page.locator('#config-bm-list')).toHaveCount(0);
        await page.locator('[data-bm-tab="list"]').click();

        await expect(page.locator('.config-bm-row')).toHaveCount(rowsBefore);
        // Rebound, not just redrawn: the search box drives the list.
        await page.locator('#config-bm-search').fill('zzzz-no-such-bookmark');
        await expect.poll(() => page.locator('.config-bm-row').count(), { timeout: 5000 }).toBe(0);
        await page.locator('#config-bm-search').fill('');
        await expect.poll(() => page.locator('.config-bm-row').count(), { timeout: 5000 }).toBe(rowsBefore);
    });

    test('the tab is a place you can link to', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="settings"]').click();

        expect(await page.evaluate(() => location.hash)).toBe('#config/bookmarks/settings');
    });

    test('leaving and coming back returns to the tab you were on', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="settings"]').click();
        expect(await activeTab(page)).toBe('settings');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(300);
        // Wiped in memory first: closeConfigView leaves bmTab on the instance, so
        // without this the assertion below passes whether or not the location was
        // ever stored — the same vacuum that made four config-dashboard-view
        // tests unable to fail.
        await page.evaluate(() => { window.dashboardInstance.config.bmTab = 'list'; });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await page.waitForSelector('[data-bm-tab]', { timeout: 15_000 });

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('bookmarks');
        expect(await activeTab(page)).toBe('settings');
    });

    test('the arrow keys walk the strip', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="settings"]').focus();
        await page.keyboard.press('ArrowLeft');

        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('list');
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('settings');
    });
});
