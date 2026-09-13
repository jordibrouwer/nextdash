// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Glass has three tiers, and they are ordered by how much reading a surface
 * carries.
 *
 * The depth step ships already: data-depth="glass" thins every raised surface
 * by the theme's own --theme-surface-alpha and blurs what is behind it. One
 * alpha for everything is the problem. It makes the page ground and a context
 * menu equally see-through, and a menu is the one surface whose text the
 * reader is acting on -- the first draft of this redesign came back unreadable
 * for exactly that reason.
 *
 * So: the page ground may be the most translucent, blocks and rails sit in
 * between, and anything carrying text to act on is near-opaque whatever the
 * theme asked for. Depth comes from its edges and its shadow instead.
 */

async function openGlass(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.body.setAttribute('data-depth', 'glass'));
}

/** Paints the token on a throwaway element so color-mix actually resolves. */
const resolve = (page, prop) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${name})`;
    document.body.appendChild(probe);
    const value = window.getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
}, prop);

/** The alpha channel of an rgba()/color() string, 1 when fully opaque. */
function alphaOf(colour) {
    const m = colour.match(/[\d.]+\s*\)\s*$/);
    if (/rgba?\([^)]*,\s*([\d.]+)\)/.test(colour)) {
        return Number(colour.match(/rgba?\([^)]*,\s*([\d.]+)\)/)[1]);
    }
    if (/\/\s*([\d.]+)\s*\)/.test(colour)) return Number(colour.match(/\/\s*([\d.]+)\s*\)/)[1]);
    return m ? Number(m[0].replace(')', '')) : 1;
}

test.describe('glass tiers', () => {
    test('three tiers, ordered by reading need', async ({ page }) => {
        await openGlass(page);

        const pageTier = alphaOf(await resolve(page, '--surface-glass-page'));
        const slab = alphaOf(await resolve(page, '--surface-glass-slab'));
        const overlay = alphaOf(await resolve(page, '--surface-glass-overlay'));

        expect(pageTier, 'the page tier is not translucent at all').toBeLessThan(1);
        expect(slab, 'the slab tier is not between the other two').toBeGreaterThan(pageTier);
        expect(overlay, 'the overlay tier is not the most solid').toBeGreaterThan(slab);
    });

    test('an overlay is near-opaque whatever the theme asked for', async ({ page }) => {
        await openGlass(page);

        const overlay = alphaOf(await resolve(page, '--surface-glass-overlay'));
        // Text the reader acts on sits on solid ground, floor of 92%.
        expect(overlay).toBeGreaterThanOrEqual(0.92);
    });

    test('the blur behind a surface follows the same order', async ({ page }) => {
        await openGlass(page);

        const blur = (name) => page.evaluate((prop) => {
            const probe = document.createElement('div');
            probe.style.backdropFilter = `blur(var(${prop}))`;
            document.body.appendChild(probe);
            const value = window.getComputedStyle(probe).backdropFilter;
            probe.remove();
            return Number((value.match(/([\d.]+)px/) || [0, 0])[1]);
        }, name);

        const [pageBlur, slabBlur, overlayBlur] = await Promise.all([
            blur('--glass-blur-page'), blur('--glass-blur-slab'), blur('--glass-blur-overlay'),
        ]);

        expect(pageBlur, 'the page tier should blur the most').toBeGreaterThanOrEqual(slabBlur);
        expect(slabBlur, 'the slab tier should blur more than an overlay').toBeGreaterThanOrEqual(overlayBlur);
    });

    test('no glass outside the glass step', async ({ page }) => {
        await openGlass(page);
        await page.evaluate(() => document.body.setAttribute('data-depth', 'rich'));

        const overlay = await resolve(page, '--surface-glass-overlay');
        // Outside the step the tokens resolve to nothing paintable, so a view
        // that reaches for one cannot quietly turn a solid theme see-through.
        expect(overlay === 'rgba(0, 0, 0, 0)' || overlay === '').toBe(true);
    });

    test('an open modal reads on solid ground', async ({ page }) => {
        await openGlass(page);

        const modal = await page.evaluate(async () => {
            // A theme that thins its own surfaces must not thin this one: the
            // modal is where the reader reads to act.
            window.AppModal.show({ title: 'probe', message: 'probe', showCancel: false });
            await new Promise((resolve) => setTimeout(resolve, 300));
            const el = document.querySelector('.modal');
            const style = window.getComputedStyle(el);
            const value = { background: style.backgroundColor, filter: style.backdropFilter };
            window.AppModal.hide();
            return value;
        });

        const alpha = Number((modal.background.match(/[\d.]+(?=\s*\)$)/) || ['1'])[0]);
        expect(alpha, `the modal is see-through: ${modal.background}`).toBeGreaterThanOrEqual(0.92);
    });
});
