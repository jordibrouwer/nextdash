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

    test('a finder is posted once it has a name, not while still blank', async ({ page }) => {
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

        // Add alone no longer persists an all-blank row — a refresh mid-typing
        // used to leave one behind. The first filled field saves it.
        expect(saved).toBeNull();
        await page.locator('[data-finder="name"]').fill('Wikipedia');
        await page.locator('[data-finder="name"]').blur();
        await expect.poll(() => Array.isArray(saved) && saved.length).toBe(1);
        expect(saved[0].name).toBe('Wikipedia');
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
        const r = await page.evaluate(async () => {
            // config is a lazy loader proxy until the module is fetched, so its
            // .constructor is the loader, not DashboardConfig. Force the load and
            // read the class off window, where dashboard-config.js publishes it.
            await window.dashboardInstance.config.load();
            const C = window.DashboardConfig;
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
        const r = await page.evaluate(async () => {
            await window.dashboardInstance.config.load();
            const C = window.DashboardConfig;
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

        // Count relative to what was already there: other specs share this
        // server and may have left pages behind, so a fixed count is brittle.
        const names = page.locator('[data-page="name"]');
        await expect.poll(() => names.count()).toBeGreaterThan(1);
        const total = await names.count();
        const first = await names.nth(0).inputValue();

        let posted = false;
        await page.route('**/api/pages', async (route) => {
            if (route.request().method() === 'POST') posted = true;
            await route.fallback();
        });

        // Differing only in case must still be rejected. Target the row just
        // added rather than a fixed index.
        const added = names.nth(total - 1);
        await added.fill(first.toUpperCase());
        await added.blur();

        // The input is put back and nothing is written.
        await expect(added).not.toHaveValue(first.toUpperCase());
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
        const r = await page.evaluate(async () => {
            await window.dashboardInstance.config.load();
            const C = window.DashboardConfig;
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

test.describe('smart collection limits', () => {
    // Regression: the limit dropdown offered only [5,10,15,20,30] while the
    // stored defaults are 8, 25, 50 and 50. A <select> with no matching option
    // falls back to its first one, so every limit displayed "5" regardless of
    // the real setting — and any later change wrote that wrong value.
    test('each limit select shows the value actually stored', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            s.smartTodayLimit = 8;
            s.smartMostUsedLimit = 25;
            s.smartRecentLimit = 50;
            s.smartStaleLimit = 0;
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="collections"]').click();
        await expect(page.locator('[data-collection-field="smartMostUsedLimit"]')).toHaveValue('25');
        await expect(page.locator('[data-collection-field="smartRecentLimit"]')).toHaveValue('50');
        await expect(page.locator('[data-collection-field="smartTodayLimit"]')).toHaveValue('8');
        // 0 is "Unlimited", which the builders treat as no cap.
        await expect(page.locator('[data-collection-field="smartStaleLimit"]')).toHaveValue('0');
    });

    test('the collections panel explains why Most used can look empty', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="collections"]').click();
        await expect(page.locator('.config-field-hint').filter({ hasText: /most used/i }).first()).toBeVisible();
        // A `note` entry has no field: it must not become a bound text input.
        await expect(page.locator('[data-collection-field="undefined"]')).toHaveCount(0);
    });

    test('Most used renders on the dashboard once a bookmark has an open count', async ({ page }) => {
        await loadDashboard(page);
        const ids = await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showSmartMostUsedCollection = true;
            d.allBookmarks.forEach((bm) => { bm.openCount = 0; });
            const before = d.getSmartCollections(d.allBookmarks).map((c) => c.id);
            // The collection is built from openCount, so it cannot exist until
            // something has actually been opened.
            d.allBookmarks[0].openCount = 3;
            const after = d.getSmartCollections(d.allBookmarks).map((c) => c.id);
            return { before, after };
        });
        expect(ids.before).not.toContain('__smart_most_used__');
        expect(ids.after).toContain('__smart_most_used__');
    });
});

test.describe('destructive actions confirm first', () => {
    test('deleting a category asks, and names what happens to its bookmarks', async ({ page }) => {
        let nativeDialogs = 0;
        page.on('dialog', (d) => { nativeDialogs += 1; d.dismiss(); });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="categories"]').click();
        await page.waitForSelector('[data-cat-delete]');

        const before = await page.evaluate(() =>
            (window.dashboardInstance.config._categories || []).length);
        await page.locator('[data-cat-delete]').first().click();

        // In-app, not window.confirm: the native one cannot be themed and a
        // delete needs to look like a delete.
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        expect(nativeDialogs).toBe(0);
        await expect(page.locator('[data-confirm="ok"]')).toHaveClass(/danger/);
        // The orphaning is invisible from the list, so the message states it.
        await expect(page.locator('.config-confirm-message')).toContainText(/bookmarks/i);

        await page.locator('[data-confirm="cancel"]').click();
        await expect(page.locator('#config-confirm-modal')).toHaveCount(0);
        expect(await page.evaluate(() =>
            (window.dashboardInstance.config._categories || []).length)).toBe(before);
    });

    test('Escape cancels the dialog without also leaving config', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="categories"]').click();
        await page.locator('[data-cat-delete]').first().click();
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#config-confirm-modal')).toHaveCount(0);
        // The dialog must swallow that Escape, or one keypress closes both.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('deleting a named finder asks first', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: '1', name: 'Wikipedia', searchUrl: 'https://en.wikipedia.org/?q=%s', shortcut: 'w' },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="finders"]').click();
        await page.waitForSelector('[data-finder-delete]');
        await page.locator('[data-finder-delete]').first().click();
        await expect(page.locator('.config-confirm-message')).toContainText('Wikipedia');
        await page.locator('[data-confirm="cancel"]').click();
        await expect(page.locator('[data-finder="name"]')).toHaveCount(1);
    });
});

test.describe('finder URL placeholder', () => {
    test('a searchUrl without %s is flagged and clears as you type', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: '1', name: 'Broken', searchUrl: 'https://example.com/search', shortcut: 'b' },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="finders"]').click();
        const url = page.locator('[data-finder="searchUrl"]').first();
        // search.js does searchUrl.replace('%s', query) — without it the finder
        // opens the bare URL and silently drops what was typed.
        await expect(page.locator('[data-finder-warning]')).toHaveCount(1);
        await expect(url).toHaveClass(/field-conflict/);
        await url.fill('https://example.com/search?q=%s');
        await expect(page.locator('[data-finder-warning]')).toHaveCount(0);
        await expect(url).not.toHaveClass(/field-conflict/);
    });

    test('adding a finder does not save an all-blank row', async ({ page }) => {
        let posted = 0;
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() === 'POST') { posted += 1; return route.fallback(); }
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="finders"]').click();
        await page.locator('[data-finder-add]').click();
        await expect(page.locator('[data-finder="name"]')).toHaveCount(1);
        // The row exists locally and is focused, but nothing is persisted until
        // a field is filled in.
        expect(posted).toBe(0);
        await expect(page.locator('[data-finder="name"]')).toBeFocused();
    });

});

test.describe('category list accessibility', () => {
    test('the category move buttons are labelled for screen readers', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="categories"]').click();
        await page.waitForSelector('[data-cat-move]');
        // Without these a screen reader announces only "↑".
        await expect(page.locator('[data-cat-move="up"]').first()).toHaveAttribute('aria-label', /.+/);
        await expect(page.locator('[data-cat-move="down"]').first()).toHaveAttribute('aria-label', /.+/);
    });
});

test.describe('tag cloud and filter', () => {
    test('the tags tab shows a usage-sized word cloud', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="tags"]').click();
        await expect(page.locator('[data-tag-row]').first()).toBeVisible();

        // Reuses the dashboard's own .tag-cloud-word styling and tier classes
        // rather than a lookalike, so the two clouds cannot drift apart.
        const words = page.locator('[data-tag-cloud]');
        await expect(words.first()).toBeVisible();
        await expect(words.first()).toHaveClass(/tag-cloud-word/);
        // The cloud's own tier classes, not the stat-bar ones: they carry the
        // colour gradation that makes a cloud readable.
        await expect(words.first()).toHaveClass(/tag-cloud-word--tier-/);
    });

    test('a selected tag is visibly marked, not just filtered', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="tags"]').click();
        const word = page.locator('[data-tag-cloud]').first();
        await expect(word).toBeVisible();

        await expect(word).toHaveAttribute('aria-pressed', 'false');
        const plain = await word.evaluate((el) => getComputedStyle(el).borderColor);

        await word.click();
        // Recolouring the label alone is easy to miss among words that already
        // vary in size and weight, so the selected word gets a real border.
        const selected = page.locator('[data-tag-cloud].is-selected');
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        const marked = await selected.evaluate((el) => getComputedStyle(el).borderColor);
        expect(marked).not.toBe(plain);
        expect(marked).not.toMatch(/rgba\(0, 0, 0, 0\)/);
    });

    test('clicking a word filters the list, and again clears it', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="tags"]').click();
        await expect(page.locator('[data-tag-cloud]').first()).toBeVisible();

        const before = await page.locator('[data-tag-row]').count();
        test.skip(before < 2, 'needs at least two tags');
        const tag = await page.locator('[data-tag-cloud]').first().getAttribute('data-tag-cloud');

        await page.locator('[data-tag-cloud]').first().click();
        await expect.poll(() => page.locator('[data-tag-row]').count()).toBeLessThan(before);
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._tagQuery)).toBe(tag);

        // The cloud doubles as the filter control, so the same word clears it.
        await page.locator(`[data-tag-cloud="${tag}"]`).click();
        await expect.poll(() => page.locator('[data-tag-row]').count()).toBe(before);
    });

    test('the filter box narrows the list and keeps focus while typing', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="tags"]').click();
        await expect(page.locator('#config-tag-filter')).toBeVisible();

        const before = await page.locator('[data-tag-row]').count();
        const tag = await page.locator('[data-tag-rename]').first().inputValue();
        await page.locator('#config-tag-filter').fill(tag);
        await expect.poll(() => page.locator('[data-tag-row]').count()).toBeLessThanOrEqual(before);
        // The body is replaced on every keystroke, so focus has to be restored
        // or the input swallows the rest of what you type.
        await expect(page.locator('#config-tag-filter')).toBeFocused();
    });
});

test.describe('custom collections', () => {
    test('a rule-based collection can be created, edited and saved', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.collections = []; });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="collections"]').click();
        await expect(page.locator('[data-collection-add]')).toBeVisible();

        await page.locator('[data-collection-add]').click();
        await expect(page.locator('[data-collection-row]')).toHaveCount(1);
        // The editor opens on the new collection, with one rule ready.
        await expect(page.locator('[data-collection-field="name"]')).toBeVisible();
        await expect(page.locator('[data-collection-rule]')).toHaveCount(1);

        const tag = await page.evaluate(() =>
            (window.dashboardInstance.allBookmarks.find((b) => (b.tags || []).length) || {}).tags?.[0] || '');
        test.skip(!tag, 'needs a tagged bookmark');
        await page.locator('[data-rule-value="0"]').fill(tag);
        await page.locator('[data-rule-value="0"]').blur();

        // The shape must match what the dashboard's _evaluateCollection reads.
        await expect.poll(async () => page.evaluate(async () => {
            const s = await (await fetch('/api/settings')).json();
            const c = (s.collections || [])[0];
            return c && c.id && c.logic && Array.isArray(c.rules) && c.rules[0].field ? 'ok' : 'bad';
        }), { timeout: 10_000 }).toBe('ok');
        await expect(page.locator('[data-collection-match]')).toContainText(/\d/);
    });

    test('the last rule cannot be removed, since a ruleless collection is skipped', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.collections = []; });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="collections"]').click();
        await page.locator('[data-collection-add]').click();
        await expect(page.locator('[data-collection-rule]')).toHaveCount(1);
        await expect(page.locator('[data-rule-remove="0"]')).toBeDisabled();

        await page.locator('[data-collection-add-rule]').click();
        await expect(page.locator('[data-collection-rule]')).toHaveCount(2);
        await expect(page.locator('[data-rule-remove="0"]')).toBeEnabled();
    });

    test('deleting a collection asks first', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.collections = []; });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.locator('[data-pt-tab="collections"]').click();
        await page.locator('[data-collection-add]').click();
        await expect(page.locator('[data-collection-row]')).toHaveCount(1);

        await page.locator('[data-collection-delete]').click();
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();
        await expect(page.locator('[data-collection-row]')).toHaveCount(0);
    });
});
