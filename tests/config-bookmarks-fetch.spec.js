// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-helpers');

/**
 * Icons and previews from the workbench.
 *
 * Config → Bookmarks is where a whole library is worked through, and it could
 * refresh a favicon but never fetch a preview -- the one thing the kept list
 * offers on every row it holds. Both are the same shape as there: a button
 * saying how many rows it would act on, the blocking bar counting them off,
 * and a Stop for a sweep that is longer than the reader expected.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

/** Tick the first `n` rows with the keyboard. */
async function tickRows(page, n) {
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < n; i += 1) {
        await page.keyboard.press('j');
        await page.keyboard.press('x');
    }
}

test('the bulk panel offers both fetches, counting what they would ask for', async ({ page }) => {
    await openBookmarks(page);
    await tickRows(page, 2);

    const panel = page.locator('#config-bm-panel');
    await expect(panel.locator('[data-bm-bulk-action="favicons"]')).toContainText(/Fetch icons \(\d\)/);
    await expect(panel.locator('[data-bm-bulk-action="previews"]')).toContainText(/Fetch previews \(\d\)/);
});

test('fetching previews walks the selection behind the counting bar', async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route('**/api/bookmark-preview**', async (route) => {
        asked.push(new URL(route.request().url()).searchParams.get('url') || '');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'From the sweep', description: 'Fetched here' }),
        });
    });
    await openBookmarks(page);
    await tickRows(page, 2);
    await page.locator('#config-bm-panel [data-bm-bulk-action="previews"]').click();

    const overlay = page.locator('#nextdash-progress-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-progress-status]')).toContainText(' of ');
    await expect(overlay.locator('[data-progress-cancel]')).toBeVisible();

    await expect.poll(() => asked.length, { timeout: 20_000 }).toBe(2);
    // On the bookmarks themselves, not only in the server's preview cache.
    await expect.poll(async () => page.evaluate(async () => {
        const rows = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return (Array.isArray(rows) ? rows : []).filter((b) => b.previewTitle === 'From the sweep').length;
    }), { timeout: 20_000 }).toBe(2);
});

test('a refused preview request is waited out, not counted as a failure', async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route('**/api/bookmark-preview**', async (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        asked.push(url);
        if (asked.filter((entry) => entry === url).length === 1) {
            await route.fulfill({
                status: 429,
                headers: { 'Retry-After': '1' },
                contentType: 'application/json',
                body: JSON.stringify({ error: 'rate limited' }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'Second time' }),
        });
    });
    await openBookmarks(page);
    // Two rows: one ticked row is a bookmark, not a selection, and the panel
    // shows that bookmark's own form.
    await tickRows(page, 2);
    await page.locator('#config-bm-panel [data-bm-bulk-action="previews"]').click();

    // Each row is refused once and asked for twice.
    await expect.poll(() => asked.length, { timeout: 25_000 }).toBe(4);
    await expect.poll(async () => page.evaluate(async () => {
        const rows = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return (Array.isArray(rows) ? rows : []).some((b) => b.previewTitle === 'Second time');
    }), { timeout: 20_000 }).toBe(true);
});

test('Stop ends a sweep where it stands', async ({ page }) => {
    let asked = 0;
    await page.route('**/api/bookmark-preview**', async (route) => {
        asked += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: `Row ${asked}` }),
        });
    });
    await openBookmarks(page);
    await tickRows(page, 3);
    await page.locator('#config-bm-panel [data-bm-bulk-action="previews"]').click();

    const overlay = page.locator('#nextdash-progress-overlay');
    await expect(overlay).toBeVisible();
    await overlay.locator('[data-progress-cancel]').click();
    await expect(overlay).toBeHidden({ timeout: 15_000 });

    const seen = asked;
    await page.waitForTimeout(1500);
    expect(asked).toBe(seen);
});
