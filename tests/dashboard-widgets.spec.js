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
        await expect(widget).toContainText('Status');

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
