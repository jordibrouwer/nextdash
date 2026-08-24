const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Every bookmark mutation used to force a full grid rebuild.
 *
 * repaintBookmarkMutationSurfaces passed `incremental: false`, which is the one
 * flag canAttemptDataPatch refuses outright — so a single rename threw away the
 * whole grid, every DragReorder instance, the scroll offset and the focused row.
 * The incremental path has its own guards for the cases that genuinely need a
 * rebuild, and those are what should decide.
 */

async function load(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
}

/**
 * Run `body` and report whether the grid was patched or rebuilt.
 *
 * Rebuilds are detected by identity, not by counting removed nodes: the full
 * render replaces every .category element, the patch keeps them and edits their
 * rows. An earlier version watched for a MutationRecord with several removed
 * nodes, which never fired — innerHTML = '' on a two-column layout removes two.
 */
async function measureRepaint(page, body) {
    return page.evaluate(async (source) => {
        const d = window.dashboardInstance;
        const stats = { patched: 0 };

        const realTry = d.renderIncremental.tryRender.bind(d.renderIncremental);
        d.renderIncremental.tryRender = (...args) => {
            const ok = realTry(...args);
            if (ok) stats.patched += 1;
            return ok;
        };

        const categoriesBefore = [...document.querySelectorAll('#dashboard-layout .category')];

        // eslint-disable-next-line no-new-func
        await new Function('d', `return (${source})(d);`)(d);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const categoriesAfter = [...document.querySelectorAll('#dashboard-layout .category')];
        stats.keptCategoryNodes = categoriesBefore.length > 0
            && categoriesBefore.every((el) => categoriesAfter.includes(el));
        return stats;
    }, body);
}

test.describe('a bookmark mutation patches the grid', () => {
    test('the ordinary repaint takes the incremental path', async ({ page }) => {
        await load(page);
        const stats = await measureRepaint(page,
            'async (d) => { await d.data.repaintBookmarkMutationSurfaces({}); }');

        expect(stats.patched).toBe(1);
        expect(stats.keptCategoryNodes).toBe(true);
    });

    test('the focused row survives it', async ({ page }) => {
        await load(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.keyboardNavigation?.currentIndex
        ), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);

        const focusedBefore = await page.evaluate(
            () => document.activeElement?.closest('.bookmark-link')?.querySelector('a')?.href || '');
        expect(focusedBefore).not.toBe('');

        await page.evaluate(() => window.dashboardInstance.data.repaintBookmarkMutationSurfaces({}));
        await page.waitForTimeout(300);

        const focusedAfter = await page.evaluate(
            () => document.activeElement?.closest('.bookmark-link')?.querySelector('a')?.href || '');
        expect(focusedAfter).toBe(focusedBefore);
    });

    test('the scroll offset survives it', async ({ page }) => {
        await load(page);
        // Only meaningful on a page tall enough to scroll; skip rather than
        // assert 0 === 0, which would pass with the fix reverted.
        const scrollable = await page.evaluate(
            () => document.documentElement.scrollHeight > window.innerHeight + 120);
        test.skip(!scrollable, 'fixture page is not tall enough to scroll');

        await page.evaluate(() => window.scrollTo({ top: 100, behavior: 'instant' }));
        await page.evaluate(() => window.dashboardInstance.data.repaintBookmarkMutationSurfaces({}));
        await page.waitForTimeout(300);

        expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(50);
    });

    // The guards that must still win: a request that explicitly wants the full
    // render, and a structure change the patch cannot express.
    test('an animated repaint still rebuilds', async ({ page }) => {
        await load(page);
        const stats = await measureRepaint(page,
            'async (d) => { await d.data.repaintBookmarkMutationSurfaces({ animate: true }); }');

        expect(stats.patched).toBe(0);
        expect(stats.keptCategoryNodes).toBe(false);
    });

    test('a new category falls back to the full render', async ({ page }) => {
        await load(page);
        const stats = await measureRepaint(page, `async (d) => {
            d.categories = [...d.categories, { id: 'probe-cat', name: 'probe' }];
            d.bookmarks = [...d.bookmarks, {
                name: 'probe', url: 'https://probe.example', category: 'probe-cat',
            }];
            await d.data.repaintBookmarkMutationSurfaces({});
        }`);

        expect(stats.patched).toBe(0);
        expect(stats.keptCategoryNodes).toBe(false);
    });
});
