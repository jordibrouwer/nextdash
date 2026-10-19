// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A page of categories and widgets keeps its titles in step.
 *
 * The // stands in the title, for a category as for a widget: the two kinds of
 * block on one page share it. Pointing at a title grew it four
 * pixels to the left and painted it with the `background` shorthand, which took
 * the accent tab off the rule under it, so the rule jumped. Now the // is at one
 * place for both, a widget's name starts where its card's content does, and
 * a title is tinted where it stands.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
}

/** Left edge of the // and of the name, and the title's own box, each from its block's left edge. */
const measure = (page, widget) => page.evaluate((isWidget) => {
    const block = [...document.querySelectorAll('#dashboard-layout .category')]
        .find((c) => c.classList.contains('dashboard-widget') === isWidget && c.querySelector('.category-title-name'));
    if (!block) return null;
    const left = block.getBoundingClientRect().left;
    const title = block.querySelector('.category-title');
    const box = title.getBoundingClientRect();
    return {
        glyph: Math.round((block.querySelector('.category-reorder-glyph').getBoundingClientRect().left - left) * 10) / 10,
        name: Math.round((block.querySelector('.category-title-name').getBoundingClientRect().left - left) * 10) / 10,
        title: { x: Math.round((box.left - left) * 10) / 10, w: Math.round(box.width * 10) / 10 },
        block: Math.round(block.getBoundingClientRect().width * 10) / 10,
        top: Math.round((box.top - block.getBoundingClientRect().top) * 10) / 10,
        // Where the accent tab on the rule really is, from the block's left edge.
        tabX: Math.round((box.left - left + (parseFloat(getComputedStyle(title).backgroundPositionX) || 0)) * 10) / 10,
        tab: getComputedStyle(title).backgroundImage,
    };
}, widget);

test.describe('titles of categories and widgets', () => {
    test('the // stands in the title, at one place for a category and a widget', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.ThemeLoader.applyWidgetSurface('none'); window.ThemeLoader.applyCatSurface('open'); });
        const category = await measure(page, false);
        const widget = await measure(page, true);
        expect(category).not.toBeNull();
        expect(widget).not.toBeNull();
        // In the title's row, not hung in the gutter before it.
        expect(category.glyph).toBeGreaterThanOrEqual(0);
        expect(widget.glyph).toBe(category.glyph);
    });

    test('on open, the name starts at one place for a category and a widget', async ({ page }) => {
        await openDashboard(page);
        // A widget with a card of its own (Widget background) has its // inside the
        // card; these two are about a widget without one.
        await page.evaluate(() => { window.ThemeLoader.applyWidgetSurface('none'); window.ThemeLoader.applyCatSurface('open'); });
        const category = await measure(page, false);
        const widget = await measure(page, true);
        expect(category.name).toBe(widget.name);
    });

    test('on a glass pane the handle stands inside it; a widget\'s sits on its header strip, a little further in', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.ThemeLoader.applyCatSurface('glass'));
        const category = await measure(page, false);
        const widget = await measure(page, true);
        expect(category).not.toBeNull();
        expect(widget).not.toBeNull();
        // Inside the pane, not over its edge.
        expect(category.glyph).toBeGreaterThan(0);
        // The strip is what tells the two apart, and its text has its own padding.
        expect(widget.glyph).toBeGreaterThan(category.glyph);
    });

    test('a widget has a head strip by default, and with None its title is not on a surface of its own', async ({ page }) => {
        await openDashboard(page);
        const read = () => page.evaluate(() => {
            const w = document.querySelector('#dashboard-layout .category.dashboard-widget');
            const title = w.querySelector('.category-title');
            const body = w.querySelector('.dashboard-widget-body');
            return {
                bg: getComputedStyle(title).backgroundColor,
                border: getComputedStyle(title).borderBottomWidth,
                gap: body.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
            };
        });
        // The default: the title sits on a strip, with a line under it.
        const strip = await read();
        expect(strip.bg).not.toBe('rgba(0, 0, 0, 0)');
        expect(strip.border).toBe('1px');
        // None draws it like a category.
        await page.evaluate(() => window.ThemeLoader.applyWidgetSurface('none'));
        const plain = await read();
        expect(plain.bg).toBe('rgba(0, 0, 0, 0)');
        expect(plain.gap).toBeGreaterThan(4);
    });

    test('pointing at a title tints the whole header and does not move its text', async ({ page }) => {
        await openDashboard(page);
        for (const widget of [false, true]) {
            const before = await measure(page, widget);
            const block = page.locator(`#dashboard-layout .category${widget ? '.dashboard-widget' : ':not(.dashboard-widget)'}`)
                .filter({ has: page.locator('.category-title-name') }).first();
            const box = await block.locator('.category-title').boundingBox();
            await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
            await expect(block.locator('.category-title')).toHaveCSS('background-color', /rgba?\(.*, 0\.\d+\)|color\(.* \/ 0\.\d+\)/);
            const during = await measure(page, widget);
            // The tint is the whole header, from one edge of the block to the other,
            // and the text inside it stays where it was.
            expect(during.title.x).toBe(0);
            expect(during.title.w).toBe(during.block);
            // And up to the block's top edge, where a pane has padding above the title.
            expect(during.top).toBe(0);
            // The accent tab does not slide when the title grows to the edges.
            expect(during.tabX).toBe(before.tabX);
            expect(during.glyph).toBe(before.glyph);
            expect(during.name).toBe(before.name);
            // The accent tab on the rule is still there under the tint.
            expect(during.tab).toBe(before.tab);
            expect(during.tab).toContain('linear-gradient');
            await page.mouse.move(0, 0);
        }
    });
});
