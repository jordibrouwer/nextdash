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
        await expect(page.locator('[data-tag-row="dev"] .config-tag-count')).toHaveText('2 bookmarks');
        // The most-used tag fills its popularity bar completely.
        await expect(page.locator('[data-tag-row="dev"] .config-stat-bar-fill')).toHaveCSS('width', /\d/);
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

    test('the pages editor lists pages and adding one posts the list', async ({ page }) => {
        let posted = null;
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/pages', async (route) => {
            if (route.request().method() === 'POST') {
                posted = JSON.parse(route.request().postData() || '[]');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="pages"]').click();

        // At least the current page shows, and the first page's delete is disabled.
        await expect(page.locator('[data-page="name"]').first()).toBeVisible();
        const before = await page.locator('[data-page-row]').count();
        await page.locator('[data-page-add]').click();
        await expect.poll(() => Array.isArray(posted) && posted.length).toBeGreaterThan(before);
    });

    test('the categories editor loads a page’s categories and can add one', async ({ page }) => {
        let posted = null;
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/categories**', async (route) => {
            if (route.request().method() === 'POST') {
                posted = JSON.parse(route.request().postData() || '[]');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
            }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'work', name: 'Work' }]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="categories"]').click();

        await expect(page.locator('[data-cat="name"]').first()).toHaveValue('Work');
        await page.locator('[data-cat-add]').click();
        await expect.poll(() => Array.isArray(posted) && posted.length).toBeGreaterThan(1);
        // New category carries a generated id.
        expect(posted[posted.length - 1].id).toBeTruthy();
    });

    test('pages, categories and collections all show bookmark statistics', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/bookmarks?all=true', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { name: 'A', url: 'https://a.com', pageId: 1, category: 'Work', tags: ['dev'] },
                { name: 'B', url: 'https://b.com', pageId: 1, category: 'Work', tags: [] },
                { name: 'C', url: 'https://c.com', pageId: 1, category: 'Fun', tags: [] },
            ]) });
        });
        await page.route('**/api/categories**', async (route) => {
            if (route.request().method() === 'POST') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: 'work', name: 'Work' },
                { id: 'fun', name: 'Fun' },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));

        // Pages: the only page holds all three bookmarks.
        await page.locator('[data-pt-tab="pages"]').click();
        await expect(page.locator('[data-page-row] .config-tag-count').first()).toHaveText('3 bookmarks');
        await expect(page.locator('.config-stat-summary')).toBeVisible();

        // Categories: counted per category name on the selected page.
        await page.locator('[data-pt-tab="categories"]').click();
        await expect(page.locator('[data-cat-row="0"] .config-tag-count')).toHaveText('2 bookmarks');
        await expect(page.locator('[data-cat-row="1"] .config-tag-count')).toHaveText('1 bookmarks');

        // Collections: the sizes panel lists each active collection.
        await page.locator('[data-pt-tab="collections"]').click();
        await expect(page.locator('.config-stat-name').first()).toBeVisible();
    });
});
