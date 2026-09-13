// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config's panels and tiles are slabs too.
 *
 * Every other raised surface in the app now carries the pair -- a lit line
 * along its top edge and a shaded one along its foot -- which is what makes a
 * rectangle read as something with a thickness. Config was left out, so its
 * panels sat flat beside a dashboard whose blocks did not.
 *
 * They already take their colours from the theme (--card-bg is mixed from
 * --background-secondary, --border-color is --border-primary), so this is the
 * edge and nothing else.
 */

async function openConfig(page, depth = 'rich') {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => document.body.setAttribute('data-depth', value), depth);
}

/** Paints a probe with the class so the rule resolves as it would live. */
const shadowOf = (page, className) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.className = name;
    document.body.appendChild(probe);
    const value = window.getComputedStyle(probe).boxShadow;
    probe.remove();
    return value;
}, className);

const insetCount = (shadow) => shadow.split(/,(?![^(]*\))/).filter((p) => p.includes('inset')).length;

test.describe('config slabs', () => {
    for (const className of ['config-panel', 'config-tile']) {
        test(`.${className} carries both edges`, async ({ page }) => {
            await openConfig(page);
            const shadow = await shadowOf(page, className);

            expect(insetCount(shadow), `no two-sided edge: ${shadow}`).toBeGreaterThanOrEqual(2);
        });
    }

    test('flat leaves config flat', async ({ page }) => {
        await openConfig(page, 'flat');

        for (const className of ['config-panel', 'config-tile']) {
            const shadow = await shadowOf(page, className);
            const paints = shadow !== 'none' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(shadow);
            expect(paints, `.${className} drew an edge on flat`).toBe(false);
        }
    });
});
