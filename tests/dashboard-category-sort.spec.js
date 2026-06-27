// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
}

test.describe('dashboard per-category sort', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.addInitScript(() => {
            try {
                const release = '2026.06-dashboard-release-v72';
                localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            } catch {
                // ignore
            }
        });
    });

    test('category A–Z toggle sorts rows and disables drag handles', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .category:not([data-smart-collection="true"])', {
            timeout: 15_000,
        });
        await dismissBlockingOverlays(page);

        const category = page.locator('#dashboard-layout .category:not([data-smart-collection="true"])').first();
        const azBtn = category.locator('.category-sort-btn[data-sort-mode="az"]');
        await category.locator('.category-title').hover();
        await expect(azBtn).toBeVisible();

        const namesBefore = await category.locator('.bookmark-link .bookmark-text').allTextContents();
        expect(namesBefore.length).toBeGreaterThan(1);

        await azBtn.click();

        await expect(category.locator('.bookmarks-list')).toHaveClass(/bookmarks-list--sort-active/);
        await expect(azBtn).toHaveClass(/is-active/);

        const namesAfter = await category.locator('.bookmark-link .bookmark-text').allTextContents();
        const sorted = [...namesAfter].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        expect(namesAfter).toEqual(sorted);

        const result = await page.evaluate(() => {
            const list = document.querySelector(
                '#dashboard-layout .category:not([data-smart-collection="true"]) .bookmarks-list'
            );
            const categoryId = list?.getAttribute('data-category-id') || '';
            const mode = window.DashboardCategorySort?.getCategorySortMode?.(
                window.dashboardInstance,
                { id: categoryId }
            );
            const handle = list?.querySelector('.bookmark-reorder-handle');
            const handleDisplay = handle ? getComputedStyle(handle).display : null;
            return { mode, handleDisplay };
        });
        expect(result.mode).toBe('az');
        expect(result.handleDisplay).toBe('none');

        await azBtn.click();
        await expect(azBtn).not.toHaveClass(/is-active/);
        await expect(category.locator('.bookmarks-list')).not.toHaveClass(/bookmarks-list--sort-active/);
    });
});
