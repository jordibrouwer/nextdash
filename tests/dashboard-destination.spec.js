// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Four destinations, not three exits.
 *
 * The cluster on the right held the inbox, health and config — three ways out
 * of the dashboard with no way back in. You returned by pressing Escape, or a
 * digit, or by finding the page tab you had come from; nothing in the header
 * said "the dashboard" the way the other three say "health".
 *
 * It does now, and it is lit while a page of bookmarks is what you are looking
 * at — the one state the other three are never in. Pressing it goes back to the
 * page you left, in the page: `/` in the href is for middle-click and for
 * anyone with JavaScript off, and following it would reload the whole app.
 */
async function openWithPages(page, count = 3) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pages = [...dash.pages];
        for (let i = pages.length; i < n; i += 1) pages.push({ id: 3300 + i, name: `page-${i}` });
        const saved = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
        await dash.loadData();
        dash.pageNav?.renderPageNavigation?.();
    }, count);
    await page.waitForTimeout(400);
}

const view = (page) => page.evaluate(() => window.dashboardInstance.activeView);
const currentPage = (page) => page.evaluate(() => Number(window.dashboardInstance.currentPageId));

test('it stands with the destinations, at their size', async ({ page }) => {
    await openWithPages(page);

    const seen = await page.evaluate(() => {
        const box = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            return { x: Math.round(r.x), height: Math.round(r.height), shadow: cs.boxShadow };
        };
        return {
            dashboard: box('.dashboard-link-anchor'),
            health: box('.health-link-anchor'),
            config: box('.config-link-anchor'),
            inDestinations: Boolean(document.querySelector('.header-destinations .dashboard-link')),
        };
    });

    expect(seen.inDestinations, 'the button is not in the destination cluster').toBe(true);
    // Before inbox, health and config: it is the way back, so it leads them.
    expect(seen.dashboard.x).toBeLessThan(seen.health.x);
    expect(seen.dashboard.height, 'it is drawn at a different size').toBe(seen.health.height);
    // It is lit here — the grid is what is open — so it carries the plate plus
    // the bloom the other three take when their view is the one you are in.
    expect(seen.dashboard.shadow.startsWith(seen.config.shadow),
        'it carries a different plate').toBe(true);
});

test('it is lit on the grid and dark in a view', async ({ page }) => {
    await openWithPages(page);
    const lit = () => page.evaluate(
        () => document.querySelector('.dashboard-link-anchor')?.classList.contains('active') === true,
    );

    expect(await lit(), 'the dashboard icon is dark while the dashboard is open').toBe(true);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await expect.poll(lit, { timeout: 10_000 }).toBe(false);

    await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
    await page.waitForTimeout(600);
    expect(await lit(), 'the dashboard icon is lit inside health').toBe(false);
});

test('it comes back to the page you left, without reloading', async ({ page }) => {
    await openWithPages(page);

    // Through the key a reader presses, so the page it returns to is one that
    // was actually opened rather than one set by hand.
    await page.keyboard.press('3');
    const third = await page.evaluate(() => Number(window.dashboardInstance.pages[2].id));
    await expect.poll(() => currentPage(page), { timeout: 10_000 }).toBe(third);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    expect(await view(page)).toBe('config');

    let reloaded = false;
    page.on('load', () => { reloaded = true; });
    await page.locator('.dashboard-link-anchor').click();

    await expect.poll(() => view(page), { timeout: 10_000 }).toBe('bookmarks');
    expect(await currentPage(page), 'it came back to a different page').toBe(third);
    // The grid is back: a seeded page carries no bookmarks, so what says the
    // dashboard is drawn is the layout, not a row in it.
    await expect(page.locator('#dashboard-layout')).toBeVisible();
    await expect(page.locator('.config-view')).toHaveCount(0);
    expect(reloaded, 'the whole app was reloaded').toBe(false);
});

test('the href is still a link for everything but the click', async ({ page }) => {
    await openWithPages(page);
    const anchor = page.locator('.dashboard-link-anchor');
    await expect(anchor).toHaveAttribute('href', '/');
    // Named for a screen reader, like its neighbours.
    expect((await anchor.getAttribute('aria-label') || '').trim().length).toBeGreaterThan(0);
});
