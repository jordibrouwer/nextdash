// @ts-check
const { test, expect } = require('@playwright/test');
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
});
