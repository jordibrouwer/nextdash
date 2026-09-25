// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Config → Bookmarks side panel offers the bookmark in it the same tag
 * suggestions the edit form does, under its tags field: + saves the tag at
 * once, ✕ turns it down everywhere. A selection of several gets none -- the
 * dashboard's multi-select is where a tag goes onto many.
 */
async function seedAndOpen(page, host) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
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
        for (const slug of ['a', 'b', 'c']) await add({ name: `Panel ${slug}`, url: `https://${h}/${slug}`, tags: ['homelab'] });
        await add({ name: 'Panel target', url: `https://${h}/target`, tags: [] });
        await d.loadAllBookmarks?.();
        window.TagSuggestLive.changed(d);
        await d.config.openConfigView('bookmarks');
    }, host);
    const row = page.locator('#config-bm-list .config-bm-row', { hasText: 'Panel target' }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
}

test('the side panel offers the bookmark its suggestions, and + saves the tag', async ({ page }) => {
    const host = `panel-${Date.now()}.example`;
    await seedAndOpen(page, host);
    const chips = page.locator('#config-bm-panel [data-bm-suggest]');
    const chip = chips.locator('.tag-suggest-chip[data-tag="homelab"]');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.locator('button').first().click();
    await expect.poll(() => page.evaluate((u) => (window.dashboardInstance.allBookmarks || [])
        .find((b) => b.url === u)?.tags || [], `https://${host}/target`), { timeout: 10_000 }).toContain('homelab');
    await expect(page.locator('#config-bm-panel [data-bm-field="tags"]')).toHaveValue(/homelab/);
    await expect(chips.locator('.tag-suggest-chip[data-tag="homelab"]')).toHaveCount(0);
});
