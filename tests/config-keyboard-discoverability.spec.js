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
        // The same three the legend itself waits for: choices, a slider, or a
        // sub-tab strip. A group may carry any one of them.
        await expect(page.locator(
            '#config-view-body .config-choices, #config-view-body .config-range, #config-view-body .config-subtabs',
        ).first()).toBeVisible();

        await expect(page.locator('.config-form-keyboard-legend')).toBeVisible();
        await expect(page.locator('.config-form-keyboard-legend')).toContainText(/Shift\+K|cheat sheet|spiekbriefje/i);
    });

    test('Help → Search & keyboard includes Config navigation', async ({ page }) => {
        await openConfigSection(page, 'help');
        await page.locator('[data-help-tab="search"]').click();
        await expect(page.getByRole('heading', { name: /Config navigation|Config-navigatie|Config-Navigation|Navigation dans config/i }))
            .toBeVisible();
    });

    /*
     * The config keys used to be introduced by a toast on a first config open.
     * Tips wait in the bell now (group Tips), so the same introduction is a bell
     * row: it comes without a toast, and once read it does not come back.
     */
    test('the config keyboard tip waits in the bell once, never as a toast', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView
            && window.NotificationBell && window.DashboardKeyboardTip, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            window.DiscoverabilityState.forgetTip('tipConfigKeyboard', { persist: false });
            // Every other tip counts as offered before, so the never-offered
            // config keyboard tip is sure to fill one of today's two slots.
            const all = window.ConfigHelpTips.TIP_GROUPS.flatMap((g) => g.tips);
            localStorage.setItem('nextdash-keyboard-tips-offered',
                JSON.stringify(all.filter((id) => id !== 'tipConfigKeyboard')));
            localStorage.removeItem('nextdash-keyboard-tip-current');
            window.dashboardInstance.settings.enableSessionTips = true;
            // Every toast is recorded and still shown, so a tip sent as one is seen.
            window.__toastTexts = [];
            const show = window.AppNotification.show.bind(window.AppNotification);
            window.AppNotification.show = (message, ...rest) => {
                window.__toastTexts.push(String(message));
                return show(message, ...rest);
            };
        });
        const tipToasts = () => page.evaluate(() => window.__toastTexts
            .filter((m) => /Ctrl\+Shift\+K|j<\/code>\s*\/\s*<code>k/.test(m)).length);

        try {
            await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
            await expect(page.locator('#config-view-body')).toBeVisible();
            expect(await page.evaluate(() => window.DashboardKeyboardTip.tick())).toContain('tipConfigKeyboard');

            await page.evaluate(() => window.NotificationBell.refreshAll());
            await page.evaluate(() => window.NotificationBell.open());
            const row = page.locator('.notification-bell-row[data-bell-id="keyboard-tip:tipConfigKeyboard"]');
            await expect(row).toBeVisible();
            await expect(row).toContainText(/j\s*\/\s*k.*Ctrl\+Shift\+K/);
            await expect(row.getByRole('button', { name: 'Cheat sheet' })).toBeVisible();
            expect(await tipToasts()).toBe(0);

            await row.getByRole('button', { name: 'Mark read' }).click();
            await expect(row).toHaveCount(0);
            expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenTip('tipConfigKeyboard'))).toBe(true);

            // A second config open the same day: no row and no toast.
            await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
            await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
            await expect(page.locator('#config-view-body')).toBeVisible();
            expect(await page.evaluate(() => window.DashboardKeyboardTip.tick()) || []).not.toContain('tipConfigKeyboard');
            await page.evaluate(() => window.NotificationBell.refreshAll());
            await expect(row).toHaveCount(0);
            expect(await tipToasts()).toBe(0);
        } finally {
            // The seen mark is shared through ./data; leave the tip unseen again.
            await page.evaluate(() => window.DiscoverabilityState.forgetTip('tipConfigKeyboard'));
        }
    });
});
