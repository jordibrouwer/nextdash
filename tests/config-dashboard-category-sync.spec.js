// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function deleteBookmarkByUrl(page, pageId, url) {
    await page.evaluate(async ({ targetPageId, targetUrl }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/bookmarks?page=${targetPageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const bookmark = (list || []).find(
            (bm) => String(bm?.url || '').trim().toLowerCase() === String(targetUrl).trim().toLowerCase()
        );
        if (!bookmark) return;
        await api('/api/bookmarks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: targetPageId, bookmark }),
        });
    }, { targetPageId: pageId, targetUrl: url });
}

test.describe('config to dashboard category sync', () => {
    test('bookmark categorised in config appears in that column on dashboard', async ({ page }) => {
        const uniqueUrl = `https://example.com/config-media-sync-${Date.now()}.test`;
        const uniqueName = `Config media sync ${Date.now()}`;
        const pageId = 1;

        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // Seed an uncategorised bookmark on page 1.
        await page.evaluate(async ({ targetPageId, targetUrl, targetName }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: targetPageId,
                    bookmark: {
                        name: targetName,
                        url: targetUrl,
                        category: '',
                        tags: [],
                        createdAt: Date.now(),
                    },
                }),
            });
            if (!res.ok) {
                throw new Error(`add failed: ${res.status}`);
            }
        }, { targetPageId: pageId, targetUrl: uniqueUrl, targetName: uniqueName });

        // Reload so the config view sees the seeded bookmark, then open Bookmarks.
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await expect(page.locator('#config-bm-list')).toBeVisible();

        // Narrow the list to the seeded bookmark and open its editor.
        await page.locator('#config-bm-search').fill(uniqueName);
        const row = page.locator('#config-bm-list [data-feed-action="edit"]').first();
        await expect(row).toBeVisible({ timeout: 10_000 });
        await row.click();
        await expect(page.locator('#new-bookmark-modal.show')).toBeVisible();

        const categorySelect = page.locator('#new-bookmark-category');
        const targetCategory = await categorySelect.evaluate((el) => {
            const opt = [...el.options].find((o) => o.value && o.value !== '__new__');
            if (!opt) throw new Error('no category options available');
            return opt.value;
        });
        await categorySelect.selectOption(targetCategory);
        await page.locator('#new-bookmark-create').click();

        // The change must reach the server, not just the in-page model.
        await expect.poll(async () => page.evaluate(async ({ targetPageId, targetUrl }) => {
            const res = await fetch(`/api/bookmarks?page=${targetPageId}`);
            const list = res.ok ? await res.json() : [];
            const bm = (list || []).find(
                (b) => String(b?.url || '').trim().toLowerCase() === String(targetUrl).trim().toLowerCase()
            );
            return String(bm?.category ?? '');
        }, { targetPageId: pageId, targetUrl: uniqueUrl }), { timeout: 10_000 }).toBe(targetCategory);

        // And the dashboard must render it under that category, not uncategorised.
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const inCategory = `.category[data-category-id="${targetCategory}"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`;
        await expect(page.locator(inCategory)).toBeVisible({ timeout: 10_000 });

        const uncategorized = `.category[data-category-id=""]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`;
        await expect(page.locator(uncategorized)).toHaveCount(0);

        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });
});
