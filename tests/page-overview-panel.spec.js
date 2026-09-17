// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The pages panel is drawn like recent bookmarks.
 *
 * Both are a short list you open with one key and leave with another, so they
 * were two designs for one idea: this one had every page in its own outlined
 * card, a full-width *Close page list* button, and an ESC hint under that —
 * the same third way of saying what Esc already says that the recents panel
 * lost when it was redrawn.
 *
 * It takes the same treatment now: the name with its key beside it, a way out
 * on the right, the rows in one slab, and a thin foot.
 */
async function openPages(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Through the key someone presses, not through the renderer.
    await page.keyboard.press(',');
    await page.waitForSelector('.page-overview-modal', { timeout: 20_000 });
}

test('the header names the key and carries the way out', async ({ page }) => {
    await openPages(page);

    expect((await page.locator('.page-overview-modal-key').textContent() || '').trim()).toBe(',');

    const actions = await page.evaluate(() => {
        const el = document.querySelector('.page-overview-modal .modal-actions');
        return el ? window.getComputedStyle(el).display : 'absent';
    });
    expect(actions, 'the wide Close button is back').toBe('none');

    await page.locator('.page-overview-modal-close').click();
    await expect(page.locator('#app-modal.show .page-overview-modal')).toHaveCount(0);
});

test('a page is a row in one slab, not a card of its own', async ({ page }) => {
    await openPages(page);

    const row = await page.evaluate(() => {
        const link = document.querySelector('.page-overview-modal-link');
        const list = document.querySelector('.page-overview-modal-slab');
        const cs = window.getComputedStyle(link);
        /*
         * The resting colour comes off a probe, not off a row.
         *
         * The panel marks the page you are on with .is-focused and keeps it
         * marked — it is the cursor, not a hover — so every row on screen may
         * legitimately be carrying the accent wash. What is under test is the
         * rule: a row, by itself, paints nothing.
         */
        const probe = document.createElement('button');
        probe.className = 'page-overview-modal-link';
        list.appendChild(probe);
        const resting = window.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
            height: Math.round(link.getBoundingClientRect().height),
            borderWidth: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
            background: resting,
            depth: document.body.getAttribute('data-depth'),
            listHasGround: window.getComputedStyle(list).backgroundColor !== 'rgba(0, 0, 0, 0)',
        };
    });

    expect(row.borderWidth, 'the row draws its own box').toBe(0);
    expect(row.background, 'a resting row paints its own ground')
        .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // 52px: one run of pointer targets, which is what the panel is for, at the
    // height the sheet's grid draws them. Measured with a tolerance because the
    // row is min-height plus its own padding, and a theme's radius scale moves
    // the last pixel.
    expect(row.height, `a row is ${row.height}px tall`).toBeGreaterThanOrEqual(42);
    expect(row.height, `a row is ${row.height}px tall`).toBeLessThanOrEqual(54);
    /*
     * The slab under the rows is a depth cue, and flat is the depth that draws
     * none -- which is what an install now starts on. On any other depth the
     * list carries the same surface the recents panel does.
     */
    expect(row.listHasGround, `the slab does not follow the depth (${row.depth})`)
        .toBe(row.depth !== 'flat');
});

test('the cursor opens on the page you are on, not on the first', async ({ page }) => {
    await openPages(page);
    // Stand on the second page, then open the panel again.
    await page.keyboard.press('Escape');
    const second = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        if (d.pages.length < 2) {
            const pages = [...d.pages, { id: 6200, name: 'second' }];
            const saved = await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pages),
            });
            if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
            await d.loadData();
        }
        const id = Number(d.pages[1].id);
        await d.requestPageNavigation(id);
        return id;
    });
    await page.keyboard.press(',');
    await page.waitForSelector('.page-overview-modal-list', { timeout: 10_000 });

    const seen = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.page-overview-modal-item')];
        return {
            ring: items.findIndex((el) => el.classList.contains('is-focused')),
            focused: items.findIndex((el) => el.contains(document.activeElement)),
            pageOfFocus: document.activeElement?.dataset?.pageId,
        };
    });
    expect(seen.ring, 'the ring sits on the first page').toBe(1);
    expect(seen.focused, 'the focus sits on the first page').toBe(1);
    expect(Number(seen.pageOfFocus)).toBe(second);
});

test('the foot counts the pages instead of repeating Esc', async ({ page }) => {
    await openPages(page);

    const foot = await page.locator('.page-overview-modal-foot').innerText();
    // "1 pages" is not a sentence; the count leads and the noun follows it.
    expect(foot).toMatch(/\b1 page\b|\b\d+ pages\b/);
});

test('the page you are on takes the focus, whichever page that is', async ({ page }) => {
    await openPages(page);

    /*
     * AppModal focuses the first focusable thing it finds, and the close button
     * in the header is now the first — so without being told otherwise the
     * panel opened with the cursor on "leave" and the first arrow key had to
     * travel back into the list.
     */
    const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return {
            isLink: Boolean(active?.classList?.contains('page-overview-modal-link')),
            isCurrent: Boolean(active?.closest('.page-overview-modal-item.is-current')),
        };
    });
    expect(focused.isLink, 'focus did not land in the list').toBe(true);
    expect(focused.isCurrent, 'focus landed on a page you are not on').toBe(true);
});

/*
 * Deleting a page from the panel, asked twice.
 *
 * A page takes its bookmarks with it — the server drops them in the trash, but
 * the page empties either way — so one press is not enough of a decision. The
 * row arms and says what it is about to take; the second press is the one that
 * does it. The first page is never offered: the server refuses to delete it,
 * because a dashboard with no pages is not a state anything can draw.
 */
test.describe('deleting a page from the overview', () => {
    async function seedAndOpen(page) {
        await openPages(page);
        await page.keyboard.press('Escape');
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const pages = [...d.pages.filter((p) => p.name !== 'doomed'), { id: 7001, name: 'doomed' }];
            const saved = await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pages),
            });
            if (!saved.ok) throw new Error(`seeding failed: ${saved.status}`);
            await d.loadData();
            d.pageNav?.renderPageNavigation?.();
        });
        await page.keyboard.press(',');
        await page.waitForSelector('#app-modal.show .page-overview-modal', { timeout: 10_000 });
        return page.locator('.page-overview-modal-item', { hasText: 'doomed' });
    }

    test('the first page carries no delete at all', async ({ page }) => {
        await seedAndOpen(page);
        await expect(page.locator('.page-overview-modal-item').first()
            .locator('.page-overview-modal-delete')).toHaveCount(0);
    });

    test('one press arms the row and names what goes with it', async ({ page }) => {
        // Watch the wire, not the model: the delete is a round trip, so reading
        // `pages` straight after the click sees the state from before it either
        // way -- a single-press delete would have passed this test.
        const deletes = [];
        page.on('request', (r) => {
            if (r.method() === 'DELETE' && r.url().includes('/api/pages/')) deletes.push(r.url());
        });

        const row = await seedAndOpen(page);
        await row.locator('.page-overview-modal-delete').click();

        await expect(row).toHaveClass(/is-armed/);
        await expect(row.locator('.page-overview-modal-confirm')).toBeVisible();

        await page.waitForTimeout(800);
        expect(deletes, 'one press deleted the page').toEqual([]);
        expect(await page.evaluate(() => window.dashboardInstance.pages.some((p) => p.name === 'doomed')))
            .toBe(true);
    });

    test('Escape takes the safety catch off, not the panel', async ({ page }) => {
        const row = await seedAndOpen(page);
        await row.locator('.page-overview-modal-delete').click();
        await expect(row).toHaveClass(/is-armed/);

        await page.keyboard.press('Escape');
        await expect(row).not.toHaveClass(/is-armed/);
        await expect(page.locator('#app-modal.show .page-overview-modal')).toBeVisible();
    });

    test('the second press deletes the page', async ({ page }) => {
        const row = await seedAndOpen(page);
        await row.locator('.page-overview-modal-delete').click();
        await row.locator('.page-overview-modal-delete').click();

        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.pages.some((p) => p.name === 'doomed'),
        ), { timeout: 10_000 }).toBe(false);
    });
});

/*
 * One column, a filter past eight pages, and the one-page case.
 *
 * The panel is the list of places you can go, so it is drawn as a single run of
 * 44px rows rather than as a grid: one vertical path for the pointer, no
 * diagonal travel. A filter appears only when there are more pages than fit in
 * one look, and with a single page the panel stops being a list at all — what
 * it offers is the second page.
 */
test.describe('the shape of the panel', () => {
    async function seedPages(page, count) {
        await page.evaluate(async (n) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const d = window.dashboardInstance;
            const pages = [...d.pages];
            for (let i = pages.length; i < n; i += 1) {
                pages.push({ id: 6100 + i, name: `page-${i}` });
            }
            const saved = await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pages.slice(0, n)),
            });
            if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
            await d.loadData();
            d.pageNav?.renderPageNavigation?.();
        }, count);
        await page.waitForTimeout(300);
    }

    test('the rows are one column, and the current one is marked down its edge', async ({ page }) => {
        await openPages(page);

        const seen = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.page-overview-modal-link')];
            const xs = new Set(rows.map((el) => Math.round(el.getBoundingClientRect().x)));
            const current = document.querySelector('.page-overview-modal-item.is-current .page-overview-modal-link');
            return {
                columns: xs.size,
                rows: rows.length,
                currentShadow: current ? window.getComputedStyle(current).boxShadow : null,
            };
        });

        expect(seen.columns, 'the rows are not in one column').toBe(1);
        expect(seen.currentShadow, 'the current page carries no mark').not.toBe('none');
    });

    test('no filter with a few pages, a filter with many', async ({ page }) => {
        await openPages(page);
        await expect(page.locator('#page-overview-filter'), 'a filter for three pages').toHaveCount(0);

        await page.keyboard.press('Escape');
        await seedPages(page, 10);
        await page.keyboard.press(',');
        await page.waitForSelector('.page-overview-modal', { timeout: 10_000 });

        const filter = page.locator('#page-overview-filter');
        await expect(filter).toBeVisible();
        // The cursor stays on the page you are on; a letter is handed to the
        // filter, which is the only thing it used to take the focus for.
        await expect.poll(() => page.evaluate(
            () => Boolean(document.activeElement?.closest('.page-overview-modal-item.is-current'))),
        { timeout: 5_000 }).toBe(true);

        await page.keyboard.type('page-');
        await expect.poll(() => page.evaluate(
            () => document.activeElement?.id), { timeout: 5_000 }).toBe('page-overview-filter');
        expect(await filter.inputValue()).toBe('page-');

        await filter.fill('page-7');
        await expect.poll(() => page.evaluate(
            () => [...document.querySelectorAll('.page-overview-modal-item')]
                .filter((el) => !el.hidden).length,
        ), { timeout: 5_000 }).toBe(1);
    });

    test('a digit still means the page it names, filtered or not', async ({ page }) => {
        await openPages(page);
        await page.keyboard.press('Escape');
        await seedPages(page, 10);
        const third = await page.evaluate(() => Number(window.dashboardInstance.pages[2].id));

        await page.keyboard.press(',');
        await page.waitForSelector('#page-overview-filter', { timeout: 10_000 });
        await page.locator('#page-overview-filter').fill('page-9');
        await page.waitForTimeout(200);

        // The filter hides rows; it does not renumber them.
        await page.keyboard.press('3');
        await expect.poll(() => page.evaluate(
            () => Number(window.dashboardInstance.currentPageId)), { timeout: 10_000 }).toBe(third);
    });

    test('with one page the panel offers the second one', async ({ page }) => {
        await openPages(page);
        await page.keyboard.press('Escape');
        /*
         * Trimmed through the route the panel itself uses: POSTing a shorter
         * list leaves the pages in place -- the server treats a page as a thing
         * with bookmarks behind it, so removing one is its own request.
         */
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const d = window.dashboardInstance;
            const extras = d.pages.slice(1).map((p) => p.id);
            for (const id of extras) {
                await api(`/api/pages/${id}`, { method: 'DELETE' });
            }
            await d.loadData();
            await d.pageNav?.requestPageNavigation?.(d.pages[0].id);
            d.pageNav?.renderPageNavigation?.();
        });

        // Polled rather than slept through: the panel is built from d.pages, so
        // opening it before loadData() has landed draws the list it replaced.
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.pages.length), { timeout: 10_000 }).toBe(1);

        await page.keyboard.press(',');
        await page.waitForSelector('.page-overview-modal', { timeout: 10_000 });

        await expect(page.locator('.page-overview-modal-actions.is-alone')).toHaveCount(1);
        await expect(page.locator('.page-overview-modal-newhint')).toBeVisible();
        expect((await page.locator('.page-overview-modal-foot').innerText())).toMatch(/\b1 page\b/);
        // And still no filter: one row needs no searching.
        await expect(page.locator('#page-overview-filter')).toHaveCount(0);
    });
});

/*
 * One slab, and the new-page entry is the row at the end of it.
 *
 * It used to stand in a tinted block under the list: a gap, a second surface
 * and a second set of corners for one more line, which read as something stuck
 * to the panel rather than part of it.
 */
test('the new-page entry is the last row on the same slab', async ({ page }) => {
    await openPages(page);

    const seen = await page.evaluate(() => {
        const slab = document.querySelector('.page-overview-modal-slab');
        const rows = [...document.querySelectorAll('.page-overview-modal-link')];
        const last = rows[rows.length - 1].getBoundingClientRect();
        const neu = document.getElementById('page-overview-new-page');
        const box = neu.getBoundingClientRect();
        return {
            insideSlab: slab.contains(neu),
            // Outside the listbox: it is a button, not one more page to choose.
            insideList: Boolean(document.querySelector('.page-overview-modal-list #page-overview-new-page')),
            gap: Math.round(box.top - last.bottom),
            height: Math.round(box.height),
            rowHeight: Math.round(last.height),
            background: window.getComputedStyle(neu).backgroundColor,
        };
    });

    expect(seen.insideSlab, 'the entry stands off the slab').toBe(true);
    expect(seen.insideList, 'a screen reader counts it as a page').toBe(false);
    expect(seen.gap, `${seen.gap}px between the last row and the entry`).toBeLessThanOrEqual(2);
    expect(seen.height, 'the entry is a different size from a row').toBe(seen.rowHeight);
    expect(seen.background, 'the entry paints a ground of its own')
        .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

/*
 * And it stands in the same three columns a page does.
 *
 * The + belongs under the numbers and the key under the counts. The rows keep
 * 2.1rem clear on the right for the delete cross, so an entry padded like an
 * ordinary button put its key a cross-width further out than every count above
 * it -- close enough to look like a mistake rather than a difference.
 */
test('the new-page entry lines up with the rows above it', async ({ page }) => {
    await openPages(page);
    // Two pages, so the entry is the last row of a list rather than the wide
    // offer the one-page case draws -- that one is centred on purpose.
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        if (d.pages.length < 2) {
            const saved = await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...d.pages, { id: 7410, name: 'second' }]),
            });
            if (!saved.ok) throw new Error(`seeding a page failed: ${saved.status}`);
            await d.loadData();
            d.pageNav?.renderPageNavigation?.();
        }
    });
    await page.keyboard.press(',');
    await page.waitForSelector('.page-overview-modal', { timeout: 10_000 });

    const seen = await page.evaluate(() => {
        const edges = (sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return { left: Math.round(r.left), right: Math.round(r.right) };
        };
        return {
            num: edges('.page-overview-modal-num'),
            plus: edges('.page-overview-modal-plus'),
            count: edges('.page-overview-modal-count'),
            key: edges('.page-overview-modal-hintkey'),
        };
    });

    expect(Math.abs(seen.plus.left - seen.num.left),
        `the + starts ${seen.plus.left - seen.num.left}px from the numbers`).toBeLessThanOrEqual(1);
    expect(Math.abs(seen.key.right - seen.count.right),
        `the key ends ${seen.key.right - seen.count.right}px from the counts`).toBeLessThanOrEqual(1);
});

/*
 * One scrollbar, and it is the rows'.
 *
 * The list scrolls itself, so a scrolling modal body put a second track beside
 * the first as soon as the pages outgrew the panel -- and the outer one carried
 * the filter and the foot out of view with it.
 */
test('a long list scrolls the rows, not the panel', async ({ page }) => {
    await openPages(page);
    await page.keyboard.press('Escape');
    // A short window, so the panel's own max-height bites: this is the case
    // that used to put a second scrollbar beside the list's own.
    await page.setViewportSize({ width: 1500, height: 620 });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        const pages = [...d.pages];
        // Enough to overflow a grid, not just a column: the sheet lays the rows
        // out across the page's width now, so fourteen of them fit.
        for (let i = pages.length; i < 46; i += 1) pages.push({ id: 6300 + i, name: `page-${i}` });
        const saved = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
        await d.loadData();
        d.pageNav?.renderPageNavigation?.();
    });
    await page.keyboard.press(',');
    await page.waitForSelector('.page-overview-modal-list', { timeout: 10_000 });

    const seen = await page.evaluate(() => {
        const scrolls = (el) => el.scrollHeight - el.clientHeight > 2;
        const body = document.querySelector('.modal.page-overview-modal .modal-body');
        /*
         * Whichever box holds the rows: in the sheet's grid the list is the
         * cells themselves (display: contents) and the slab around them is the
         * scroller; in one column the list still is.
         */
        const list = document.querySelector('.page-overview-modal-list');
        const slab = document.querySelector('.page-overview-modal-slab');
        return {
            bodyScrolls: scrolls(body),
            listScrolls: scrolls(list) || scrolls(slab),
            footVisible: document.querySelector('.page-overview-modal-foot')
                .getBoundingClientRect().height > 0,
        };
    });

    expect(seen.listScrolls, 'the rows do not scroll, so nothing is being tested').toBe(true);
    expect(seen.bodyScrolls, 'the panel grew a second scrollbar').toBe(false);
    expect(seen.footVisible, 'the foot was scrolled out of the panel').toBe(true);
});
