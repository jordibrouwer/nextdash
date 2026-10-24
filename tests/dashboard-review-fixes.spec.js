// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/*
 * A new page's default category is stored as the key "dashboard.others" and
 * drawn as "Others". The page kept the drawn name in its copy, and a category
 * save sent that copy back: the key was gone after one drag, and the name
 * stayed in whatever language it was saved in.
 */
test('a category save stores the translation key, not the translated name', async ({ page }) => {
    await openDashboard(page);
    const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));

    await page.route(`**/api/categories?page=${pageId}`, async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }
        const response = await route.fetch();
        const rows = await response.json();
        rows.push({ id: 'review-others', name: 'dashboard.others' });
        await route.fulfill({ response, json: rows });
    });
    let posted = null;
    await page.route(`**/api/categories?page=${pageId}`, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        posted = route.request().postDataJSON();
        await route.fulfill({ json: { status: 'success' } });
    });

    await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id, { forceFetch: true }), pageId);
    const shown = await page.evaluate(() => window.dashboardInstance.categories.find((c) => c.id === 'review-others')?.name);
    expect(shown).not.toBe('dashboard.others');

    await page.evaluate(() => window.dashboardInstance.renderCore.saveCategoryOrder());
    expect(posted).not.toBeNull();
    const saved = posted.find((c) => c.id === 'review-others');
    expect(saved.name).toBe('dashboard.others');
    expect(saved).not.toHaveProperty('_storedName');

    // A rename is a rename: the new name is what gets stored.
    await page.evaluate(() => {
        window.dashboardInstance.categories.find((c) => c.id === 'review-others').name = 'Renamed';
        return window.dashboardInstance.renderCore.saveCategoryOrder();
    });
    expect(posted.find((c) => c.id === 'review-others').name).toBe('Renamed');
});
