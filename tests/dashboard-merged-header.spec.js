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

    // .header-identity is `display: contents` in the default placement -- the
    // clock stands in a column of its own -- so it has no box to measure. What
    // is on the row is the name it wraps.
    const identity = await box(page, '.title-wrapper');
    const title = await box(page, '.title');
    const header = await box(page, '.header-top');
    const actions = await box(page, '.header-actions');

    expect(identity, 'there is no name on the row').not.toBeNull();
    // The row is a band with padding of its own now, so "in the row" is a
    // centre line shared rather than an edge shared: the name and the actions
    // ride the same middle, and the name is the leftmost thing on it.
    const middle = (b) => Math.round(b.y + b.h / 2);
    // The name is the top line of a two-line block, so what rides the row's
    // middle is the block; the name itself sits above it and inside the band.
    expect(middle(identity), 'the name is not on the row').toBeCloseTo(middle(header), -1);
    expect(title.y, 'the name escaped the band').toBeGreaterThanOrEqual(header.y);
    expect(title.x, 'something stands left of the name').toBeLessThan(actions.x);
    // The actions are in the same row, not under it.
    expect(middle(actions), 'the actions dropped off the row').toBeCloseTo(middle(header), -1);
    expect(actions.x).toBeGreaterThan(title.x + title.w);

    // And the band that used to hold the name is gone entirely.
    expect(await page.locator('.section-title').count(),
        'the title still has a section of its own').toBe(0);
});

test('the identity block stays two lines tall', async ({ page }) => {
    await openDashboard(page);

    const identity = await box(page, '.title-wrapper');
    const title = await box(page, '.title');
    const clock = await box(page, '.date-time-line');

    // The clock shares the name's line now (see the placement test below); what
    // this holds is that neither of them grows the block.
    expect(clock.h, `the clock line is ${clock.h}px tall`).toBeLessThan(60);
    expect(title.h, `the name is ${title.h}px tall`).toBeLessThan(60);
    /*
     * dashboard-enhancements.css gives .header-top-primary `flex: 1 1 12rem`,
     * which meant "take the width left over" while its parent was the header
     * row. In a column that means "take the height left over", and one line of
     * clock grew to 192px before that was caught.
     */
    expect(identity.h, `the name block is ${identity.h}px tall`).toBeLessThan(110);
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

/*
 * The clock reads as text, and where it stands is the reader's.
 *
 * It was 0.65rem of --text-tertiary at 60% opacity — the smallest type on the
 * page in its faintest colour, which on a light theme is barely there. It sits
 * beside the name at the reader's own size now, or in a column of its own, and
 * the setting that swaps them writes one attribute onto <body>.
 */
test('the clock is readable, and its placement is a setting', async ({ page }) => {
    await openDashboard(page);

    const read = () => page.evaluate(() => {
        const el = document.querySelector('.date-time-line');
        if (!el) return null;
        const c = window.getComputedStyle(el);
        const title = document.querySelector('.header-identity .title').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return {
            size: parseFloat(c.fontSize),
            opacity: parseFloat(c.opacity),
            // Beside the name rather than under it: same line, further right.
            beside: Math.abs(r.top - title.top) < 12 && r.left > title.left,
            body: parseFloat(window.getComputedStyle(document.body).fontSize),
        };
    });

    // The default: beside the name, at the reader's own size.
    expect(await page.evaluate(() => document.body.getAttribute('data-header-clock'))).toBe('beside-name');
    const inline = await read();
    expect(inline, 'the clock line is not on the page').not.toBeNull();
    expect(inline.size, 'the clock is smaller than the body text').toBeGreaterThanOrEqual(inline.body);
    expect(inline.opacity, 'the clock is dimmed').toBe(1);
    expect(inline.beside, 'the clock is not beside the name').toBe(true);

    // The other placement, through the setting rather than the class.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.headerClockPlacement = 'own-zone';
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => document.body.getAttribute('data-header-clock'))).toBe('own-zone');
    const zone = await read();
    expect(zone.size, 'a column of its own does not give the clock more room')
        .toBeGreaterThan(inline.size);
});
