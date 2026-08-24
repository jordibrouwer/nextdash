// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A category can spread across several grid columns.
 *
 * Spreading is a switch per category. How many columns a spread category takes
 * is not a setting: it follows from the items-per-category limit — which caps
 * the height of one column — and how many bookmarks the category holds. So the
 * tests here set the limit, count the rows, and expect the layout to work the
 * width out for itself.
 *
 * Packed columns carries the same switch a different way, by packing the page
 * around a spread category instead of reserving a row for it, so both layouts
 * are exercised.
 */

async function openDashboard(page, { packed = false, columns = 3, itemLimit = 15 } = {}) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async ({ packed, columns, itemLimit }) => {
        const d = window.dashboardInstance;
        d.settings.packedColumns = packed;
        d.settings.columnsPerRow = columns;
        // Spreading needs a limit: the limit is what decides how many columns a
        // category asks for.
        d.settings.categoryItemLimit = itemLimit;
        d.settings.defaultCategorySpread = false;
        await d.saveSettings?.();
        // The switch is stored, and every test here flips some — so each one
        // starts from "nothing spreads" rather than from whatever the previous
        // test left in the shared data directory.
        await window.DashboardCategorySpan.resetAllCategorySpreads(d, 'page');
        d.renderDashboard({ animate: false, forceFull: true });
    }, { packed, columns, itemLimit });
    await page.waitForTimeout(400);
}

/** A stored category holding at least `rows` bookmarks. */
const categoryWith = (page, rows) => page.evaluate((min) => {
    const el = [...document.querySelectorAll(
        '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])')]
        .find((cat) => cat.querySelectorAll('.bookmark-link').length >= min);
    return el ? el.getAttribute('data-category-id') : null;
}, rows);

const stateOf = (page, id) => page.evaluate((categoryId) => {
    const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
    if (!el) return null;
    const rows = [...el.querySelectorAll('.bookmark-link')];
    return {
        spread: el.getAttribute('data-spread'),
        wide: el.classList.contains('category--wide'),
        span: Number(el.style.getPropertyValue('--category-span')) || 1,
        gridColumn: getComputedStyle(el).gridColumnStart,
        widthPx: Math.round(el.getBoundingClientRect().width),
        rows: rows.length,
        visible: rows.filter((row) => !row.classList.contains('is-overflow-hidden')).length,
    };
}, id);

const setSpread = (page, id, on) => page.evaluate(({ categoryId, on }) => {
    const d = window.dashboardInstance;
    window.DashboardCategorySpan.setCategorySpread(d, categoryId, on);
    window.DashboardCategorySpan.refreshCategorySpreadUi(d, categoryId);
}, { categoryId: id, on });

test.describe('spreading is a switch, the width follows from the content', () => {
    test('a category takes one column per limit-worth of bookmarks', async ({ page }) => {
        // One bookmark per column, so a category of three asks for three.
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        test.skip(id === null, 'no stored category with two bookmarks in this fixture');

        const before = await stateOf(page, id);
        expect(before.wide).toBe(false);
        expect(before.visible).toBe(1);

        await setSpread(page, id, true);
        const after = await stateOf(page, id);

        expect(after.spread).toBe('true');
        expect(after.span).toBe(Math.min(before.rows, 3));
        expect(after.gridColumn).toBe(`span ${after.span}`);
        // The limit caps the height of a column, so a category that spreads
        // shows its limit once per column instead of hiding the rest.
        expect(after.visible).toBe(after.span);
        expect(after.widthPx).toBeGreaterThan(before.widthPx * 1.5);
    });

    test('a category that fits in one column stays one column wide', async ({ page }) => {
        await openDashboard(page, { itemLimit: 50 });
        const id = await categoryWith(page, 1);
        await setSpread(page, id, true);

        const state = await stateOf(page, id);
        // The switch is on, and it asks for nothing: fifty per column is more
        // than this category holds. Spreading is permission, not a width.
        expect(state.spread).toBe('true');
        expect(state.wide).toBe(false);
        expect(state.span).toBe(1);
    });

    test('the width is capped by the column count', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1, columns: 2 });
        const id = await categoryWith(page, 3);
        test.skip(id === null, 'no stored category with three bookmarks in this fixture');

        await setSpread(page, id, true);
        expect((await stateOf(page, id)).span).toBe(2);
    });

    test('the switch survives a reload', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        await setSpread(page, id, true);
        // The category save is debounced by a second.
        await page.waitForTimeout(1600);

        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        const after = await stateOf(page, id);
        expect(after.spread).toBe('true');
        expect(after.wide).toBe(true);

        await setSpread(page, id, false);
        await page.waitForTimeout(1600);
    });

    test('a spread category flows its bookmarks across the columns', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        test.skip(id === null, 'no stored category with two bookmarks in this fixture');

        const layout = (categoryId) => {
            const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
            const rows = [...el.querySelectorAll('.bookmark-link')];
            return {
                tracks: getComputedStyle(el.querySelector('.bookmarks-list')).gridTemplateColumns.split(' ').length,
                // Measured as "do the first two rows share a line" rather than
                // by counting left edges: rows differ by a fraction of a pixel
                // for reasons that have nothing to do with columns.
                sameLine: Math.abs(rows[0].getBoundingClientRect().top - rows[1].getBoundingClientRect().top) < 2,
            };
        };

        const before = await page.evaluate(layout, id);
        expect(before.sameLine).toBe(false);

        await setSpread(page, id, true);
        const after = await page.evaluate(layout, id);
        const span = (await stateOf(page, id)).span;

        // The row's track pattern is repeated once per column, so the second
        // bookmark lands beside the first rather than under it.
        expect(after.tracks).toBe(before.tracks * span);
        expect(after.sameLine).toBe(true);
    });

    test('unlimited items and spreading are mutually exclusive', async ({ page }) => {
        await openDashboard(page, { itemLimit: 0 });

        // Nothing caps the height of a column, so nothing decides how many
        // columns a category would need.
        expect(await page.evaluate(() =>
            window.DashboardCategorySpan.spreadUnavailableReason(window.dashboardInstance)))
            .toBe('unlimited-items');

        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.categoryItemLimit = 15;
            d.settings.defaultCategorySpread = true;
            const c = d.config;
            await c.openConfigView('appearance');
            c.appearanceTab = 'layout';
            c.render();
        });
        await page.waitForSelector('[data-behavior-field="categoryItemLimit"]', { timeout: 15_000 });
        // And the other way round: with spreading in use, config refuses to
        // offer Unlimited rather than letting the two contradict each other.
        expect(await page.evaluate(() => {
            const option = [...document.querySelector('[data-behavior-field="categoryItemLimit"]').options]
                .find((o) => o.value === '0');
            return option?.disabled;
        })).toBe(true);
    });
});

test.describe('the width follows the category as it changes', () => {
    test('a bookmark that pushes it past the limit brings the next column with it', async ({ page }) => {
        await openDashboard(page);
        const id = await categoryWith(page, 2);
        test.skip(id === null, 'no stored category with two bookmarks in this fixture');

        // The limit is set to exactly what this category holds, so it sits on
        // the line: one more bookmark is one more column. Derived from the
        // fixture rather than assumed, or the test measures the fixture.
        await page.evaluate(async (categoryId) => {
            const d = window.dashboardInstance;
            const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
            d.settings.categoryItemLimit = el.querySelectorAll('.bookmark-link').length;
            await d.saveSettings?.();
            d.renderDashboard({ animate: false, forceFull: true });
        }, id);
        await page.waitForTimeout(300);

        await setSpread(page, id, true);
        expect((await stateOf(page, id)).span).toBe(1);

        // Added through the API and then the same refresh a real add triggers,
        // which patches the grid in place rather than rebuilding it — the path
        // where the width used to be left behind until a reload.
        await page.evaluate(async (categoryId) => {
            const d = window.dashboardInstance;
            const res = await fetch(`/api/bookmarks?page=${d.currentPageId}`);
            const list = await res.json();
            list.push({ name: 'width-growth-probe', url: 'https://example.com/width-growth', category: categoryId, shortcut: '' });
            const write = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await write(`/api/bookmarks?page=${d.currentPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list),
            });
            await d.data.refreshAfterBookmarkMutation({});
        }, id);

        await expect.poll(async () => (await stateOf(page, id)).span, { timeout: 5000 }).toBe(2);
        // And the cut moves with it: the limit is per column, so two columns
        // show everything the category now holds.
        const after = await stateOf(page, id);
        expect(after.visible).toBe(after.rows);

        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const res = await fetch(`/api/bookmarks?page=${d.currentPageId}`);
            const list = (await res.json()).filter((b) => b.name !== 'width-growth-probe');
            const write = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await write(`/api/bookmarks?page=${d.currentPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list),
            });
            await d.data.refreshAfterBookmarkMutation({});
        });
    });
});

test.describe('the column count is the ceiling', () => {
    test('lowering it narrows a spread category, raising it gives the columns back', async ({ page }) => {
        await openDashboard(page, { columns: 3, itemLimit: 1 });
        const id = await categoryWith(page, 3);
        test.skip(id === null, 'no stored category with three bookmarks in this fixture');
        await setSpread(page, id, true);

        // One per column and three bookmarks: it asks for three, and gets what
        // the grid has.
        expect((await stateOf(page, id)).span).toBe(3);

        // Opened once so the lazily loaded config module exists — changing the
        // column count is something you do in config, and its own setBehavior
        // is the path that takes.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.waitForFunction(() => window.dashboardInstance.config.instance != null, null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(300);

        const setColumns = async (n) => {
            await page.evaluate(async (count) => {
                await window.dashboardInstance.config.instance.setBehavior('columnsPerRow', count, 'render');
            }, n);
            await page.waitForTimeout(400);
        };

        await setColumns(2);
        const narrowed = await stateOf(page, id);
        // Never wider than the grid: a category reaching past the last column
        // would create implicit ones and scroll the page sideways.
        expect(narrowed.span).toBe(2);
        expect(narrowed.visible).toBe(2);

        await setColumns(4);
        // Back to what it asks for, not to what the grid now allows: three
        // bookmarks at one per column need three columns, not four.
        expect((await stateOf(page, id)).span).toBe(3);
    });
});

test.describe('a spread category shows that it is one category', () => {
    test('a rule under the header runs the width of the block, and a marker names it', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        test.skip(id === null, 'no stored category with two bookmarks in this fixture');

        const plain = await page.evaluate((categoryId) => {
            const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
            return {
                rule: getComputedStyle(el.querySelector('.category-body')).borderTopWidth,
                badge: el.querySelector('.category-spread-badge') !== null,
            };
        }, id);
        // Nothing to explain while it is one column wide.
        expect(plain).toEqual({ rule: '0px', badge: false });

        await setSpread(page, id, true);
        const spread = await page.evaluate((categoryId) => {
            const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
            const body = el.querySelector('.category-body').getBoundingClientRect();
            const rows = [...el.querySelectorAll('.bookmark-link')].map((r) => r.getBoundingClientRect());
            const badge = el.querySelector('.category-spread-badge');
            return {
                rule: getComputedStyle(el.querySelector('.category-body')).borderTopWidth,
                // From the first column to the last: two blocks of bookmarks
                // side by side read as two categories, and this is the line
                // that says they are one.
                startsAtFirstColumn: Math.round(body.left) <= Math.round(Math.min(...rows.map((r) => r.left))),
                endsAfterLastColumn: Math.round(body.right) >= Math.round(Math.max(...rows.map((r) => r.right))),
                badge: badge?.textContent || null,
                badgeTitle: badge?.title || null,
            };
        }, id);

        const span = (await stateOf(page, id)).span;
        expect(spread.rule).toBe('1px');
        expect(spread.startsAtFirstColumn).toBe(true);
        expect(spread.endsAfterLastColumn).toBe(true);
        expect(spread.badge).toBe(`↔${span}`);
        expect(spread.badgeTitle).toContain(String(span));
    });

    test('the rule goes away while the category is collapsed', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        await setSpread(page, id, true);

        // The body stays in the document with its rows squeezed to nothing, so
        // an unguarded rule would hang under a header with nothing beneath it.
        expect(await page.evaluate((categoryId) => {
            const el = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"]`);
            el.setAttribute('data-collapsed', 'true');
            const collapsed = getComputedStyle(el.querySelector('.category-body')).borderTopWidth;
            el.setAttribute('data-collapsed', 'false');
            return collapsed;
        }, id)).toBe('0px');
    });
});

test.describe('a spread category lines up with the ones around it', () => {
    for (const packed of [false, true]) {
        test(`its columns sit on the grid columns — ${packed ? 'packed' : 'plain'}`, async ({ page }) => {
            await openDashboard(page, { packed, itemLimit: 1 });
            const id = await categoryWith(page, 2);
            test.skip(id === null, 'no stored category with two bookmarks in this fixture');
            await setSpread(page, id, true);
            await page.waitForTimeout(400);

            const columns = await page.evaluate(() => {
                const wide = document.querySelector('.category--wide');
                const lefts = (root) => [...new Set([...root.querySelectorAll('.bookmark-link')]
                    .map((row) => Math.round(row.getBoundingClientRect().left)))].sort((a, b) => a - b);
                const others = [...document.querySelectorAll('.category[data-category-id]')]
                    .filter((el) => el !== wide)
                    .flatMap((el) => lefts(el));
                return { inner: lefts(wide), others: [...new Set(others)].sort((a, b) => a - b) };
            });

            // Every column of a spread category starts where a plain
            // category's rows start. Two things used to break this: the spread
            // box pads only its outer edges, where a run of categories pads
            // every column on both sides, and the repeated track pattern sized
            // each copy to the rows that happened to land in it.
            expect(columns.inner.length).toBeGreaterThan(1);
            columns.inner.forEach((left) => {
                expect(columns.others.some((other) => Math.abs(other - left) <= 1)).toBe(true);
            });
        });
    }

    test('the seam inside it matches the seam beside it', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        await setSpread(page, id, true);

        // The density rule sets `gap` on every bookmarks list and sits further
        // down the stylesheet, so it used to win the column gap too and the
        // seam inside a spread category was a tenth of the one beside it. The
        // padding two neighbouring categories would each have contributed is
        // part of the sum — that is what puts the columns on the grid.
        const gaps = await page.evaluate(() => {
            const grid = document.getElementById('dashboard-layout');
            const list = document.querySelector('.category--wide .bookmarks-list');
            const px = (value) => parseFloat(value) || 0;
            return {
                grid: px(getComputedStyle(grid).columnGap),
                inside: px(getComputedStyle(list).columnGap),
                pad: px(getComputedStyle(document.querySelector('.category')).paddingLeft),
            };
        });
        expect(gaps.inside).toBe(gaps.grid + gaps.pad * 2);
    });
});

test.describe('packed columns carries the switch by packing tighter', () => {
    test('while nothing spreads, packed is the round-robin columns it always was', async ({ page }) => {
        await openDashboard(page, { packed: true });

        expect(await page.evaluate(() => {
            const grid = document.getElementById('dashboard-layout');
            return {
                columns: grid.querySelectorAll(':scope > .dashboard-column').length,
                masonry: grid.classList.contains('packed-masonry'),
            };
        })).toEqual({ columns: 3, masonry: false });
    });

    test('a spread category takes its columns in place, and the rest fills in beside it', async ({ page }) => {
        await openDashboard(page, { packed: true, itemLimit: 1 });

        // The second stored category, not whichever element happens to be
        // second on screen: this test is about where the blocks land, so the
        // block being spread has to be the same one every run.
        const id = await page.evaluate(() => window.dashboardInstance.categories[1].id);
        await setSpread(page, id, true);
        await page.waitForTimeout(400);

        const layout = await page.evaluate((categoryId) => {
            const grid = document.getElementById('dashboard-layout');
            const boxes = [...grid.querySelectorAll('.category[data-category-id]')].map((el) => {
                const r = el.getBoundingClientRect();
                return {
                    id: el.getAttribute('data-category-id'),
                    left: Math.round(r.left),
                    top: Math.round(r.top),
                    bottom: Math.round(r.bottom),
                    width: Math.round(r.width),
                };
            });
            const wide = boxes.find((b) => b.id === categoryId);
            const narrow = boxes.find((b) => b.width < wide.width);
            const tracks = [...new Set(boxes.map((b) => b.left))].sort((a, b) => a - b);
            return {
                masonry: grid.classList.contains('packed-masonry'),
                tracks: tracks.length,
                widerThanOne: wide.width > narrow.width,
                // Where each column starts. The spread block does not fit
                // beside the ones above it, so it drops — and the column it
                // leaves free has to be taken by whatever comes next rather
                // than left standing empty down the page.
                columnTops: tracks.map((left) => Math.min(...boxes.filter((b) => b.left === left).map((b) => b.top))),
                // Each block reserves its own height. Without that they all
                // start at the top of the grid and print over each other,
                // which packs beautifully and is unreadable.
                overlaps: tracks.some((left) => {
                    const column = boxes.filter((b) => b.left <= left && b.left + b.width > left)
                        .sort((a, b) => a.top - b.top);
                    return column.some((box, i) => i > 0 && box.top < column[i - 1].bottom - 2);
                }),
            };
        }, id);

        expect(layout.masonry).toBe(true);
        expect(layout.tracks).toBe(3);
        expect(layout.widerThanOne).toBe(true);
        expect(Math.max(...layout.columnTops) - Math.min(...layout.columnTops)).toBeLessThanOrEqual(4);
        expect(layout.overlaps).toBe(false);
    });

    test('the packed grid survives a window resize', async ({ page }) => {
        await openDashboard(page, { packed: true, itemLimit: 1 });
        const id = await page.evaluate(() => window.dashboardInstance.categories[1].id);
        await setSpread(page, id, true);
        await page.waitForTimeout(400);

        await page.setViewportSize({ width: 1200, height: 1000 });
        await page.waitForTimeout(600);

        // A resize runs the settings refresh, which rewrites the grid's class
        // list wholesale. Dropping the masonry class there left the categories
        // as bare flex children of a row with no columns in it — a dozen
        // categories side by side, each a few characters wide.
        expect(await page.evaluate(() => {
            const grid = document.getElementById('dashboard-layout');
            const lefts = [...new Set([...grid.querySelectorAll('.category[data-category-id]')]
                .map((el) => Math.round(el.getBoundingClientRect().left)))];
            return {
                masonry: grid.classList.contains('packed-masonry'),
                display: getComputedStyle(grid).display,
                columns: lefts.length,
            };
        })).toEqual({ masonry: true, display: 'grid', columns: 3 });
    });

    test('the stored order survives a rearrangement in either shape', async ({ page }) => {
        await openDashboard(page, { packed: true, itemLimit: 1 });

        // syncCategoriesFromDom is what a finished drag calls. In the
        // round-robin shape it used to read the columns in document order while
        // the render filled them round-robin — not each other's inverse, so
        // every drag rewrote the order into one that redistributed differently
        // and the page scrambled.
        const roundRobin = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const before = (d.categories || []).map((cat) => cat.id);
            d.renderCore.syncCategoriesFromDom();
            return { before, after: (d.categories || []).map((cat) => cat.id) };
        });
        expect(roundRobin.after).toEqual(roundRobin.before);

        // And in the masonry shape, where document order is the stored order.
        const masonry = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const id = d.categories[1].id;
            window.DashboardCategorySpan.setCategorySpread(d, id, true);
            window.DashboardCategorySpan.refreshCategorySpreadUi(d, id);
            await new Promise((resolve) => setTimeout(resolve, 300));
            const before = (d.categories || []).map((cat) => cat.id);
            d.renderCore.syncCategoriesFromDom();
            return { before, after: (d.categories || []).map((cat) => cat.id) };
        });
        expect(masonry.after).toEqual(masonry.before);
    });
});

test.describe('the switch is reachable from everywhere', () => {
    test('Shift+W flips it on the focused category', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        await page.locator(`.category[data-category-id="${id}"] .category-title`).click();

        await page.keyboard.press('Shift+W');
        await expect.poll(async () => (await stateOf(page, id)).spread, { timeout: 5000 }).toBe('true');

        await page.keyboard.press('Shift+W');
        await expect.poll(async () => (await stateOf(page, id)).spread, { timeout: 5000 }).toBe('false');
        await page.waitForTimeout(1600);
    });

    test('the category menu says what the click will do, both ways', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        const openMenu = async () => {
            await page.locator(`.category[data-category-id="${id}"] .category-title`).click({ button: 'right' });
            return page.locator('#category-context-menu .move-popover-item[data-action="spread"]');
        };

        const item = await openMenu();
        await expect(item).toBeVisible();
        await expect(item).toContainText(/spread across columns/i);

        await item.click();
        await expect.poll(async () => (await stateOf(page, id)).spread, { timeout: 5000 }).toBe('true');

        // Reopened on a spread category, the entry offers the way back rather
        // than repeating the thing that has already happened. This list is
        // verbs — Rename, Add, Delete — so a constant label read as "spreading
        // is available", which it no longer was.
        const again = await openMenu();
        await expect(again).toContainText(/back to one column/i);
        // And not marked as a ticked state: a label that flips already says it,
        // and the two together announce the opposite of what clicking does.
        await expect(again).not.toHaveAttribute('aria-checked', 'true');

        await again.click();
        await expect.poll(async () => (await stateOf(page, id)).spread, { timeout: 5000 }).toBe('false');
    });

    test('the command palette flips it for the focused category', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        // The command acts on the category the cursor is in; with nothing
        // focused that is the first block on the page, which is a smart
        // collection here.
        await page.locator(`.category[data-category-id="${id}"] .category-title`).click();

        const rows = await page.evaluate(() => window.dashboardInstance
            .searchComponent.commandsComponent.handleWidthCommand(['']));
        // On, off, and turn it off everywhere.
        expect(rows.length).toBe(3);

        await page.evaluate(() => {
            const cmds = window.dashboardInstance.searchComponent.commandsComponent;
            cmds.handleWidthCommand(['on'])[0].action();
        });
        await expect.poll(async () => (await stateOf(page, id)).spread, { timeout: 5000 }).toBe('true');
    });
});

test.describe('the category menu shows its keys', () => {
    test('nothing is cut off, in any language', async ({ page }) => {
        await openDashboard(page);
        const id = await categoryWith(page, 1);

        for (const lang of ['en', 'nl', 'de', 'fr']) {
            await page.evaluate(async (code) => {
                const d = window.dashboardInstance;
                await d.language.loadTranslations(code);
                d.renderDashboard({ animate: false, forceFull: true });
            }, lang);
            await page.waitForTimeout(250);
            await page.locator(`.category[data-category-id="${id}"] .category-title`).click({ button: 'right' });
            await page.waitForSelector('#category-context-menu', { timeout: 5000 });

            // Rows are nowrap with an ellipsis, and the shared .move-popover cap
            // is sized for the move/tag/delete pickers rather than for a menu
            // whose every row carries a key chip. Under that cap the widest row
            // needed 274px and got 237, so "Shift+W" was silently trimmed —
            // and the French labels are half again as long as the English.
            const clipped = await page.evaluate(() =>
                [...document.querySelectorAll('#category-context-menu .move-popover-item')]
                    .filter((item) => item.scrollWidth > item.clientWidth + 1)
                    .map((item) => item.getAttribute('data-action')));
            expect(clipped, `clipped in ${lang}`).toEqual([]);

            await page.keyboard.press('Escape');
        }

        await page.evaluate(() => window.dashboardInstance.language.loadTranslations('en'));
    });
});

test.describe('config points the way to the new setting', () => {
    test('no trail is left once the setting is no longer new', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.openConfigView('appearance');
            c.appearanceTab = 'layout';
            c.render();
        });
        await page.waitForSelector('[data-behavior-field="categoryItemLimit"]', { timeout: 15_000 });

        // The twinkle marked the way to categories across columns when that was
        // new, in v1.3.0. A mark that outlives its release teaches people to
        // ignore the mark, so Appearance, Layout and the panel are quiet again —
        // and nothing else has taken the trail over.
        expect(await page.evaluate(() => document.querySelectorAll(
            '.config-nav-item--animated, .config-subtab--animated, .config-panel--animated',
        ).length)).toBe(0);
    });
});

test.describe('config sets the switch too', () => {
    const openConfig = async (page, section, apply) => {
        await page.evaluate(async ({ section, apply }) => {
            const c = window.dashboardInstance.config;
            await c.openConfigView(section);
            if (apply === 'layout') c.appearanceTab = 'layout';
            if (apply === 'categories') c.ptTab = 'categories';
            c.render();
        }, { section, apply });
        // Waited on rather than slept through: the section renders its body
        // asynchronously and a fixed pause was sometimes short.
        await page.waitForSelector(apply === 'categories' ? '.config-crud-row' : '[data-behavior-field]',
            { timeout: 15_000 });
    };

    test('Pages & tags carries a switch per category, without a wall of labels', async ({ page }) => {
        await openDashboard(page);
        await openConfig(page, 'pages-tags', 'categories');

        const toggle = page.locator('.config-crud-row [data-cat-spread]').first();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        // A symbol beside the row's other buttons: ten rows of "Spread across
        // columns" is a column of repeated prose between the names and their
        // counts. The words live in the tooltip and the accessible name.
        await expect(toggle).toHaveText('↔');
        await expect(toggle).toHaveAttribute('aria-label', /spread/i);

        await toggle.click();
        await page.waitForTimeout(1200);
        expect(await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const first = c._categories[0];
            const live = (window.dashboardInstance.categories || []).find((cat) => cat.id === first.id);
            return { editor: first.spread, dashboard: live?.spread };
        })).toEqual({ editor: true, dashboard: true });
    });

    test('the reset button turns spreading off across the page', async ({ page }) => {
        await openDashboard(page, { itemLimit: 1 });
        const id = await categoryWith(page, 2);
        await setSpread(page, id, true);
        await page.waitForTimeout(1200);

        await openConfig(page, 'appearance', 'layout');
        await expect(page.locator('[data-behavior-field="defaultCategorySpread"]')).toHaveCount(1);
        // The scope is a setting of its own, and the default is the page you
        // are on rather than everything you own.
        await expect(page.locator('[data-behavior-field="categorySpreadResetScope"]')).toHaveValue('page');

        await page.locator('[data-config-action="resetCategorySpreads"]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        // Asserted against the stored file rather than the copy in memory: what
        // the button promises is that the switches are off, and opening config
        // reloads the categories, so the in-memory copy briefly disagrees.
        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch(`/api/categories?page=${window.dashboardInstance.currentPageId}`);
            const categories = res.ok ? await res.json() : [];
            return categories.filter((cat) => cat.spread === true).length;
        }), { timeout: 10_000 }).toBe(0);
    });
});
