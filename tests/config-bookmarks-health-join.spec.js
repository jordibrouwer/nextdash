// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-helpers');

/**
 * The Bookmarks view joined the health report by URL alone, and the report has
 * one issue per row: with the same address on two pages, the later page's
 * issue answered for both, so the panel, its keys and work-through acted on
 * the other page's copy.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

test('each copy of an address on two pages gets its own health issue', async ({ page }) => {
    const url = `https://health-join-${Date.now()}.example/`;
    const pages = await page.evaluate(async (url) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const json = { 'Content-Type': 'application/json' };
        const list = await (await api('/api/pages')).json();
        const second = Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
        await api('/api/pages', { method: 'POST', headers: json, body: JSON.stringify([...list, { id: second, name: 'Reference' }]) });
        const first = list[0].id;
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: first, bookmark: { name: 'On first', url } }) });
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: second, bookmark: { name: 'On second', url }, allowDuplicate: true }) });
        return { first, second };
    }, url);
    await openBookmarks(page);

    const issuePages = await page.evaluate(async ({ url, pages }) => {
        const config = window.dashboardInstance.config;
        await config.bmHealth();
        return [pages.first, pages.second].map((pageId) => Number(config.bmHealthIssue({ url, pageId })?.pageId));
    }, { url, pages });
    expect(issuePages).toEqual([pages.first, pages.second]);
});

// The Expectations form draws "Sign in with" from the credential names. The
// Bookmarks view never loaded them, the select showed "Nothing", and Save
// removed the bookmark's sign-in.
test('the Expectations form keeps a bookmark\'s credential selected', async ({ page }) => {
    await openBookmarks(page);
    const result = await page.evaluate(async () => {
        const config = window.dashboardInstance.config;
        const health = await config.bmHealth();
        const loaded = window.dashboardInstance.healthCredentials !== undefined;
        window.dashboardInstance.healthCredentials = {};
        const html = health.renderCredentialOptions('cred-unknown');
        return { loaded, selected: /value="cred-unknown"\s+selected/.test(html) };
    });
    expect(result.loaded, 'the credential names were not loaded with the report').toBe(true);
    expect(result.selected, 'a credential missing from the list was not kept selected').toBe(true);
});
