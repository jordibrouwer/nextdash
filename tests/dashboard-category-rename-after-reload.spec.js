// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * The header keeps the category object it was drawn with. A reload of the same
 * page (the revision poll on focus does one) replaces d.categories while the
 * incremental render keeps the header, so a rename afterwards changed an object
 * nothing saved: the new name showed, and the old one came back.
 */
test('a rename after a same-page reload is saved', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    const id = await page.locator('.category:not([data-smart-collection="true"]):not([data-widget-id])[data-category-id]:not([data-category-id=""])')
        .first().getAttribute('data-category-id');
    expect(id).toBeTruthy();

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.loadPageBookmarks(Number(d.currentPageId), { animate: false, forceFetch: true });
    });

    const target = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
    await target.dblclick();
    const input = target.locator('.category-rename-input');
    await expect(input).toBeVisible();
    await input.fill('Renamed after reload');
    await input.press('Enter');

    await expect.poll(async () => page.evaluate(async (catId) => {
        const d = window.dashboardInstance;
        const res = await fetch(`/api/categories?page=${d.currentPageId}`);
        const list = await res.json();
        return list.find((c) => String(c.id) === String(catId))?.name;
    }, id), { timeout: 10_000 }).toBe('Renamed after reload');
});
