// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The corner card that introduces edit mode and its key (Shift+M).
 *
 * Everyone is asked once. A new install waits a day; an upgrade, or an install
 * without the first-run stamp, is asked at the next quiet moment.
 */
const PROMO_ID = 'edit-mode-hint-v1';
const DAY = 24 * 60 * 60 * 1000;

async function load(page, settings = {}) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.editMode, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, settings }) => {
        localStorage.removeItem('nextdash:last-corner-card-at');
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        Object.assign(window.dashboardInstance.settings, { firstRunInstall: false, firstRunAt: 0 }, settings);
    }, { id: PROMO_ID, settings });
}

const card = (page) => page.locator('.edit-mode-notice-card');

test.describe('the edit mode hint', () => {
    test('it names the key, and Try edit mode switches the mode on and is not asked again', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => window.DashboardEditModeNotice.render())).toBe(true);
        await expect(card(page)).toBeVisible();
        await expect(card(page)).toContainText('Shift+M');
        await card(page).locator('[data-em-action="open"]').click();
        await expect(card(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-edit-mode'))).toBe('on');
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(false);
    });

    test('No thanks closes it for good', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.DashboardEditModeNotice.render());
        await card(page).locator('[data-em-action="dismiss"]').first().click();
        await expect(card(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(false);
    });

    test('a new install waits a day, an upgrade does not', async ({ page }) => {
        await load(page, { firstRunInstall: true, firstRunAt: Date.now() });
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(false);
        await page.evaluate((ago) => { window.dashboardInstance.settings.firstRunAt = Date.now() - ago; }, DAY + 60_000);
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(true);
    });

    test('it waits until three minutes after the latest corner card', async ({ page }) => {
        await load(page);
        await page.evaluate(() => localStorage.setItem('nextdash:last-corner-card-at', String(Date.now() - 60_000)));
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(false);
        await page.evaluate(() => localStorage.setItem('nextdash:last-corner-card-at', String(Date.now() - 181_000)));
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(true);
    });

    test('showing any corner card starts the three minutes', async ({ page }) => {
        await load(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:last-corner-card-at'));
        await page.evaluate(() => window.DashboardEditModeNotice.render());
        await expect(card(page)).toBeVisible();
        const at = await page.evaluate(() => Number(localStorage.getItem('nextdash:last-corner-card-at')));
        expect(Date.now() - at).toBeLessThan(10_000);
    });

    test('it is not shown while the mode is already on', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.editMode.enter());
        expect(await page.evaluate(() => window.DashboardEditModeNotice.shouldShow())).toBe(false);
    });
});
