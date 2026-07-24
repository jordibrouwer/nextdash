// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('config pages & tags', () => {
    test('renders sub-tabs and the finders editor', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: '1', name: 'Wikipedia', searchUrl: 'https://en.wikipedia.org/w/index.php?search=%s', shortcut: 'w' },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));

        for (const tab of ['finders', 'tags', 'collections', 'pages', 'categories']) {
            await expect(page.locator(`[data-pt-tab="${tab}"]`)).toBeVisible();
        }
        await expect(page.locator('[data-finder="name"]')).toHaveValue('Wikipedia');
    });

    test('adding a finder posts the updated list', async ({ page }) => {
        let saved = null;
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '[]');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
            }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-finder-add]').click();

        await expect.poll(() => Array.isArray(saved) && saved.length).toBe(1);
    });

    test('the tags manager lists tags with counts', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/bookmarks?all=true', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { name: 'A', url: 'https://a.com', pageId: 1, tags: ['dev', 'news'] },
                { name: 'B', url: 'https://b.com', pageId: 1, tags: ['dev'] },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="tags"]').click();

        await expect(page.locator('[data-tag-rename="dev"]')).toBeVisible();
        await expect(page.locator('[data-tag-row="dev"] .config-tag-count')).toHaveText('2');
    });

    test('collections tab shows smart-collection settings', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="collections"]').click();

        await expect(page.locator('[data-collection-field="showSmartTodayCollection"]')).toBeVisible();
    });
});
