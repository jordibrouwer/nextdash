// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The floating dock does not let the page read through it.
 *
 * The classic layout gives `.button-container` no plate of its own -- no fill,
 * no border, no blur -- and leaves every button on a 74% wash of
 * `--background-secondary`. Over the empty band below the grid that reads as a
 * light touch; over a scrolled page it is bookmark names running straight
 * through the buttons.
 *
 * The modern layout already solved this a different way: it puts one blurred
 * plate under the whole row and keeps the buttons deliberately translucent
 * against it. So the fix belongs to classic only, and the second test is here
 * to say so -- making every dock button opaque everywhere would flatten a
 * design decision the other layout already made.
 */

/**
 * Resolved alpha of an element's own background, or null when it has none.
 *
 * Three notations turn up here, and which one you get is not something the
 * stylesheet chose: plain colours resolve to `rgb()` / `rgba()`, a color-mix
 * of two sRGB colours to `color(srgb r g b / a)`, and a mix that had to cross
 * colour spaces to `oklab(l a b / a)`. Only rgba() puts the alpha after a
 * comma; the modern notations put it after a slash. In all of them its absence
 * means opaque.
 */
const bgAlpha = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundColor;
    const inside = bg.match(/^[a-z]+\(([^)]+)\)$/i);
    if (!inside) return null;
    const slash = inside[1].split('/');
    if (slash.length > 1) return Number(slash[1].trim());
    const parts = inside[1].split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length < 4 ? 1 : Number(parts[3]);
}, selector);

/**
 * Flip a setting, let setupDOM write the body attributes it drives, and wait
 * for the paint to settle.
 *
 * The buttons carry `transition: background-color` -- so between the attribute
 * flip and the end of the transition, getComputedStyle answers with the
 * interpolated colour, not the target one. It even changes notation while it
 * interpolates (`oklab(...)`), which is what makes the reading look like a
 * cascade puzzle instead of a race. Sampling until two consecutive frames
 * agree is what makes this file measure the stylesheet rather than the clock.
 */
async function applySetting(page, key, value) {
    await page.evaluate(([k, v]) => {
        const d = window.dashboardInstance;
        d.settings[k] = v;
        d.setupDOM();
    }, [key, value]);
    await page.waitForFunction(() => {
        const el = document.getElementById('search-button');
        if (!el) return true;
        const now = getComputedStyle(el).backgroundColor;
        const settled = window.__dockProbeLast === now;
        window.__dockProbeLast = now;
        return settled;
    }, null, { timeout: 5_000, polling: 120 });
}

test.describe('floating dock opacity', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await page.waitForFunction(() => window.dashboardInstance?.settings != null,
            null, { timeout: 15_000 });
    });

    /*
     * What floats still has to be opaque.
     *
     * The action buttons moved into the header, where they sit on the header's
     * own surface. What's New is the one button left floating over the grid in
     * a corner, with no plate around it, so the rule written for the corner
     * buttons is now about it alone. The tag cloud's button is an action button.
     */
    test('the corner button is opaque', async ({ page }) => {
        expect(await bgAlpha(page, '#whats-new-btn')).toBe(1);
    });

    test('the header actions read against the header, not against the grid', async ({ page }) => {
        /*
         * No plate, no box, no wash: an action in the header is drawn like the
         * destinations beside it, which are flat. The dock's opaque treatment
         * was for buttons floating over the grid, and these are not.
         */
        const inHeader = await page.evaluate(() => Boolean(
            document.querySelector('.header-shortcuts #search-button')));
        expect(inHeader, 'the action buttons left the header').toBe(true);
        expect(await bgAlpha(page, '#search-button'),
            'a header action still carries the dock plate').toBe(0);
    });

});
