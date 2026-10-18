// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A page of categories and widgets keeps its titles in step.
 *
 * The // hangs in the gutter left of the column, and it hung there for a
 * category while a widget kept it in the row: the two kinds of block on one
 * page did not share a column of them. And pointing at a title grew it four
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
        tab: getComputedStyle(title).backgroundImage,
    };
}, widget);

test.describe('titles of categories and widgets', () => {
    test('the // hangs at the same place for a category and a widget', async ({ page }) => {
        await openDashboard(page);
        const category = await measure(page, false);
        const widget = await measure(page, true);
        expect(category).not.toBeNull();
        expect(widget).not.toBeNull();
        expect(category.glyph).toBeLessThan(0);
        expect(widget.glyph).toBe(category.glyph);
    });

    test('a widget has no head strip: the title is not on a surface of its own', async ({ page }) => {
        await openDashboard(page);
        const gap = await page.evaluate(() => {
            const w = document.querySelector('#dashboard-layout .category.dashboard-widget');
            const title = w.querySelector('.category-title');
            const body = w.querySelector('.dashboard-widget-body');
            return {
                bg: getComputedStyle(title).backgroundColor,
                border: getComputedStyle(title).borderTopWidth,
                gap: body.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
            };
        });
        expect(gap.bg).toBe('rgba(0, 0, 0, 0)');
        expect(gap.border).toBe('0px');
        expect(gap.gap).toBeGreaterThan(4);
    });

    test('pointing at a title tints it and does not move it', async ({ page }) => {
        await openDashboard(page);
        for (const widget of [false, true]) {
            const before = await measure(page, widget);
            const block = page.locator(`#dashboard-layout .category${widget ? '.dashboard-widget' : ':not(.dashboard-widget)'}`)
                .filter({ has: page.locator('.category-title-name') }).first();
            const box = await block.locator('.category-title').boundingBox();
            await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
            await expect(block.locator('.category-title')).toHaveCSS('background-color', /rgba?\(.*, 0\.\d+\)|color\(.* \/ 0\.\d+\)/);
            const during = await measure(page, widget);
            expect(during.title).toEqual(before.title);
            expect(during.glyph).toBe(before.glyph);
            expect(during.name).toBe(before.name);
            // The accent tab on the rule is still there under the tint.
            expect(during.tab).toBe(before.tab);
            expect(during.tab).toContain('linear-gradient');
            await page.mouse.move(0, 0);
        }
    });
});
