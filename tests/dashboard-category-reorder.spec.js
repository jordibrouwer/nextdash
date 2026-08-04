// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    dismissBlockingOverlays,
    dismissOnboardingIfPresent,
} = require('./e2e-helpers');

const realCategorySel = '#dashboard-layout .category:not([data-smart-collection="true"])';

test.describe('dashboard category drag-reorder', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await markWhatsNewSeen(page, {
            extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'],
        });
    });

    test('the "//" prefix is a drag handle on real categories only', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector(realCategorySel, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // Real categories expose a draggable "//" handle showing "// ".
        const handle = page.locator(`${realCategorySel} .category-reorder-handle`).first();
        await expect(handle).toHaveCount(1);
        await expect(handle).toHaveText('// ');
        await expect(handle).toHaveJSProperty('draggable', true);
        const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
        expect(cursor).toBe('grab');

        // Smart collections keep a plain "//" prefix that is not a handle.
        const smart = page.locator('#dashboard-layout .category[data-smart-collection="true"]');
        if (await smart.count()) {
            await expect(smart.first().locator('.category-reorder-handle')).toHaveCount(0);
        }
    });

    test('clicking the handle does not collapse the category', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector(realCategorySel, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const category = page.locator(realCategorySel).first();
        await expect(category).toHaveAttribute('data-collapsed', 'false');
        await category.locator('.category-reorder-handle').click();
        // Handle stops propagation, so collapse state must be unchanged.
        await expect(category).toHaveAttribute('data-collapsed', 'false');
    });

    test('reordering categories persists across reload', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector(realCategorySel, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // Only categories the server actually stores can be reordered. Buckets derived
        // from bookmark fields — uncategorized (groupedBookmarks[''], empty id) and rows
        // whose category no longer exists — are regenerated on every render and never
        // appear in the POST to /api/categories, so moving one can never persist.
        // They still carry a data-category-id in the DOM, so the DOM alone cannot tell
        // them apart: ask the server which ids are real.
        const storedIds = await page.evaluate(async () => {
            const res = await fetch('/api/categories?page=1');
            const body = await res.json();
            const list = Array.isArray(body) ? body : (body.categories || []);
            return list.map((c) => c.id).filter(Boolean);
        });
        const storedSel = storedIds
            .map((id) => `${realCategorySel}[data-category-id="${id}"]`)
            .join(', ');
        const readOrder = async () => (storedSel
            ? page.locator(storedSel).evaluateAll((els) => els.map((el) => el.getAttribute('data-category-id')))
            : []);

        const idsBefore = await readOrder();
        // Other specs share this server and can leave a page with fewer than two
        // rendered stored categories; there is nothing to reorder then.
        test.skip(idsBefore.length < 2, 'needs at least two stored categories rendered');

        // Move the first stored category behind the last one, then let the dashboard
        // persist the new order (same path a real drag triggers).
        await page.evaluate((selector) => {
            const grid = document.getElementById('dashboard-layout');
            const stored = [...grid.querySelectorAll(selector)];
            const first = stored[0];
            const last = stored[stored.length - 1];
            last.after(first);
            window.dashboardInstance.syncCategoriesFromDom();
        }, storedSel);

        // saveCategoryOrder debounces ~1s; wait it out.
        await page.waitForTimeout(1500);

        await page.reload();
        await page.waitForSelector(realCategorySel, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const idsAfter = await readOrder();

        // The previously-first category should no longer be first.
        expect(idsAfter[0]).not.toBe(idsBefore[0]);
        // And it should still be present (moved, not lost).
        expect(idsAfter).toContain(idsBefore[0]);
        expect(idsAfter.length).toBe(idsBefore.length);
    });
});
