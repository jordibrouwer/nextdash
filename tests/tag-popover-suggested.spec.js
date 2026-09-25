// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Shift+T offers what the engine would tag the row.
 *
 * The row's own tag popover listed every tag you have and nothing about which
 * of them this bookmark is likely to want, while Config, the inbox, Kept and
 * the bookmark form all knew. The suggestions stand at the top, and taking
 * one is the same click as any other tag in the list.
 */
test('Shift+T shows the tag the row\'s site agrees on, and a click adds it', async ({ page }) => {
    // A host of its own, so a second copy from an earlier test or a retry is
    // never the row selected, and the seeds are the only evidence.
    const host = `pop-${Date.now()}.example`;
    const url = `https://${host}/target`;
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (h) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const add = (bookmark) => api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, allowDuplicate: true, bookmark: { category: '', createdAt: Date.now(), ...bookmark } }),
        });
        for (const slug of ['a', 'b', 'c']) await add({ name: `Pop ${slug} ${h}`, url: `https://${h}/${slug}`, tags: ['homelab'] });
        await add({ name: `Pop target ${h}`, url: `https://${h}/target`, tags: [] });
        await d.loadData?.();
    }, host);
    // The engine reads allBookmarks; wait until the seeds are in it before
    // asking, rather than trusting loadData to have finished with them.
    await page.waitForFunction((h) => (window.dashboardInstance.allBookmarks || [])
        .filter((b) => String(b.url || '').includes(h)).length >= 4, host, { timeout: 10_000 });
    await page.evaluate(() => window.TagSuggestLive.invalidate());
    const row = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await page.evaluate((u) => {
        const el = document.querySelector(`.bookmark-link[data-bookmark-url="${u}"]`);
        window.dashboardInstance.keyboardNavigation.selectBookmarkRow(el);
    }, url);
    await page.keyboard.press('Shift+T');
    const suggested = page.locator('#tag-popover .tag-popover-suggested .move-popover-item[data-tag="homelab"]');
    await expect(suggested).toBeVisible();
    await suggested.click();
    await expect.poll(() => page.evaluate((u) => window.dashboardInstance.allBookmarks
        .find((b) => b.url === u)?.tags || [], url)).toContain('homelab');
});

test('Shift+T opens at the top of its list, suggestions in view, however long the list', async ({ page }) => {
    const host = `top-${Date.now()}.example`;
    await page.setViewportSize({ width: 1400, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (h) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const add = (bookmark) => api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, allowDuplicate: true, bookmark: { category: '', createdAt: Date.now(), ...bookmark } }),
        });
        // A long library, so the list scrolls.
        const many = Array.from({ length: 30 }, (_, i) => `aa-filler-${String(i).padStart(2, '0')}`);
        await add({ name: `Filler ${h}`, url: `https://filler-${h}/`, tags: many });
        for (const slug of ['a', 'b', 'c']) await add({ name: `Top ${slug} ${h}`, url: `https://${h}/${slug}`, tags: ['homelab'] });
        // The row's own tag sorts last, far down the list.
        await add({ name: `Top target ${h}`, url: `https://${h}/target`, tags: ['zz-late'] });
        await d.loadData?.();
        window.TagSuggestLive.invalidate();
    }, host);
    const url = `https://${host}/target`;
    const row = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await page.evaluate((u) => {
        const el = document.querySelector(`.bookmark-link[data-bookmark-url="${u}"]`);
        window.dashboardInstance.keyboardNavigation.selectBookmarkRow(el);
    }, url);
    await page.keyboard.press('Shift+T');
    const pop = page.locator('#tag-popover');
    await expect(pop).toBeVisible();
    const state = await pop.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const sug = el.querySelector('.tag-popover-suggested .move-popover-item')?.getBoundingClientRect();
        return {
            scrolls: el.scrollHeight > el.clientHeight,
            scrollTop: el.scrollTop,
            suggestionInView: !!sug && sug.top >= box.top && sug.bottom <= box.bottom,
        };
    });
    expect(state.scrolls).toBe(true);
    expect(state).toEqual({ scrolls: true, scrollTop: 0, suggestionInView: true });
});
