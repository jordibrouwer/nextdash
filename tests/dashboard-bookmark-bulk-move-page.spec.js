// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
} = require('./e2e-helpers');

/**
 * Bulk-moving multi-selected bookmarks to another page, via the shared move
 * popover multi-select and the tag filter view both drive.
 *
 * bulkMoveTagFilterToPage used to GET both pages' whole bookmark arrays,
 * splice/push in memory, and POST both arrays back — two unsynchronized
 * read-modify-writes racing any concurrent write to either page, and if the
 * source save landed but the target save then failed, every selected
 * bookmark vanished from both lists at once. It now moves each bookmark with
 * its own add+delete pair, so one bookmark failing cannot take the others
 * down with it and a mid-move failure never loses a bookmark outright.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
}

async function seedBookmark(page, pageId, name, url) {
    await page.evaluate(async ({ targetPageId, targetName, targetUrl }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: targetPageId,
                bookmark: { name: targetName, url: targetUrl, category: '', tags: [], createdAt: Date.now() },
            }),
        });
        if (!res.ok) throw new Error(`seed bookmark failed: ${res.status}`);
    }, { targetPageId: pageId, targetName: name, targetUrl: url });
}

async function bookmarksOnPage(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/bookmarks?page=${id}`);
        return res.ok ? res.json() : [];
    }, pageId);
}

async function ensureSecondPage(page) {
    return page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        const pages = res.ok ? await res.json() : [];
        const existingOther = pages.find((p) => Number(p.id) !== Number(window.dashboardInstance.currentPageId));
        if (existingOther) return { id: Number(existingOther.id), name: existingOther.name };

        const newId = Math.max(0, ...pages.map((p) => Number(p.id) || 0)) + 1;
        const newName = `Bulk move target ${newId}`;
        const nextPages = [...pages, { id: newId, name: newName }];
        const saveRes = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextPages),
        });
        if (!saveRes.ok) throw new Error(`create second page failed: ${saveRes.status}`);
        return { id: newId, name: newName };
    });
}

/** Tick rows through the multi-select module, the way x/Shift+Z does. */
async function selectRowsByName(page, names) {
    await page.evaluate((wantedNames) => {
        const ms = window.dashboardInstance.multiSelect;
        const rows = [...document.querySelectorAll('.bookmark-link[data-bookmark-index]')];
        wantedNames.forEach((name) => {
            const row = rows.find((r) => r.textContent.includes(name));
            if (row) ms.toggleRow(row);
        });
    }, names);
}

test.describe('bulk move selected bookmarks to another page', () => {
    test('moving two selected bookmarks adds both to the target and removes both from the source', async ({ page }) => {
        const stamp = Date.now();
        const nameA = `Bulk move A ${stamp}`;
        const nameB = `Bulk move B ${stamp}`;
        const urlA = `https://example.com/bulk-move-a-${stamp}.test`;
        const urlB = `https://example.com/bulk-move-b-${stamp}.test`;

        await openDashboard(page);
        const sourcePageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const { id: targetPageId, name: targetName } = await ensureSecondPage(page);

        await seedBookmark(page, sourcePageId, nameA, urlA);
        await seedBookmark(page, sourcePageId, nameB, urlB);
        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });

        await selectRowsByName(page, [nameA, nameB]);
        expect(await page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(2);

        const row = page.locator('.bookmark-link', { hasText: nameA }).first();
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="multi-move"]');

        await page.waitForSelector('#move-popover', { timeout: 10_000 });
        await page.click(`#move-popover .move-popover-item[data-type="page"][data-id="${targetPageId}"]`);

        await expect.poll(async () => {
            const target = await bookmarksOnPage(page, targetPageId);
            return [urlA, urlB].every((u) => target.some((b) => b.url === u));
        }, { timeout: 10_000 }).toBe(true);

        await expect.poll(async () => {
            const source = await bookmarksOnPage(page, sourcePageId);
            return [urlA, urlB].some((u) => source.some((b) => b.url === u));
        }, { timeout: 10_000 }).toBe(false);

        // A stray debounced reorder-save must not flush a stale pre-move
        // snapshot back and silently resurrect either bookmark on the source.
        await page.waitForTimeout(1500);
        const sourceAfterSettle = await bookmarksOnPage(page, sourcePageId);
        expect([urlA, urlB].some((u) => sourceAfterSettle.some((b) => b.url === u))).toBe(false);

        await expect(page.locator('.app-notification', { hasText: targetName })).toBeVisible({ timeout: 10_000 });
    });

    test('one bookmark failing to add does not block the other from moving', async ({ page }) => {
        const stamp = Date.now();
        const nameA = `Bulk move fail A ${stamp}`;
        const nameB = `Bulk move fail B ${stamp}`;
        const urlA = `https://example.com/bulk-move-fail-a-${stamp}.test`;
        const urlB = `https://example.com/bulk-move-fail-b-${stamp}.test`;

        await openDashboard(page);
        const sourcePageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const { id: targetPageId } = await ensureSecondPage(page);

        await seedBookmark(page, sourcePageId, nameA, urlA);
        await seedBookmark(page, sourcePageId, nameB, urlB);
        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });

        // Only bookmark A's add is made to fail; B's must still go through.
        await page.route('**/api/bookmarks/add', async (route) => {
            const body = route.request().postDataJSON();
            if (body?.bookmark?.url === urlA) {
                await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'forced failure' }) });
                return;
            }
            await route.fallback();
        });

        await selectRowsByName(page, [nameA, nameB]);
        expect(await page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(2);

        const row = page.locator('.bookmark-link', { hasText: nameA }).first();
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="multi-move"]');
        await page.waitForSelector('#move-popover', { timeout: 10_000 });
        await page.click(`#move-popover .move-popover-item[data-type="page"][data-id="${targetPageId}"]`);

        await expect.poll(async () => {
            const target = await bookmarksOnPage(page, targetPageId);
            return target.some((b) => b.url === urlB);
        }, { timeout: 10_000 }).toBe(true);

        const target = await bookmarksOnPage(page, targetPageId);
        expect(target.some((b) => b.url === urlA)).toBe(false);

        const source = await bookmarksOnPage(page, sourcePageId);
        expect(source.some((b) => b.url === urlA)).toBe(true);
        expect(source.some((b) => b.url === urlB)).toBe(false);
    });
});
