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
    test('it opens on View, and the list is the Bookmarks view\'s alone', async ({ page }) => {
        await openBookmarks(page);

        // Counted against BM_TABS: the strip gained a third tab and this failed
        // for naming a number rather than for anything being wrong.
        const tabs = await page.evaluate(() =>
            window.DashboardConfig.BM_TABS.length);
        await expect(page.locator('[data-bm-tab]')).toHaveCount(tabs);
        expect(await activeTab(page)).toBe('view');
        await expect(page.locator('[data-bm-tab="list"]')).toHaveCount(0);
        await expect(page.locator('#config-bm-list')).toHaveCount(0);
    });

    test('the settings tab holds the settings, and drops the list', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="settings"]').click();

        expect(await activeTab(page)).toBe('settings');
        await expect(page.locator('#config-bm-list')).toHaveCount(0);
        // New bookmarks and bulk actions; the list's own went to View.
        const controls = await page.evaluate(() => document.querySelectorAll(
            '#config-bm-body input, #config-bm-body select, #config-bm-body textarea').length);
        expect(controls).toBeGreaterThanOrEqual(6);
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
        await page.evaluate(() => { window.dashboardInstance.config.bmTab = 'view'; });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await page.waitForSelector('[data-bm-tab]', { timeout: 15_000 });

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('bookmarks');
        expect(await activeTab(page)).toBe('settings');
    });

    test('the arrow keys walk the strip', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="settings"]').focus();
        await page.keyboard.press('ArrowLeft');

        // View · Tags · Tag suggestions · Your rules · Settings · Local copies.
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('tag-rules');
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('tag-suggestions');
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('tags');
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('view');
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('tags');
    });

    test('a reload on a sub-tab does not filter the list to a page named after it', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tab="tag-suggestions"]').click();
        await expect.poll(() => activeTab(page), { timeout: 5000 }).toBe('tag-suggestions');

        // The tab is written into the hash, and the same third segment is
        // where a page filter goes. Reading it back as a page id filtered the
        // list to a page called "tag-suggestions", which no collection has.
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('[data-bm-tab]', { timeout: 15_000 });

        expect(await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            return cfg.bmPageFilter;
        })).toBeFalsy();

        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await expect(page.locator('#config-bm-list')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#config-bm-rail-facets')).not.toContainText('tag-suggestions');
    });
});
