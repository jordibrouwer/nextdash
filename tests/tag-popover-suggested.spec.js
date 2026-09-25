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
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const add = (bookmark) => api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, bookmark: { category: '', ...bookmark } }),
        });
        for (const slug of ['a', 'b', 'c']) await add({ name: `Pop ${slug}`, url: `https://pop.example/${slug}`, tags: ['homelab'] });
        await add({ name: 'Pop target', url: 'https://pop.example/target', tags: [] });
        await d.loadData?.();
        window.TagSuggestLive.invalidate();
    });
    const row = page.locator('.bookmark-link[data-bookmark-url="https://pop.example/target"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
        const row = document.querySelector('.bookmark-link[data-bookmark-url="https://pop.example/target"]');
        window.dashboardInstance.keyboardNavigation.selectBookmarkRow(row);
    });
    await page.keyboard.press('Shift+T');
    const suggested = page.locator('#tag-popover .tag-popover-suggested .move-popover-item[data-tag="homelab"]');
    await expect(suggested).toBeVisible();
    await suggested.click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.allBookmarks
        .find((b) => b.url === 'https://pop.example/target')?.tags || [])).toContain('homelab');
});
