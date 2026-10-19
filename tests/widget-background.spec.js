// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A widget with a background of its own.
 *
 * On an open category surface nothing frames a widget, and it looked like a
 * category with another title. Widget background (Appearance → Surfaces) gives
 * it a frame: automatic where the surface is open, always, or never.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .dashboard-widget .dashboard-widget-body', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const setSurface = (page, word) => page.evaluate((w) => window.ThemeLoader.applyCatSurface(w), word);
const setWidget = (page, word) => page.evaluate((w) => {
    window.dashboardInstance.settings.widgetSurface = w;
    window.ThemeLoader.applyWidgetSurface(w);
}, word);

/** What a widget is drawn with: its card, the strip its title sits on, and its body. */
const body = (page) => page.evaluate(() => {
    const widget = document.querySelector('.dashboard-grid:is(.layout-default, .layout-compact, .layout-masonry) .dashboard-widget');
    const title = widget.querySelector('.category-title');
    const inner = widget.querySelector('.dashboard-widget-body');
    const alphaOf = (cs) => {
        const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
        const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
        return slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
    };
    const wcs = getComputedStyle(widget);
    const tcs = getComputedStyle(title);
    const icscs = getComputedStyle(inner);
    const glyph = widget.querySelector('.category-reorder-glyph, .category-reorder-handle');
    const wbox = widget.getBoundingClientRect();
    return {
        attr: document.body.getAttribute('data-widget-bg'),
        alpha: alphaOf(wcs),
        hairline: /inset 0px 0px 0px 1px|0px 0px 0px 1px inset/.test(wcs.boxShadow),
        radius: parseFloat(wcs.borderTopLeftRadius),
        stripAlpha: alphaOf(tcs),
        stripLine: tcs.borderBottomWidth,
        bodyAlpha: alphaOf(icscs),
        bodyRing: /inset 0px 0px 0px 1px|0px 0px 0px 1px inset/.test(icscs.boxShadow),
        glyphInside: glyph ? glyph.getBoundingClientRect().left >= wbox.left - 0.5 : null,
    };
});

test.describe('widget background', () => {
    test('automatic: a card with a title strip on an open surface, none where the pane is the frame', async ({ page }) => {
        await openDashboard(page);
        await setWidget(page, 'auto');

        await setSurface(page, 'open');
        const open = await body(page);
        expect(open.attr).toBe('background');
        // The widget is one card: its own fill and hairline, round corners...
        expect(open.alpha).toBeGreaterThan(0);
        expect(open.alpha).toBeLessThanOrEqual(0.15);
        expect(open.hairline).toBe(true);
        expect(open.radius).toBeGreaterThanOrEqual(10);
        // ...a strip for the title, with a line under it...
        expect(open.stripAlpha).toBeGreaterThan(0);
        expect(open.stripAlpha).toBeLessThanOrEqual(0.2);
        expect(open.stripLine).toBe('1px');
        // ...the // inside the card, not hanging off it, and a body with no frame of its own.
        expect(open.glyphInside).toBe(true);
        expect(open.bodyAlpha).toBe(0);
        expect(open.bodyRing).toBe(false);

        await setSurface(page, 'glass');
        const glass = await body(page);
        expect(glass.attr).toBe('none');
        expect(glass.stripAlpha).toBe(0);

        await setSurface(page, 'card');
        expect((await body(page)).attr).toBe('none');
    });

    test('background: always, also on glass and card: the title strip is there on every surface', async ({ page }) => {
        await openDashboard(page);
        await setWidget(page, 'background');
        for (const word of ['glass', 'card', 'open']) {
            await setSurface(page, word);
            const got = await body(page);
            expect(got.attr, word).toBe('background');
            expect(got.stripAlpha, word).toBeGreaterThan(0);
            expect(got.stripLine, word).toBe('1px');
        }
    });

    test('automatic steps back when the category has a pane of its own glass, and background does not', async ({ page }) => {
        await openDashboard(page);
        await setSurface(page, 'open');
        await page.evaluate(() => {
            window.ThemeLoader.applyCardGlass?.({ alpha: 0.4, blur: 12, border: false });
        });
        await setWidget(page, 'auto');
        expect((await body(page)).attr).toBe('none');
        await setWidget(page, 'background');
        expect((await body(page)).attr).toBe('background');
    });

    test('none: never, also on open', async ({ page }) => {
        await openDashboard(page);
        await setWidget(page, 'none');
        await setSurface(page, 'open');
        const got = await body(page);
        expect(got.attr).toBe('none');
        expect(got.alpha).toBe(0);
        expect(got.stripAlpha).toBe(0);
    });

    test('the first paint has it: the server writes the answer into the page', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        const before = await (await request.get('/api/settings')).json();
        expect((await request.post('/api/settings', { headers, data: { categorySurface: 'open', widgetSurface: 'auto' } })).ok()).toBe(true);
        try {
            const html = await (await request.get('/')).text();
            expect(html).toContain('data-cat-surface="open"');
            expect(html).toContain('data-widget-bg="background"');
            expect((await request.post('/api/settings', { headers, data: { categorySurface: 'glass', widgetSurface: 'auto' } })).ok()).toBe(true);
            expect(await (await request.get('/')).text()).toContain('data-widget-bg="none"');
        } finally {
            await request.post('/api/settings', { headers, data: { categorySurface: before.categorySurface || 'follow', widgetSurface: before.widgetSurface || 'auto' } });
        }
    });

    test('Appearance → Surfaces has the setting, and changing it paints and saves', async ({ page, request }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.evaluate(() => { window.dashboardInstance.config.appearanceTab = 'surface'; window.dashboardInstance.config.render?.(); });
        const select = page.locator('[data-appearance-select="widgetSurface"]');
        await expect(select).toBeVisible({ timeout: 15_000 });
        await expect(select.locator('option')).toHaveText(['Automatic', 'Background', 'None']);
        await expect(select).toHaveValue('auto');
        await setSurface(page, 'glass');
        await select.selectOption('background');
        await expect(page.locator('body')).toHaveAttribute('data-widget-bg', 'background');
        await expect.poll(async () => (await (await request.get('/api/settings')).json()).widgetSurface).toBe('background');
        await select.selectOption('auto');
        await expect(page.locator('body')).toHaveAttribute('data-widget-bg', 'none');
    });
});
