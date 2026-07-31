// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openConfigSection(page, section) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => {
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        return window.dashboardInstance.config.openConfigView(s);
    }, section);
    await expect(page.locator('#config-view-body')).toBeVisible({ timeout: 10_000 });
}

test.describe('config keyboard discoverability', () => {
    test('form sections show a keyboard legend footer', async ({ page }) => {
        await openConfigSection(page, 'behavior');
        await expect(page.locator('.config-form-keyboard-legend')).toBeVisible();
        await expect(page.locator('.config-form-keyboard-legend')).toContainText(/Shift\+K|cheat sheet|spiekbriefje/i);
    });

    test('Help → Search & keyboard includes Config navigation', async ({ page }) => {
        await openConfigSection(page, 'help');
        await page.locator('[data-help-tab="search"]').click();
        await expect(page.getByRole('heading', { name: /Config navigation|Config-navigatie|Config-Navigation|Navigation dans config/i }))
            .toBeVisible();
    });

    test('first config open shows the keyboard intro toast once', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            window.DiscoverabilityState?.init?.({ seenTips: [] });
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect(page.locator('#app-notification.show')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#app-notification.show')).toContainText(/1.*8|Ctrl.*Shift.*K|cheat sheet/i);

        await page.evaluate(() => window.AppNotification?.hide?.());
        await expect(page.locator('#app-notification.show')).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect(page.locator('#app-notification.show')).toHaveCount(0);
    });
});
