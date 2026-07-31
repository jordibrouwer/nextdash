// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openConfig(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config settings jump', () => {
    test('Ctrl+Shift+K opens the settings jump overlay', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await expect(page.locator('.config-settings-jump-modal')).toBeVisible();
        await expect.poll(() => page.evaluate(() =>
            document.activeElement?.id === 'config-settings-jump-filter'), { timeout: 15_000 }).toBe(true);
    });

    test('filtering and Enter navigates to a section', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('appearance');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page.locator('.config-settings-jump-modal')).toHaveCount(0);
        await expect(page.locator('[data-config-section="appearance"][aria-selected="true"]')).toBeVisible();
    });

    test('cached fields appear after visiting a section', async ({ page }) => {
        await openConfig(page, 'appearance');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('theme');
        await expect(page.locator('.config-settings-jump-result').first()).toContainText(/theme/i);
    });
});
