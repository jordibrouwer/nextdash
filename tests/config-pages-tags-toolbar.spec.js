// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Pages & tags lists carry the same search / sort / Add strip the Bookmarks
 * list does, above the list rather than under the keyboard legend.
 *
 * The ordering rule is the interesting part: for categories and pages the row
 * order *is* the dashboard's order, so sorting here is a way of looking at the
 * list and never a way of changing it — the move buttons come off the rows
 * while a sort or search is on, and nothing is written.
 */
async function openPagesTags(page, tab) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
    await page.locator(`[data-pt-tab="${tab}"]`).click();
    await expect(page.locator(`[data-pt-search="${tab}"]`)).toBeVisible();
}

test.describe('config pages & tags — list toolbar', () => {
    test('the Add button sits in the toolbar above the list, not below the legend', async ({ page }) => {
        await openPagesTags(page, 'pages');

        const addBtn = page.locator('[data-page-add]');
        await expect(addBtn).toBeVisible();
        // In the toolbar, and the toolbar is above the list.
        await expect(page.locator('.config-crud-toolbar [data-page-add]')).toHaveCount(1);

        const order = await page.evaluate(() => {
            const body = document.getElementById('config-pt-body');
            const toolbar = body.querySelector('.config-crud-toolbar');
            const list = body.querySelector('.config-crud-list');
            // 4 === DOCUMENT_POSITION_FOLLOWING: the list comes after the toolbar.
            return toolbar.compareDocumentPosition(list) & 4 ? 'toolbar-first' : 'list-first';
        });
        expect(order).toBe('toolbar-first');
    });

    test('searching filters the rows and reports how many are shown', async ({ page }) => {
        // The seeded install can have a single page, which nothing can filter
        // down to fewer of. Two more, named distinctly, give the search
        // something to exclude.
        await page.route('**/api/pages', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const res = await route.fetch();
            const pages = await res.json();
            const extra = [
                { id: 9001, name: 'Zebra', icon: '🦓', color: '#888888' },
                { id: 9002, name: 'Quokka', icon: '🦘', color: '#888888' },
            ];
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([...(Array.isArray(pages) ? pages : []), ...extra]),
            });
        });
        await openPagesTags(page, 'pages');
        const before = await page.locator('.config-crud-list .config-crud-row').count();
        expect(before).toBeGreaterThan(1);

        await page.locator('[data-pt-search="pages"]').fill('Zebra');

        await expect.poll(() => page.locator('.config-crud-list .config-crud-row').count())
            .toBe(1);
        await expect(page.locator('.config-pt-count')).toBeVisible();
        // Searching hides the arrows for the same reason sorting does.
        await expect(page.locator('.config-pt-view-only')).toBeVisible();
    });

    // The whole point of the view-only rule: a sorted list must not let you
    // reorder, because the arrows swap by stored position and the list on
    // screen is no longer in that order.
    test('sorting is view-only — the move buttons go away and nothing is saved', async ({ page }) => {
        await openPagesTags(page, 'pages');
        await expect(page.locator('[data-page-move]').first()).toBeVisible();

        let wrote = false;
        await page.route('**/api/pages', async (route) => {
            if (route.request().method() === 'POST') wrote = true;
            await route.fallback();
        });

        const storedBefore = await page.evaluate(() =>
            window.dashboardInstance.pages.map((p) => p.name));

        await page.locator('[data-pt-sort="pages"]').selectOption('name');

        // Arrows gone, notice shown, stored order untouched.
        await expect(page.locator('[data-page-move]')).toHaveCount(0);
        await expect(page.locator('.config-pt-view-only')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.pages.map((p) => p.name)))
            .toEqual(storedBefore);
        expect(wrote).toBe(false);

        // Clearing the sort brings reordering back.
        await page.locator('[data-pt-sort="pages"]').selectOption('manual');
        await expect(page.locator('[data-page-move]').first()).toBeVisible();
        await expect(page.locator('.config-pt-view-only')).toHaveCount(0);
    });

    test('the sorted view really is sorted', async ({ page }) => {
        await openPagesTags(page, 'pages');
        await page.locator('[data-pt-sort="pages"]').selectOption('name');

        const shown = await page.locator('[data-page="name"]').evaluateAll(
            (els) => els.map((el) => el.value));
        const sorted = [...shown].sort((a, b) => a.localeCompare(b));
        expect(shown).toEqual(sorted);
    });

    test('categories get the same toolbar, with the page picker kept', async ({ page }) => {
        await openPagesTags(page, 'categories');
        await expect(page.locator('.config-crud-toolbar [data-cat-add]')).toHaveCount(1);
        await expect(page.locator('.config-crud-toolbar [data-cat-page]')).toHaveCount(1);
        await expect(page.locator('[data-pt-sort="categories"]')).toBeVisible();
    });
});
