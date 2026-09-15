// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Escape on a bare grid: home, then search.
 *
 * Every overlay answers Escape and the key travels the whole chain when none of
 * them is open, so on a dashboard with nothing on top of it the press reached
 * the grid and did nothing at all. Two steps out of that now: from any other
 * page it goes home, the way Escape leaves config or the inbox, and from the
 * first page — where there is nowhere further out — it opens search.
 *
 * Everything that has a closer claim keeps it: a modal, an open search, a
 * multi-select, a cursor on a row. Escape only travels this far when there is
 * nothing left to close.
 */
async function openWithPages(page, count = 3) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pages = [...dash.pages];
        for (let i = pages.length; i < n; i += 1) pages.push({ id: 3100 + i, name: `page-${i}` });
        const saved = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
        await dash.loadData();
        dash.pageNav?.renderPageNavigation?.();
    }, count);
    await page.waitForTimeout(400);
}

const currentPage = (page) => page.evaluate(() => Number(window.dashboardInstance.currentPageId));
const firstPage = (page) => page.evaluate(() => Number(window.dashboardInstance.pages[0].id));

/** Through the key a reader presses, not through the navigation call. */
async function goToThirdPage(page) {
    await page.keyboard.press('3');
    await expect.poll(() => currentPage(page), { timeout: 10_000 })
        .toBe(await page.evaluate(() => Number(window.dashboardInstance.pages[2].id)));
}

test('Escape on a bare grid goes back to the first page', async ({ page }) => {
    await openWithPages(page);
    await goToThirdPage(page);

    await page.keyboard.press('Escape');

    await expect.poll(() => currentPage(page), { timeout: 10_000 }).toBe(await firstPage(page));
    // Going home is not opening search: one press, one thing.
    expect(await page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), 'the way home opened search as well').toBe(false);
});

/*
 * And the ring goes with the page.
 *
 * closeSearch() hands focus back to #search-button, so after any visit to
 * search the header keeps the focus ring -- which made the next Escape read as
 * "the key focused search" rather than "the key went home".
 */
test('Escape leaves nothing in the header holding focus', async ({ page }) => {
    await openWithPages(page);
    await goToThirdPage(page);

    // Open search and leave it again: that is what parks focus on the button.
    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(false);

    await page.keyboard.press('Escape');

    await expect.poll(() => currentPage(page), { timeout: 10_000 }).toBe(await firstPage(page));
    expect(await page.evaluate(
        () => Boolean(document.activeElement?.closest?.('.section-controls')),
    ), 'the header still holds the focus ring').toBe(false);
});

test('Escape on the first page opens search', async ({ page }) => {
    await openWithPages(page);
    const home = await firstPage(page);
    expect(await currentPage(page)).toBe(home);

    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(true);
    expect(await currentPage(page), 'the first page went somewhere').toBe(home);

    // And the next Escape closes it again, which is search's own answer to the
    // key -- this fallback never sees it.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(false);
});

test('a cursor on a row is dropped first, and the page stays', async ({ page }) => {
    await openWithPages(page);
    // A seeded page is empty, and a cursor needs a row to stand on.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.pages[2].id;
        const saved = await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ name: 'somewhere', url: 'https://example.com', category: '' }]),
        });
        if (!saved.ok) throw new Error(`seeding a bookmark failed: ${saved.status}`);
        await dash.loadData();
    });
    await goToThirdPage(page);
    await page.waitForSelector('.bookmark-link', { timeout: 10_000 });
    const away = await currentPage(page);

    // Arrow down puts the cursor on a row; that is what the first Escape is for.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(0);
    expect(await currentPage(page), 'the cursor and the page went in one press').toBe(away);

    // The second press, with nothing left to drop, goes home.
    await page.keyboard.press('Escape');
    await expect.poll(() => currentPage(page), { timeout: 10_000 }).toBe(await firstPage(page));
});

test('Escape closes the panel it opened, and leaves the page alone', async ({ page }) => {
    await openWithPages(page);
    await goToThirdPage(page);
    const away = await currentPage(page);

    await page.keyboard.press(',');
    await page.waitForSelector('#app-modal.show .page-overview-modal', { timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal.show .page-overview-modal')).toHaveCount(0);
    expect(await currentPage(page), 'closing the panel also left the page').toBe(away);
});
