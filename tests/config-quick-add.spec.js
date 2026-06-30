// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigBookmarks(page) {
    await page.goto('/config#bookmarks');
    await page.waitForFunction(() => (
        typeof window.configManager?.quickAdd !== 'undefined'
        && (window.configManager?.bookmarkStore || Array.isArray(window.configManager?.bookmarksData))
    ));
    await page.waitForSelector('[data-tab-content="bookmarks"].active', { timeout: 20_000 });
    await page.waitForSelector('#bookmarks-list', { timeout: 15_000 });
}

async function openQuickAddModal(page) {
    const menu = page.locator('#bookmark-add-menu');
    await menu.locator('summary').click();
    await page.locator('#config-quick-add-btn').click();
    await page.waitForSelector('#new-bookmark-modal.show', { timeout: 10_000 });
}

test.describe('config quick add bookmarks', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('quick add shows new bookmark in list without page reload', async ({ page }) => {
        await waitForConfigBookmarks(page);

        const countBefore = await page.locator('#bookmarks-list .bookmark-item').count();
        const uniqueName = `Quick Add Test ${Date.now()}`;
        const uniqueUrl = `https://example.com/quick-add-${Date.now()}`;

        await openQuickAddModal(page);
        await page.fill('#new-bookmark-url', uniqueUrl);
        await page.fill('#new-bookmark-name', uniqueName);
        await page.locator('#new-bookmark-url').blur();
        await page.locator('#new-bookmark-create').click();

        await expect(page.locator('#new-bookmark-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
        await expect(page.locator('#bookmarks-list .bookmark-item')).toHaveCount(countBefore + 1);
        await expect(page.locator('#bookmarks-list .bookmark-row-name', { hasText: uniqueName }).first()).toBeVisible();
    });

    test('quick add refresh ignores active search filter', async ({ page }) => {
        await waitForConfigBookmarks(page);

        await page.fill('#bookmarks-search', 'zzzz-no-match-filter-test');
        await page.waitForTimeout(200);
        const filteredCount = await page.locator('#bookmarks-list .bookmark-item').count();

        const uniqueName = `Filtered Quick Add ${Date.now()}`;
        const uniqueUrl = `https://example.com/quick-add-filter-${Date.now()}`;
        await openQuickAddModal(page);
        await page.fill('#new-bookmark-url', uniqueUrl);
        await page.fill('#new-bookmark-name', uniqueName);
        await page.locator('#new-bookmark-url').blur();
        await page.locator('#new-bookmark-create').click();

        await expect(page.locator('#new-bookmark-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
        await expect(page.locator('#bookmarks-search')).toHaveValue('');
        await expect(page.locator('#bookmarks-list .bookmark-item').count()).resolves.toBeGreaterThan(filteredCount);
        await expect(page.locator('#bookmarks-list .bookmark-row-name', { hasText: uniqueName }).first()).toBeVisible();
    });
});
