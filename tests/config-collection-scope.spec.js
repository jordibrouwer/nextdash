// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Ticking a page under Collection scope saves, and the collection then honours
 * the scope on the dashboard.
 *
 * The bug: the checkbox collected page ids as the strings the DOM hands back,
 * but the four smartXxxPageIds fields are []int on the server. `["1"]` cannot
 * unmarshal into []int, so the whole settings POST came back 400 — every
 * collection reported "Failed to save settings", nothing was written, and the
 * scope was therefore never visible on the dashboard either.
 */
async function openCollections(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Clear any scope left behind by an earlier run, then reload so the config
    // panel renders from the settings that are actually stored.
    await resetScopes(page);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
    await page.locator('[data-pt-tab="collections"]').click();
    await expect(page.locator('[data-scope-field]').first()).toBeAttached();
    // Every box starts clear, so .check() below always represents a real change.
    await expect(page.locator('[data-scope-field]:checked')).toHaveCount(0);
}

/**
 * Put every scope field back to "all pages".
 *
 * Settings persist server-side between specs, so this runs *before* each test
 * rather than after: an afterEach leaves the previous run's state in place if
 * that run failed part-way, and a box that is already ticked makes .check() a
 * no-op — the test then waits for a save that was never going to happen.
 * Goes through nextDashFetch, not bare fetch: writes need the token the app
 * attaches, and a plain fetch here just gets 401 and silently changes nothing.
 */
async function resetScopes(page) {
    const status = await page.evaluate(async () => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await send('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                smartTodayPageIds: [], smartRecentPageIds: [],
                smartStalePageIds: [], smartMostUsedPageIds: [],
            }),
        });
        return res.status;
    });
    expect(status).toBeLessThan(400);
}

test.describe('config collection scope', () => {

    test('ticking a page saves it, as numbers the server accepts', async ({ page }) => {
        const rejected = [];
        page.on('response', (res) => {
            if (res.url().includes('/api/settings')
                && res.request().method() === 'POST' && !res.ok()) {
                rejected.push(res.status());
            }
        });
        let posted = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') posted = route.request().postData();
            await route.fallback();
        });

        await openCollections(page);
        const box = page.locator('[data-scope-field="smartTodayPageIds"]').first();
        await box.scrollIntoViewIfNeeded();
        await box.check();

        await expect.poll(() => posted).not.toBeNull();
        const sent = JSON.parse(posted).smartTodayPageIds;
        // The crux: numbers, not strings. []int rejects the latter outright.
        expect(sent.every((id) => typeof id === 'number')).toBe(true);
        expect(sent.length).toBeGreaterThan(0);

        // No 400, and the value survives a round trip to the server.
        expect(rejected).toEqual([]);
        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch('/api/settings');
            return (await res.json()).smartTodayPageIds;
        })).toEqual(sent);
    });

    // The badge the bug report showed: "Not saved — try again", the is-error
    // state of the shared save indicator.
    test('no "Not saved" badge appears when a scope box is ticked', async ({ page }) => {
        await openCollections(page);
        const box = page.locator('[data-scope-field="smartStalePageIds"]').first();
        await box.scrollIntoViewIfNeeded();
        await box.check();

        // Wait for the save to resolve either way before asserting it went well,
        // so this cannot pass merely by looking before the error lands.
        await expect(page.locator('#config-save-state.is-saved')).toBeAttached({ timeout: 10_000 });
        await expect(page.locator('#config-save-state.is-error')).toHaveCount(0);
    });

    test('unticking removes just that page and still saves', async ({ page }) => {
        await openCollections(page);
        const box = page.locator('[data-scope-field="smartRecentPageIds"]').first();
        await box.scrollIntoViewIfNeeded();
        await box.check();
        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch('/api/settings');
            return (await res.json()).smartRecentPageIds.length;
        })).toBeGreaterThan(0);

        await box.uncheck();
        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch('/api/settings');
            return (await res.json()).smartRecentPageIds;
        })).toEqual([]);
    });

    // _isSmartCollectionPageAllowed ("is the current page in scope") and
    // _smartCollectionFilterNeedsCrossPageData ("does evaluating this scope
    // need bookmarks from other pages") look like inverses but are not: a
    // scope spanning the current page *and* another page is allowed=true and
    // still needs cross-page data=true, and an empty/all-pages scope is
    // allowed=true and needs cross-page data=true too (every page, including
    // others, is in scope). A prior commit collapsed needsCrossPageData into
    // `!isPageAllowed`, which silently broke cross-page bookmark loading for
    // the default empty-pageIds settings — the "empty" and "currentPlusOther"
    // cases below pin exactly the values that regression got wrong, not just
    // internal consistency between the two functions.
    test('needsCrossPageData and isPageAllowed answer different questions, not inverses', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const results = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const currentPageId = Number(d.currentPageId);
            const currentIndex = d.pages.findIndex((p) => Number(p.id) === currentPageId);
            const currentPageNumber = currentIndex >= 0 ? currentIndex + 1 : null;
            const otherPageId = d.pages.map((p) => Number(p.id)).find((id) => id !== currentPageId) ?? 999999;

            const cases = {
                empty: [],
                notArray: null,
                matchingId: [currentPageId],
                matchingIndex: currentPageNumber !== null ? [currentPageNumber] : [currentPageId],
                onlyOtherPage: [otherPageId],
                currentPlusOther: [currentPageId, otherPageId],
            };

            return Object.fromEntries(Object.entries(cases).map(([label, pageIds]) => [label, {
                allowed: d._isSmartCollectionPageAllowed(pageIds),
                needsCrossPage: d._smartCollectionFilterNeedsCrossPageData(pageIds),
            }]));
        });

        // Empty/all-pages scope: current page is trivially in scope, and every
        // other page is too, so cross-page data is always needed. This is the
        // default (unset smartXPageIds), and the exact case the `!allowed`
        // regression broke.
        expect(results.empty).toEqual({ allowed: true, needsCrossPage: true });
        expect(results.notArray).toEqual({ allowed: true, needsCrossPage: true });
        // Scoped to exactly the current page (by id or by 1-based index): in
        // scope, and nothing outside it is needed.
        expect(results.matchingId).toEqual({ allowed: true, needsCrossPage: false });
        expect(results.matchingIndex).toEqual({ allowed: true, needsCrossPage: false });
        // Scoped to a page that isn't current: out of scope, so nothing on
        // this page needs fetching for it either.
        expect(results.onlyOtherPage).toEqual({ allowed: false, needsCrossPage: true });
        // Scoped to current *and* another page: current is in scope (allowed),
        // but the other page's bookmarks still have to be fetched.
        expect(results.currentPlusOther).toEqual({ allowed: true, needsCrossPage: true });
    });
});
