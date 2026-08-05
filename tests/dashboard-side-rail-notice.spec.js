// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The side rail is a large visual change nobody finds by reading a settings
 * list, so it is offered once, in place. Trying it has to apply immediately,
 * and declining has to be final — an invitation that returns is nagging.
 */

const PROMO_ID = 'side-rail-try-v1';

async function loadWithCardPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (id) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        window.dashboardInstance.settings.buttonBarPosition = 'bottom';
        await window.dashboardInstance.saveSettings?.();
        window.dashboardInstance.setupDOM?.();
    }, PROMO_ID);
}

test.describe('side rail invitation', () => {
    test('Try it applies the rail at once and offers the way back', async ({ page }) => {
        await loadWithCardPending(page);
        expect(await page.evaluate(() => window.DashboardSideRailNotice.render())).toBe(true);

        const card = page.locator('.side-rail-notice-card');
        await expect(card).toBeVisible();

        await card.locator('[data-sr-action="try"]').click();

        // Applied live: setupDOM writes it onto <body> and CSS does the rest.
        await expect.poll(() => page.evaluate(() =>
            document.body.getAttribute('data-button-position')), { timeout: 5000 }).toBe('side-left');
        expect(await page.evaluate(() =>
            window.dashboardInstance.settings.buttonBarPosition)).toBe('side-left');

        // The card stays up to say where to switch it back off.
        await expect(card).toBeVisible();
        await expect(card.locator('.side-rail-notice-text')).toContainText(/Layout/i);
        await expect(card.locator('[data-sr-action="open-layout"]')).toBeVisible();
    });

    test('the follow-up opens Appearance → Layout', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardSideRailNotice.render());
        await page.locator('.side-rail-notice-card [data-sr-action="try"]').click();
        await page.locator('.side-rail-notice-card [data-sr-action="open-layout"]').click();

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section), { timeout: 5000 }).toBe('appearance');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab)).toBe('layout');
        // And the control it points at is really there.
        await expect(page.locator('[data-appearance-barpos="side-left"]')).toBeVisible();
    });

    test('dismissing without trying is final and changes nothing', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardSideRailNotice.render());
        await page.locator('.side-rail-notice-card [data-sr-action="dismiss"]').first().click();

        await expect(page.locator('.side-rail-notice-card')).toHaveCount(0);
        expect(await page.evaluate((id) =>
            window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        // Declining is not a setting change.
        expect(await page.evaluate(() =>
            window.dashboardInstance.settings.buttonBarPosition)).toBe('bottom');
        // And it must not come back.
        expect(await page.evaluate(() => window.DashboardSideRailNotice.shouldShow())).toBe(false);
        expect(await page.evaluate(() => window.DashboardSideRailNotice.render())).toBe(false);
    });

    test('it is not offered to someone already on the side rail', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(async () => {
            window.dashboardInstance.settings.buttonBarPosition = 'side-left';
            await window.dashboardInstance.saveSettings?.();
        });
        expect(await page.evaluate(() => window.DashboardSideRailNotice.shouldShow())).toBe(false);
    });

    test('the feature is listed in the config overview carousel', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));

        const spotlight = page.locator('.config-feature-spotlight');
        await expect(spotlight).toBeVisible();
        // It leads the carousel, and reads as copy rather than locale keys.
        await expect(spotlight.locator('.config-feature-spotlight-title')).toHaveText(/button bar|knoppenbalk|barre de boutons|schaltflächenleiste/i);
        await expect(spotlight).not.toContainText('config.overviewNewFeature');

        await spotlight.locator('[data-overview-go]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab), { timeout: 5000 }).toBe('layout');
    });
});
