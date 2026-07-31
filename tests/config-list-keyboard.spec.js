// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openPagesTags(page, finders = []) {
    await page.route('**/api/finders', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(finders),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        return window.dashboardInstance.config.openConfigView('pages-tags');
    });
    await expect(page.locator('[data-finder-index="0"]')).toBeVisible({ timeout: 10_000 });
}

test.describe('config list keyboard navigation', () => {
    test('arrow keys move between finder rows and highlight the selection', async ({ page }) => {
        await openPagesTags(page, [
            { id: '1', name: 'Alpha', searchUrl: 'https://a.com/?q=%s', shortcut: 'a' },
            { id: '2', name: 'Beta', searchUrl: 'https://b.com/?q=%s', shortcut: 'b' },
        ]);

        await page.locator('#config-pt-body').click();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-finder-index="0"]')).toHaveClass(/keyboard-selected/);

        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-finder-index="1"]')).toHaveClass(/keyboard-selected/);
        await expect(page.locator('[data-finder-index="0"]')).not.toHaveClass(/keyboard-selected/);

        await page.keyboard.press('ArrowUp');
        await expect(page.locator('[data-finder-index="0"]')).toHaveClass(/keyboard-selected/);
    });

    test('Enter focuses the first field in the selected row', async ({ page }) => {
        await openPagesTags(page, [
            { id: '1', name: 'Alpha', searchUrl: 'https://a.com/?q=%s', shortcut: 'a' },
        ]);

        await page.locator('#config-pt-body').click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-finder-index="0"] [data-finder="name"]')).toBeFocused();
    });

    test('g and Shift+G jump to first and last rows', async ({ page }) => {
        await openPagesTags(page, [
            { id: '1', name: 'Alpha', searchUrl: 'https://a.com/?q=%s', shortcut: 'a' },
            { id: '2', name: 'Beta', searchUrl: 'https://b.com/?q=%s', shortcut: 'b' },
            { id: '3', name: 'Gamma', searchUrl: 'https://c.com/?q=%s', shortcut: 'c' },
        ]);

        await page.locator('#config-pt-body').click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+G');
        await expect(page.locator('[data-finder-index="2"]')).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('g');
        await expect(page.locator('[data-finder-index="0"]')).toHaveClass(/keyboard-selected/);
    });

    test('Escape clears list selection before closing config', async ({ page }) => {
        await openPagesTags(page, [
            { id: '1', name: 'Alpha', searchUrl: 'https://a.com/?q=%s', shortcut: 'a' },
        ]);

        await page.locator('#config-pt-body').click();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-finder-index="0"]')).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-finder-index="0"]')).not.toHaveClass(/keyboard-selected/);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });

    test('slash focuses the tag filter on the Tags sub-tab', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/bookmarks?all=true', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { name: 'A', url: 'https://a.com', pageId: 1, tags: ['dev'] },
                ]),
            });
        });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
            return window.dashboardInstance.config.openConfigView('pages-tags');
        });
        await page.locator('[data-pt-tab="tags"]').click();
        await expect(page.locator('#config-tag-filter')).toBeVisible();

        await page.locator('#config-pt-body').click();
        await page.keyboard.press('/');
        await expect(page.locator('#config-tag-filter')).toBeFocused();
    });
});
