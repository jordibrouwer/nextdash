// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The tip in the bell that points to the theme studio (Shift+A).
 *
 * Everyone is asked once. A new install is not greeted on its first day; an
 * upgrade, or an install without the first-run stamp, is asked at the next
 * quiet moment.
 */
const PROMO_ID = 'theme-studio-hint-v1';
const DAY = 24 * 60 * 60 * 1000;

async function load(page, settings = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, settings }) => {
        // Marks written by these tests must not reach the ./data the dev server shares.
        window.DiscoverabilityState.schedulePersist = () => {};
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        Object.assign(window.dashboardInstance.settings, { firstRunInstall: false, firstRunAt: 0 }, settings);
    }, { id: PROMO_ID, settings });
}

const toast = (page) => page.locator('#app-notification.show');
const row = (page) => page.locator('.notification-bell-row[data-bell-id="theme-studio-notice"]');
const grey = (page) => page.locator('.notification-bell-grey');

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('the theme studio hint', () => {
    test('it waits in the bell as a tip, names the key, and shows no toast or corner card', async ({ page }) => {
        await load(page);
        await openBell(page);
        await expect(row(page)).toBeVisible();
        await expect(row(page)).toContainText('Shift+A');
        await expect(page.locator('.notification-bell-group[data-bell-group="tips"]')).toContainText('theme studio');
        await expect(toast(page)).toHaveCount(0);
        await expect(page.locator('.theme-studio-notice-card')).toHaveCount(0);
        expect(await page.evaluate(() => window.NotificationBell.counts().grey)).toBeGreaterThanOrEqual(1);
    });

    test('Mark read lets it go for good, through the next refresh as well', async ({ page }) => {
        await load(page);
        await openBell(page);
        await row(page).getByRole('button', { name: 'Mark read' }).click();
        await expect(row(page)).toHaveCount(0);
        // The probe keeps its marks in the page; a "reload" is a fresh refresh.
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(row(page)).toHaveCount(0);
    });

    test('Open the studio reads the row and counts as answered', async ({ page }) => {
        await load(page);
        await page.evaluate(() => { window.dashboardInstance.config.openThemeBrowser = () => { window.__studio = true; }; });
        await openBell(page);
        await row(page).getByRole('button', { name: 'Open the studio' }).click();
        await expect.poll(() => page.evaluate(() => window.__studio === true)).toBe(true);
        await expect(row(page)).toHaveCount(0);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(false);
    });

    test('a new install waits a day, an upgrade does not', async ({ page }) => {
        await load(page, { firstRunInstall: true, firstRunAt: Date.now() });
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(false);
        await page.evaluate((ago) => { window.dashboardInstance.settings.firstRunAt = Date.now() - ago; }, DAY + 60_000);
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(true);
        await page.evaluate(() => { window.dashboardInstance.settings.firstRunInstall = false; window.dashboardInstance.settings.firstRunAt = Date.now(); });
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(true);
    });
});
