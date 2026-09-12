// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A raised surface has two edges, not one.
 *
 * --edge-light has drawn the lit top line since the depth ladder landed, and
 * it is what makes a flat rectangle read as something sitting on the page. On
 * its own it is a highlight; with a darker line along the bottom the same
 * surface reads as a slab with a thickness. Every one of the seven redesign
 * drafts uses both, and the shipped app defines only the first.
 *
 * Derived from --text-primary, never from black: an inset line lies ON the
 * surface, so on a light or paper theme a black one turns into a hard stripe.
 */

async function openDashboard(page, depth) {
    await page.addInitScript((value) => {
        window.localStorage.setItem('nextdash-test-depth', value);
    }, depth);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => {
        document.body.setAttribute('data-depth', value);
    }, depth);
}

/** The resolved value of a custom property on <body>. */
const tokenValue = (page, name) => page.evaluate(
    (prop) => window.getComputedStyle(document.body).getPropertyValue(prop).trim(),
    name,
);

test.describe('the dark bottom edge', () => {
    test('is defined, and derived from the theme rather than from black', async ({ page }) => {
        await openDashboard(page, 'rich');

        const edgeDark = await tokenValue(page, '--edge-dark');
        expect(edgeDark, '--edge-dark is not defined').not.toBe('');

        // An inset line along the bottom: the offset is negative.
        expect(edgeDark).toMatch(/inset/);
        expect(edgeDark).toMatch(/-1px/);

        // color-mix resolves before this is read, so what is left must not be
        // a flat black. A theme-derived line carries the theme's own hue.
        expect(edgeDark.toLowerCase()).not.toContain('rgb(0, 0, 0)');
        expect(edgeDark.toLowerCase()).not.toContain('#000');
    });

    test('flat means flat: no edges at all', async ({ page }) => {
        await openDashboard(page, 'flat');

        const edgeDark = await tokenValue(page, '--edge-dark');
        const edgeLight = await tokenValue(page, '--edge-light');

        // Both may resolve to a transparent line, but neither may paint.
        const paints = (value) => value !== '' && !/transparent|rgba\(0, 0, 0, 0\)/.test(value);
        expect(paints(edgeDark), 'flat drew a bottom edge').toBe(false);
        expect(paints(edgeLight), 'flat drew a top edge').toBe(false);
    });

    test('the raised surfaces carry both edges', async ({ page }) => {
        await openDashboard(page, 'rich');

        // The widget body is the clearest case: it is nothing but a surface
        // with figures on it, so it is where the ladder shows most.
        const shadow = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.className = 'dashboard-widget';
            const body = document.createElement('div');
            body.className = 'dashboard-widget-body';
            probe.appendChild(body);
            document.getElementById('dashboard-layout').appendChild(probe);
            const value = window.getComputedStyle(body).boxShadow;
            probe.remove();
            return value;
        });

        // Two inset lines in the same declaration: one down, one up.
        const insets = shadow.split(/,(?![^(]*\))/).filter((part) => part.includes('inset'));
        expect(insets.length, `expected two inset edges, got: ${shadow}`).toBeGreaterThanOrEqual(2);
    });
});
