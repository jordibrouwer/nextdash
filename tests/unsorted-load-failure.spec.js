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

/**
 * A refusal that will read differently next time does not count as having
 * asked.
 *
 * _previewAsked is marked before the request, so a second hover while the first
 * is in flight does not ask twice. Only the catch cleared it again, and a 429
 * is not a thrown fetch -- so hovering enough rows to trip the server's own
 * 60/min gate meant every URL caught by it never loaded a preview again for the
 * rest of the session, however often it was hovered.
 *
 * Read off _previewAsked rather than by counting requests: the hover card asks
 * the same endpoint for the same address, so a request count measures both
 * paths at once and this is about exactly one of them.
 */
const askedFor = (page, url) => page.evaluate(
    (wanted) => Boolean(window.dashboardInstance.unsorted._previewAsked?.has(wanted)),
    url,
);

async function hoverFirstRowWithPreviewStatus(page, status) {
    await page.route('**/api/bookmark-preview**', (route) => route.fulfill({
        status,
        contentType: 'application/json',
        body: '{"error":"refused"}',
    }));
    // The hover delay is a setting; shorten it so the test is not mostly waiting.
    await page.evaluate(() => { window.dashboardInstance.settings.linkPreviewHoverDelayMs = 30; });

    const row = page.locator('.bookmark-link[data-unsorted-key]').first();
    await row.hover();
    await page.waitForTimeout(1200);
}

test('a preview refused with 429 may be asked for again', async ({ page }) => {
    const url = 'https://preview.example/one';
    await openKept(page, [{ name: 'Preview Me', url }]);

    await hoverFirstRowWithPreviewStatus(page, 429);

    expect(await askedFor(page, url),
        'the address stayed marked as asked, so the next hover will not try again')
        .toBe(false);
});

// A refusal about the address itself is not worth asking again on every hover:
// the answer is not going to change, and it spends the same per-minute budget.
test('a preview refused with 404 is not asked for again', async ({ page }) => {
    const url = 'https://preview.example/gone';
    await openKept(page, [{ name: 'Gone', url }]);

    await hoverFirstRowWithPreviewStatus(page, 404);

    expect(await askedFor(page, url),
        'a 404 was cleared, so every hover spends the budget on an unchanging answer')
        .toBe(true);
});
