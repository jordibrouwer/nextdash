// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The view name and the clock are one block in the header row.
 *
 * They used to be two bands: a 32px strip carrying the clock and the toolbar,
 * and under it a 60px section that held nothing but the page's name. The grid
 * therefore began 148px down the page to say one word, on every view, at every
 * window size.
 *
 * The name now owns the left of the header row with the clock as the quiet
 * line beneath it, and the band it used to live in is gone.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const box = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}, selector);

test('the view name sits in the header row, not in a band of its own', async ({ page }) => {
    await openDashboard(page);

    const identity = await box(page, '.header-identity');
    const title = await box(page, '.title');
    const header = await box(page, '.header-top');
    const actions = await box(page, '.header-actions');

    expect(identity, 'there is no identity block').not.toBeNull();
    // The row is a band with padding of its own now, so "in the row" is a
    // centre line shared rather than an edge shared: the name and the actions
    // ride the same middle, and the name is the leftmost thing on it.
    const middle = (b) => Math.round(b.y + b.h / 2);
    // The name is the top line of a two-line block, so what rides the row's
    // middle is the block; the name itself sits above it and inside the band.
    expect(middle(identity), 'the identity block is not on the row').toBeCloseTo(middle(header), -1);
    expect(title.y, 'the name escaped the band').toBeGreaterThanOrEqual(header.y);
    expect(title.x, 'something stands left of the name').toBeLessThan(actions.x);
    // The actions are in the same row, not under it.
    expect(middle(actions), 'the actions dropped off the row').toBeCloseTo(middle(header), -1);
    expect(actions.x).toBeGreaterThan(title.x + title.w);

    // And the band that used to hold the name is gone entirely.
    expect(await page.locator('.section-title').count(),
        'the title still has a section of its own').toBe(0);
});

test('the clock is the line under the name, and does not stretch', async ({ page }) => {
    await openDashboard(page);

    const identity = await box(page, '.header-identity');
    const title = await box(page, '.title');
    const clock = await box(page, '.header-top-primary');

    expect(clock.y, 'the clock is not under the name').toBeGreaterThanOrEqual(title.y + title.h - 2);
    /*
     * dashboard-enhancements.css gives .header-top-primary `flex: 1 1 12rem`,
     * which meant "take the width left over" while its parent was the header
     * row. In this column it would mean "take the height left over", and one
     * line of clock grew to 192px before that was caught.
     */
    expect(clock.h, `the clock line is ${clock.h}px tall`).toBeLessThan(60);
    expect(identity.h, `the identity block is ${identity.h}px tall`).toBeLessThan(110);
});

test('the grid starts higher than it did', async ({ page }) => {
    await openDashboard(page);

    // 148px before this change: a 32px header strip plus a 60px title band plus
    // the space between them. The header now carries both.
    const grid = await box(page, '#dashboard-layout');
    expect(grid.y, `the grid starts at ${grid.y}px`).toBeLessThan(148);
});

/*
 * The bar is chrome; what is in it belongs to the page.
 *
 * As a card the header was an island: 1309px of slab with a corner and a cast,
 * floating over content 1040px wide that carries no card of its own — and in a
 * view a second card started right under it. It runs edge to edge now, with one
 * hairline, and its contents sit on the page's own vertical: the grid's on the
 * dashboard, the panel's in config.
 */
test('the bar spans the window and its contents span the page', async ({ page }) => {
    await openDashboard(page);

    const onGrid = await page.evaluate(() => {
        const box = (sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return { x: Math.round(r.x), right: Math.round(r.right) };
        };
        const bar = box('.dashboard-section.section-controls');
        return {
            bar,
            // The page's own width: html reserves a stable scrollbar gutter
            // (theme.css), so edge to edge means body's edges, not the
            // viewport's 11px-wider ones.
            page: Math.round(document.body.clientWidth),
            barSpansWindow: bar.x === 0 && Math.abs(bar.right - document.body.clientWidth) <= 1,
            row: box('.header-top'),
            grid: box('#dashboard-layout'),
            radius: window.getComputedStyle(document.querySelector('.header-top')).borderTopLeftRadius,
        };
    });

    expect(onGrid.barSpansWindow,
        `the bar runs ${onGrid.bar.x}-${onGrid.bar.right} in a ${onGrid.page}px window`).toBe(true);
    expect(onGrid.row, 'the header does not share the grid’s column').toEqual(onGrid.grid);
    expect(parseFloat(onGrid.radius), 'the header row is still a card').toBe(0);

    // And the dashboard's positions are the positions, in every view: the row
    // followed each view's own column for a while, so the add button and the
    // config icon moved as you walked between them.
    const places = async () => page.evaluate(() => {
        const x = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return r.width ? Math.round(r.x) : null;
        };
        return {
            row: x('.header-top'),
            track: x('.header-track'),
            pages: x('.pages-link'),
            // Hidden in a view rather than removed, so its box still holds the
            // place of everything right of it.
            actions: x('.header-shortcuts'),
            health: x('.health-link'),
            config: x('.config-link'),
        };
    });

    const onDashboard = await places();

    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(await places(), 'the header shifts when config opens').toEqual(onDashboard);

    await page.evaluate(() => window.dashboardInstance.inbox?.openInboxView?.());
    await page.waitForTimeout(900);
    expect(await places(), 'the header shifts when the inbox opens').toEqual(onDashboard);
});
