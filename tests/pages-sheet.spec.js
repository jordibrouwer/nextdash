// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The pages panel drops out of the header rather than floating over the page.
 *
 * It is opened from the strip and answers the question the strip asks -- which
 * page am I going to -- so it hangs from the band the strip stands in: the
 * band's bottom edge and the sheet's top edge are one line, and the sheet is
 * centred on the strip. Past a handful of pages it spans the page's own column
 * and lays the rows out across it, because one column of nine rows is a list
 * you scroll to read. Under that it is as wide as what it holds: a 1300px band
 * holding two names is a table with nothing in it.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function seedPages(page, count) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pages = [...dash.pages];
        for (let i = pages.length; i < n; i += 1) {
            pages.push({ id: 600 + i, name: `page-${i}` });
        }
        const saved = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
        await dash.loadData();
        dash.pageNav?.renderPageNavigation?.();
    }, count);
    await page.waitForTimeout(300);
}

/** Through the key a reader presses, not through showPageOverlay(). */
async function openSheet(page) {
    await page.keyboard.press(',');
    await page.waitForSelector('.page-overview-sheet', { timeout: 10_000 });
    await page.waitForTimeout(350);
}

const sheet = (page) => page.evaluate(() => {
    const el = document.querySelector('.page-overview-sheet');
    const band = document.querySelector('.dashboard-section.section-controls');
    const row = document.querySelector('.header-top');
    const r = el.getBoundingClientRect();
    const b = band.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const slab = document.querySelector('.page-overview-modal-slab');
    return {
        classes: el.className,
        gapToBand: Math.round(r.top - b.bottom),
        mid: Math.round(r.x + r.width / 2),
        rowMid: Math.round(rowBox.x + rowBox.width / 2),
        width: Math.round(r.width),
        rowWidth: Math.round(rowBox.width),
        topRadius: parseFloat(window.getComputedStyle(el).borderTopLeftRadius),
        bottomRadius: parseFloat(window.getComputedStyle(el).borderBottomLeftRadius),
        columns: window.getComputedStyle(slab).gridTemplateColumns.split(' ').filter(Boolean).length,
        // The row proper: the li carries the hairline under it, the button is
        // the 52px the reader sees.
        rowHeight: Math.round(document.querySelector('.page-overview-modal-link').getBoundingClientRect().height),
    };
});

test('with pages enough it spans the header row and lays them out across it', async ({ page }) => {
    await openDashboard(page);
    await seedPages(page, 8);
    await openSheet(page);

    const seen = await sheet(page);

    expect(seen.classes, 'the sheet is not in its wide shape').toContain('is-grid');
    // One line, not a gap and not an overlap.
    expect(seen.gapToBand, `the sheet sits ${seen.gapToBand}px from the band`).toBeLessThanOrEqual(0);
    expect(seen.gapToBand, 'the sheet covers part of the band').toBeGreaterThanOrEqual(-2);
    expect(seen.mid, 'the sheet is not centred on the header row').toBe(seen.rowMid);
    expect(seen.width, 'the sheet does not span the page’s column').toBe(seen.rowWidth);
    // Square where it meets the band, round where it leaves the page.
    expect(seen.topRadius, 'the sheet is rounded against the band').toBe(0);
    expect(seen.bottomRadius, 'the sheet has square bottom corners').toBeGreaterThan(0);
    // Three across the page's column: a minimum in rem would fit five, and five
    // names side by side is a table again.
    expect(seen.columns, `${seen.columns} columns of pages`).toBe(3);

    // The way to make a page is the last cell of that grid, not a row under it.
    const lastCell = await page.evaluate(() => {
        const actions = document.querySelector('.page-overview-modal-actions');
        const items = [...document.querySelectorAll('.page-overview-modal-item')];
        const last = items[items.length - 1].getBoundingClientRect();
        const a = actions.getBoundingClientRect();
        return { sameRow: Math.abs(Math.round(a.top) - Math.round(last.top)) <= 2, right: a.x > last.x };
    });
    expect(lastCell.sameRow, 'the new-page cell dropped below the grid').toBe(true);
    expect(lastCell.right, 'the new-page cell is not after the last page').toBe(true);
});

/** Trim the store down: seeding only ever adds, and pages persist per file. */
async function keepPages(page, keep) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        for (const id of d.pages.slice(n).map((p) => p.id)) {
            await api(`/api/pages/${id}`, { method: 'DELETE' });
        }
        await d.loadData();
        d.pageNav?.renderPageNavigation?.();
    }, keep);
    await page.waitForTimeout(300);
}

test('with a handful of pages it is as wide as what it holds', async ({ page }) => {
    await openDashboard(page);
    await keepPages(page, 2);
    await openSheet(page);

    const seen = await sheet(page);

    expect(seen.classes, 'the sheet stayed in its wide shape').toContain('is-compact');
    expect(seen.width, 'the sheet spans the column for two pages')
        .toBeLessThan(seen.rowWidth);
    // Still hanging from the band, still on the strip's centre line.
    expect(seen.gapToBand, `the sheet sits ${seen.gapToBand}px from the band`).toBeLessThanOrEqual(0);
    expect(Math.abs(seen.mid - seen.rowMid), 'the narrow sheet is off centre').toBeLessThanOrEqual(1);
});

test('a row keeps its height whichever shape the sheet is in', async ({ page }) => {
    await openDashboard(page);
    await keepPages(page, 2);
    await openSheet(page);
    const narrow = await sheet(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await seedPages(page, 9);
    await openSheet(page);
    const wide = await sheet(page);

    expect(wide.rowHeight, `a row is ${wide.rowHeight}px in the grid`).toBe(narrow.rowHeight);
    // And past eight pages the filter is there to type into.
    await expect(page.locator('#page-overview-filter'), 'nine pages and no filter').toBeVisible();
});

/*
 * Down means down, even when the rows lie across the sheet.
 *
 * In one column a step of one was a step down; in a grid it is a step
 * sideways, and vertical navigation stopped working the moment the rows were
 * laid out across the page's width. The step is the number of pages standing
 * on a line, counted off the layout because the filter can take rows out of it.
 */
test('the arrows walk the grid in both directions', async ({ page }) => {
    await openDashboard(page);
    await seedPages(page, 8);
    await openSheet(page);

    /*
     * The cursor is the marked row, not the focused element: the panel keeps
     * its own index (setFocus) and the browser's focus follows it, which in a
     * fresh page can land a frame later.
     */
    const key = () => page.evaluate(() => document
        .querySelector('.page-overview-modal-item.is-focused .page-overview-modal-num')?.textContent?.trim());
    const across = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('.page-overview-modal-item')];
        const top = Math.round(rows[0].getBoundingClientRect().top);
        return rows.filter((r) => Math.abs(Math.round(r.getBoundingClientRect().top) - top) <= 2).length;
    });

    const columns = await across();
    expect(columns, 'the rows are not laid out across the sheet').toBeGreaterThan(1);

    // Wherever the panel puts the cursor, down lands a full line further on.
    const start = Number(await key());
    expect(start, 'nothing carries the keyboard').toBeGreaterThan(0);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    expect(await key(), 'down walked sideways').toBe(String(start + columns));

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    expect(await key(), 'up did not come back').toBe(String(start));

    // And the row itself is walked with left and right.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    expect(await key(), 'right did not step along the row').toBe(String(start + 1));

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    expect(await key(), 'left did not step back').toBe(String(start));
});
