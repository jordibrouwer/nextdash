// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two listeners for the whole grid instead of two per row, and the selection
 * toolbar out of the grid it was never a valid child of.
 *
 * Every row carried its own click and auxclick handler, closing over the
 * bookmark, its index and the sanitised href. All of that is recoverable from
 * the row, so one pair on #dashboard-layout — which outlives every repaint —
 * does the same work.
 *
 * The toolbar was prepended into #dashboard-layout, which carries role="grid":
 * a role="toolbar" among rows and rowgroups is invalid. It also laid out wrong,
 * since the grid is a flex row — a full-width bar was squeezed into a narrow
 * vertical strip beside the columns.
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

/** Tick a row that belongs to the page currently open. */
async function tickFirstCurrentPageRow(page) {
    await page.evaluate(() => document.activeElement?.blur());
    for (let step = 0; step < 25; step += 1) {
        await page.keyboard.press('ArrowDown');
        const ok = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const kn = d.keyboardNavigation;
            const row = (kn?.navigableElements || [])[kn?.currentIndex ?? -1];
            if (!row) return false;
            const idx = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
            return Number.isFinite(idx) && idx >= 0 && Boolean(d.bookmarks[idx]);
        });
        if (ok) {
            await page.keyboard.press('x');
            return true;
        }
    }
    return false;
}

test.describe('bookmark clicks are delegated', () => {
    test('a row the renderer never touched is still clickable', async ({ page }) => {
        await openDashboard(page);

        // The proof that the handler lives on the grid rather than on the row:
        // this row is assembled by hand and inserted, so it never went through
        // populateBookmarkRowView and would carry no listeners of its own.
        const handled = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const grid = document.getElementById('dashboard-layout');
            const real = grid.querySelector('.bookmark-link[data-bookmark-index] a.bookmark-open');
            const row = document.createElement('div');
            row.className = 'bookmark-link';
            row.dataset.bookmarkIndex = real.closest('.bookmark-link').dataset.bookmarkIndex;
            row.setAttribute('data-bookmark-url',
                real.closest('.bookmark-link').getAttribute('data-bookmark-url'));
            const link = document.createElement('a');
            link.className = 'bookmark-open';
            link.href = real.getAttribute('href');
            row.appendChild(link);
            grid.appendChild(row);

            // Ctrl+click, which the handler answers by ticking rather than
            // opening — observable without navigating anywhere.
            const before = d.multiSelect.count();
            link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
            await new Promise((resolve) => setTimeout(resolve, 100));
            const after = d.multiSelect.count();

            row.remove();
            d.multiSelect.clear();
            return { before, after };
        });

        expect(handled.before).toBe(0);
        expect(handled.after).toBe(1);
    });

    test('Ctrl+click still ticks the row instead of opening it', async ({ page }) => {
        await openDashboard(page);

        const link = page.locator('#dashboard-layout .bookmark-link[data-bookmark-index] a.bookmark-open').first();
        await link.click({ modifiers: ['ControlOrMeta'] });

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBe(1);
        // Still on the dashboard: the browser's own "open in new tab" was
        // stopped as well.
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
    });

    test('Shift+click extends from the anchor', async ({ page }) => {
        await openDashboard(page);
        const ticked = await tickFirstCurrentPageRow(page);
        test.skip(!ticked, 'no row on the current page to select');

        const links = page.locator('#dashboard-layout .bookmark-link[data-bookmark-index] a.bookmark-open');
        test.skip(await links.count() < 3, 'need three rows to extend across');
        await links.nth(2).click({ modifiers: ['Shift'] });

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBeGreaterThan(1);
    });

    test('a plain click with a selection open clears it rather than opening', async ({ page }) => {
        await openDashboard(page);
        const ticked = await tickFirstCurrentPageRow(page);
        test.skip(!ticked, 'no row on the current page to select');

        await page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first().click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBe(0);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
    });

    test('an ordinary click records the open', async ({ page }) => {
        await openDashboard(page);

        const recorded = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            let seen = null;
            const real = d.recordBookmarkOpened.bind(d);
            d.recordBookmarkOpened = (bookmark, index) => {
                seen = { url: bookmark?.url || null, index };
                // Not calling through: the write is not what is under test, and
                // it would mutate the fixture's open counts.
            };
            const link = document.querySelector(
                '#dashboard-layout .bookmark-link[data-bookmark-index] a.bookmark-open');
            const expected = link.getAttribute('href');
            // Opening in a new tab is the app's own setting; suppressed here so
            // the click cannot navigate the test away.
            link.addEventListener('click', (e) => e.preventDefault(), { once: true });
            link.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            d.recordBookmarkOpened = real;
            return { seen, expected };
        });

        expect(recorded.seen).not.toBeNull();
        expect(recorded.expected).toContain(recorded.seen.url.replace(/\/$/, '').slice(0, 20));
    });
});

test.describe('the selection toolbar', () => {
    test('sits above the grid, not inside it', async ({ page }) => {
        await openDashboard(page);
        const ticked = await tickFirstCurrentPageRow(page);
        test.skip(!ticked, 'no row on the current page to select');

        const layout = await page.evaluate(() => {
            const bar = document.querySelector('.multi-select-toolbar');
            const grid = document.getElementById('dashboard-layout');
            const b = bar.getBoundingClientRect();
            const g = grid.getBoundingClientRect();
            return {
                insideGrid: grid.contains(bar),
                gridRole: grid.getAttribute('role'),
                barWidth: Math.round(b.width),
                gridWidth: Math.round(g.width),
                barLeft: Math.round(b.left),
                gridLeft: Math.round(g.left),
                aboveGrid: b.bottom <= g.top + 1,
            };
        });

        expect(layout.gridRole).toBe('grid');
        // A role="toolbar" is not a valid child of a role="grid".
        expect(layout.insideGrid).toBe(false);
        // And it renders as the full-width bar its CSS asks for, rather than
        // being squeezed into a column of the flex row.
        expect(layout.barWidth).toBe(layout.gridWidth);
        expect(layout.barLeft).toBe(layout.gridLeft);
        expect(layout.aboveGrid).toBe(true);
    });

    test('it goes away with the selection', async ({ page }) => {
        await openDashboard(page);
        const ticked = await tickFirstCurrentPageRow(page);
        test.skip(!ticked, 'no row on the current page to select');
        await expect(page.locator('.multi-select-toolbar')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('.multi-select-toolbar')).toHaveCount(0, { timeout: 5000 });
    });
});
