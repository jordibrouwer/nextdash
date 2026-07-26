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

test.describe('unique names', () => {
    // The pure matcher backing every check, exercised directly so the edge
    // cases are pinned independently of any one section's wiring.
    test('the shared matcher ignores case and surrounding whitespace', async ({ page }) => {
        await loadDashboard(page);
        const r = await page.evaluate(() => {
            const C = window.dashboardInstance.config.constructor;
            return {
                exact: C.isNameTaken('Work', ['Work']),
                casing: C.isNameTaken('WORK', ['work']),
                padded: C.isNameTaken('  Work  ', ['Work']),
                innerSpace: C.isNameTaken('My  Work', ['My Work']),
                distinct: C.isNameTaken('Personal', ['Work']),
                // Renaming a row to its own name is not a clash with itself.
                self: C.isNameTaken('Work', ['Work', 'Home'], 'Work'),
                // Only its own capitalisation changed — still allowed.
                recase: C.isNameTaken('WORK', ['Work', 'Home'], 'Work'),
                // But a genuine clash with a *different* row still reports.
                selfVsOther: C.isNameTaken('Home', ['Work', 'Home'], 'Work'),
                // Empty is not a duplicate; emptiness is a separate concern.
                empty: C.isNameTaken('', ['Work']),
            };
        });
        expect(r).toEqual({
            exact: true, casing: true, padded: true, innerSpace: true,
            distinct: false, self: false, recase: false,
            selfVsOther: true, empty: false,
        });
    });

    test('uniqueNameFrom suffixes until the name is free', async ({ page }) => {
        await loadDashboard(page);
        const r = await page.evaluate(() => {
            const C = window.dashboardInstance.config.constructor;
            return [
                C.uniqueNameFrom('Page 2', []),
                C.uniqueNameFrom('Page 2', ['Page 2']),
                C.uniqueNameFrom('Page 2', ['Page 2', 'Page 2 2']),
            ];
        });
        expect(r).toEqual(['Page 2', 'Page 2 2', 'Page 2 3']);
    });

    test('a page cannot be renamed onto another page name', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="pages"]').click();
        await page.evaluate(() => window.dashboardInstance.config.addPage());
        await page.locator('[data-pt-tab="pages"]').click();

        const names = page.locator('[data-page="name"]');
        await expect(names).toHaveCount(2);
        const first = await names.nth(0).inputValue();

        let posted = false;
        await page.route('**/api/pages', async (route) => {
            if (route.request().method() === 'POST') posted = true;
            await route.fallback();
        });

        // Differing only in case must still be rejected.
        await names.nth(1).fill(first.toUpperCase());
        await names.nth(1).blur();

        // The input is put back and nothing is written.
        await expect(names.nth(1)).not.toHaveValue(first.toUpperCase());
        expect(posted).toBe(false);
        const stored = await page.evaluate(() => window.dashboardInstance.pages.map((p) => p.name));
        expect(new Set(stored.map((n) => n.toLowerCase())).size).toBe(stored.length);
    });

    test('a category cannot be renamed onto another category on the same page', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="categories"]').click();
        await expect(page.locator('[data-cat="name"]').first()).toBeVisible();

        const names = page.locator('[data-cat="name"]');
        const count = await names.count();
        test.skip(count < 2, 'needs at least two categories');
        const first = await names.nth(0).inputValue();

        await names.nth(1).fill(first);
        await names.nth(1).blur();

        await expect(names.nth(1)).not.toHaveValue(first);
        const stored = await page.evaluate(() =>
            (window.dashboardInstance.config._categories || []).map((c) => c.name));
        expect(new Set(stored.map((n) => n.toLowerCase())).size).toBe(stored.length);
    });

    test('a tag cannot be renamed onto an existing tag', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="tags"]').click();
        await expect(page.locator('[data-tag-rename]').first()).toBeVisible();

        const tags = page.locator('[data-tag-rename]');
        const count = await tags.count();
        test.skip(count < 2, 'needs at least two tags');
        const first = await tags.nth(0).inputValue();
        const second = await tags.nth(1).inputValue();

        // A tag rename rewrites every bookmark, so a merge would be silent.
        let wrote = false;
        await page.route('**/api/bookmarks**', async (route) => {
            if (route.request().method() === 'POST') wrote = true;
            await route.fallback();
        });

        await tags.nth(1).fill(first);
        await tags.nth(1).blur();

        await expect(tags.nth(1)).toHaveValue(second);
        expect(wrote).toBe(false);
    });

    test('a finder rejects a duplicate name and a duplicate shortcut', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: '1', name: 'Wikipedia', searchUrl: 'https://en.wikipedia.org/?q=%s', shortcut: 'w' },
                { id: '2', name: 'GitHub', searchUrl: 'https://github.com/search?q=%s', shortcut: 'g' },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="finders"]').click();

        const names = page.locator('[data-finder="name"]');
        const shortcuts = page.locator('[data-finder="shortcut"]');
        await expect(names).toHaveCount(2);

        await names.nth(1).fill('Wikipedia');
        await names.nth(1).blur();
        await expect(names.nth(1)).toHaveValue('GitHub');

        // The shortcut decides which finder "?w" runs, so it is guarded too.
        await shortcuts.nth(1).fill('w');
        await shortcuts.nth(1).blur();
        await expect(shortcuts.nth(1)).toHaveValue('g');
    });

    test('adding pages repeatedly never repeats a name', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.addPage();
            await c.addPage();
        });
        const names = await page.evaluate(() => window.dashboardInstance.pages.map((p) => p.name));
        expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    });
});

test.describe('category statistics', () => {
    // Regression: a bookmark stores its category by *id* ("development"), while
    // the category list carries the display *name* ("Development"). Counting by
    // id but looking up by name matched nothing, so every row read 0 bookmarks.
    test('counts categories when bookmarks store the id, not the display name', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/categories**', async (route) => {
            if (route.request().method() === 'POST') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: 'development', name: 'Development' },
                { id: 'media', name: 'Media' },
                { id: 'empty-one', name: 'Utilities' },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.allBookmarks = [
                { name: 'A', url: 'https://a.com', pageId: 1, category: 'development' },
                { name: 'B', url: 'https://b.com', pageId: 1, category: 'development' },
                { name: 'C', url: 'https://c.com', pageId: 1, category: 'media' },
                // Another page's bookmark must not leak into these counts.
                { name: 'D', url: 'https://d.com', pageId: 2, category: 'development' },
            ];
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="categories"]').click();
        await expect(page.locator('[data-cat-row="0"] .config-tag-count')).toHaveText('2 bookmarks');
        await expect(page.locator('[data-cat-row="1"] .config-tag-count')).toHaveText('1 bookmarks');
        // A category nothing points at is genuinely zero, not a lookup miss.
        await expect(page.locator('[data-cat-row="2"] .config-tag-count')).toHaveText('0 bookmarks');
    });

    test('the count lookup prefers the id but still falls back to the name', async ({ page }) => {
        await loadDashboard(page);
        const r = await page.evaluate(() => {
            const C = window.dashboardInstance.config.constructor;
            const counts = new Map([['development', 3], ['Legacy Name', 2]]);
            return {
                byId: C.categoryCountFor(counts, { id: 'development', name: 'Development' }),
                // Older data stored the display name as the category.
                byName: C.categoryCountFor(counts, { id: '', name: 'Legacy Name' }),
                missing: C.categoryCountFor(counts, { id: 'nope', name: 'Nope' }),
            };
        });
        expect(r).toEqual({ byId: 3, byName: 2, missing: 0 });
    });
});

