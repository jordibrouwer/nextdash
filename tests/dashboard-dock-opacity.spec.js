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

    test('classic dock buttons and corner FABs are opaque', async ({ page }) => {
        // The default install: classic, and every surface below is one the user
        // sees on a first run.
        expect(await page.getAttribute('body', 'data-layout-version')).toBe('classic');

        // The dock itself.
        expect(await bgAlpha(page, '#search-button')).toBe(1);
        expect(await bgAlpha(page, '#quick-add-toolbar-btn')).toBe(1);
        expect(await bgAlpha(page, '#commands-button')).toBe(1);

        // The two corner FABs, which float over the grid with no plate at all.
        expect(await bgAlpha(page, '#tag-cloud-toggle-btn')).toBe(1);
        expect(await bgAlpha(page, '#whats-new-btn')).toBe(1);
    });

    test('the corner dock positions are covered too', async ({ page }) => {
        // bottom-left and bottom-right drop the container's own box entirely,
        // so the buttons are the only thing between the page and the eye.
        await applySetting(page, 'buttonBarPosition', 'bottom-left');
        expect(await bgAlpha(page, '#search-button')).toBe(1);

        await applySetting(page, 'buttonBarPosition', 'bottom-right');
        expect(await bgAlpha(page, '#search-button')).toBe(1);
    });

    test('the modern layout keeps its translucent face over its own plate',
        async ({ page }) => {
            await applySetting(page, 'layoutVersion', 'modern');
            expect(await page.getAttribute('body', 'data-layout-version')).toBe('modern');

            const alpha = await bgAlpha(page, '#search-button');
            expect(alpha).not.toBeNull();
            expect(alpha).toBeLessThan(1);
        });

    test('the what\'s new FAB is opaque in the modern layout as well',
        async ({ page }) => {
            // Modern styles the dock and the / FAB, but never this one -- it
            // floats over the grid on the same 74% wash in both layouts, so the
            // fix has to reach it regardless of layout version.
            await applySetting(page, 'layoutVersion', 'modern');
            expect(await bgAlpha(page, '#whats-new-btn')).toBe(1);
        });
});
