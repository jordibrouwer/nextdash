// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen,
    dismissBlockingOverlays,
    dismissOnboardingIfPresent,
    ensurePageCategory,
} = require('./e2e-helpers');

/**
 * "Last opened" and "Most opened" sort a category on the usage data the server
 * already records per bookmark. A bookmark never opened has nothing to rank on,
 * so it goes last, and bookmarks that tie keep the order they had.
 *
 * The two opened rows rank opposite ways on the two fields — Recent was opened
 * last, Frequent was opened most — so each mode is seen to read its own field.
 */
const CATEGORY = 'usage-sort';
const now = Date.now();
const ROWS = [
    { name: 'Never A', url: 'https://never-a.example', openCount: 0, lastOpened: 0 },
    { name: 'Frequent', url: 'https://frequent.example', openCount: 9, lastOpened: now - 3 * 60 * 60 * 1000 },
    { name: 'Never B', url: 'https://never-b.example', openCount: 0, lastOpened: 0 },
    { name: 'Recent', url: 'https://recent.example', openCount: 2, lastOpened: now - 60 * 1000 },
];

async function load(page) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await markWhatsNewSeen(page, {
        extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'],
    });
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector('#dashboard-layout .category:not([data-smart-collection="true"])', {
        timeout: 15_000,
    });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.getElementById('favicon-prefetch-overlay')?.remove());

    await ensurePageCategory(page, CATEGORY, 'Usage sort');
    await page.evaluate(async ({ categoryId, rows }) => {
        const d = window.dashboardInstance;
        const write = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetch(`/api/bookmarks?page=${d.currentPageId}`);
        const list = (await res.json()).filter((b) => b.category !== categoryId);
        list.push(...rows.map((b) => ({ ...b, category: categoryId, shortcut: '' })));
        await write(`/api/bookmarks?page=${d.currentPageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(list),
        });
        await d.data.refreshAfterBookmarkMutation({});
    }, { categoryId: CATEGORY, rows: ROWS });
}

for (const { mode, label, expected } of [
    { mode: 'opened', label: 'Last opened', expected: ['Recent', 'Frequent', 'Never A', 'Never B'] },
    { mode: 'opens', label: 'Most opened', expected: ['Frequent', 'Recent', 'Never A', 'Never B'] },
]) {
    test(`${label} puts the top one first and the never-opened last, in their order`, async ({ page }) => {
        await load(page);
        const category = page.locator(`#dashboard-layout .category[data-category-id="${CATEGORY}"]`);
        const names = category.locator('.bookmark-link .bookmark-text');
        await expect(names).toHaveText(ROWS.map((b) => b.name));

        await category.locator('.category-title').hover();
        await category.locator('.category-sort-menu-btn').click();
        await category.locator(`.category-sort-menu-item[data-sort-mode="${mode}"]`).click();

        await expect(category.locator(`.category-sort-btn[data-sort-mode="${mode}"]`)).toBeVisible();
        await expect(names).toHaveText(expected);
    });
}
