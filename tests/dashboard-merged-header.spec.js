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
    // The name is inside the header row, and starts at its left edge.
    expect(title.y).toBe(header.y);
    expect(title.x).toBe(header.x);
    // The actions are in the same row, not under it.
    expect(actions.y).toBe(header.y);
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
