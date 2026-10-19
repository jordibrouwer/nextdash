// @ts-check
const { test, expect } = require('./fixtures');
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

/*
 * These wait for the animation's own events, not for a stretch of time. They
 * used to sleep 200ms and then read how many `animationstart` events had come,
 * which a busy machine (CI runs four workers on two cores) answered with zero:
 * the animation had not started yet, not failed to. Under a CPU load that
 * failed one run in a hundred, in both tests.
 */
const WAIT_MS = 5000;

test.describe('the shared row animation helper', () => {
    test('adds the class and takes it off again', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async (waitMs) => {
            const d = window.dashboardInstance;
            const row = document.querySelector('#dashboard-layout .bookmark-link');
            const once = (type) => new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), waitMs);
                row.addEventListener(type, () => { clearTimeout(timer); resolve(true); }, { once: true });
            });

            const started = once('animationstart');
            const ended = once('animationend');
            d.bookmarkRows.restartRowAnimation(row, 'bookmark-copy-flash');
            const onImmediately = row.classList.contains('bookmark-copy-flash');
            const didStart = await started;
            const didEnd = await ended;
            // The class comes off in the animationend listener the helper added,
            // which runs before this one is awaited.
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
            return { onImmediately, didStart, didEnd, stillOn: row.classList.contains('bookmark-copy-flash') };
        }, WAIT_MS);

        expect(result.onImmediately).toBe(true);
        expect(result.didStart).toBe(true);
        expect(result.didEnd).toBe(true);
        // The animationend listener took it off again, which is what stops the
        // class accumulating on the row -- and why reduced motion has to collapse
        // these animations to 0.01ms rather than `none`, or the event never comes.
        expect(result.stillOn).toBe(false);
    });

    test('restarts an animation that is already running', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async (waitMs) => {
            const d = window.dashboardInstance;
            const row = document.querySelector('#dashboard-layout .bookmark-link');
            row.classList.remove('bookmark-copy-flash');

            let starts = 0;
            const nextStart = () => new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), waitMs);
                row.addEventListener('animationstart', () => { starts += 1; clearTimeout(timer); resolve(true); }, { once: true });
            });

            // The first animation has to be genuinely running before the second
            // call: firing both in one task proves nothing, because the first
            // has not started yet, so there is nothing to restart and the count
            // is 1 either way.
            const first = nextStart();
            d.bookmarkRows.restartRowAnimation(row, 'bookmark-copy-flash');
            const firstStarted = await first;
            const afterFirst = starts;

            const second = nextStart();
            d.bookmarkRows.restartRowAnimation(row, 'bookmark-copy-flash');
            const secondStarted = await second;

            return { firstStarted, secondStarted, afterFirst, total: starts };
        }, WAIT_MS);

        expect(result.firstStarted).toBe(true);
        expect(result.afterFirst).toBe(1);
        // The forced reflow is what makes the second start come at all.
        expect(result.secondStarted).toBe(true);
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

        const readState = () => page.evaluate(() => {
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
        // Rows are there and numbered again before anything is read.
        await expect.poll(async () => {
            const s = await readState();
            return s.rowIndices.length > 0 && s.rowIndices[0] === '1';
        }).toBe(true);
        const state = await readState();

        expect(state.missingCols).toBe(0);
        // Still numbered from 1, which is the part syncBookmarkGridA11y still owns.
        expect(state.rowIndices.slice(0, 3)).toEqual(['1', '2', '3'].slice(0, state.rowIndices.length));
    });
});
