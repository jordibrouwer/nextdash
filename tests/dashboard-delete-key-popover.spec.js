// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One bookmark is confirmed beside the row; a set of them is confirmed in a modal.
 *
 * Delete used to be the exception. Right-click → Delete and Shift+D both open the
 * anchored two-step popover, but the Delete key — same row, same position, same
 * act — went through AppModal instead. The split itself is worth keeping: a
 * popover next to one row says nothing about the other fourteen in a selection,
 * and the inline editor's row is a form at that moment. Only this route was on
 * the wrong side of it.
 */

const PROBE_NAME = 'E2E delete key probe';
const PROBE_URL = 'https://delete-key.example/probe';

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** A bookmark of our own to delete, so the fixture's own rows are left alone. */
async function addProbeBookmark(page) {
    const ok = await page.evaluate(async ({ name, url }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        const res = await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, bookmark: { name, url } }),
        });
        return res.ok;
    }, { name: PROBE_NAME, url: PROBE_URL });

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    return ok;
}

async function removeProbeBookmark(page) {
    await page.evaluate(async ({ url }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pageId = window.dashboardInstance.currentPageId;
        const res = await api(`/api/bookmarks?page=${pageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const keep = (Array.isArray(list) ? list : []).filter((b) => b.url !== url);
        if (keep.length === (list || []).length) return;
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, { url: PROBE_URL }).catch(() => { /* the page may already be closed */ });
}

/** Put the keyboard cursor on the probe row. */
async function focusProbeRow(page) {
    const found = await page.evaluate(({ url }) => {
        const kn = window.dashboardInstance.keyboardNavigation;
        kn.updateNavigableElements?.();
        const idx = (kn.navigableElements || []).findIndex(
            (row) => row.getAttribute('data-bookmark-url') === url);
        if (idx < 0) return false;
        kn.currentIndex = idx;
        kn.highlightCurrent?.();
        kn.navigableElements[idx].querySelector('a.bookmark-open')?.focus();
        return true;
    }, { url: PROBE_URL });
    expect(found, 'probe bookmark is not on the grid').toBe(true);
}

/**
 * Walk the grid with the arrow keys until the cursor is on a row that belongs to
 * the page currently open, then tick it.
 *
 * Not simply the first row: smart collections render bookmarks from other pages,
 * and a selection keyed to another page resolves to nothing on this one — so the
 * bulk actions quietly do nothing. Which row ArrowDown lands on first depends on
 * what the collections are showing, which depends on what earlier specs left
 * behind.
 */
async function tickFirstCurrentPageRow(page) {
    await page.evaluate(() => document.activeElement?.blur());
    for (let step = 0; step < 25; step += 1) {
        await page.keyboard.press('ArrowDown');
        const onCurrentPage = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const kn = d.keyboardNavigation;
            const row = (kn?.navigableElements || [])[kn?.currentIndex ?? -1];
            if (!row) return false;
            const idx = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
            return Number.isFinite(idx) && idx >= 0 && Boolean(d.bookmarks[idx]);
        });
        if (onCurrentPage) {
            await page.keyboard.press('x');
            return true;
        }
    }
    return false;
}

const probeCount = (page) => page.evaluate(({ url }) =>
    window.dashboardInstance.bookmarks.filter((b) => b.url === url).length, { url: PROBE_URL });

test.describe('the Delete key on a bookmark', () => {
    test.afterEach(async ({ page }) => {
        await removeProbeBookmark(page);
    });

    test('asks in the popover beside the row, not in a modal', async ({ page }) => {
        await openDashboard(page);
        const added = await addProbeBookmark(page);
        test.skip(!added, 'could not add the probe bookmark');
        await focusProbeRow(page);

        await page.keyboard.press('Delete');

        await expect(page.locator('#delete-popover')).toBeVisible({ timeout: 5000 });
        // The modal is what this route used to open; both at once would mean the
        // old path still ran underneath.
        await expect(page.locator('#app-modal.show, .app-modal.show')).toHaveCount(0);
        // Nothing is gone until it is confirmed.
        expect(await probeCount(page)).toBe(1);
    });

    test('it opens against the row it will delete', async ({ page }) => {
        await openDashboard(page);
        const added = await addProbeBookmark(page);
        test.skip(!added, 'could not add the probe bookmark');
        await focusProbeRow(page);

        await page.keyboard.press('Delete');
        await expect(page.locator('#delete-popover')).toBeVisible({ timeout: 5000 });

        const near = await page.evaluate(({ url }) => {
            const pop = document.getElementById('delete-popover').getBoundingClientRect();
            const row = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(url)}"]`)
                .getBoundingClientRect();
            return Math.abs(pop.top - row.top);
        }, { url: PROBE_URL });

        // Anchored, not centred on the viewport the way the modal is.
        expect(near).toBeLessThan(120);
    });

    test('Escape leaves the bookmark alone', async ({ page }) => {
        await openDashboard(page);
        const added = await addProbeBookmark(page);
        test.skip(!added, 'could not add the probe bookmark');
        await focusProbeRow(page);

        await page.keyboard.press('Delete');
        await expect(page.locator('#delete-popover')).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');

        await expect(page.locator('#delete-popover')).toHaveCount(0, { timeout: 5000 });
        expect(await probeCount(page)).toBe(1);
    });

    test('confirming in it actually deletes', async ({ page }) => {
        await openDashboard(page);
        const added = await addProbeBookmark(page);
        test.skip(!added, 'could not add the probe bookmark');
        await focusProbeRow(page);

        await page.keyboard.press('Delete');
        await expect(page.locator('#delete-popover')).toBeVisible({ timeout: 5000 });
        await page.locator('#delete-popover [data-action="confirm"]').click();

        await expect.poll(() => probeCount(page), { timeout: 10_000 }).toBe(0);
    });

    test('with a selection open it still uses the bulk modal', async ({ page }) => {
        await openDashboard(page);
        const ticked = await tickFirstCurrentPageRow(page);
        test.skip(!ticked, 'no row on the current page to select');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBe(1);

        // Answered "no", so the fixture keeps its bookmark either way.
        await page.evaluate(() => {
            window.__bulkAsked = false;
            const real = window.AppModal.danger;
            window.AppModal.danger = async (...args) => {
                window.__bulkAsked = true;
                return false;
            };
            window.__restoreDanger = () => { window.AppModal.danger = real; };
        });

        await page.keyboard.press('Delete');
        await page.waitForTimeout(400);

        expect(await page.evaluate(() => window.__bulkAsked)).toBe(true);
        await expect(page.locator('#delete-popover')).toHaveCount(0);
        await page.evaluate(() => window.__restoreDanger());
    });
});
