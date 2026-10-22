// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Berry is the default theme for new installs. Someone who already has a
 * dashboard on another theme is asked once whether to try it: one button
 * switches, the other is a final no.
 */
const PROMO_ID = 'berry-theme-try-v1';

async function load(page, theme) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, theme }) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        window.dashboardInstance.settings.theme = theme;
    }, { id: PROMO_ID, theme });
}

test.describe('the Berry invitation', () => {
    test('it asks someone on another theme, and Try Berry switches to it', async ({ page }) => {
        await load(page, 'nord-dark');
        expect(await page.evaluate(() => window.DashboardBerryNotice.render())).toBe(true);
        const card = page.locator('.berry-theme-notice-card');
        await expect(card).toBeVisible();
        await card.locator('[data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-berry-dark');
    });

    test('a light theme still gets the dark half', async ({ page }) => {
        await load(page, 'nord-light');
        await page.evaluate(() => window.DashboardBerryNotice.render());
        await page.locator('.berry-theme-notice-card [data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-berry-dark');
    });

    test('after switching, the card stays and can go back to the previous theme', async ({ page }) => {
        await load(page, 'nord-light');
        await page.evaluate(() => window.DashboardBerryNotice.render());
        const card = page.locator('.berry-theme-notice-card');
        await card.locator('[data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-berry-dark');
        await expect(card).toBeVisible();
        await expect(card.locator('[data-ct-action="try"]')).toHaveCount(0);
        await card.locator('[data-ct-action="back"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('nord-light');
        await expect(card).toHaveCount(0);
    });

    test('Keep Berry closes the card and leaves the theme', async ({ page }) => {
        await load(page, 'nord-dark');
        await page.evaluate(() => window.DashboardBerryNotice.render());
        const card = page.locator('.berry-theme-notice-card');
        await card.locator('[data-ct-action="try"]').click();
        await card.locator('[data-ct-action="keep"]').click();
        await expect(card).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-berry-dark');
    });

    test('Not interested closes it for good and keeps the theme', async ({ page }) => {
        await load(page, 'nord-dark');
        await page.evaluate(() => window.DashboardBerryNotice.render());
        await page.locator('.berry-theme-notice-card .quickstart-btn[data-ct-action="dismiss"]').click();
        await expect(page.locator('.berry-theme-notice-card')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('nord-dark');
        expect(await page.evaluate(() => window.DashboardBerryNotice.shouldShow())).toBe(false);
    });

    test('someone on Confetti is asked too, even after answering the old Confetti card', async ({ page }) => {
        await load(page, 'look-confetti-dark');
        await page.evaluate(() => window.DiscoverabilityState.markSettingPromoSeen('confetti-theme-try-v1'));
        expect(await page.evaluate(() => window.DashboardBerryNotice.shouldShow())).toBe(true);
        await page.evaluate(() => window.DashboardBerryNotice.render());
        await page.locator('.berry-theme-notice-card [data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-berry-dark');
    });

    test('someone already on Berry is not asked, in either half', async ({ page }) => {
        await load(page, 'look-berry-light');
        expect(await page.evaluate(() => window.DashboardBerryNotice.shouldShow())).toBe(false);
    });
});
