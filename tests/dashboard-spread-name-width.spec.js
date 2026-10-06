// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A spread category gives its names at least the room a plain one does.
 *
 * Each column of a spread category is at least as wide as the category was in
 * one column, so a name that fits before it spreads still fits after. It did
 * not: the list's column gap -- wide enough to stand for the seam between two
 * grid columns -- was laid between every track of the repeated pattern, icon
 * and name and status and shortcut alike, so the name track lost two seams'
 * worth of width in every column and "Weather radar" came out "Weather r…".
 */

async function openDashboard(page, { columns, density, ping }) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async ({ columns, density, ping }) => {
        const d = window.dashboardInstance;
        d.settings.packedColumns = false;
        d.settings.columnsPerRow = columns;
        // Room for every bookmark, so the single column is measured with all
        // of its rows: a status row is inset a little, and the names of the
        // others move over to line up with it.
        d.settings.categoryItemLimit = 50;
        d.settings.defaultCategorySpread = false;
        d.settings.densityMode = density;
        d.settings.showStatus = ping;
        d.settings.showPing = ping;
        await d.saveSettings?.();
        await window.DashboardCategorySpan.resetAllCategorySpreads(d, 'page');
    }, { columns, density, ping });
    // Loaded again rather than re-rendered: density is stamped on the body as
    // well as the grid, at load, and a test before this one in the same worker
    // may have left the body saying something else.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissBlockingOverlays(page);
    await page.waitForTimeout(400);
}

/** One bookmark per column, so a category of four asks for four. */
const limitToOne = (page) => page.evaluate(async () => {
    const d = window.dashboardInstance;
    d.settings.categoryItemLimit = 1;
    await d.saveSettings?.();
    d.renderDashboard({ animate: false, forceFull: true });
});

/** Name widths of every visible row in a category. */
const namesOf = (page, id) => page.evaluate((categoryId) => {
    const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
    return [...el.querySelectorAll('.bookmark-link')]
        .filter((row) => row.offsetParent !== null)
        .map((row) => {
            const name = row.querySelector('.bookmark-text');
            // Both to the fraction: clientWidth and scrollWidth round, and a
            // name a hundredth of a pixel either side of fitting comes out as
            // a whole pixel short.
            const text = document.createRange();
            text.selectNodeContents(name);
            return {
                text: name.textContent.trim(),
                width: name.getBoundingClientRect().width,
                needed: text.getBoundingClientRect().width,
                offset: Math.round(name.getBoundingClientRect().left - row.getBoundingClientRect().left),
            };
        });
}, id);

for (const columns of [2, 3, 4]) {
    for (const density of ['compact', 'dense']) {
        for (const ping of [true, false]) {
            test(`names keep their width when spread — ${columns} columns, ${density}, ping ${ping ? 'on' : 'off'}`, async ({ page }) => {
                await openDashboard(page, { columns, density, ping });
                const id = 'development';
                const category = page.locator(`#dashboard-layout .category[data-category-id="${id}"]`);
                test.skip(await category.count() === 0, 'no development category in this fixture');

                if (ping) {
                    // The status lands after the first paint, and a status row
                    // is inset: measured before it, the names have room they
                    // lose a moment later in either shape.
                    await expect(category.locator('.bookmark-link:is(.status-online, .status-offline)'))
                        .not.toHaveCount(0, { timeout: 10_000 });
                }
                const single = new Map((await namesOf(page, id)).map((row) => [row.text, row]));
                expect(single.size).toBeGreaterThanOrEqual(columns);

                await limitToOne(page);
                await category.locator('.category-title').click({ button: 'right' });
                await page.locator('#category-context-menu .move-popover-item[data-action="spread"]').click();
                await expect(category).toHaveClass(/category--wide/);
                await expect.poll(() => category.evaluate((el) =>
                    Number(el.style.getPropertyValue('--category-span')))).toBe(columns);
                await page.waitForTimeout(300);

                const spread = await namesOf(page, id);
                expect(spread.length).toBe(columns);
                for (const row of spread) {
                    const before = single.get(row.text);
                    // At least the room it had in a column of its own, give or
                    // take the rounding of a fractional track. Not exactly that
                    // room: a spread column can come out a little wider than a
                    // plain one, and more room is not the bug.
                    expect(row.width, row.text).toBeGreaterThanOrEqual(before.width - 0.1);
                    // And so a name that was shown in full still is.
                    if (before.needed <= before.width) {
                        expect(row.needed, row.text).toBeLessThanOrEqual(row.width + 0.01);
                    }
                }
                // Each row lays out its own tracks now, and a status row is
                // inset a little further than the others: the names still
                // start at one place in every column.
                expect(new Set(spread.map((row) => row.offset)).size).toBe(1);
            });
        }
    }
}
