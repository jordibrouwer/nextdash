// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A request that failed and a pile with nothing in it must not look alike.
 *
 * loadAndRender started with an empty array and both a non-ok status and a
 * thrown fetch fell through to render(it) -- the catch even said so. So a
 * transient 500, or a dropped connection during the background poll, replaced
 * the whole kept list with "Nothing kept yet.". That is exactly what someone
 * sees after they have just filed everything, so it reads as "it worked"
 * rather than "ask again", and nothing on screen said a request had failed.
 */
async function openKept(page, rows) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.evaluate(async (kept) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (const bookmark of kept) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none',
        });
        await window.dashboardInstance.loadAllBookmarks?.();
    }, rows);

    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView({ tab: 'kept' }));
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible({ timeout: 15_000 });
}

const keptRows = (page) => page.locator('.bookmark-link[data-unsorted-key]');

test('a failed reload leaves the kept pile on screen and says what happened', async ({ page }) => {
    await openKept(page, [
        { name: 'Kept One', url: 'https://kept.example/one' },
        { name: 'Kept Two', url: 'https://kept.example/two' },
    ]);
    const before = await keptRows(page).count();
    expect(before, 'nothing was kept, so there is no pile to lose').toBeGreaterThan(0);

    // The background poll's next round finds the server unwilling.
    await page.route('**/api/unsorted', (route) => route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":"unavailable"}',
    }));

    await page.evaluate(() => window.dashboardInstance.unsorted.loadAndRender());
    await page.waitForTimeout(800);

    expect(await keptRows(page).count(), 'a failed request emptied the kept pile').toBe(before);
    await expect(page.locator('.empty-state--unsorted'),
        'a failed request drew the empty state').toHaveCount(0);
    await expect(page.locator('.notification, .toast, [class*="notification"]').first(),
        'nothing said the reload had failed').toBeVisible({ timeout: 5_000 });
});

// And a pile that really is empty still says so, rather than the fix turning
// every empty view into a silent one.
test('an empty pile still says it is empty', async ({ page }) => {
    await openKept(page, [{ name: 'Only One', url: 'https://kept.example/only' }]);

    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        await window.dashboardInstance.unsorted.loadAndRender();
    });

    await expect(page.locator('.empty-state--unsorted')).toBeVisible({ timeout: 10_000 });
    expect(await keptRows(page).count()).toBe(0);
});
