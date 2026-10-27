// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

const TITLE = 'Hold notices during quiet hours';

async function openConfig(page) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(
        () => typeof window.dashboardInstance?.config?.openConfigView === 'function',
        null,
        { timeout: 15_000 }
    );
    await page.evaluate(() => {
        localStorage.removeItem('nextdash.settingsJumpRecent');
        return window.dashboardInstance.config.openConfigView('overview');
    });
}

const openSearch = async (page) => {
    await page.locator('#config-section-panel').focus();
    await page.keyboard.press('Control+Shift+K');
    await expect(page.locator('.config-settings-jump-modal')).toBeVisible();
};

test.describe('settings search: recent', () => {
    test('shows nothing special until a setting has been opened, then lists it first', async ({ page }) => {
        await openConfig(page);
        await openSearch(page);
        await expect(page.locator('.config-settings-jump-group')).toHaveCount(0);

        await page.locator('#config-settings-jump-filter').fill(TITLE);
        await page.keyboard.press('Enter');
        await expect(page.locator('.config-settings-jump-modal')).toHaveCount(0);

        await openSearch(page);
        await expect(page.locator('.config-settings-jump-group').first()).toHaveText('Recent');
        await expect(page.locator('.config-settings-jump-result').first()).toContainText(TITLE);
        await expect(page.locator('.config-settings-jump-group').nth(1)).toHaveText('All settings');

        // Typing leaves the heading out: it is a start state, not a filter.
        await page.locator('#config-settings-jump-filter').fill('quiet');
        await expect(page.locator('.config-settings-jump-group')).toHaveCount(0);
    });

    test('a setting changed on its tab is remembered too', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.setBehavior('enableSessionTips', true));
        await openSearch(page);
        await expect(page.locator('.config-settings-jump-result').first()).toBeVisible();
        const stored = await page.evaluate(() => localStorage.getItem('nextdash.settingsJumpRecent'));
        expect(stored).toContain('f:enableSessionTips');
    });
});
