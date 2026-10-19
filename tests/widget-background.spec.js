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
    test('the default: a title strip on every surface, and a card round it where the surface is open', async ({ page }) => {
        await openDashboard(page);
        await setWidget(page, 'auto');

        await setSurface(page, 'open');
        const open = await body(page);
        expect(open.attr).toBe('background');
        // The widget is one card, mostly solid by default (70%), not a see-through
        // wash: its own fill and hairline, round corners...
        expect(open.alpha).toBeGreaterThanOrEqual(0.7);
        expect(open.alpha).toBeLessThanOrEqual(0.9);
        expect(open.hairline).toBe(true);
        expect(open.radius).toBeGreaterThanOrEqual(10);
        // ...a strip for the title, with a line under it...
        expect(open.stripAlpha).toBeGreaterThan(open.alpha);
        expect(open.stripLine).toBe('1px');
        // ...the handle inside the card, not hanging off it, and a body with no frame of its own.
        expect(open.glyphInside).toBe(true);
        expect(open.bodyAlpha).toBe(0);
        expect(open.bodyRing).toBe(false);

        // On glass and card the pane is the card; what tells a widget from a
        // category there is the strip.
        for (const word of ['glass', 'card']) {
            await setSurface(page, word);
            const got = await body(page);
            expect(got.attr, word).toBe('background');
            expect(got.stripAlpha, word).toBeGreaterThan(0);
            expect(got.stripLine, word).toBe('1px');
        }
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
            // On glass too: the strip is what tells a widget from a category there.
            expect((await request.post('/api/settings', { headers, data: { categorySurface: 'glass', widgetSurface: 'auto' } })).ok()).toBe(true);
            expect(await (await request.get('/')).text()).toContain('data-widget-bg="background"');
            expect((await request.post('/api/settings', { headers, data: { categorySurface: 'glass', widgetSurface: 'none' } })).ok()).toBe(true);
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
        await expect(select.locator('option')).toHaveText(['Background', 'None']);
        await expect(select).toHaveValue('background');
        await setSurface(page, 'glass');
        await select.selectOption('none');
        await expect(page.locator('body')).toHaveAttribute('data-widget-bg', 'none');
        await expect.poll(async () => (await (await request.get('/api/settings')).json()).widgetSurface).toBe('none');
        await select.selectOption('background');
        await expect(page.locator('body')).toHaveAttribute('data-widget-bg', 'background');
    });

    test('Widget opacity: a slider from 0 to 100, 70 by default, paints the card and saves', async ({ page, request }) => {
        await openDashboard(page);
        await setWidget(page, 'background');
        await setSurface(page, 'open');
        await page.evaluate(() => { window.dashboardInstance.config.openConfigView('appearance'); });
        await page.evaluate(() => { window.dashboardInstance.config.appearanceTab = 'surface'; window.dashboardInstance.config.render?.(); });
        const range = page.locator('[data-appearance-range="widgetOpacity"]');
        await expect(range).toBeVisible({ timeout: 15_000 });
        await expect(range).toHaveAttribute('min', '0');
        await expect(range).toHaveAttribute('max', '100');
        await expect(range).toHaveValue('70');
        await expect(range.locator('xpath=..').locator('.config-range-value')).toHaveText('70%');
        const css = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--widget-bg').trim());
        expect(await css()).toBe('70');

        await range.fill('20');
        await expect(range.locator('xpath=..').locator('.config-range-value')).toHaveText('20%');
        await expect.poll(css).toBe('20');
        await expect.poll(async () => (await (await request.get('/api/settings')).json()).widgetOpacity).toBe(20);
        // The card follows; its title strip is a little more solid.
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView?.());
        await page.waitForSelector('.dashboard-grid .dashboard-widget');
        const alphas = await page.evaluate(() => {
            const widget = document.querySelector('.dashboard-grid .dashboard-widget');
            const a = (el) => {
                const m = getComputedStyle(el).backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
                const c = getComputedStyle(el).backgroundColor.match(/rgba\(([^)]+)\)/);
                return m ? parseFloat(m[1]) : c ? parseFloat(c[1].split(',')[3]) : 1;
            };
            return { card: a(widget), strip: a(widget.querySelector('.category-title')) };
        });
        expect(alphas.card).toBeCloseTo(0.2, 1);
        expect(alphas.strip).toBeGreaterThan(alphas.card);
        await request.post('/api/settings', { headers: { 'X-NextDash-Token': WRITE_TOKEN }, data: { widgetOpacity: 70 } });
    });

    test('Widget opacity 0 is kept, and the first paint carries the value', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        const before = await (await request.get('/api/settings')).json();
        try {
            expect((await request.post('/api/settings', { headers, data: { widgetOpacity: 0 } })).ok()).toBe(true);
            expect((await (await request.get('/api/settings')).json()).widgetOpacity).toBe(0);
            expect(await (await request.get('/')).text()).toMatch(/--widget-bg:\s*0;/);
            expect((await request.post('/api/settings', { headers, data: { widgetOpacity: 33 } })).ok()).toBe(true);
            expect(await (await request.get('/')).text()).toMatch(/--widget-bg:\s*33;/);
        } finally {
            await request.post('/api/settings', { headers, data: { widgetOpacity: before.widgetOpacity ?? 70 } });
        }
    });

    test('the theme studio has the select and the slider, and Cancel puts them back', async ({ page }) => {
        await openDashboard(page);
        const readVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--widget-bg').trim());
        const baseline = await readVar();
        const surfaceBefore = await page.evaluate(() => window.dashboardInstance.settings.widgetSurface || 'auto');
        await page.evaluate(() => window.dashboardInstance.config.openThemeBrowser());
        await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 15_000 });
        await page.locator('[data-studio-tab="surface"]').click();
        const select = page.locator('[data-look-studio] [data-appearance-select="widgetSurface"]');
        const range = page.locator('[data-look-studio] [data-appearance-range="widgetOpacity"]');
        await expect(select).toBeVisible();
        await expect(range).toBeVisible();
        await range.fill('30');
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--widget-bg').trim())).toBe('30');
        await select.selectOption('none');
        await expect(page.locator('body')).toHaveAttribute('data-widget-bg', 'none');
        // Cancel: the page goes back to what it was.
        await page.locator('[data-look-studio]').getByRole('button', { name: 'Cancel' }).click();
        await expect.poll(readVar).toBe(baseline);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.widgetSurface || 'auto')).toBe(surfaceBefore);
    });

    test('a widget has its own handle where a category has slashes', async ({ page }) => {
        await openDashboard(page);
        const read = (selector) => page.evaluate((sel) => {
            const block = [...document.querySelectorAll('.dashboard-grid .category')].find((c) => c.matches(sel) && c.querySelector('.category-title-name'));
            const glyph = block.querySelector('.category-reorder-glyph');
            return { glyphText: glyph.textContent, widgetGlyph: glyph.classList.contains('category-reorder-glyph--widget') };
        }, selector);
        const widget = await read('.dashboard-widget');
        expect(widget.widgetGlyph).toBe(true);
        const category = await read('.category:not(.dashboard-widget)');
        expect(category.widgetGlyph).toBe(false);
        expect(category.glyphText).toBe('//');
        // The widget's box is the same, slashes and all, with the panel drawn over them.
        expect(widget.glyphText).toBe('//');
        // No kind chip in the header: the handle and the strip say what it is.
        expect(await page.locator('.category-title-kind').count()).toBe(0);
    });

    // The stylesheet keys off <body>; the server had written the answer on <html>
    // only, so until a setting was touched the strip was not drawn on a plain load.
    test('a plain load has the answer on the body, and the strip is drawn', async ({ page }) => {
        await openDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-widget-bg'))).toBe('background');
        const strip = await page.evaluate(() => {
            const title = document.querySelector('.dashboard-grid .dashboard-widget .category-title');
            return getComputedStyle(title).backgroundColor;
        });
        expect(strip).not.toBe('rgba(0, 0, 0, 0)');
    });
});
