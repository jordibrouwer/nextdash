// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openAddBookmark(page) {
    await page.evaluate(() => {
        window.dashboardInstance.quickAddWidget?.open?.()
            ?? window.dashboardInstance.searchComponent.commandsComponent.newCommandHandler.openModal();
    });
    await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
}

test.describe('add bookmark — Create + New', () => {
    test('the footer offers a distinct Create + New button', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const btn = page.locator('#new-bookmark-create-another');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveClass(/nbm-btn-create-another/);
    });

    test('Create + New saves, keeps the modal open, clears the form and keeps the page', async ({ page }) => {
        const posted = [];
        await page.route('**/api/bookmarks/add', async (route) => {
            posted.push(JSON.parse(route.request().postData() || '{}'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await loadDashboard(page);
        await openAddBookmark(page);

        await page.fill('#new-bookmark-url', 'https://example.com');
        await page.fill('#new-bookmark-name', 'Example One');
        const pageBefore = await page.locator('#new-bookmark-page').inputValue();

        await page.locator('#new-bookmark-create-another').click();

        // Modal stays open.
        await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
        // Fields cleared for the next entry.
        await expect(page.locator('#new-bookmark-url')).toHaveValue('');
        await expect(page.locator('#new-bookmark-name')).toHaveValue('');
        // Page selection preserved.
        await expect(page.locator('#new-bookmark-page')).toHaveValue(pageBefore);
        // The first bookmark was posted.
        await expect.poll(() => posted.length).toBe(1);

        // A second bookmark can be added right away.
        await page.fill('#new-bookmark-url', 'https://example.org');
        await page.fill('#new-bookmark-name', 'Example Two');
        await page.locator('#new-bookmark-create-another').click();
        await expect.poll(() => posted.length).toBe(2);
        await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
    });

    test('the plain Create button still closes the modal', async ({ page }) => {
        await page.route('**/api/bookmarks/add', async (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await loadDashboard(page);
        await openAddBookmark(page);
        await page.fill('#new-bookmark-url', 'https://example.net');
        await page.fill('#new-bookmark-name', 'Closes');
        await page.locator('#new-bookmark-create').click();
        await expect(page.locator('#new-bookmark-modal')).toHaveCount(0);
    });
});
