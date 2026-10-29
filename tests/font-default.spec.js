// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The dashboard is Source Code Pro, stored on the server, as are the // and the
 * figures; every other screen reads in Inter.
 *
 * It was Inter everywhere for a while, because a mono cut long names short in
 * narrow columns, then Source Code Pro everywhere. Now the dashboard (header bar,
 * bookmark grid, search and the modals opened on it) is the mono and Config and
 * the other views are Inter.
 * Both load from /static/fonts with no request to a font CDN.
 */
test('the dashboard is Source Code Pro, from our own files, like the // and the figures', async ({ page }) => {
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
            header: family('.dashboard-section.section-controls'),
            preset: document.documentElement.getAttribute('data-font-preset'),
            name: family('#dashboard-layout .bookmark-text'),
            glyph: family('#dashboard-layout .category-reorder-glyph'),
            monoLoaded: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Source Code Pro' && f.status === 'loaded'),
        };
    });

    expect(read.preset).toBe('source-code-pro');
    expect(read.body, 'outside the dashboard the text is Inter').toMatch(/Inter/);
    expect(read.header).toMatch(/Source Code Pro/);
    expect(read.name).toMatch(/Source Code Pro/);
    expect(read.glyph, 'the // is on the mono').toMatch(/Source Code Pro/);
    expect(read.monoLoaded, 'Source Code Pro is loaded from /static/fonts').toBe(true);
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

test('Config reads in Inter while the header bar stays Source Code Pro', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.locator('a[href="/#config"]').first().click();
    await page.waitForSelector('#dashboard-layout .config-view', { timeout: 20_000 });
    await page.evaluate(async () => { await document.fonts.ready; });

    const read = await page.evaluate(() => {
        const family = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).fontFamily : null;
        };
        return {
            view: document.body.getAttribute('data-active-view'),
            config: family('#dashboard-layout .config-view-head-breadcrumb'),
            header: family('.dashboard-section.section-controls'),
            interLoaded: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Inter' && f.status === 'loaded'),
        };
    });

    expect(read.view).toBe('config');
    expect(read.config, 'Config is Inter').toMatch(/Inter/);
    expect(read.header, 'the header bar is the dashboard font').toMatch(/Source Code Pro/);
    expect(read.interLoaded, 'Inter is loaded from /static/fonts').toBe(true);
});

test('a modal opened on the dashboard is Source Code Pro; the same modal in Config is Inter', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    const confirmFont = () => page.evaluate(async () => {
        window.AppModal.show({ title: 'Font check', message: 'Body text', confirmText: 'OK' });
        await new Promise((r) => setTimeout(r, 300));
        const family = (sel) => getComputedStyle(document.querySelector(sel)).fontFamily;
        const seen = { title: family('#app-modal .modal-title'), text: family('#modal-text'), button: family('#modal-actions button') };
        window.AppModal.hide();
        await new Promise((r) => setTimeout(r, 300));
        return seen;
    });

    const onDashboard = await confirmFont();
    expect(onDashboard.title, 'the modal title on the dashboard').toMatch(/Source Code Pro/);
    expect(onDashboard.text, 'the modal text on the dashboard').toMatch(/Source Code Pro/);
    expect(onDashboard.button, 'the modal button on the dashboard').toMatch(/Source Code Pro/);

    // Recent bookmarks, through the toggle the key runs.
    await page.evaluate(() => window.dashboardInstance.toggleRecentBookmarksModal());
    await expect(page.locator('#app-modal.show .recent-bookmarks-modal')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.recent-bookmarks-modal .modal-title')).fontFamily))
        .toMatch(/Source Code Pro/);
    await page.evaluate(() => window.AppModal.hide());

    await page.evaluate(() => { location.hash = '#config'; });
    await expect.poll(() => page.evaluate(() => document.body.dataset.activeView)).toBe('config');
    const inConfig = await confirmFont();
    expect(inConfig.title, 'the modal title in Config').toMatch(/Inter/);
});
