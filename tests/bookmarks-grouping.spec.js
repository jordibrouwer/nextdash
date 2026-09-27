// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithRows } = require('./config-bookmarks-helpers');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Task 2.4: a Group control of its own next to Sort, independent of it --
 * page, category (page › category), site, status or tag -- with Sort
 * ordering the rows inside whichever group is chosen.
 */

const ROWS = [
    { name: 'Grafana', url: 'https://mon.example/grafana', pageId: 1, category: 'mon', tags: ['ops', 'dash'] },
    { name: 'Prometheus', url: 'https://mon.example/prom', pageId: 1, category: 'mon', tags: ['ops'] },
    { name: 'Proxmox', url: 'https://pve.example', pageId: 1, category: 'virt', tags: [] },
    { name: 'Plex', url: 'https://plex.example', pageId: 1, category: '', tags: ['media'] },
];

/** Cold-load `#bookmarks…`, the view Config → Bookmarks → List and the view of its own share. */
async function coldLoad(page, hash) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/**
 * Config → Bookmarks with four bookmarks health-joined to broken / down /
 * healthy / unchecked, for the "status" group. Built directly (not through
 * tests/helpers/bookmarks-health.js) so each of the four states is chosen on
 * purpose rather than inherited from the fixture's real bookmarks.
 */
async function openWithHealthStates(page) {
    const bookmarks = [
        { name: 'Broken one', url: 'https://broken.example', pageId: 1, state: 'broken' },
        { name: 'Down one', url: 'https://down.example', pageId: 1, state: 'down' },
        { name: 'Healthy one', url: 'https://healthy.example', pageId: 1, state: 'healthy' },
        { name: 'Unchecked one', url: 'https://unchecked.example', pageId: 1, state: 'unchecked' },
    ];
    const issues = bookmarks.map((b, i) => ({
        url: b.url, name: b.name, pageId: b.pageId, index: i, category: '',
        status: b.state === 'broken' ? 'broken' : 'healthy',
        flags: [], reasons: [], reasonDetails: [],
        lastChecked: b.state === 'unchecked' ? 0 : Date.now(),
        monitorStats: b.state === 'down' ? { downSince: Date.now() } : undefined,
    }));
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ generatedAt: Date.now(), summary: { totalBookmarks: issues.length }, issues }),
    }));
    await page.setViewportSize({ width: 1500, height: 950 });
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
    // The join is fetched once the section binds; awaited here so the group
    // select's own repaint (triggered by the test next) sees it landed.
    await page.evaluate(() => window.dashboardInstance.config.bmHealth());
    return { bookmarks };
}

test.describe('bookmarks: grouping (task 2.4)', () => {
    test('page groups the list, one head per page, named and counted', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-group', 'page');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        await expect(heads).toHaveCount(1);
        const pageName = await page.evaluate(() => window.dashboardInstance.config.pageLabel(1));
        await expect(heads.first().locator('.config-bm-group-label')).toContainText(pageName);
        await expect(heads.first().locator('.config-bm-group-count')).toHaveText('4');
        // Every row says which page's group it belongs to.
        await expect(page.locator('#config-bm-list [data-bm-group="1"]')).toHaveCount(1);
    });

    test('category groups by page, then the page\'s own category order -- not alphabetically', async ({ page }) => {
        // The server's own order is reversed from alphabetical, so a pass that
        // groups the categories only follows knownCategories()'s alphabetical
        // fallback would put them the wrong way round.
        await page.route('**/api/categories?page=1', (route) => (route.request().method() === 'GET'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ id: 'virt', name: 'Virt' }, { id: 'mon', name: 'Mon' }]),
            })
            : route.fallback()));
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-group', 'category');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        await expect(heads).toHaveCount(3);
        // "No category" (Plex) sorts first -- the same rule the Category
        // *sort* already used (empty string before any name) -- then virt
        // (the server's index 0) before mon (index 1), the opposite of
        // alphabetical, which knownCategories()'s fallback would have given.
        // Polled: loadBookmarkCategoriesForPage answers after the first paint
        // (prefetchAllBookmarkCategories, kicked when the section binds), so
        // the very first render may still show that fallback order.
        const pageName = await page.evaluate(() => window.dashboardInstance.config.pageLabel(1));
        await expect.poll(() => heads.locator('.config-bm-group-label').allTextContents())
            .toEqual([expect.stringContaining(pageName), expect.stringMatching(/virt/i), expect.stringMatching(/mon/i)]);
        // The categorised heads read "page › category", not just the category.
        const second = await heads.nth(1).locator('.config-bm-group-label').textContent();
        expect(second).toContain('›');
    });

    test('site groups alphabetically by hostname, www stripped', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'A', url: 'https://www.zeta.example/one', pageId: 1, category: '' },
            { name: 'B', url: 'https://zeta.example/two', pageId: 1, category: '' },
            { name: 'C', url: 'https://alpha.example', pageId: 1, category: '' },
        ]);
        await page.selectOption('#config-bm-group', 'site');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        await expect(heads).toHaveCount(2);
        const labels = await heads.locator('.config-bm-group-label').allTextContents();
        expect(labels[0]).toContain('alpha.example');
        expect(labels[1]).toContain('zeta.example');
        expect(labels[1]).not.toContain('www.');
        // Both zeta.example bookmarks (www and bare) land in the one group.
        await expect(heads.nth(1).locator('.config-bm-group-count')).toHaveText('2');
    });

    test('status groups broken, down, healthy, unchecked, in that order', async ({ page }) => {
        await openWithHealthStates(page);
        await page.selectOption('#config-bm-group', 'status');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        await expect(heads).toHaveCount(4);
        const labels = await heads.locator('.config-bm-group-label').allTextContents();
        expect(labels[0]).toMatch(/broken/i);
        expect(labels[1]).toMatch(/down/i);
        expect(labels[2]).toMatch(/healthy/i);
        expect(labels[3]).toMatch(/never checked|unchecked/i);
    });

    test('tag groups alphabetically by a bookmark\'s first tag, untagged last', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Zeta tagged', url: 'https://a.example', pageId: 1, tags: ['zzz'] },
            { name: 'Alpha tagged (also zzz)', url: 'https://b.example', pageId: 1, tags: ['zzz', 'aaa'] },
            { name: 'No tags', url: 'https://c.example', pageId: 1, tags: [] },
        ]);
        await page.selectOption('#config-bm-group', 'tag');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        // "Alpha tagged" carries both aaa and zzz, but groups once, under its
        // alphabetically-first tag -- one row per bookmark, not one per tag.
        await expect(heads).toHaveCount(3);
        const labels = await heads.locator('.config-bm-group-label').allTextContents();
        expect(labels[0]).toContain('#aaa');
        expect(labels[1]).toContain('#zzz');
        expect(labels[2]).toMatch(/no tags/i);
        await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(3);
    });

    test('sorting changes the order inside a group, not the groups themselves', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-group', 'category');
        await expect(page.locator('#config-bm-list .config-bm-group-head')).toHaveCount(3);
        const monTitlesBefore = await page.locator('#config-bm-list .config-bm-group-head[data-bm-group$="::mon"] ~ .config-bm-row')
            .locator('.config-bm-title').allTextContents();
        expect(monTitlesBefore.slice(0, 2)).toEqual(['Grafana', 'Prometheus']);

        await page.selectOption('#config-bm-sort', 'name');
        await expect(page.locator('#config-bm-list .config-bm-group-head')).toHaveCount(3);
        const monTitlesAfter = await page.locator('#config-bm-list .config-bm-group-head[data-bm-group$="::mon"] ~ .config-bm-row')
            .locator('.config-bm-title').allTextContents();
        expect(monTitlesAfter.slice(0, 2)).toEqual(['Grafana', 'Prometheus'].sort());
    });

    test('an existing sort of "Page order" with no group ever chosen opens grouped by category', async ({ page }) => {
        // Nobody has touched Group yet (a fresh browser context, no
        // localStorage) -- the default rule (2.4) has to hold for them.
        await openBookmarksWithRows(page, ROWS);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSort)).toBe('page');
        await expect(page.locator('#config-bm-group')).toHaveValue('category');
        await expect(page.locator('#config-bm-list .config-bm-group-head')).toHaveCount(3);
    });

    test('#bookmarks?group=site on a cold load lands grouped by site', async ({ page }) => {
        await coldLoad(page, '#bookmarks?group=site');
        await expect(page.locator('#config-bm-group')).toHaveValue('site');
        await expect(page.locator('#config-bm-list .config-bm-group-head').first()).toBeVisible();
    });

    test('choosing a group writes group= to the hash', async ({ page }) => {
        await coldLoad(page, '#bookmarks');
        await page.selectOption('#config-bm-group', 'status');
        await expect(page).toHaveURL(/#bookmarks\?group=status$/);
        // Back to the default -- explicitly "no groups" now, still worth
        // saying so a link means what it shows.
        await page.selectOption('#config-bm-group', '');
        await expect(page).toHaveURL(/#bookmarks\?group=none$/);
    });

    test('select group ticks exactly that group\'s rows', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Zeta tagged', url: 'https://a.example', pageId: 1, tags: ['zzz'] },
            { name: 'Alpha tagged (also zzz)', url: 'https://b.example', pageId: 1, tags: ['zzz', 'aaa'] },
            { name: 'No tags', url: 'https://c.example', pageId: 1, tags: [] },
        ]);
        await page.selectOption('#config-bm-group', 'tag');
        // "aaa" is the group its first tag puts it in -- picking "zzz" must
        // tick only the bookmark whose first tag really is zzz.
        const zzzHead = page.locator('#config-bm-list .config-bm-group-head', { hasText: '#zzz' });
        await zzzHead.locator('[data-bm-select-group]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(1);
        await expect(page.locator('#config-bm-list .config-bm-row[aria-selected="true"] .config-bm-title'))
            .toHaveText('Zeta tagged');
    });
});
