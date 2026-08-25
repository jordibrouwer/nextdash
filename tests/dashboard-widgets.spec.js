// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Widgets as blocks in the grid.
 *
 * Phase 1 and 2: a widget appears where the stored order puts it, and moving it
 * sticks. What it draws is phase 4 -- until then it says so rather than being an
 * empty hole.
 */
test.describe('dashboard widgets', () => {
    async function addWidget(page, title) {
        return page.evaluate(async (t) => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            const res = await f('/api/pages/1/blocks', {
                method: 'PUT', headers: h,
                body: JSON.stringify({ widgets: [{ type: 'health', title: t }] }),
            });
            return res.json();
        }, title);
    }

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test('a widget is drawn as a block among the categories', async ({ page }) => {
        await addWidget(page, 'Status');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });

        const widget = page.locator('.dashboard-widget').first();
        await expect(widget).toBeVisible({ timeout: 10_000 });
        // Lower-cased like every other block title, so one heading in the grid
        // does not shout. The typed title is kept in the tooltip.
        await expect(widget.locator('.category-title-name')).toHaveText('status');
        await expect(widget.locator('.category-title-name')).toHaveAttribute('title', 'Status');

        /*
         * It carries `.category` as well. The masonry layout measures blocks by
         * that class and the drag module selects by it, so a widget that called
         * itself something else would be laid out and dragged by nothing.
         */
        await expect(widget).toHaveClass(/(^|\s)category(\s|$)/);
        await expect(widget.locator('.category-reorder-handle')).toHaveCount(1);
    });

    test('an order stored on the server is the order it is built in', async ({ page }) => {
        const saved = await addWidget(page, 'Status');
        const widgetId = saved.widgets[0].id;

        /*
         * The widget in the middle, deliberately.
         *
         * Widgets are pushed into the block list before the categories, so an
         * order that puts one first is one the builder would produce anyway --
         * a test asserting that passes whether the order is applied or not.
         * Between two categories is a position only the stored order can give.
         */
        await page.evaluate(async (id) => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', {
                method: 'PUT', headers: h,
                body: JSON.stringify({ order: ['development', id, 'media'] }),
            });
        }, widgetId);

        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });

        /*
         * Read from the block builder, not the DOM: the packed layout hands
         * blocks to columns round-robin, so document order is a different
         * question from the order the reader arranged.
         */
        const built = await page.evaluate(() =>
            window.dashboardInstance.renderCore.buildCategoryColumnBlocks().map((b) => b.category?.id));

        // Smart collections stay at the top -- they have no handle and are not
        // the reader's to arrange.
        const movable = built.filter((id) => !String(id).startsWith('__smart'));
        expect(movable[0]).toBe('development');
        expect(movable[1]).toBe(widgetId);
        expect(movable[2]).toBe('media');
    });

    test('moving a widget is saved and survives a reload', async ({ page }) => {
        const saved = await addWidget(page, 'Status');
        const widgetId = saved.widgets[0].id;
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });

        // The path a drop takes once the DOM has been rearranged.
        // Dropped between the first two categories, which is a place only the
        // stored order can produce.
        await page.evaluate((id) => {
            const d = window.dashboardInstance;
            const rest = (d.blockOrder || []).filter((x) => x !== id && !String(x).startsWith('__smart'));
            d.blockOrder = [rest[0], id, ...rest.slice(1)];
            d.renderCore.scheduleBlockOrderSave();
        }, widgetId);

        await expect.poll(async () => page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await (await f('/api/pages/1/blocks')).json()).order[1];
        }), { timeout: 15_000 }).toBe(widgetId);

        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });
        const built = await page.evaluate(() =>
            window.dashboardInstance.renderCore.buildCategoryColumnBlocks().map((b) => b.category?.id));
        expect(built.filter((id) => !String(id).startsWith('__smart'))[1]).toBe(widgetId);
    });

    /*
     * A widget id must never reach the category list.
     *
     * Written back to /api/categories it would become a category with a w_ slug
     * and no bookmarks -- visible on the page, impossible to explain.
     *
     * Worth knowing: this holds for two reasons. syncCategoriesFromDom filters
     * widget elements out explicitly, and the lookup that follows maps ids to
     * category objects and drops what it cannot find, so a widget id would fall
     * out there too. Removing either alone still leaves the property true --
     * this asserts the property, not the line, and a passing run is not proof
     * that both halves are load-bearing.
     */
    test('reordering does not turn a widget into a category', async ({ page }) => {
        await addWidget(page, 'Status');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });

        await page.evaluate(() => window.dashboardInstance.renderCore.syncCategoriesFromDom());
        await page.waitForTimeout(1500);

        const categories = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await (await f('/api/categories?page=1')).json()).map((c) => c.id);
        });
        expect(categories.some((id) => String(id).startsWith('w_'))).toBe(false);
    });
});

/*
 * The Widgets tab in Config, and the health widget itself.
 */
test.describe('the widgets tab', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.click('[data-pt-tab="widgets"]');
        await expect(page.locator('[data-widget-add]')).toBeVisible({ timeout: 15_000 });
    });

    test('adding a widget lists it among the categories', async ({ page }) => {
        /*
         * Cleared first: the store is reset per spec file, not per test, so an
         * earlier test's widget would still be here and the empty state would
         * be a claim about running order rather than about this code.
         */
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({ widgets: [] }) });
        });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c._widgetLoadedFor = null;
            c._widgetBlocks = null;
            return c.loadWidgetsEditor();
        });
        await expect(page.locator('.config-panel-empty')).toContainText(/No widgets/i, { timeout: 10_000 });

        await page.click('[data-widget-add]');
        await expect(page.locator('[data-widget-row]').first()).toBeVisible({ timeout: 15_000 });

        const rows = await page.evaluate(() => [...document.querySelectorAll('[data-widget-row]')].map((r) => ({
            isCategory: r.classList.contains('config-widget-row--category'),
        })));
        // Categories are listed too, so a widget can be moved between them --
        // "move up" is meaningless in a list of widgets alone.
        expect(rows.some((r) => r.isCategory)).toBe(true);
        expect(rows.some((r) => !r.isCategory)).toBe(true);

        // Only the widget can be deleted here; renaming a category belongs on
        // the Categories tab, and offering it twice is two places to keep right.
        expect(await page.locator('[data-widget-delete]').count()).toBe(1);
    });

    test('moving a widget here moves it on the dashboard', async ({ page }) => {
        await page.click('[data-widget-add]');
        await expect(page.locator('[data-widget-delete]')).toHaveCount(1, { timeout: 15_000 });

        const before = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await (await f('/api/pages/1/blocks')).json()).order;
        });
        const widgetIndex = before.findIndex((id) => String(id).startsWith('w_'));
        expect(widgetIndex).toBeGreaterThan(0);

        await page.click(`[data-widget-row="${widgetIndex}"] [data-widget-move="up"]`);

        // The same blockOrder the dashboard draws from: one order, not two that
        // agree until they do not.
        await expect.poll(async () => page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const order = (await (await f('/api/pages/1/blocks')).json()).order;
            return order.findIndex((id) => String(id).startsWith('w_'));
        }), { timeout: 15_000 }).toBe(widgetIndex - 1);
    });
});

test.describe('the health widget', () => {
    test('it reports the same figures as the header badge', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', {
                method: 'PUT', headers: h,
                body: JSON.stringify({ widgets: [{ type: 'health', title: 'Status' }] }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });

        // Filled in from the report the badge already fetched, so the two cannot
        // disagree about how many links are broken while sharing a screen.
        await expect.poll(async () =>
            page.locator('.dashboard-widget-health-row').count(), { timeout: 15_000 }).toBeGreaterThan(0);

        const agreed = await page.evaluate(() => {
            const summary = window.dashboardInstance.healthSummary || {};
            const row = document.querySelector('[data-health-filter="broken"] .dashboard-widget-health-value');
            return { widget: row?.textContent, badge: String(summary.brokenCount ?? '') };
        });
        expect(agreed.widget).toBe(agreed.badge);

        // Every figure is a way into the rows behind it: a count you cannot act
        // on is a decoration.
        const filters = await page.evaluate(() =>
            [...document.querySelectorAll('.dashboard-widget-health-row')].map((r) => r.dataset.healthFilter));
        expect(filters).toContain('broken');
        expect(filters.every(Boolean)).toBe(true);
    });
});

/*
 * How a widget looks beside the categories it sits among.
 *
 * It shipped once as a plain div with a smaller font and no edge, which read as
 * loose text under a heading rather than a block. These assert the three things
 * that were wrong, against the categories themselves rather than against fixed
 * values -- a widget should follow the grid, not a number written down here.
 */
test.describe('widget appearance', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', {
                method: 'PUT', headers: h,
                body: JSON.stringify({ widgets: [{ type: 'health', title: 'Status' }] }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('.dashboard-widget')).toBeVisible({ timeout: 15_000 });
    });

    test('its title is a category title, not a smaller heading of its own', async ({ page }) => {
        const measured = await page.evaluate(() => {
            const widgetTitle = document.querySelector('.dashboard-widget .category-title');
            const categoryTitle = document.querySelector('.category:not(.dashboard-widget) .category-title');
            if (!widgetTitle || !categoryTitle) return null;
            const a = getComputedStyle(widgetTitle);
            const b = getComputedStyle(categoryTitle);
            return {
                sameSize: a.fontSize === b.fontSize,
                sameWeight: a.fontWeight === b.fontWeight,
                size: a.fontSize,
            };
        });
        expect(measured, 'no category to compare against').not.toBeNull();
        expect(measured.sameSize).toBe(true);
        expect(measured.sameWeight).toBe(true);
    });

    test('it has the same drag handle a category has', async ({ page }) => {
        const handle = page.locator('.dashboard-widget .category-reorder-handle');
        await expect(handle).toHaveCount(1);
        // The "//" prefix is the handle -- that is what DragReorder grabs, and
        // the grab cursor is how a reader knows it can be moved.
        await expect(handle).toHaveText(/\/\//);
        expect(await handle.evaluate((el) => getComputedStyle(el).cursor)).toBe('grab');
    });

    test('its body is a card, at the grid\u2019s own text size', async ({ page }) => {
        const body = await page.evaluate(() => {
            const el = document.querySelector('.dashboard-widget .dashboard-widget-body');
            const grid = document.querySelector('.category:not(.dashboard-widget)');
            if (!el) return null;
            const c = getComputedStyle(el);
            return {
                borderWidth: parseFloat(c.borderTopWidth),
                transparent: c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.backgroundColor === 'transparent',
                fontSize: parseFloat(c.fontSize),
                // The blocks beside it, which is the size to match rather than
                // a number written down here.
                gridFontSize: grid ? parseFloat(getComputedStyle(grid).fontSize) : null,
            };
        });
        expect(body, 'no widget body').not.toBeNull();
        // An edge, because a panel of figures without one reads as loose text.
        expect(body.borderWidth).toBeGreaterThan(0);
        expect(body.transparent).toBe(false);
        /*
         * Its content at the size the grid uses, not the smaller one meant for
         * meta lines: these figures are the widget's content.
         *
         * Compared with a neighbouring category rather than a fixed pixel
         * value, so this follows a theme that changes the scale instead of
         * pinning the widget to one.
         */
        expect(body.gridFontSize, 'no category to compare against').not.toBeNull();
        expect(body.fontSize).toBeGreaterThanOrEqual(body.gridFontSize);
    });
});

/*
 * One order, one write.
 *
 * Widgets and categories used to have separate lists: the category array's own
 * order decided where categories went, blockOrder decided where widgets went,
 * and a single drag wrote both. Two lists saying where something sits is two
 * lists that disagree the moment one is written and the other is not -- and it
 * really did disagree: a widget dropped in second place came back fourth.
 */
test.describe('one order for widgets and categories', () => {
    async function order(page) {
        return page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await (await f('/api/pages/1/blocks')).json()).order;
        });
    }

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', {
                method: 'PUT', headers: h,
                body: JSON.stringify({ widgets: [{ type: 'health', title: 'Status' }] }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });
    });

    test('a move writes the block order and nothing else', async ({ page }) => {
        const writes = [];
        page.on('request', (r) => {
            if (r.method() !== 'GET' && /\/api\/(categories|pages\/\d+\/blocks)/.test(r.url())) {
                writes.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]}`);
            }
        });

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.renderCore.moveBlockInOrder(d.widgets[0].id, -1);
        });
        await expect.poll(async () => writes.length, { timeout: 15_000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1500);

        // The category array is not where the order lives any more, so moving a
        // block must not touch it.
        expect(writes.filter((w) => w.includes('/api/categories'))).toEqual([]);
        expect(writes.filter((w) => w.includes('/blocks'))).not.toEqual([]);
    });

    /*
     * A category with nothing in it is not rendered under "hide empty
     * categories", so the DOM is not the whole list. Writing the DOM order as
     * the complete order dropped those to the end and shifted everything after
     * them -- which is exactly how a widget dropped second came back fourth.
     */
    test('a block that is not on screen keeps its place', async ({ page }) => {
        const before = await order(page);
        const offScreen = await page.evaluate(() => {
            const rendered = new Set([...document.querySelectorAll('.category')]
                .map((el) => el.getAttribute('data-category-id')));
            return (window.dashboardInstance.blockOrder || []).filter((id) => !rendered.has(id));
        });
        test.skip(offScreen.length === 0, 'no unrendered block on this page to protect');

        await page.evaluate(() => window.dashboardInstance.renderCore.syncCategoriesFromDom());
        await page.waitForTimeout(1800);

        const after = await order(page);
        // Same members, and the unrendered one did not fall to the end.
        expect([...after].sort()).toEqual([...before].sort());
        offScreen.forEach((id) => {
            expect(after.indexOf(id)).toBe(before.indexOf(id));
        });
    });

    test('the keyboard moves a block through the same order', async ({ page }) => {
        const before = await order(page);
        const widgetId = before.find((id) => String(id).startsWith('w_'));
        const from = before.indexOf(widgetId);
        test.skip(from === 0, 'already first; nothing to move up into');

        await page.evaluate((id) => {
            window.dashboardInstance.renderCore.moveBlockInOrder(id, -1);
        }, widgetId);

        await expect.poll(async () => (await order(page)).indexOf(widgetId), { timeout: 15_000 })
            .toBe(from - 1);
        // Exactly one place, not to the end and not past a neighbour.
        const after = await order(page);
        expect(after.length).toBe(before.length);
    });
});
