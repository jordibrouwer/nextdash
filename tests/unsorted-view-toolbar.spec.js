// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Unsorted toolbar: search, sort, group.
 *
 * All three act on the array /api/unsorted already returned, so what is being
 * checked is the shape of the grid after a control changes -- which rows
 * survive a query, which order they come back in, and which headings a
 * grouping puts over them.
 */

const KEPT = [
    { name: 'Zebra Docs', url: 'https://zebra-uvt.example/docs', createdAt: 5000 },
    { name: 'Alpha Guide', url: 'https://alpha-uvt.example/guide', createdAt: 4000 },
    { name: 'Alpha Reference', url: 'https://alpha-uvt.example/reference', createdAt: 3000 },
];

async function openUnsorted(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // How the kept list is read is a setting now, so it outlives a test and
    // the next one would inherit a grouping it never chose.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        const s = window.dashboardInstance?.settings;
        if (s) { s.unsortedSort = 'added-desc'; s.unsortedGroup = 'none'; }
        const u = window.dashboardInstance?.unsorted;
        if (u) { u.sort = 'added-desc'; u.groupBy = 'none'; u.searchQuery = ''; u.brokenOnly = false; }
    });

    await page.evaluate(async (kept) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const bookmark of kept) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
    }, KEPT);

    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');
    await expect(page.locator('.unsorted-view')).toBeVisible();
    await expect(page.locator('.unsorted-view-search-input')).toBeVisible();
}

/** Row labels in the order the grid lays them out, top to bottom per column. */
function rowNames(page) {
    return page.locator('.unsorted-view .bookmarks-list .bookmark-text').allInnerTexts();
}

test('search narrows the grid and the header count says how far', async ({ page }) => {
    await openUnsorted(page);

    const total = await page.locator('.unsorted-view .bookmark-link').count();
    expect(total).toBeGreaterThanOrEqual(KEPT.length);

    await page.locator('.unsorted-view-search-input').fill('alpha');

    const names = await rowNames(page);
    expect(names).toContain('Alpha Guide');
    expect(names).toContain('Alpha Reference');
    expect(names).not.toContain('Zebra Docs');
    await expect(page.locator('.unsorted-view-count')).toHaveText(/^2 of \d+$/);

    // Escape empties the box rather than leaving the grid filtered behind a
    // cleared-looking field.
    await page.locator('.unsorted-view-search-input').press('Escape');
    await expect(page.locator('.unsorted-view-search-input')).toHaveValue('');
    expect(await rowNames(page)).toContain('Zebra Docs');
});

test('search matches the URL, not only the name', async ({ page }) => {
    await openUnsorted(page);

    await page.locator('.unsorted-view-search-input').fill('zebra-uvt.example');

    const names = await rowNames(page);
    expect(names).toContain('Zebra Docs');
    expect(names).not.toContain('Alpha Guide');
});

test('sorting by name reorders the rows', async ({ page }) => {
    await openUnsorted(page);
    // Narrowed first so the assertion is about these three rows rather than
    // whatever else the store carries.
    await page.locator('.unsorted-view-search-input').fill('-uvt.example');

    await expect(page.locator('.unsorted-view-sort-select')).toHaveValue('added-desc');
    expect(await rowNames(page)).toEqual(['Zebra Docs', 'Alpha Guide', 'Alpha Reference']);

    await page.locator('.unsorted-view-sort-select').selectOption('name');
    expect(await rowNames(page)).toEqual(['Alpha Guide', 'Alpha Reference', 'Zebra Docs']);

    await page.locator('.unsorted-view-sort-select').selectOption('added-asc');
    expect(await rowNames(page)).toEqual(['Alpha Reference', 'Alpha Guide', 'Zebra Docs']);
});

test('grouping by site puts a heading over each host, biggest first', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvt.example');

    await expect(page.locator('.unsorted-group-title')).toHaveCount(0);

    await page.locator('.unsorted-view-group-select').selectOption('site');

    const titles = page.locator('.unsorted-view .unsorted-group-title .category-title-name');
    await expect(titles).toHaveCount(2);
    // alpha has two rows, zebra one, and the larger group leads.
    await expect(titles.nth(0)).toHaveText('alpha-uvt.example');
    await expect(titles.nth(1)).toHaveText('zebra-uvt.example');
    await expect(page.locator('.unsorted-group').nth(0).locator('.unsorted-group-count'))
        .toHaveText('2');
});

test('grouping by date buckets by age, oldest bucket last', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvt.example');

    await page.locator('.unsorted-view-group-select').selectOption('date');

    // The three fixtures carry createdAt values from 1970, so they all land in
    // the same bucket -- which is the point: 'older' is one heading, not three.
    const titles = page.locator('.unsorted-view .unsorted-group-title .category-title-name');
    await expect(titles).toHaveCount(1);
    await expect(titles.nth(0)).toHaveText('older');
    expect(await rowNames(page)).toHaveLength(3);
});

test('toolbar state survives leaving the view and coming back', async ({ page }) => {
    await openUnsorted(page);

    await page.locator('.unsorted-view-search-input').fill('alpha');
    await page.locator('.unsorted-view-sort-select').selectOption('name');
    await page.locator('.unsorted-view-group-select').selectOption('site');

    await page.locator('.dashboard-link a, .page-tab').first().click();
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toHaveCount(0);

    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');

    await expect(page.locator('.unsorted-view-search-input')).toHaveValue('alpha');
    await expect(page.locator('.unsorted-view-sort-select')).toHaveValue('name');
    await expect(page.locator('.unsorted-view-group-select')).toHaveValue('site');
    // Polled: the list loads with the inbox now, so the toolbar is on screen a
    // moment before the rows it describes are.
    await expect.poll(() => rowNames(page)).toEqual(['Alpha Guide', 'Alpha Reference']);
});
