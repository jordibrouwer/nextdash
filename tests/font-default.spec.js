// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The text is Inter, stored on the server; the // and the figures stay on the mono.
 *
 * Source Code Pro as the text font cut long names short in narrow columns. Inter
 * is the default now, loaded from /static/fonts like the mono, with no request
 * to a font CDN, and the code-like parts keep the mono.
 */
test('the text is Inter, from our own files, and the // and the figures are mono', async ({ page }) => {
    const outside = [];
    page.on('request', (request) => {
        if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) outside.push(request.url());
    });

    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async () => { await document.fonts.ready; });

    const read = await page.evaluate(() => {
        const family = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).fontFamily : null;
        };
        return {
            body: getComputedStyle(document.body).fontFamily,
            preset: document.documentElement.getAttribute('data-font-preset'),
            name: family('#dashboard-layout .bookmark-text'),
            glyph: family('#dashboard-layout .category-reorder-glyph'),
            interLoaded: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Inter' && f.status === 'loaded'),
        };
    });

    expect(read.preset).toBe('inter');
    expect(read.body).toMatch(/Inter/);
    expect(read.name).toMatch(/Inter/);
    expect(read.glyph, 'the // stays on the mono').toMatch(/Source Code Pro/);
    expect(read.interLoaded, 'Inter is loaded from /static/fonts').toBe(true);
    expect(outside, 'no request to a font CDN').toEqual([]);
});

test('the response time and the shortcut on a row are mono', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    const fonts = await page.evaluate(() => {
        const out = {};
        for (const [key, sel] of Object.entries({ shortcut: '.bookmark-shortcut', badge: '.bookmark-superscript-badge, .status-text', stat: '.dashboard-widget-health-value, .dashboard-widget-stat-value' })) {
            const el = document.querySelector(sel);
            out[key] = el ? getComputedStyle(el).fontFamily : null;
        }
        return out;
    });
    for (const [key, family] of Object.entries(fonts)) {
        if (family === null) continue; // not on this page's data
        expect(family, key).toMatch(/Source Code Pro/);
    }
    expect(Object.values(fonts).some((f) => f !== null), 'at least one of them is on the page').toBe(true);
});
