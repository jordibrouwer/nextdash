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
    await page.locator('[data-bm-selbar-action="edit"]').click();
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
        // Slow enough for the bar to be seen.
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'From the sweep', description: 'Fetched here' }),
        });
    });
    await openBookmarks(page);
    await tickRows(page, 2);
    // The side panel asks for a row's preview as it shows it; the sweep's
    // requests are the ones counted.
    asked.length = 0;
    // The panel's own request can land and give a row its preview before the
    // click, and the sweep skips rows that have one: the button says how many
    // rows it will ask for, so the sweep is held to that number, not to two.
    const button = page.locator('#config-bm-panel [data-bm-bulk-action="previews"]');
    const targets = Number(/\((\d+)\)/.exec(await button.textContent())?.[1] || 0);
    expect(targets).toBeGreaterThan(0);
    await button.click();

    const overlay = page.locator('#nextdash-progress-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-progress-status]')).toContainText(' of ');
    await expect(overlay.locator('[data-progress-cancel]')).toBeVisible();

    await expect.poll(() => asked.length, { timeout: 20_000 }).toBe(targets);
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
        // Slow on purpose. Answered at once, three rows were done before the
        // click landed, the bar had closed, and the click waited on a hidden
        // Stop until the test ran out of time. It also meant a Stop that did
        // nothing passed: the sweep had nothing left to stop.
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: `Row ${asked}` }),
        });
    });
    await openBookmarks(page);
    await tickRows(page, 3);
    // The side panel asks for a row's preview as it shows it; only the
    // sweep's requests are counted.
    asked = 0;
    await page.locator('#config-bm-panel [data-bm-bulk-action="previews"]').click();

    const overlay = page.locator('#nextdash-progress-overlay');
    await expect(overlay).toBeVisible();
    await overlay.locator('[data-progress-cancel]').click();
    // Counted when a request starts, so the row in flight is already in here.
    const atStop = asked;
    await expect(overlay).toBeHidden({ timeout: 15_000 });

    await page.waitForTimeout(1500);
    expect(atStop).toBeLessThan(3);
    expect(asked, 'a row was asked for after Stop').toBe(atStop);
});
