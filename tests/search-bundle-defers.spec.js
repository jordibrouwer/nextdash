// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Search is fetched by the key that opens it, not by the first paint.
 *
 * The search stack is 394 KB — 17% of the JavaScript the dashboard used to
 * parse before a bookmark was clickable — for a feature that starts on `>`.
 * It rides in its own bundle now, prefetched after `load` so the first press is
 * usually warm, and the grid never waits for it.
 *
 * Three things have to hold, and the third is the one that bites: the eager
 * bundle must not contain search, the grid must render without it, and pressing
 * `>` before the prefetch lands must still open the overlay rather than swallow
 * the key.
 */
async function gotoDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('the page carries no eager search script, only an address for one', async ({ page, baseURL }) => {
    // Read what the server sends, not the live DOM: the prefetch appends a
    // <script> of its own shortly after load, so a DOM query here would be
    // asserting on the loader's work rather than on the page's markup.
    const html = await (await page.request.get(baseURL + '/')).text();

    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    const eagerSearch = srcs.filter(src => /\/search(-commands)?[./]/.test(src) && !src.includes('search-loader'));
    expect(eagerSearch, 'a search script is still fetched on first paint').toEqual([]);

    expect(html).toMatch(/data-nextdash-search-js="[^"]*\/static\/bundle\/search\.js/);
});

test('the grid renders before search has loaded', async ({ page }) => {
    // Hold the bundle so the page is observed in the state it has on a cold,
    // slow connection: rows painted, search still on the wire.
    let release = () => {};
    const held = new Promise((r) => { release = r; });
    await page.route('**/static/bundle/search.js*', async (route) => {
        await held;
        await route.continue();
    });

    await gotoDashboard(page);
    await expect(page.locator('.bookmark-link').first()).toBeVisible();
    expect(await page.locator('.bookmark-link').count()).toBeGreaterThan(0);

    // The keyboard still moves through the grid without the search code.
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(() => page.evaluate(() => Boolean(
            window.dashboardInstance?.keyboardNavigation?.getSelectedBookmark?.())), { timeout: 10_000 })
        .toBe(true);

    release();
});

test('pressing > before the prefetch lands still opens search', async ({ page }) => {
    let release = () => {};
    const held = new Promise((r) => { release = r; });
    await page.route('**/static/bundle/search.js*', async (route) => {
        await held;
        await route.continue();
    });

    await gotoDashboard(page);
    // The key arrives while the bundle is still held: the loader has to take it,
    // wait, and replay it — otherwise the press is lost and the reader presses
    // a key that does nothing.
    await page.keyboard.press('>');
    release();

    await expect
        .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
            { timeout: 15_000 })
        .toBe(true);
});
