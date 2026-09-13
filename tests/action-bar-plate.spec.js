// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The action bar is a surface, not a loose row of buttons.
 *
 * It is the one free-floating control surface in the product -- always there,
 * over whatever is on the page -- and the redesign gives it a plate of its
 * own: airier than any other surface, lifted by a deep shadow rather than by
 * a glow. That is what makes it read as chrome instead of as content.
 *
 * theme-character.css already lists .button-container among the surfaces that
 * take a backdrop blur on the glass depth step. It never did: search.css
 * loads later and sets `background: transparent` with `backdrop-filter: none`,
 * so the rule was dead. This is that rule made true, on every depth step that
 * draws depth at all.
 */

async function openDashboard(page, depth) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => document.body.setAttribute('data-depth', value), depth);
    await page.waitForTimeout(150);
}

const barStyle = (page) => page.evaluate(() => {
    const el = document.querySelector('.button-container');
    const style = window.getComputedStyle(el);
    return {
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        shadow: style.boxShadow,
        padding: style.paddingTop,
    };
});

/** An rgba()/color() string that actually paints something. */
const paints = (colour) => colour !== ''
    && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(colour)
    && !/transparent/.test(colour);

test.describe('the action bar plate', () => {
    test('carries a plate on a depth step that draws depth', async ({ page }) => {
        await openDashboard(page, 'rich');
        const bar = await barStyle(page);

        expect(paints(bar.background), `the bar has no plate: ${bar.background}`).toBe(true);
        expect(parseFloat(bar.radius), 'the plate has square corners').toBeGreaterThan(0);
        expect(bar.shadow, 'the bar is not lifted off the page').not.toBe('none');
    });

    test('flat keeps the bar a loose row', async ({ page }) => {
        await openDashboard(page, 'flat');
        const bar = await barStyle(page);

        // Whoever asked for flat asked for no plate either.
        expect(paints(bar.background), 'flat drew a plate').toBe(false);
    });

    test('the plate is airier than a block, and lifted rather than lit', async ({ page }) => {
        await openDashboard(page, 'glass');

        const compared = await page.evaluate(() => {
            const alpha = (colour) => {
                const m = colour.match(/rgba?\([^)]*,\s*([\d.]+)\)/)
                    || colour.match(/\/\s*([\d.]+)\s*\)/);
                return m ? Number(m[1]) : 1;
            };
            const probe = (prop) => {
                const el = document.createElement('div');
                el.style.backgroundColor = `var(${prop})`;
                document.body.appendChild(el);
                const value = window.getComputedStyle(el).backgroundColor;
                el.remove();
                return alpha(value);
            };
            const bar = window.getComputedStyle(document.querySelector('.button-container'));
            return { barAlpha: alpha(bar.backgroundColor), slab: probe('--surface-glass-slab') };
        });

        expect(compared.barAlpha, 'the bar is no airier than a block')
            .toBeLessThan(compared.slab);
    });
});
