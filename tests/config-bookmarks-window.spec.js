// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Infinite scroll answered how much is fetched and nothing about how much is
 * painted. A row is thirty-four elements: a thousand of them is thirty-three
 * thousand nodes and four megabytes of markup, and every repaint — a tag added,
 * a row ticked — pays for all of it.
 *
 * The list draws the rows near the viewport and two spacers of the right
 * height, so the scrollbar still describes the whole list.
 */

async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
    await page.waitForSelector('#config-bm-list', { timeout: 15_000 });
}

/** A library big enough to be worth windowing, in memory only. */
async function withManyBookmarks(page, count) {
    return page.evaluate((n) => {
        const d = window.dashboardInstance;
        const base = d.allBookmarks[0];
        d.allBookmarks = Array.from({ length: n }, (_, i) => ({
            ...base, name: `Probe ${i}`, url: `https://example.com/${i}`, shortcut: '', tags: [],
        }));
        const c = d.config;
        c.invalidateVisibleBookmarks();
        c.bmVisibleLimit = n;
        c.repaintBookmarkRowsOnly();
        const host = document.getElementById('config-bm-list');
        return {
            rowsDrawn: host.querySelectorAll('.config-bm-row').length,
            nodes: host.querySelectorAll('*').length,
            spacerHeight: [...host.querySelectorAll('.config-bm-spacer')]
                .reduce((sum, s) => sum + s.getBoundingClientRect().height, 0),
        };
    }, count);
}

test.describe('a long list draws a screenful', () => {
    test('two thousand rows are a screenful of nodes, not sixty thousand', async ({ page }) => {
        await openBookmarks(page);
        const drawn = await withManyBookmarks(page, 2000);

        expect(drawn.rowsDrawn).toBeGreaterThan(5);
        expect(drawn.rowsDrawn).toBeLessThan(200);
        expect(drawn.nodes).toBeLessThan(8000);
        // The scrollbar still describes the whole list: the rows nobody can see
        // are two spacers of the right height.
        expect(drawn.spacerHeight).toBeGreaterThan(1000);
    });

    /*
     * Opening the view chooses the first window without measuring -- the
     * measurement was a full layout of the empty shell -- and checks it a frame
     * later. The guess has to fill the screen, and the check has to agree.
     */
    test('a long list opened afresh fills the screen, and the window holds once measured', async ({ page }) => {
        await openBookmarks(page);
        await withManyBookmarks(page, 2000);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
        expect(await page.evaluate(() => window.dashboardInstance.allBookmarks.length)).toBe(2000);

        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

        const state = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const rows = [...document.querySelectorAll('#config-bm-list .config-bm-row')];
            const lastBottom = rows[rows.length - 1].getBoundingClientRect().bottom;
            const measured = c.bookmarkRowWindow();
            return {
                rowsDrawn: rows.length,
                coversScreen: lastBottom >= window.innerHeight,
                measuredKey: measured ? `${measured.start}-${measured.end}` : 'all',
                drawnKey: c._bmWindowKey,
            };
        });
        expect(state.rowsDrawn).toBeLessThan(200);
        expect(state.coversScreen).toBe(true);
        expect(state.drawnKey).toBe(state.measuredKey);
    });

    test('a short list is drawn whole, spacers and all left out', async ({ page }) => {
        await openBookmarks(page);
        const drawn = await withManyBookmarks(page, 20);
        expect(drawn.rowsDrawn).toBe(20);
        expect(drawn.spacerHeight).toBe(0);
    });

    test('the keyboard carries on past the edge of the window', async ({ page }) => {
        await openBookmarks(page);
        await withManyBookmarks(page, 2000);

        const walked = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c._bmKeyboardKey = null;
            const seen = [];
            for (let i = 0; i < 60; i += 1) {
                c.moveBookmarkKeyboardSelection(1);
                seen.push(c._bmKeyboardKey);
            }
            return { first: seen[0], last: seen[seen.length - 1], unique: new Set(seen).size };
        });

        // Sixty presses, sixty different rows: walking the DOM would have
        // wrapped at the edge of the window and started again.
        expect(walked.unique).toBe(60);
        expect(walked.last).not.toBe(walked.first);
    });
});
