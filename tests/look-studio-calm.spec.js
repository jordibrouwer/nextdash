// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The quiet centre of the backdrop is a theme's own answer in theme scope. A
 * look saved with a theme carries the one on screen, and a look applied over
 * it replaces it rather than being outranked by it.
 */

async function ready(page) {
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
}

async function setup(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await ready(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { theme: 'cherry-graphite-dark', themeSurfacesForceAll: false });
        d.settings.backdropTuning = { strength: 1, scale: 1, seed: 0, blur: 0, brightness: 1, saturate: 1, tint: 0, calm: 0.5 };
        delete d.settings.themeSurfacePrefs;
        await d.saveSettings();
    });
    await page.reload();
    await ready(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 15_000 });
}

const rootVar = (page, name) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);

test('a look saved with a theme carries the theme\'s own quiet centre', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.dashboardInstance.config.setCalm(0.2));
    const calm = await page.evaluate(() => window.dashboardInstance.config.currentLookAnswers().tuning.calm);
    expect(calm).toBe(0.2);
});

test('a look applied over a theme\'s own quiet centre replaces it', async ({ page }) => {
    await setup(page);
    const id = await page.evaluate(() => {
        const cfg = window.dashboardInstance.config;
        cfg.setCalm(0.2);
        cfg.applyLookAnswers({ tuning: { calm: 0.9 } });
        return cfg.currentThemeId();
    });
    const own = await page.evaluate((themeId) => window.dashboardInstance.settings.themeSurfacePrefs?.[themeId]?.calm ?? null, id);
    expect(own, 'the theme no longer answers for itself').toBe(null);
    await expect.poll(() => rootVar(page, '--bd-calm')).toBe('0.9');
});
