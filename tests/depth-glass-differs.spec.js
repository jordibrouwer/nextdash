// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Glass has to look unlike rich, on the theme the reader is actually using.
 *
 * The glass step reads --theme-surface-alpha and --theme-surface-blur, and
 * both used to fall back to the value that means "not glass at all": fully
 * solid, no blur. Four of the 222 built-in themes declare an alpha and two
 * declare a blur, so on the other 218 -- the default among them -- picking
 * glass produced a dashboard indistinguishable from rich. A setting that does
 * nothing is worse than one that is not offered.
 *
 * Measured on a card preset's category: the widget body is a quiet tint now,
 * not a raised surface. The presets that draw no card stay untouched by
 * design: transparency is a property of a surface, and where there is no
 * surface there is nothing to see through.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** A raised card's ground and the blur behind it, at a given depth. */
const surfaceAt = (page, depth) => page.evaluate((value) => {
    document.body.setAttribute('data-depth', value);
    const widget = document.createElement('div');
    widget.className = 'dashboard-grid layout-cards';
    const body = document.createElement('div');
    body.className = 'category';
    widget.appendChild(body);
    document.getElementById('dashboard-layout').appendChild(widget);
    const style = window.getComputedStyle(body);
    const read = { background: style.backgroundColor, blur: style.backdropFilter };
    widget.remove();
    return read;
}, depth);

/** The alpha of a colour written as rgb(a) or as color(srgb ...). Opaque is 1. */
const alphaOf = (colour) => {
    const srgb = colour.match(/color\(srgb [^/)]+\/\s*([\d.]+)\)/);
    if (srgb) return parseFloat(srgb[1]);
    const rgba = colour.match(/rgba?\([^)]*?,\s*([\d.]+)\)/);
    return rgba ? parseFloat(rgba[1]) : 1;
};

test.describe('glass against rich', () => {
    test('a raised surface lets the page through', async ({ page }) => {
        await dashboard(page);

        const rich = await surfaceAt(page, 'rich');
        const glass = await surfaceAt(page, 'glass');

        expect(alphaOf(rich.background), 'rich is not solid').toBe(1);
        expect(alphaOf(glass.background), `glass is as solid as rich: ${glass.background}`)
            .toBeLessThan(1);
    });

    test('and the page behind it is blurred', async ({ page }) => {
        await dashboard(page);

        const rich = await surfaceAt(page, 'rich');
        const glass = await surfaceAt(page, 'glass');

        expect(rich.blur, 'rich blurs what is behind a surface').toBe('none');
        expect(glass.blur, `glass draws no blur: ${glass.blur}`).toMatch(/blur\((?!0px)/);
    });

    test('on the theme a fresh install starts on, not only on the glass ones', async ({ page }) => {
        await dashboard(page);

        const declared = await page.evaluate(() => ({
            theme: document.documentElement.getAttribute('data-theme'),
            alpha: window.getComputedStyle(document.body).getPropertyValue('--theme-surface-alpha').trim(),
        }));

        // Guard, so this cannot pass by the fixture having switched to Aurora
        // Glass: the point is a theme that never mentions glass.
        expect(declared.theme, 'the fixture is on a glass theme').not.toContain('glass');
        expect(parseFloat(declared.alpha), 'the step supplies nothing of its own').toBeLessThan(1);
    });

    test('soft and flat are left alone', async ({ page }) => {
        await dashboard(page);

        for (const depth of ['flat', 'soft', 'rich']) {
            const surface = await surfaceAt(page, depth);
            expect(surface.blur, `${depth} started blurring`).toBe('none');
        }
    });
});
