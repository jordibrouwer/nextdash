// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Per-block visibility (dashboard-block-visibility.js): a category, widget or
 * collection shows everywhere, on desktop only, or on a phone only. Set in the
 * edit-mode panel; filtered when the grid is drawn; kept, dimmed, in edit mode.
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

test.describe('block visibility on a desktop', () => {
    test('Phone only: dimmed and labelled in edit mode, gone outside it, saved', async ({ page, request }) => {
        await load(page);
        const id = await firstCategoryId(page);
        await page.keyboard.press('Shift+E');
        await expect(page.locator('body')).toHaveAttribute('data-edit-mode', 'on');
        await block(page, id).locator('.category-title').first().click();
        await page.locator('[data-edit-visible="mobile"]').click();
        await expect(block(page, id)).toHaveAttribute('data-visible-here', 'false');
        await expect(block(page, id)).toHaveAttribute('data-visible-label', 'Hidden on desktop');
        await expect(page.locator('[data-edit-visible="mobile"]')).toHaveAttribute('aria-pressed', 'true');
        const saved = await page.evaluate(async (cid) => {
            const list = await (await fetch(`/api/categories?page=${window.dashboardInstance.currentPageId}`, { cache: 'no-store' })).json();
            return list.find((c) => String(c.id) === cid)?.visibleOn;
        }, id);
        expect(saved).toBe('mobile');
        await page.keyboard.press('Escape');
        await expect(page.locator('body')).not.toHaveAttribute('data-edit-mode', 'on');
        await expect(block(page, id)).toHaveCount(0);

        // Back to everywhere, so the shared data dir is left as it was.
        await page.keyboard.press('Shift+E');
        await block(page, id).locator('.category-title').first().click();
        await page.locator('[data-edit-visible="all"]').click();
        await expect(block(page, id)).not.toHaveAttribute('data-visible-here', /.*/);
    });
});

test.describe('block visibility on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a desktop-only category is not drawn, a phone-only one is', async ({ page }) => {
        await load(page);
        const ids = await page.evaluate(() => window.dashboardInstance.categories.slice(0, 2).map((c) => String(c.id)));
        test.skip(ids.length < 2, 'needs two categories');
        await page.evaluate(([a, b]) => {
            const d = window.dashboardInstance;
            d.categories[0].visibleOn = 'desktop';
            d.categories[1].visibleOn = 'mobile';
            d.renderDashboard({ animate: false });
        }, ids);
        await expect(block(page, ids[0])).toHaveCount(0);
        await expect(block(page, ids[1])).toHaveCount(1);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            delete d.categories[0].visibleOn;
            delete d.categories[1].visibleOn;
        });
    });
});
