// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The row flash was written out by hand in five places, and the grid's constant
 * ARIA columns were rewritten on every render.
 *
 * remove/reflow/add plus an `animationend` listener is four lines that have to
 * be exactly right — the forced reflow is what makes a still-running animation
 * replay, and the listener is what takes the class off again. Five copies is
 * five chances for one of them to drift, which is also why reduced motion has to
 * keep firing `animationend` for all of them (see dashboard.css).
 *
 * aria-colindex/colcount never change: the grid is one column. Writing them from
 * syncBookmarkGridA11y meant a querySelector per row on every render, every
 * incremental render, every tag-filter change and every keyboard rebuild, to put
 * the same two values back.
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

test.describe('the shared row animation helper', () => {
    test('adds the class and takes it off again', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const row = document.querySelector('#dashboard-layout .bookmark-link');
            let starts = 0;
            row.addEventListener('animationstart', () => { starts += 1; });

            d.bookmarkRows.restartRowAnimation(row, 'bookmark-copy-flash');
            const onImmediately = row.classList.contains('bookmark-copy-flash');
            await new Promise((resolve) => setTimeout(resolve, 200));
            const started = starts;

            await new Promise((resolve) => setTimeout(resolve, 900));
            return { onImmediately, started, stillOn: row.classList.contains('bookmark-copy-flash') };
        });

        expect(result.onImmediately).toBe(true);
        expect(result.started).toBeGreaterThan(0);
        // The animationend listener took it off again, which is what stops the
        // class accumulating on the row — and why reduced motion has to collapse
        // these animations to 0.01ms rather than `none`, or the event never comes.
        expect(result.stillOn).toBe(false);
    });

    test('restarts an animation that is already running', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const row = document.querySelector('#dashboard-layout .bookmark-link');
            row.classList.remove('bookmark-copy-flash');
            await new Promise((resolve) => setTimeout(resolve, 800));

            let starts = 0;
            const onStart = () => { starts += 1; };
            row.addEventListener('animationstart', onStart);

            d.bookmarkRows.restartRowAnimation(row, 'bookmark-copy-flash');
            // Waited out, so the animation is genuinely running before the
            // second call. Firing both in one task proves nothing: the first
            // has not started yet, so there is nothing to restart and the count
            // is 1 either way.
            await new Promise((resolve) => setTimeout(resolve, 120));
            const afterFirst = starts;

            d.bookmarkRows.restartRowAnimation(row, 'bookmark-copy-flash');
            await new Promise((resolve) => setTimeout(resolve, 200));
            row.removeEventListener('animationstart', onStart);

            return { afterFirst, total: starts };
        });

        expect(result.afterFirst).toBe(1);
        // The forced reflow is what makes this 2 rather than 1.
        expect(result.total).toBe(2);
    });

    test('the copy shortcut flashes the row through it', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowDown');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1))
            .toBeGreaterThanOrEqual(0);

        await page.keyboard.press('Control+c');
        await expect
            .poll(() => page.evaluate(() => document.querySelectorAll('.bookmark-copy-flash').length),
                { timeout: 3000 })
            .toBe(1);

        // And it comes off on its own.
        await expect
            .poll(() => page.evaluate(() => document.querySelectorAll('.bookmark-copy-flash').length),
                { timeout: 5000 })
            .toBe(0);
    });
});

test.describe('the grid ARIA columns', () => {
    test('are stamped when the row is built', async ({ page }) => {
        await openDashboard(page);

        const attrs = await page.evaluate(() => {
            const links = [...document.querySelectorAll('#dashboard-layout .bookmark-link a.bookmark-open')];
            return {
                total: links.length,
                withColIndex: links.filter((l) => l.getAttribute('aria-colindex') === '1').length,
                withColCount: links.filter((l) => l.getAttribute('aria-colcount') === '1').length,
            };
        });

        expect(attrs.total).toBeGreaterThan(0);
        expect(attrs.withColIndex).toBe(attrs.total);
        expect(attrs.withColCount).toBe(attrs.total);
    });

    test('survive an incremental repaint, and the row indices still track', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.data.repaintBookmarkMutationSurfaces({}));
        await page.waitForTimeout(300);

        const state = await page.evaluate(() => {
            const links = [...document.querySelectorAll('#dashboard-layout .bookmark-link a.bookmark-open')];
            const firstGroup = document.querySelector('#dashboard-layout .category[role="rowgroup"]');
            const rows = firstGroup
                ? [...firstGroup.querySelectorAll('.bookmark-link[data-bookmark-url]')]
                : [];
            return {
                missingCols: links.filter((l) => l.getAttribute('aria-colindex') !== '1').length,
                rowIndices: rows.map((r) => r.getAttribute('aria-rowindex')),
            };
        });

        expect(state.missingCols).toBe(0);
        // Still numbered from 1, which is the part syncBookmarkGridA11y still owns.
        expect(state.rowIndices.slice(0, 3)).toEqual(['1', '2', '3'].slice(0, state.rowIndices.length));
    });
});
