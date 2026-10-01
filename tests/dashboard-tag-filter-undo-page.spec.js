// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The tag filter's bulk delete offers an undo for eight seconds, and a page
 * switch fits in that. The undo spliced the rows into whatever page was
 * showing and saved it, so they landed on the wrong page and their own page
 * stayed without them.
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

const readPage = (page, id) => page.evaluate(async (id) => {
    const res = await fetch(`/api/bookmarks?page=${id}`);
    const body = await res.json();
    return (Array.isArray(body) ? body : body.bookmarks || []).map((b) => b.url);
}, id);

test('undo of a tag-filter delete after a page switch puts the rows back on their own page', async ({ page }) => {
    await openDashboard(page);
    const tag = `undo-page-${Date.now()}`;
    const urls = [1, 2].map((n) => `https://tag-undo-${n}-${Date.now()}.example.com/`);
    const { source, other } = await page.evaluate(async ({ tag, urls }) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        let target = list.find((p) => p.name === 'tag-undo-target');
        if (!target) {
            target = { id: Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1, name: 'tag-undo-target' };
            await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...list, target]) });
        }
        for (const url of urls) {
            await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: { name: url, url, tags: [tag] } }),
            });
        }
        return { source: Number(d.currentPageId), other: Number(target.id) };
    }, { tag, urls });
    await openDashboard(page);

    await page.evaluate(async (t) => {
        const d = window.dashboardInstance;
        d._tagFilters = [t];
        const originalDanger = window.AppModal.danger;
        window.AppModal.danger = async () => true;
        const originalGrouped = d.showGroupedNotification.bind(d);
        d.showGroupedNotification = (...args) => {
            window.__capturedUndo = args[4]?.undoCallback || null;
            return originalGrouped(...args);
        };
        try {
            await d.tagFilter.bulkDeleteTagFilterBookmarks();
        } finally {
            window.AppModal.danger = originalDanger;
            d.showGroupedNotification = originalGrouped;
        }
    }, tag);
    expect(await page.evaluate(() => typeof window.__capturedUndo)).toBe('function');
    expect(await readPage(page, source)).not.toContain(urls[0]);

    await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id), other);
    await expect.poll(() => page.evaluate(() => Number(window.dashboardInstance.currentPageId))).toBe(other);
    await page.evaluate(() => window.__capturedUndo());

    await expect.poll(async () => {
        const back = await readPage(page, source);
        return urls.every((url) => back.includes(url));
    }, { timeout: 10_000 }).toBe(true);
    const onOther = await readPage(page, other);
    urls.forEach((url) => expect(onOther).not.toContain(url));
});
