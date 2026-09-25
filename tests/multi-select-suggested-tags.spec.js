// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The multi-select Tags popover offers what the engine would tag the
 * selection, with how many of the selected rows each offer is for -- and a
 * click puts the tag only on those rows, not on every row selected.
 */
test('a selection is offered the tag its site agrees on, and it lands only where offered', async ({ page }) => {
    const host = `sel-${Date.now()}.example`;
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (h) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const add = (bookmark) => api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, allowDuplicate: true, bookmark: { category: '', createdAt: Date.now(), ...bookmark } }),
        });
        for (const slug of ['a', 'b', 'c']) await add({ name: `Sel ${slug} ${h}`, url: `https://${h}/${slug}`, tags: ['homelab'] });
        await add({ name: `Sel target ${h}`, url: `https://${h}/target`, tags: [] });
        await add({ name: `Other target ${h}`, url: `https://other-${h}/x`, tags: [] });
    }, host);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const size = await page.evaluate((h) => {
        const d = window.dashboardInstance;
        const ms = d.multiSelect;
        ms.clear();
        d.bookmarks.filter((b) => [`Sel target ${h}`, `Other target ${h}`].includes(b.name))
            .forEach((b) => ms.selected.add(ms.keyFor(b, d.currentPageId)));
        ms.sync();
        return ms.selected.size;
    }, host);
    expect(size).toBe(2);

    await page.locator('.multi-select-tags-btn').click();
    const suggested = page.locator('#multi-select-tags-popover .tag-popover-suggested [data-tag="homelab"]');
    await expect(suggested).toContainText('1 of 2');
    await suggested.click();
    await expect.poll(() => page.evaluate((h) => {
        const all = window.dashboardInstance.bookmarks;
        return {
            sel: all.find((b) => b.name === `Sel target ${h}`)?.tags || [],
            other: all.find((b) => b.name === `Other target ${h}`)?.tags || [],
        };
    }, host), { timeout: 10_000 }).toEqual({ sel: ['homelab'], other: [] });
});
