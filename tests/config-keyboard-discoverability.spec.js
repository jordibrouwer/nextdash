// @ts-check
const { test, expect } = require('./fixtures');
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
        // The seen tips live in settings on the server, and the two specs above
        // this one open config and mark this tip seen there. init() only sets
        // the in-memory copy, so the empty state has to be written back and the
        // page reloaded onto it — otherwise this "first open" is a second one.
        await page.goto('/');
        await page.waitForFunction(() => window.DiscoverabilityState != null, null, { timeout: 15_000 });
        await page.evaluate(async () => {
            window.DiscoverabilityState?.init?.({ seenTips: [] });
            await window.DiscoverabilityState?.persistNow?.();
        });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        // The tip is queued behind whatever the view says on opening, so the
        // first toast to appear is not always this one. Wait for the text
        // rather than for the element, or the assertion reads a toast that was
        // on its way out.
        await expect(page.locator('#app-notification.show'))
            .toContainText(/j.*k|0.*9|Ctrl.*Shift.*K|cheat sheet|spiekbriefje/i, { timeout: 10_000 });

        await page.evaluate(() => window.AppNotification?.hide?.());
        await expect(page.locator('#app-notification.show')).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect(page.locator('#app-notification.show')).toHaveCount(0);
    });
});
