// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The plate belongs to the buttons, and goes when they do.
 *
 * .button-container was the free-floating control surface at the bottom of the
 * screen, and every depth step that draws depth gave it a plate: airy fill,
 * blur, deep shadow. The actions then moved into the header, and what was left
 * in the container was the flow hint, which is positioned against it rather
 * than laid out in it -- so the plate shrank to its own padding and drew a
 * 24px bubble at the bottom of the page, over the grid, with nothing in it.
 *
 * The plate is drawn only while there are buttons to put on it. The container
 * stays, because the hint is anchored to it, and takes no clicks.
 */

/** Put a button back in the bar: the plate exists for buttons. */
async function fillBar(page) {
    await page.evaluate(() => {
        const bar = document.querySelector('.button-container');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-button';
        button.textContent = 'x';
        bar.appendChild(button);
    });
    await page.waitForTimeout(100);
}

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
        await fillBar(page);
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
        await fillBar(page);

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

    /*
     * The shipped layout: every action lives in the header, so the bar holds
     * only the hint and must not paint anything at all.
     */
    test('an empty bar is nothing on the page', async ({ page }) => {
        await openDashboard(page, 'rich');

        const bar = await page.evaluate(() => {
            const el = document.querySelector('.button-container');
            const style = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
                background: style.backgroundColor,
                padding: style.paddingTop,
                shadow: style.boxShadow,
                pointer: style.pointerEvents,
                buttons: el.querySelectorAll('button, a').length,
                // The point the bubble was drawn at.
                hits: document.elementFromPoint(
                    Math.round(r.x + r.width / 2),
                    Math.round(r.y + r.height / 2),
                )?.className?.toString?.() || '',
            };
        });

        expect(bar.buttons, 'the bar holds buttons after all').toBe(0);
        expect(paints(bar.background), `the empty bar drew a plate: ${bar.background}`).toBe(false);
        expect(parseFloat(bar.padding), 'the empty bar keeps the plate’s padding').toBe(0);
        expect(bar.shadow, 'the empty bar is lifted off the page').toBe('none');
        expect(bar.pointer, 'the empty bar still takes clicks').toBe('none');
        expect(bar.hits, 'the empty bar is over the grid').not.toContain('button-container');
    });
});
