// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Sub-tab strips already honour arrow keys when focused; these shortcuts work
 * from anywhere in the config panel so you can cycle tabs without tabbing back
 * to the strip first.
 */
async function openSection(page, section) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config sub-tab shortcuts from the panel', () => {
    test('Alt+Arrow cycles behavior sub-tabs', async ({ page }) => {
        await openSection(page, 'behavior');
        await expect(page.locator('[data-behavior-tab="general"][aria-selected="true"]')).toBeVisible();
        await page.locator('#config-section-panel').focus();

        await page.keyboard.press('Alt+ArrowRight');
        await expect(page.locator('[data-behavior-tab="datetime"][aria-selected="true"]')).toBeVisible();

        await page.keyboard.press('Alt+ArrowLeft');
        await expect(page.locator('[data-behavior-tab="general"][aria-selected="true"]')).toBeVisible();
    });

    test('[ and ] cycle pages & tags sub-tabs', async ({ page }) => {
        await openSection(page, 'pages-tags');
        await expect(page.locator('[data-pt-tab="categories"][aria-selected="true"]')).toBeVisible();
        await page.locator('#config-section-panel').focus();

        await page.keyboard.press(']');
        await expect(page.locator('[data-pt-tab="tags"][aria-selected="true"]')).toBeVisible();

        await page.keyboard.press('[');
        await expect(page.locator('[data-pt-tab="categories"][aria-selected="true"]')).toBeVisible();
    });

    test('sub-tab shortcuts do nothing in sections without sub-tabs', async ({ page }) => {
        await openSection(page, 'bookmarks');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect(page.locator('[data-config-section="bookmarks"][aria-selected="true"]')).toBeVisible();
    });
});
