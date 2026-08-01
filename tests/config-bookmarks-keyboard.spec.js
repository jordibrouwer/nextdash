// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openBookmarksWithRows(page, bookmarks) {
    await page.route('**/api/bookmarks?all=true', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(bookmarks),
        });
    });
    await page.route('**/api/bookmarks?page=*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const pageId = new URL(route.request().url()).searchParams.get('page');
        const rows = bookmarks.filter((b) => String(b.pageId) === String(pageId));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(rows),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((rows) => {
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        window.dashboardInstance.allBookmarks = rows;
        return window.dashboardInstance.config.openConfigView('bookmarks');
    }, bookmarks);
    await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('config bookmarks keyboard navigation', () => {
    test('j and k move between bookmark rows and highlight the selection', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
            { name: 'Beta', url: 'https://beta.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('j');
        await expect(page.locator('.config-bm-row').nth(1)).toHaveClass(/keyboard-selected/);
        await expect(page.locator('.config-bm-row').first()).not.toHaveClass(/keyboard-selected/);

        await page.keyboard.press('k');
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
    });

    test('e opens the edit bookmark modal', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(page.locator('#new-bookmark-modal.show')).toBeVisible();
        await expect(page.locator('#new-bookmark-name')).toBeFocused();
    });

    test('g and Shift+G jump to first and last bookmark rows', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
            { name: 'Beta', url: 'https://beta.example', pageId: 1 },
            { name: 'Gamma', url: 'https://gamma.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('Shift+G');
        await expect(page.locator('.config-bm-row').nth(2)).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('g');
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
    });

    test('slash focuses the bookmark search field', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('/');
        await expect(page.locator('#config-bm-search')).toBeFocused();
    });

    test('Escape closes the modal before clearing list selection', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(page.locator('#new-bookmark-modal.show')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#new-bookmark-modal.show')).toHaveCount(0);
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);

        await page.keyboard.press('Escape');
        await expect(page.locator('.config-bm-row').first()).not.toHaveClass(/keyboard-selected/);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });

    test('j/k in the bookmarks list do not move the section rail', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await expect(page.locator('[data-config-section="bookmarks"]')).toHaveAttribute('aria-selected', 'true');
    });
});
