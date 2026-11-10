// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The tip in the bell about the network tests: a row in the Tips group for
 * everyone while the network checks are on, with "Open Tests", gone for good
 * once it is read, and not there when the checks are switched off.
 */

const ROW = '.notification-bell-row[data-bell-id="net-tests-notice"]';

async function load(page, settings = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.DashboardNetTestsNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => {
        // Reads and marks of this probe must not reach the shared ./data.
        window.DiscoverabilityState.schedulePersist = () => {};
        Object.assign(window.dashboardInstance.settings, s);
    }, settings);
}

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('the network tests tip in the bell', () => {
    test('is a tip row with Open Tests while the network checks are on', async ({ page }) => {
        await load(page);
        await openBell(page);
        const row = page.locator(ROW);
        await expect(row).toBeVisible();
        await expect(row).toContainText('network tests');
        await expect(row.getByRole('button', { name: 'Open Tests' })).toBeVisible();
    });

    test('is not there when the network checks are switched off', async ({ page }) => {
        await load(page, { netToolsEnabled: false });
        await openBell(page);
        await expect(page.locator(ROW)).toHaveCount(0);
    });

    test('Open Tests reads the row and opens the Bookmarks view', async ({ page }) => {
        await load(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'Open Tests' }).click();
        await expect(page.locator('#config-bm-list')).toBeVisible({ timeout: 15_000 });
        await openBell(page);
        await expect(page.locator(ROW)).toHaveCount(0);
    });
});
