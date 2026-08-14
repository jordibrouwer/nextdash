// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Deleting a selection offered no way back and said nothing when it failed.
 *
 * The single-row delete has had an undo toast for a while, and the tag-filter
 * bulk delete grew one too — the multi-select toolbar's Delete, the one route
 * that removes fifteen bookmarks at once, was the one without it. On a failed
 * save it was worse than silent: the rows were already spliced out of the model
 * and the selection already cleared, and the early return left the user looking
 * at a grid that had lost bookmarks the server still had.
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

/**
 * Tick two rows the way a user does, and report what is selected.
 *
 * Walks to a row belonging to the page currently open before ticking: smart
 * collections render rows from other pages, and a selection keyed to another
 * page resolves to nothing here, so deleteSelected would quietly return before
 * any of this is exercised.
 */
async function selectTwoBookmarks(page) {
    await page.evaluate(() => document.activeElement?.blur());
    let ticked = 0;
    for (let step = 0; step < 25 && ticked < 2; step += 1) {
        await page.keyboard.press('ArrowDown');
        const onCurrentPage = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const kn = d.keyboardNavigation;
            const row = (kn?.navigableElements || [])[kn?.currentIndex ?? -1];
            if (!row) return false;
            const idx = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
            return Number.isFinite(idx) && idx >= 0 && Boolean(d.bookmarks[idx]);
        });
        if (!onCurrentPage) continue;
        await page.keyboard.press('x');
        ticked += 1;
    }
    expect(ticked, 'not enough rows on the current page to select two').toBe(2);
    await expect
        .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
        .toBe(2);

    return page.evaluate(() => window.dashboardInstance.multiSelect
        .resolveRefs().map((ref) => ref.bookmark.url));
}

const urlsOnPage = (page) => page.evaluate(
    () => window.dashboardInstance.bookmarks.map((b) => b.url));

/**
 * Run deleteSelected with the confirmation auto-answered, capturing the
 * undoCallback the toast is given so a later evaluate can invoke exactly what a
 * click on "Undo" invokes. Going through the rendered toast instead would make
 * this depend on AppNotification's grouped-toast batching, which is not what is
 * under test here.
 */
async function deleteSelectionCapturingUndo(page) {
    return page.evaluate(async () => {
        const d = window.dashboardInstance;
        const originalDanger = window.AppModal.danger;
        window.AppModal.danger = async () => true;
        const originalGrouped = d.showGroupedNotification.bind(d);
        window.__capturedUndo = null;
        d.showGroupedNotification = (...args) => {
            window.__capturedUndo = args[4]?.undoCallback || null;
            return originalGrouped(...args);
        };
        try {
            await d.multiSelect.deleteSelected();
        } finally {
            window.AppModal.danger = originalDanger;
            d.showGroupedNotification = originalGrouped;
        }
        return { hasUndo: typeof window.__capturedUndo === 'function' };
    });
}

test.describe('deleting a selection', () => {
    test('offers an undo that puts every bookmark back', async ({ page }) => {
        await openDashboard(page);
        const before = await urlsOnPage(page);
        const selected = await selectTwoBookmarks(page);
        expect(selected).toHaveLength(2);

        const { hasUndo } = await deleteSelectionCapturingUndo(page);
        expect(hasUndo, 'deleteSelected did not offer an undoCallback').toBe(true);

        const afterDelete = await urlsOnPage(page);
        selected.forEach((url) => expect(afterDelete).not.toContain(url));

        await page.evaluate(() => window.__capturedUndo());
        await expect.poll(() => urlsOnPage(page), { timeout: 10_000 }).toEqual(before);
    });

    test('the undo restores them in their original positions', async ({ page }) => {
        await openDashboard(page);
        const before = await urlsOnPage(page);
        await selectTwoBookmarks(page);

        await deleteSelectionCapturingUndo(page);
        await page.evaluate(() => window.__capturedUndo());
        await expect.poll(() => urlsOnPage(page), { timeout: 10_000 }).toEqual(before);

        // And it stuck on the server, not only in memory: this is the whole
        // point of undoing through saveBookmarkOrder rather than through the
        // trash.
        const stored = await page.evaluate(async () => {
            const res = await fetch(`/api/bookmarks?page=${window.dashboardInstance.currentPageId}`);
            const body = await res.json();
            return (Array.isArray(body) ? body : body.bookmarks || []).map((b) => b.url);
        });
        expect(stored).toEqual(before);
    });

    test('a failed save puts the rows back and says so', async ({ page }) => {
        await openDashboard(page);
        const before = await urlsOnPage(page);
        await selectTwoBookmarks(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const originalDanger = window.AppModal.danger;
            window.AppModal.danger = async () => true;
            // The write the delete depends on, refusing.
            const originalSave = d.saveBookmarkOrder.bind(d);
            d.saveBookmarkOrder = async () => false;
            let errorShown = '';
            const originalError = d.showErrorNotification.bind(d);
            d.showErrorNotification = (message, ...rest) => {
                errorShown = String(message || '');
                return originalError(message, ...rest);
            };
            try {
                await d.multiSelect.deleteSelected();
            } finally {
                window.AppModal.danger = originalDanger;
                d.saveBookmarkOrder = originalSave;
                d.showErrorNotification = originalError;
            }
            return { errorShown };
        });

        expect(result.errorShown).not.toBe('');
        expect(await urlsOnPage(page)).toEqual(before);
    });
});
