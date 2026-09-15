// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Recents hangs from the header, the way the pages panel does.
 *
 * It is opened from the bar in that band and answers a question about the page
 * under it -- what did I open last -- so it drops out of the band rather than
 * floating over a dimmed screen. Past three entries the rows lay out across the
 * page's own column; under that the sheet is as wide as what it holds.
 *
 * The rows are the rows the rest of the product draws: 52px, one line, led by
 * the key the reader would type. The panel was a 27rem column of 27px lines,
 * which is what a narrow panel wants and what a band across the page cannot
 * use -- and it printed the bookmark's category id, "// cat_mrjjzqik_o2rt0",
 * which is the store talking to itself.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // This panel belongs to the recents button, which is off by default since
    // the header was rebuilt; with it off, `*` opens the search panel instead.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showRecentButton = true;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(250);
}

/**
 * Exactly `count` bookmarks with an opening behind them.
 *
 * Everything already in the store is reset to never-opened: recents reads the
 * page's own bookmarks, and a fixture that has been clicked would decide the
 * shape of the sheet instead of the test.
 */
async function seedRecent(page, count) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const base = Date.now();
        const existing = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
        const additions = Array.from({ length: n }, (_, index) => ({
            name: `Recent sheet ${index + 1}`,
            url: `https://example.com/recent-sheet-${base}-${index}`,
            // Every other one without a key: that column has to stand whether
            // or not there is something in it.
            shortcut: index % 2 === 0 ? `RS${index}` : '',
            category: '',
            checkStatus: false,
            lastOpened: base - index * 60_000,
            openCount: 3,
            createdAt: base - index * 60_000,
        }));
        // Drop what an earlier test in this file seeded: the store is reset per
        // file, not per test, so its entries would still be the most recent.
        const cleared = existing
            .filter((b) => !String(b.name || '').startsWith('Recent sheet'))
            .map((b) => ({ ...b, lastOpened: 0, openCount: 0 }));
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...cleared, ...additions]),
        });
        await dash.loadData();
        dash.renderDashboard?.({ animate: false });
    }, count);
    await page.waitForTimeout(400);
}

async function openRecents(page) {
    // Through the key a reader presses.
    await page.keyboard.press('Shift+Digit8');
    await page.waitForSelector('.recents-sheet .recent-bookmarks-modal-item', { timeout: 20_000 });
    await page.waitForTimeout(300);
}

const sheet = (page) => page.evaluate(() => {
    const el = document.querySelector('.recents-sheet');
    const band = document.querySelector('.dashboard-section.section-controls');
    const row = document.querySelector('.header-top');
    const r = el.getBoundingClientRect();
    const b = band.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const list = document.querySelector('.recent-bookmarks-modal-list');
    const item = document.querySelector('.recent-bookmarks-modal-item');
    return {
        classes: el.className,
        gapToBand: Math.round(r.top - b.bottom),
        mid: Math.round(r.x + r.width / 2),
        rowMid: Math.round(rowBox.x + rowBox.width / 2),
        width: Math.round(r.width),
        rowWidth: Math.round(rowBox.width),
        topRadius: parseFloat(window.getComputedStyle(el).borderTopLeftRadius),
        bottomRadius: parseFloat(window.getComputedStyle(el).borderBottomLeftRadius),
        columns: window.getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length,
        rowHeight: Math.round(item.getBoundingClientRect().height),
        entries: document.querySelectorAll('.recent-bookmarks-modal-item').length,
    };
});

test('with entries enough it hangs from the band and spans the header row', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 8);
    await openRecents(page);

    const seen = await sheet(page);

    expect(seen.classes, 'the panel is not in its wide shape').toContain('is-grid');
    // One line, not a gap and not an overlap.
    expect(seen.gapToBand, `the panel sits ${seen.gapToBand}px from the band`).toBeLessThanOrEqual(0);
    expect(seen.gapToBand, 'the panel covers part of the band').toBeGreaterThanOrEqual(-2);
    expect(seen.mid, 'the panel is not centred on the header row').toBe(seen.rowMid);
    expect(seen.width, 'the panel does not span the page’s column').toBe(seen.rowWidth);
    expect(seen.topRadius, 'the panel is rounded against the band').toBe(0);
    expect(seen.bottomRadius, 'the panel has square bottom corners').toBeGreaterThan(0);
    expect(seen.columns, `${seen.columns} columns of entries`).toBe(3);
    // The row the rest of the product draws, not a 27px line.
    expect(seen.rowHeight, `a row is ${seen.rowHeight}px tall`).toBeGreaterThanOrEqual(50);
});

test('a row leads with the key and names the category rather than its id', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 6);
    await openRecents(page);

    const rows = await page.evaluate(() => {
        /*
         * One column's worth: the rows lie across the page, so "do they line
         * up" is a question about the ones under each other.
         */
        const all = [...document.querySelectorAll('.recent-bookmarks-modal-item')];
        const left = Math.min(...all.map((row) => Math.round(row.getBoundingClientRect().x)));
        return all
            .filter((row) => Math.round(row.getBoundingClientRect().x) === left)
            .map((row) => {
                const key = row.querySelector('.recent-bookmarks-modal-shortcut');
                const name = row.querySelector('.recent-bookmarks-modal-name');
                return {
                    key: key?.textContent?.trim() ?? null,
                    keyX: key ? Math.round(key.getBoundingClientRect().x) : null,
                    nameX: name ? Math.round(name.getBoundingClientRect().x) : null,
                    detail: row.querySelector('.recent-bookmarks-modal-detail')?.textContent?.trim() || '',
                };
            });
    });

    expect(rows.length, 'nothing to compare').toBeGreaterThan(1);
    expect(rows.every((r) => r.key !== null), 'a row has no key column at all').toBe(true);
    expect(rows.some((r) => r.key.length > 0), 'no row shows the key it would be opened with').toBe(true);
    // The column stands whether or not there is a key in it.
    expect(new Set(rows.map((r) => r.nameX)).size, 'the names start in different columns').toBe(1);
    expect(new Set(rows.map((r) => r.keyX)).size, 'the key column drifts').toBe(1);
    expect(rows.some((r) => /cat_[a-z0-9_]+/i.test(r.detail)),
        `a row prints a category id: ${rows.map((r) => r.detail).join(' ')}`).toBe(false);
});

test('a handful of entries makes it as wide as what it holds', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 2);
    await openRecents(page);

    const seen = await sheet(page);

    expect(seen.entries, `${seen.entries} entries, so this is not the narrow case`).toBe(2);
    expect(seen.classes, 'the panel stayed in its wide shape').toContain('is-compact');
    expect(seen.width, 'the panel spans the column for two entries').toBeLessThan(seen.rowWidth);
    // Still hanging from the band, still on the strip's centre line.
    expect(seen.gapToBand, 'the narrow panel came loose from the band').toBeLessThanOrEqual(0);
    expect(Math.abs(seen.mid - seen.rowMid), 'the narrow panel is off centre').toBeLessThanOrEqual(1);
});

test('one entry drops the bulk buttons, because the row is the action', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 1);
    await openRecents(page);

    const single = await page.evaluate(() => {
        const toolbar = document.querySelector('.recent-bookmarks-modal-toolbar');
        return {
            entries: document.querySelectorAll('.recent-bookmarks-modal-item').length,
            classes: document.querySelector('.recents-sheet').className,
            toolbar: toolbar ? window.getComputedStyle(toolbar).display : 'absent',
            foot: !!document.querySelector('.recent-bookmarks-modal-foot'),
        };
    });

    expect(single.entries, 'the store kept more than the one entry seeded').toBe(1);
    expect(single.classes, 'the single-entry shape is not marked').toContain('is-single');
    expect(single.toolbar, '"open the last five" for one bookmark').toMatch(/none|absent/);
    // The foot still names the key that opens it.
    expect(single.foot, 'the foot went with the buttons').toBe(true);
});

/*
 * Down means down here too.
 *
 * The panel walked its rows with a step of one, which in a column was a step
 * down and across the sheet is a step sideways -- so the vertical arrows
 * stopped doing anything vertical the moment the entries lay across the page.
 */
test('the arrows walk the sheet in both directions', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 8);
    await openRecents(page);

    const name = () => page.evaluate(() => document.activeElement
        ?.querySelector?.('.recent-bookmarks-modal-name')?.textContent?.trim() || null);
    const across = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('.recent-bookmarks-modal-item')];
        const top = Math.round(rows[0].getBoundingClientRect().top);
        return rows.filter((r) => Math.abs(Math.round(r.getBoundingClientRect().top) - top) <= 2).length;
    });
    const namesInOrder = () => page.evaluate(() => [...document.querySelectorAll('.recent-bookmarks-modal-item')]
        .map((r) => r.querySelector('.recent-bookmarks-modal-name')?.textContent?.trim()));

    const columns = await across();
    expect(columns, 'the entries are not laid out across the sheet').toBeGreaterThan(1);
    const order = await namesInOrder();

    // Into the list, then down a line.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    expect(await name(), 'the arrows do not reach the list').toBe(order[0]);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    expect(await name(), 'down walked sideways').toBe(order[columns]);

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    expect(await name(), 'up did not come back').toBe(order[0]);

    // And the line itself is walked with left and right.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    expect(await name(), 'right did not step along the line').toBe(order[1]);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    expect(await name(), 'left did not step back').toBe(order[0]);
});
