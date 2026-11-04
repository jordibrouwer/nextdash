// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady, openAllBackdrops } = require('./e2e-helpers');

/**
 * The backdrop library paints its thumbnails as they scroll into view. Every
 * search keystroke draws the list again; an observer made per drawing and never
 * let go kept every tile it had been given, long after the tile was gone.
 */
test('searching the backdrops leaves no observer holding a tile that is gone', async ({ page }) => {
    await page.addInitScript(() => {
        const Native = window.IntersectionObserver;
        const live = [];
        window.__observed = live;
        window.IntersectionObserver = class extends Native {
            constructor(cb, opts) {
                super(cb, opts);
                this._held = new Set();
                live.push(this._held);
            }
            observe(el) { this._held.add(el); super.observe(el); }
            unobserve(el) { this._held.delete(el); super.unobserve(el); }
            disconnect() { this._held.clear(); super.disconnect(); }
        };
    });
    await page.setViewportSize({ width: 1400, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.keyboard.press('Shift+A');
    await page.click('[data-studio-tab="backdrop"]');
    const pick = page.locator('[data-backdrop-mode="pick"]');
    if ((await pick.getAttribute('aria-pressed')) !== 'true') await pick.click();
    const grid = page.locator('[data-backdrop-grid]');
    await openAllBackdrops(grid);
    const search = grid.locator('[data-backdrop-search]');
    for (const q of ['s', 'st', 'sta', 'st', 's', '']) {
        await search.fill(q);
    }
    const detached = await page.evaluate(() => window.__observed
        .reduce((n, held) => n + [...held].filter((el) => !el.isConnected).length, 0));
    expect(detached).toBe(0);
});
