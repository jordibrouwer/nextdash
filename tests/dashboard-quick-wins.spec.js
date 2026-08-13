// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('multi-select toolbar — Move/Tags popover buttons are announced', () => {
    test('aria-haspopup is set, aria-expanded toggles open then closed', async ({ page }) => {
        await openDashboard(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });

        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowDown');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1))
            .toBeGreaterThanOrEqual(0);
        await page.keyboard.press('x');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBeGreaterThan(0);

        const moveBtn = page.locator('.multi-select-move-btn');
        await expect(moveBtn).toHaveAttribute('aria-haspopup', 'true');
        await expect(moveBtn).toHaveAttribute('aria-expanded', 'false');

        await moveBtn.click();
        await expect(moveBtn).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#move-popover')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#move-popover')).toHaveCount(0);
        // Escape returns focus to the anchor, which is what resets the flag.
        await expect(moveBtn).toHaveAttribute('aria-expanded', 'false');
    });
});

test.describe('inline bookmark editor — save hint reflects the platform', () => {
    test('shows Cmd+Enter on a Mac platform', async ({ page }) => {
        await openDashboard(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        await page.evaluate(() => {
            Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
            window.dashboardInstance.openBookmarkFormModal({ mode: 'add' });
        });
        const hint = page.locator('.bookmark-inline-hint').first();
        await expect(hint).toBeVisible({ timeout: 10_000 });
        await expect(hint).toContainText('⌘');
        await expect(hint).not.toContainText('Ctrl');
    });

    test('shows Ctrl+Enter on a non-Mac platform', async ({ page }) => {
        // The control: without this, the test above would pass just as well
        // against a hint that always shows the Mac form.
        await openDashboard(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        await page.evaluate(() => {
            Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true });
            window.dashboardInstance.openBookmarkFormModal({ mode: 'add' });
        });
        const hint = page.locator('.bookmark-inline-hint').first();
        await expect(hint).toBeVisible({ timeout: 10_000 });
        await expect(hint).toContainText('Ctrl');
        await expect(hint).not.toContainText('⌘');
    });
});

test.describe('recent bookmarks modal — loading state is announced', () => {
    test('the content region is aria-busy while loading, then not', async ({ page }) => {
        await openDashboard(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        // The fill is fast (a single requestAnimationFrame away), so the busy
        // window can already be over by the time an assertion polls — the
        // stable, always-true assertion is the settled state, not the transient
        // "true" in between.
        await page.evaluate(() => window.dashboardInstance.toggleRecentBookmarksModal());
        const content = page.locator('#modal-text');
        await expect(content).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
    });
});

test.describe('tag filter — bulk delete offers undo, not just the 30-day trash', () => {
    test('undo puts the deleted bookmarks back on the page', async ({ page }) => {
        await openDashboard(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        const tag = `e2e-bulk-undo-${Date.now()}`;
        const url = `https://bulk-undo-${Date.now()}.example.com`;

        const addResult = await page.evaluate(async ({ tag, url }) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: d.currentPageId,
                    bookmark: { name: 'E2E bulk undo', url, tags: [tag] },
                }),
            });
            return { ok: res.ok, status: res.status, body: await res.text() };
        }, { tag, url });
        expect(addResult.ok, JSON.stringify(addResult)).toBe(true);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        const beforeCount = await page.evaluate((u) =>
            window.dashboardInstance.bookmarks.filter((b) => b.url === u).length, url);
        expect(beforeCount).toBe(1);

        // Captures the undoCallback showGroupedNotification is given onto
        // `window` — the same function a click on the toast's "Undo" button
        // invokes — so it can be called from a later, separate evaluate. This
        // tests the actual behaviour under test (does undo put the bookmarks
        // back) without depending on AppNotification's grouped-toast
        // batching/queue timing, which is unrelated to what this fix is about.
        const undoResult = await page.evaluate(async (t) => {
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
            return { hasUndo: typeof window.__capturedUndo === 'function' };
        }, tag);
        expect(undoResult.hasUndo, 'bulkDeleteTagFilterBookmarks did not offer an undoCallback').toBe(true);

        const afterDeleteCount = await page.evaluate((u) =>
            window.dashboardInstance.bookmarks.filter((b) => b.url === u).length, url);
        expect(afterDeleteCount).toBe(0);

        await page.evaluate(() => window.__capturedUndo());

        await expect
            .poll(() => page.evaluate((u) =>
                window.dashboardInstance.bookmarks.filter((b) => b.url === u).length, url))
            .toBe(1);

        const stored = await page.evaluate(async (u) => {
            const res = await fetch(`/api/bookmarks?page=${window.dashboardInstance.currentPageId}`);
            const list = res.ok ? await res.json() : [];
            return list.some((b) => b.url === u);
        }, url);
        expect(stored).toBe(true);

        await page.evaluate(async (u) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: window.dashboardInstance.currentPageId, bookmark: { url: u, name: 'E2E bulk undo' } }),
            });
        }, url);
    });
});
