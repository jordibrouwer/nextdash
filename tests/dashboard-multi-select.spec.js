// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    WRITE_TOKEN,
} = require('./e2e-helpers');

// The E2E server runs with NEXTDASH_WRITE_TOKEN, so page.request writes need
// the header the dashboard's own fetch wrapper adds. Without it every write
// here silently returns 401.
const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Multi-select on the bookmark grid, driven the way a user drives it.
 *
 * The selection is keyed by page + URL + name rather than by DOM node or array
 * index, because the grid re-renders on nearly every mutation. These tests go
 * through real keys and real clicks so a selection that only survives in the
 * model but not on screen still fails.
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

/** Put the keyboard cursor on the first bookmark, the way a user starts. */
async function focusFirstBookmark(page) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1))
        .toBeGreaterThanOrEqual(0);
}

const selectionCount = (page) =>
    page.evaluate(() => window.dashboardInstance.multiSelect.count());

/**
 * Distinct selected bookmarks on screen.
 *
 * A bookmark that also appears in a smart collection is rendered twice, and
 * both copies light up because they are the same bookmark. Counting elements
 * would therefore count it twice.
 */
const selectedRowCount = (page) =>
    page.evaluate(() => new Set(
        [...document.querySelectorAll('.bookmark-link.is-multi-selected')]
            .map((row) => window.dashboardInstance.multiSelect.keyForRow(row))
    ).size);

/** Delete is guarded by the in-app modal, not by window.confirm. */
async function confirmDangerModal(page) {
    const confirmBtn = page.locator('#modal-actions button').first();
    await confirmBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await confirmBtn.click();
}

test.describe('multi-select', () => {
    test('x ticks the row and advances to the next one', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);

        const firstIndex = await page.evaluate(
            () => window.dashboardInstance.keyboardNavigation.currentIndex
        );

        await page.keyboard.press('x');

        expect(await selectionCount(page)).toBe(1);
        expect(await selectedRowCount(page)).toBe(1);

        // The cursor moved on, so ticking a run is x-x-x.
        const afterIndex = await page.evaluate(
            () => window.dashboardInstance.keyboardNavigation.currentIndex
        );
        expect(afterIndex).toBe(firstIndex + 1);

        await page.keyboard.press('x');
        expect(await selectionCount(page)).toBe(2);
        expect(await selectedRowCount(page)).toBe(2);
    });

    test('the toolbar appears with the selection and reports the count', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);

        await expect(page.locator('.multi-select-toolbar')).toHaveCount(0);

        await page.keyboard.press('x');
        await page.keyboard.press('x');

        const toolbar = page.locator('.multi-select-toolbar');
        await expect(toolbar).toBeVisible();
        await expect(toolbar.locator('.multi-select-count')).toContainText('2');
    });

    test('Escape clears the selection before it clears the cursor', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);
        await page.keyboard.press('x');
        expect(await selectionCount(page)).toBe(1);

        const cursorBefore = await page.evaluate(
            () => window.dashboardInstance.keyboardNavigation.currentIndex
        );

        await page.keyboard.press('Escape');

        // Selection gone...
        expect(await selectionCount(page)).toBe(0);
        await expect(page.locator('.multi-select-toolbar')).toHaveCount(0);
        // ...cursor still there, so one press did not cost both.
        expect(await page.evaluate(
            () => window.dashboardInstance.keyboardNavigation.currentIndex
        )).toBe(cursorBefore);
    });

    test('Shift+ArrowDown extends the selection over a range', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);

        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');

        // Anchor row plus the two the cursor moved over.
        expect(await selectionCount(page)).toBe(3);
        expect(await selectedRowCount(page)).toBe(3);
    });

    test('a range selects one entry per bookmark, not per rendered row', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);

        // A bookmark shown in a smart collection is rendered twice, so a range
        // that runs the length of the grid must still come out at one entry per
        // bookmark — and every entry has to resolve to a real one.
        await page.keyboard.press('Control+a');

        const bookmarkCount = await page.evaluate(
            () => window.dashboardInstance.bookmarks.length
        );
        expect(await selectionCount(page)).toBe(bookmarkCount);
        expect(await page.evaluate(
            () => window.dashboardInstance.multiSelect.resolveRefs().length
        )).toBe(bookmarkCount);
    });

    test('Alt+click ticks a row without opening it', async ({ page }) => {
        await openDashboard(page);

        const firstRow = page.locator('.bookmark-link[data-bookmark-index]').first();
        await firstRow.locator('a.bookmark-open').click({ modifiers: ['Alt'] });

        expect(await selectionCount(page)).toBe(1);
        // Still on the dashboard: the click did not follow the link.
        await expect(page.locator('#dashboard-layout')).toBeVisible();
    });

    /**
     * Cmd/Ctrl+click belongs to the browser.
     *
     * It used to tick the row, with preventDefault — so the one modifier every
     * link on the web honours did the opposite of what it does everywhere else,
     * and on a Mac it came with the row menu on top, Ctrl+click being the
     * platform's secondary click.
     */
    test('Cmd/Ctrl+click opens the bookmark instead of ticking it', async ({ page, context }) => {
        await openDashboard(page);

        const firstRow = page.locator('.bookmark-link[data-bookmark-index]').first();
        const opened = context.waitForEvent('page', { timeout: 10_000 });
        await firstRow.locator('a.bookmark-open').click({ modifiers: ['ControlOrMeta'] });

        const tab = await opened;
        await tab.close();
        expect(await selectionCount(page)).toBe(0);
        // And the open is still counted: letting the default through means the
        // anchor's own handler never runs, so the row records it itself.
        await expect.poll(() => page.evaluate(() =>
            (window.dashboardInstance.bookmarks[0].openCount || 0) > 0), { timeout: 5_000 }).toBe(true);
    });

    test('Shift+click extends from the ticked row', async ({ page }) => {
        await openDashboard(page);

        const rows = page.locator('.bookmark-link[data-bookmark-index]');
        await rows.nth(0).locator('a.bookmark-open').click({ modifiers: ['Alt'] });
        await rows.nth(2).locator('a.bookmark-open').click({ modifiers: ['Shift'] });

        expect(await selectionCount(page)).toBe(3);
    });

    test('a plain click clears the selection instead of opening', async ({ page }) => {
        await openDashboard(page);

        const rows = page.locator('.bookmark-link[data-bookmark-index]');
        await rows.nth(0).locator('a.bookmark-open').click({ modifiers: ['Alt'] });
        expect(await selectionCount(page)).toBe(1);

        await rows.nth(3).locator('a.bookmark-open').click();

        expect(await selectionCount(page)).toBe(0);
        await expect(page.locator('#dashboard-layout')).toBeVisible();
    });

    test('the selection survives a re-render', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);
        await page.keyboard.press('x');
        await page.keyboard.press('x');
        expect(await selectionCount(page)).toBe(2);

        // A render replaces every row element; the ticks must land on the new
        // nodes rather than disappearing with the old ones. Both routes matter:
        // most mutations take the incremental path, which returns before the
        // full rebuild ever runs.
        await page.evaluate(() => window.dashboardInstance.renderDashboard());
        expect(await selectionCount(page)).toBe(2);
        await expect.poll(() => selectedRowCount(page)).toBe(2);

        await page.evaluate(() => window.dashboardInstance.renderDashboard({ incremental: false }));
        expect(await selectionCount(page)).toBe(2);
        await expect.poll(() => selectedRowCount(page)).toBe(2);
    });

    test('a selected bookmark deleted elsewhere drops out of the selection', async ({ page }) => {
        await openDashboard(page);
        await focusFirstBookmark(page);
        await page.keyboard.press('x');
        await page.keyboard.press('x');
        expect(await selectionCount(page)).toBe(2);

        // Remove one of the two behind the selection's back, the way a delete
        // from config or health reaches the grid. Its key no longer matches any
        // bookmark, so it must not keep padding the count.
        const dropped = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const refs = d.multiSelect.resolveRefs();
            const name = refs[0].bookmark.name;
            d.bookmarks.splice(refs[0].index, 1);
            d.renderDashboard();
            return name;
        });

        await expect.poll(() => selectionCount(page)).toBe(1);
        const left = await page.evaluate(
            () => window.dashboardInstance.multiSelect.resolveRefs().map((r) => r.bookmark.name)
        );
        expect(left).not.toContain(dropped);
    });

    test('deleting the selection removes exactly those bookmarks', async ({ page }) => {
        await openDashboard(page);

        const before = await page.evaluate(
            () => window.dashboardInstance.bookmarks.map((b) => b.name)
        );
        expect(before.length).toBeGreaterThan(3);

        await focusFirstBookmark(page);
        await page.keyboard.press('x');
        await page.keyboard.press('x');

        const picked = await page.evaluate(
            () => window.dashboardInstance.multiSelect.resolveRefs().map((r) => r.bookmark.name)
        );
        expect(picked).toHaveLength(2);

        await page.locator('.multi-select-btn.danger').click();
        await confirmDangerModal(page);

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.bookmarks.length))
            .toBe(before.length - 2);

        const after = await page.evaluate(
            () => window.dashboardInstance.bookmarks.map((b) => b.name)
        );
        // The two picked went, and nothing else did.
        picked.forEach((name) => expect(after).not.toContain(name));
        before
            .filter((name) => !picked.includes(name))
            .forEach((name) => expect(after).toContain(name));
    });

    test('a deleted selection lands in the trash and restores', async ({ page }) => {
        await openDashboard(page);

        const cleared = await page.request.delete('/api/trash', { data: { all: true }, headers: writeHeaders });
        expect(cleared.ok(), await cleared.text()).toBe(true);

        // Earlier tests in this file delete from the same page, so this one
        // seeds the bookmark it is about rather than depending on what survived.
        const marker = `trash-probe-${Date.now()}`;
        await page.evaluate(async (name) => {
            const d = window.dashboardInstance;
            d.bookmarks.push({ name, url: `https://${name}.example`, category: '', shortcut: '' });
            await d.saveBookmarkOrder();
            d.renderDashboard();
        }, marker);

        await expect
            .poll(() => page.evaluate(
                (name) => window.dashboardInstance.bookmarks.some((b) => b.name === name),
                marker
            ))
            .toBe(true);

        // Tick exactly that bookmark, through the model's own row lookup.
        await page.evaluate((name) => {
            const ms = window.dashboardInstance.multiSelect;
            const row = [...document.querySelectorAll('.bookmark-link[data-bookmark-index]')]
                .find((r) => (r.querySelector('.bookmark-text')?.textContent || '').trim() === name);
            ms.toggleRow(row);
        }, marker);

        const picked = await page.evaluate(
            () => window.dashboardInstance.multiSelect.resolveRefs().map((r) => r.bookmark.name)
        );
        expect(picked).toEqual([marker]);

        await page.locator('.multi-select-btn.danger').click();
        await confirmDangerModal(page);

        await expect
            .poll(async () => {
                const res = await page.request.get('/api/trash');
                return (await res.json()).count;
            }, { timeout: 10_000 })
            .toBe(1);

        const trash = await (await page.request.get('/api/trash')).json();
        expect(trash.items[0].bookmark.name).toBe(picked[0]);

        // And it comes back.
        const restoreRes = await page.request.post('/api/trash/restore', {
            data: { id: trash.items[0].id },
            headers: writeHeaders,
        });
        expect(restoreRes.ok(), await restoreRes.text()).toBe(true);

        const restored = await (await page.request.get('/api/bookmarks?page=1')).json();
        expect(restored.map((b) => b.name)).toContain(picked[0]);
        // Restoring consumes the entry.
        expect((await (await page.request.get('/api/trash')).json()).count).toBe(0);
    });
});
