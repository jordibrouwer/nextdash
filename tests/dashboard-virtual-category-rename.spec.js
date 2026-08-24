// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Uncategorized and orphan headers are synthesized views over bookmarks, not
 * stored categories — the right-click menu already refuses to rename them
 * (`category-menu.js` skips `isVirtualCategory`). The long-press / dblclick
 * path into `_startCategoryRename` used to miss that same guard, so renaming
 * "Uncategorized" by double-clicking it could push a phantom category with an
 * empty id into the saved list.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Add a bookmark with no category so the "Uncategorized" header renders. */
async function addUncategorizedBookmark(page, url) {
    const pageId = await page.evaluate(async (u) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, name: 'E2E uncategorized', url: u, category: '' }),
        });
        return d.currentPageId;
    }, url);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    return pageId;
}

async function removeBookmarkByURL(page, pageId, url) {
    await page.evaluate(async ({ pid, u }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: pid, bookmark: { url: u, name: 'E2E uncategorized' } }),
        });
    }, { pid: pageId, u: url });
}

test.describe('dashboard grid — virtual category headers cannot be renamed', () => {
    test('double-clicking Uncategorized does not open a rename input', async ({ page }) => {
        const url = `https://virtual-cat-${Date.now()}.example.com`;
        await loadDashboard(page);
        const pageId = await addUncategorizedBookmark(page, url);

        const header = page.locator('.category[data-category-id=""] .category-title').first();
        await expect(header).toBeVisible({ timeout: 10_000 });
        await header.dblclick();

        await expect(header.locator('.category-rename-input')).toHaveCount(0);

        await removeBookmarkByURL(page, pageId, url);
    });

    test('renaming a real category still works by dblclick', async ({ page }) => {
        // The control: without this, the test above would pass just as well
        // against a guard that blocks every dblclick, not only virtual ones.
        await loadDashboard(page);
        const header = page.locator('.category:not([data-smart-collection="true"]):not([data-category-id=""]) .category-title').first();
        test.skip(await header.count() === 0, 'no ordinary category on this page');

        await header.dblclick();
        await expect(header.locator('.category-rename-input')).toBeVisible();
        await page.keyboard.press('Escape');
    });
});
