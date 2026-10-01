// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Category ids belong to one page. A move to another page sent the source
 * page's id along, and on the target the row sat under "Unknown category".
 * It takes the target's category with the same name, or none.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('a bookmark moved to another page takes the category of the same name there', async ({ page }) => {
    await openDashboard(page);
    const stamp = Date.now();
    const setup = await page.evaluate(async (stamp) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const json = { 'Content-Type': 'application/json' };
        const source = Number(d.currentPageId);
        const list = await (await api('/api/pages')).json();
        const target = Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
        await api('/api/pages', { method: 'POST', headers: json, body: JSON.stringify([...list, { id: target, name: `move-cat-${stamp}` }]) });
        const sourceCats = await (await api(`/api/categories?page=${source}`)).json();
        await api(`/api/categories?page=${source}`, { method: 'POST', headers: json, body: JSON.stringify([...sourceCats, { id: `src-media-${stamp}`, name: `Media ${stamp}` }, { id: `src-only-${stamp}`, name: `Only ${stamp}` }]) });
        await api(`/api/categories?page=${target}`, { method: 'POST', headers: json, body: JSON.stringify([{ id: `dst-media-${stamp}`, name: `media ${stamp}` }]) });
        const urls = [`https://move-cat-a-${stamp}.example/`, `https://move-cat-b-${stamp}.example/`];
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: source, bookmark: { name: 'A', url: urls[0], category: `src-media-${stamp}` } }) });
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: source, bookmark: { name: 'B', url: urls[1], category: `src-only-${stamp}` } }) });
        return { source, target, urls };
    }, stamp);
    await openDashboard(page);

    for (const url of setup.urls) {
        await page.evaluate(async ({ url, target }) => {
            const d = window.dashboardInstance;
            const index = d.bookmarks.findIndex((b) => b.url === url);
            await d._moveBookmarkToPage({ index, scope: 'current', bookmark: d.bookmarks[index] }, { ...d.bookmarks[index] }, target, null);
        }, { url, target: setup.target });
    }

    const onTarget = await page.evaluate(async (target) => {
        const body = await (await fetch(`/api/bookmarks?page=${target}`)).json();
        return Object.fromEntries((Array.isArray(body) ? body : body.bookmarks || []).map((b) => [b.url, b.category || '']));
    }, setup.target);
    expect(onTarget[setup.urls[0]]).toBe(`dst-media-${stamp}`);
    expect(onTarget[setup.urls[1]]).toBe('');
});
