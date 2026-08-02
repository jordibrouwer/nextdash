// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

// Escape inside the config view must dismiss whatever is layered on top of it
// first, and only close the view itself once nothing is left. Closing both at
// once dropped the user on the dashboard instead of back where they were.
test.describe('config view escape handling', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 })
            .toBe('config');
    });

    test('escape closing a modal keeps the config view open', async ({ page }) => {
        // Ctrl+Shift+A is the global add-bookmark chord.
        await page.keyboard.press('Control+Shift+KeyA');
        await page.waitForSelector('#bookmark-form-modal.show', { timeout: 10_000 });

        // Blur so the guard is exercised on its own merits rather than bailing
        // out via the INPUT/TEXTAREA check.
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');

        // The modal closes...
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
        // ...and the config view is still the one on screen.
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        expect(await page.evaluate(() => location.hash)).toBe('#config');
    });

    test('escape with nothing layered on top still closes the config view', async ({ page }) => {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 })
            .toBe('bookmarks');
    });
});
