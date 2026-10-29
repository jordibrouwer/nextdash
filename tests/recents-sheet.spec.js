// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Recents opens in the middle of the window, like every dashboard modal.
 *
 * It is a column of its own: two tiles across, ten
 * to a page, with a pager for what was opened before. Spanning the page's
 * whole column, three rows of name, category and age were too wide to read.
 *
 * It printed the bookmark's category id once, "// cat_mrjjzqik_o2rt0", which
 * is the store talking to itself.
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
    await expect(page.locator('body')).toHaveAttribute('data-show-recent-button', 'true');
}

/**
 * Exactly `count` bookmarks with an opening behind them.
 *
 * Everything already in the store is reset to never-opened, on every page:
 * recents reads them all, and a fixture that has been clicked would decide the
 * shape of the sheet instead of the test.
 */
async function seedRecent(page, count) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const base = Date.now();
        for (const other of (dash.pages || []).filter((p) => Number(p.id) !== Number(pageId))) {
            const rows = await (await fetch(`/api/bookmarks?page=${other.id}`)).json();
            if (!Array.isArray(rows) || !rows.some((b) => b.lastOpened)) continue;
            await api(`/api/bookmarks?page=${other.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rows.map((b) => ({ ...b, lastOpened: 0, openCount: 0 }))),
            });
        }
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
        await dash.loadAllBookmarks?.();
        dash.renderDashboard?.({ animate: false });
    }, count);
}

async function openRecents(page) {
    // Through the key a reader presses.
    await page.keyboard.press('Shift+Digit8');
    await page.waitForSelector('.recents-sheet .recent-bookmarks-modal-item', { timeout: 20_000 });
    // The sheet slides in; its box is read next, so wait until it is still.
    let last = '';
    let same = 0;
    await expect.poll(async () => {
        const cur = await page.evaluate(() => {
            const el = document.querySelector('.recents-sheet');
            const r = el.getBoundingClientRect();
            return { box: [r.x, r.y, r.width, r.height].join(',') };
        });
        same = cur.box === last ? same + 1 : 0;
        last = cur.box;
        return same >= 4;
    }).toBe(true);
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
        midY: Math.round(r.y + r.height / 2),
        winMid: Math.round(document.documentElement.clientWidth / 2),
        winMidY: Math.round(window.innerHeight / 2),
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

test('with entries enough it is centred in the window, a column of two tiles across', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 8);
    await openRecents(page);

    const seen = await sheet(page);

    expect(seen.classes, 'the panel is not in its wide shape').toContain('is-grid');
    // In the middle of the window, not hanging from the header.
    expect(Math.abs(seen.midY - seen.winMidY), 'the panel is not centred top to bottom').toBeLessThanOrEqual(1);
    expect(Math.abs(seen.mid - seen.winMid), 'the panel is not centred left to right').toBeLessThanOrEqual(1);
    expect(seen.gapToBand, 'the panel still hangs from the band').toBeGreaterThan(8);
    // Narrower than the header row: 46rem at most, so a line is readable.
    expect(seen.width, `the panel is ${seen.width}px wide`).toBeLessThanOrEqual(736);
    expect(seen.width, 'the panel spans the page’s column again').toBeLessThan(seen.rowWidth);
    // Round on every corner, in the Signature style and the Classic one.
    expect(seen.bottomRadius, 'the panel has square bottom corners').toBeGreaterThan(0);
    expect(seen.topRadius, 'the panel is not drawn as a layer of the material').toBe(seen.bottomRadius);
    await page.evaluate(async () => {
        await window.ThemeLoader.applySurfacesForTheme(window.dashboardInstance.settings.theme,
            { ...window.dashboardInstance.settings, materialStyle: 'classic', themeSurfacesForceAll: true });
    });
    const classic = await sheet(page);
    expect(classic.bottomRadius, 'the panel has square bottom corners').toBeGreaterThan(0);
    expect(classic.topRadius, 'the panel has square top corners').toBe(classic.bottomRadius);
    expect(seen.columns, `${seen.columns} columns of entries`).toBe(2);
    // A tile, not a 27px line.
    expect(seen.rowHeight, `a tile is ${seen.rowHeight}px tall`).toBeGreaterThanOrEqual(50);
});

test('a tile shows the key it opens with and names the category rather than its id', async ({ page }) => {
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
    // The names line up down the column, after the date block and the icon.
    expect(new Set(rows.map((r) => r.nameX)).size, 'the names start in different columns').toBe(1);
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
    // Still in the middle of the window.
    expect(Math.abs(seen.midY - seen.winMidY), 'the narrow panel is not centred top to bottom').toBeLessThanOrEqual(1);
    expect(Math.abs(seen.mid - seen.winMid), 'the narrow panel is off centre').toBeLessThanOrEqual(1);
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
    await expect.poll(name, { message: 'the arrows do not reach the list' }).toBe(order[0]);

    await page.keyboard.press('ArrowDown');
    await expect.poll(name, { message: 'down walked sideways' }).toBe(order[columns]);

    await page.keyboard.press('ArrowUp');
    await expect.poll(name, { message: 'up did not come back' }).toBe(order[0]);

    // And the line itself is walked with left and right.
    await page.keyboard.press('ArrowRight');
    await expect.poll(name, { message: 'right did not step along the line' }).toBe(order[1]);

    await page.keyboard.press('ArrowLeft');
    await expect.poll(name, { message: 'left did not step back' }).toBe(order[0]);
});

/*
 * Earlier bookmarks are a page away: ten to a page, the newest first, turned
 * with ] and PageDown (older) and [ and PageUp (newer), or a page number.
 * ← and → stay the line's.
 */
test('the pager turns through what was opened before', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 23);
    await openRecents(page);

    const range = page.locator('.recents-sheet .recent-bookmarks-page-range');
    const names = () => page.locator('.recents-sheet .recent-bookmarks-modal-item .recent-bookmarks-modal-name').allInnerTexts();
    await expect(range).toHaveText('1–10 of 23');
    await expect.poll(names).toEqual(Array.from({ length: 10 }, (_, i) => `Recent sheet ${i + 1}`));

    await page.keyboard.press(']');
    await expect(range).toHaveText('11–20 of 23');
    await expect.poll(async () => (await names())[0]).toBe('Recent sheet 11');

    await page.keyboard.press('PageDown');
    await expect(range).toHaveText('21–23 of 23');
    await expect.poll(names).toEqual(['Recent sheet 21', 'Recent sheet 22', 'Recent sheet 23']);
    // The last page stays the last.
    await page.keyboard.press('PageDown');
    await expect(range).toHaveText('21–23 of 23');

    await page.keyboard.press('PageUp');
    await expect(range).toHaveText('11–20 of 23');
    await page.locator('.recents-sheet .recent-bookmarks-pager').getByRole('button', { name: 'Page 1', exact: true }).click();
    await expect(range).toHaveText('1–10 of 23');
    await expect(page.locator('.recents-sheet .recent-bookmarks-page-btn.is-current')).toHaveText('1');

    // A new opening starts on the newest page again.
    await page.keyboard.press(']');
    await expect(range).toHaveText('11–20 of 23');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.recent.isRecentBookmarksModalOpen())).toBe(false);
    await openRecents(page);
    await expect(range).toHaveText('1–10 of 23');
});

test('a bookmark opened on another page is in the list, under that page’s name', async ({ page }) => {
    await openDashboard(page);
    await seedRecent(page, 3);
    const other = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const list = await (await api('/api/pages')).json();
        let target = list.find((p) => p.name === 'Recents elsewhere');
        if (!target) {
            target = { id: Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1, name: 'Recents elsewhere' };
            await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...list, target]) });
        }
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: target.id, bookmark: { name: 'Opened elsewhere', url: `https://example.com/elsewhere-${Date.now()}`, lastOpened: Date.now() + 60_000, openCount: 5 } }),
        });
        await dash.loadData();
        await dash.loadAllBookmarks?.();
        return target.name;
    });
    await openRecents(page);
    const first = page.locator('.recents-sheet .recent-bookmarks-modal-item').first();
    await expect(first.locator('.recent-bookmarks-modal-name')).toHaveText('Opened elsewhere');
    await expect(first.locator('.recent-bookmarks-modal-detail')).toHaveText(other);
});
