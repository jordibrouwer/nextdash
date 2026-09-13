// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The health link breathes in the theme's own accent.
 *
 * Its shimmer asked for --accent-primary-rgb, and nothing has ever defined
 * that: the theme block writes colours, not channel triplets. So every one of
 * the 222 themes fell through to the literal rgba(66, 135, 245) behind it -- a
 * blue from nowhere, pulsing on a green terminal and on a paper theme alike.
 * The same shape as the hard-coded blue --accent-info fell back to, and the
 * last one of its kind in the stylesheet.
 *
 * Read off a painted probe: the animation's own colour is inside a keyframe,
 * which getComputedStyle does not hand back.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** What the shimmer paints under a named theme. */
const shimmerUnder = (page, theme) => page.evaluate((name) => {
    document.documentElement.setAttribute('data-theme', name);
    const probe = document.createElement('span');
    probe.style.textShadow = 'color-mix(in srgb, var(--accent-primary) 60%, transparent) 0 0 8px';
    document.body.appendChild(probe);
    const painted = window.getComputedStyle(probe).textShadow;
    probe.remove();
    return painted;
}, theme);

test.describe('the health link shimmer', () => {
    test('follows the theme it is drawn on', async ({ page }) => {
        await dashboard(page);

        const terminal = await shimmerUnder(page, 'retro-crt-dark');
        const glass = await shimmerUnder(page, 'aurora-glass-dark');

        expect(terminal, 'the shimmer does not follow the theme').not.toBe(glass);
    });

    test('and is not the blue that nothing defined', async ({ page }) => {
        await dashboard(page);

        const painted = await shimmerUnder(page, 'retro-crt-dark');
        const blue = await page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.textShadow = 'rgba(66, 135, 245, 0.6) 0 0 8px';
            document.body.appendChild(probe);
            const value = window.getComputedStyle(probe).textShadow;
            probe.remove();
            return value;
        });

        expect(painted, 'the hard-coded blue is still what gets painted').not.toBe(blue);
    });

    test('nothing asks for a channel triplet any more', async ({ page }) => {
        await dashboard(page);

        // The whole class, not just this rule: a token holding "66, 135, 245"
        // cannot come from a theme, so any rule asking for one is a literal
        // colour wearing a variable's name.
        const asking = await page.evaluate(() => [...document.styleSheets]
            .flatMap((sheet) => {
                try { return [...sheet.cssRules]; } catch { return []; }
            })
            .filter((rule) => (rule.cssText || '').includes('-rgb,'))
            .map((rule) => (rule.cssText || '').slice(0, 80)));

        expect(asking, `rules still asking for an undefined triplet: ${asking}`).toEqual([]);
    });
});
