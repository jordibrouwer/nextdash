// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Per-block visibility (dashboard-block-visibility.js): a category, widget or
 * collection shows everywhere, on desktop only, or on a phone only. Set in the
 * edit-mode panel or a block's menu; filtered when the grid is drawn; kept,
 * dimmed, in edit mode.
 */

async function load(page) {
    await markWhatsNewSeen(page);
    await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await page.waitForFunction(() => window.dashboardInstance?.editMode, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const firstCategoryId = (page) => page.evaluate(() => String(window.dashboardInstance.categories[0].id));
const block = (page, id) => page.locator(`#dashboard-layout .category[data-category-id="${id}"]`);

/** Whatever a test set is put back through the same call the UI uses, so the shared data dir is left as it was. */
async function reset(page, ids) {
    await page.evaluate(async (list) => {
        for (const id of list) await window.DashboardBlockVisibility.set(window.dashboardInstance, id, 'all');
    }, ids).catch(() => {});
}

test.describe('block visibility on a desktop', () => {
    test('Phone only from the edit panel: dimmed and labelled in edit mode, gone outside it, saved', async ({ page }) => {
        await load(page);
        const id = await firstCategoryId(page);
        try {
            await page.keyboard.press('Shift+E');
            await expect(page.locator('body')).toHaveAttribute('data-edit-mode', 'on');
            await block(page, id).locator('.category-title').first().click();
            await page.locator('[data-edit-visible="mobile"]').click();
            await expect(block(page, id)).toHaveAttribute('data-visible-here', 'false');
            await expect(block(page, id).locator('> .visible-on-badge')).toHaveText('Hidden on desktop');
            await expect(page.locator('[data-edit-visible="mobile"]')).toHaveAttribute('aria-pressed', 'true');
            const saved = await page.evaluate(async (cid) => {
                const list = await (await fetch(`/api/categories?page=${window.dashboardInstance.currentPageId}`, { cache: 'no-store' })).json();
                return list.find((c) => String(c.id) === cid)?.visibleOn;
            }, id);
            expect(saved).toBe('mobile');
            await page.keyboard.press('Escape');
            await expect(page.locator('body')).not.toHaveAttribute('data-edit-mode', 'on');
            await expect(block(page, id)).toHaveCount(0);
        } finally {
            await reset(page, [id]);
        }
    });

    test('the category menu has Show on: Desktop only keeps it here, Phone only takes it away', async ({ page }) => {
        await load(page);
        const id = await firstCategoryId(page);
        try {
            const title = block(page, id).locator('.category-title').first();
            await title.click({ button: 'right' });
            await page.getByRole('menuitem', { name: /Show on/ }).click();
            await page.getByRole('menuitem', { name: 'Desktop only' }).click();
            await expect(block(page, id)).toHaveCount(1);
            await expect.poll(() => page.evaluate((cid) => window.DashboardBlockVisibility.get(window.dashboardInstance, cid), id)).toBe('desktop');
            await block(page, id).locator('.category-title').first().click({ button: 'right' });
            await page.getByRole('menuitem', { name: /Show on/ }).click();
            await expect(page.getByRole('menuitem', { name: 'Desktop only' })).toHaveAttribute('aria-checked', 'true');
            await page.getByRole('menuitem', { name: 'Phone only' }).click();
            await expect(block(page, id)).toHaveCount(0);
        } finally {
            await reset(page, [id]);
        }
    });

    test('a widget and a built-in collection keep their answer through the real save path', async ({ page }) => {
        await load(page);
        const ids = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const widget = (d.widgets || [])[0]?.id || '';
            const collection = (d.getSmartCollections?.(d.allBookmarks || []) || [])[0]?.id || '';
            return { widget, collection };
        });
        test.skip(!ids.widget || !ids.collection, 'needs a widget and a collection on the page');
        try {
            await page.evaluate(async ({ widget, collection }) => {
                const d = window.dashboardInstance;
                await window.DashboardBlockVisibility.set(d, widget, 'mobile');
                await window.DashboardBlockVisibility.set(d, collection, 'mobile');
            }, ids);
            // What the server holds, not what the page remembers.
            const stored = await page.evaluate(async ({ widget, collection }) => {
                const d = window.dashboardInstance;
                const blocks = await (await fetch(`/api/pages/${d.currentPageId}/blocks`, { cache: 'no-store' })).json();
                const settings = await (await fetch('/api/settings', { cache: 'no-store' })).json();
                return { widget: (blocks.widgets || []).find((w) => w.id === widget)?.visibleOn, collection: settings.collectionVisibleOn?.[collection] };
            }, ids);
            expect(stored).toEqual({ widget: 'mobile', collection: 'mobile' });
            await page.reload();
            await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
            await expect(block(page, ids.widget)).toHaveCount(0);
            await expect(block(page, ids.collection)).toHaveCount(0);
        } finally {
            await reset(page, [ids.widget, ids.collection].filter(Boolean));
        }
    });
});

test.describe('block visibility on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a desktop-only category is not drawn, a phone-only one is, and with neither set both are', async ({ page }) => {
        await load(page);
        const ids = await page.evaluate(() => window.dashboardInstance.categories.slice(0, 2).map((c) => String(c.id)));
        test.skip(ids.length < 2, 'needs two categories');
        try {
            await expect(block(page, ids[0])).toHaveCount(1);
            await expect(block(page, ids[1])).toHaveCount(1);
            await page.evaluate(async ([a, b]) => {
                const d = window.dashboardInstance;
                await window.DashboardBlockVisibility.set(d, a, 'desktop');
                await window.DashboardBlockVisibility.set(d, b, 'mobile');
                d.renderDashboard({ animate: false });
            }, ids);
            await expect(block(page, ids[0])).toHaveCount(0);
            await expect(block(page, ids[1])).toHaveCount(1);
        } finally {
            await reset(page, ids);
        }
    });
});
