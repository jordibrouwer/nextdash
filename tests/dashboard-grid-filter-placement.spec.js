// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The filter bar has to be on screen, in every shape the grid takes.
 *
 * It used to be inserted as the layout's first child, which is harmless while
 * the layout is a CSS grid and wrong everywhere else: packed columns lay the
 * layout out as `flex-direction: row; flex-wrap: nowrap; justify-content:
 * center`, so the bar became a column of its own in that row — squeezed to a
 * fraction of its width and pushed off the left edge of the window, measured at
 * x = -21 on a three-column page. It is a sibling above the layout now, so the
 * grid's shape cannot move it.
 *
 * Both column modes are exercised because only one of them was ever broken, and
 * a fix that quietly swapped which one is broken would look identical here.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
}

async function setColumnMode(page, packed) {
    await page.evaluate((value) => {
        const d = window.dashboardInstance;
        d.settings.packedColumns = value;
        d.renderDashboard({ animate: false });
    }, packed);
    await page.waitForTimeout(300);
}

async function openFilter(page) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Shift+KeyF');
    await expect(page.locator('#grid-filter-bar')).toBeVisible({ timeout: 10_000 });
}

async function boxes(page) {
    return page.evaluate(() => {
        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), right: Math.round(r.right), width: Math.round(r.width) };
        };
        return {
            bar: rect(document.getElementById('grid-filter-bar')),
            layout: rect(document.getElementById('dashboard-layout')),
            viewport: window.innerWidth,
            insideLayout: Boolean(document.querySelector('#dashboard-layout #grid-filter-bar')),
        };
    });
}

for (const packed of [true, false]) {
    test(`the filter bar is fully visible with packed columns ${packed ? 'on' : 'off'}`, async ({ page }) => {
        await dashboard(page);
        await setColumnMode(page, packed);
        await openFilter(page);

        const { bar, layout, viewport, insideLayout } = await boxes(page);

        // The symptom: it started off the left edge of the window.
        expect(bar.x).toBeGreaterThanOrEqual(0);
        expect(bar.right).toBeLessThanOrEqual(viewport);
        // And it lines up with the grid rather than with one of its columns.
        expect(bar.x).toBe(layout.x);
        expect(bar.width).toBe(layout.width);
        // The cause: a child of a layout whose shape decides where children go.
        expect(insideLayout).toBe(false);
    });
}

test('the input keeps room for its placeholder', async ({ page }) => {
    await dashboard(page);
    await setColumnMode(page, true);
    await openFilter(page);

    // A 219px bar cut the placeholder in half; the field itself is what has to
    // be wide enough, not just the bar around it.
    const input = page.locator('#grid-filter-bar .grid-filter-input');
    const width = await input.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(width).toBeGreaterThan(300);
    await expect(input).toBeFocused();
});

/**
 * The filter narrows bookmarks, and a widget is not one.
 *
 * A block with no matching row is folded away, which is right for a category
 * and wrong for a widget: widgets deliberately carry the `category` class --
 * the masonry layout measures blocks by it and DragReorder selects by it -- and
 * they contain no `.bookmark-link` at all. So every widget counted as empty the
 * moment anything was typed, and a reader filtering their links watched the
 * processor, disks and container tiles disappear with them.
 *
 * The same trap `refreshAllCategorySpans` documents and guards against with
 * `:not([data-widget-id])`.
 */
test('typing in the filter leaves the widgets alone', async ({ page }) => {
    await dashboard(page);

    const seeded = await page.evaluate(() => {
        const d = window.dashboardInstance;
        return {
            widgets: document.querySelectorAll('.dashboard-widget').length,
            rows: document.querySelectorAll('.bookmark-link').length,
            hasFilter: Boolean(d.gridFilter),
        };
    });
    test.skip(!seeded.hasFilter || seeded.widgets === 0 || seeded.rows === 0,
        'needs a page with both widgets and bookmarks');

    const shape = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const filter = d.gridFilter;
        // A term that matches at least one row, so this is a real narrowing
        // rather than the everything-hidden case where the bug is invisible.
        const first = document.querySelector('.bookmark-link');
        const term = (first?.textContent || '').trim().split(/\s+/)[0].slice(0, 4).toLowerCase();

        filter.open = true;
        filter.query = term;
        const hits = filter.apply();

        const seen = (selector) => [...document.querySelectorAll(selector)]
            .filter((el) => el.offsetParent !== null).length;
        const out = {
            term,
            hits,
            widgetsShown: seen('.dashboard-widget'),
            widgetsTotal: document.querySelectorAll('.dashboard-widget').length,
            categoriesShown: seen('.category:not(.dashboard-widget)'),
        };

        filter.query = '';
        filter.apply();
        filter.open = false;
        return out;
    });

    // The narrowing worked on the bookmarks...
    expect(shape.hits).toBeGreaterThan(0);
    expect(shape.categoriesShown).toBeGreaterThan(0);
    // ...and left every widget where it was.
    expect(shape.widgetsShown).toBe(shape.widgetsTotal);
});
