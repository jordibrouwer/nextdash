// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A loud backdrop brings a floor of theme tint with it.
 *
 * Burst, splash and leak are the loudest things on the page. They are drawn
 * under a scrim the reader did not have to ask for, so the text on top keeps
 * its contrast, and the reader's own Theme tint can only raise it.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Alpha of the tint layer: the first gradient the backdrop layer draws. */
const tintAlpha = (page) => page.evaluate(() => {
    const layer = document.querySelector('.theme-backdrop-layer');
    const first = getComputedStyle(layer).backgroundImage;
    const m = first.match(/\/\s*([\d.]+)\s*\)/);
    return m ? parseFloat(m[1]) : 1;
});

test('a loud recipe is drawn under a scrim, a quiet one is not', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(() => { document.documentElement.style.setProperty('--bd-tint', '0'); });

    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('blooms'));
    await expect.poll(() => tintAlpha(page)).toBe(0);

    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('burst'));
    await expect.poll(() => tintAlpha(page)).toBeGreaterThanOrEqual(0.2);
});

test('the reader can raise the tint above the floor, not below it', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('burst'));

    await page.evaluate(() => document.documentElement.style.setProperty('--bd-tint', '0.6'));
    await expect.poll(() => tintAlpha(page)).toBeGreaterThanOrEqual(0.59);

    await page.evaluate(() => document.documentElement.style.setProperty('--bd-tint', '0'));
    await expect.poll(() => tintAlpha(page)).toBeGreaterThanOrEqual(0.2);
});
