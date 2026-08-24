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
        await expect(card.locator('.side-rail-notice-text')).toContainText(/Button bar/i);
        await expect(card.locator('[data-sr-action="open-buttonbar"]')).toBeVisible();
    });

    test('the follow-up names the :buttonbar command, but not before', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardSideRailNotice.render());

        // The invitation stays a single ask — no command hint yet.
        const hint = page.locator('.side-rail-notice-hint');
        await expect(hint).toBeHidden();

        await page.locator('.side-rail-notice-card [data-sr-action="try"]').click();

        await expect(hint).toBeVisible();
        await expect(hint.locator('kbd')).toHaveText(':buttonbar');
        await expect(hint).not.toContainText('dashboard.sideRailNotice');
    });

    test('the follow-up opens Appearance → Button bar', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardSideRailNotice.render());
        await page.locator('.side-rail-notice-card [data-sr-action="try"]').click();
        await page.locator('.side-rail-notice-card [data-sr-action="open-buttonbar"]').click();

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section), { timeout: 5000 }).toBe('appearance');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab)).toBe('buttonbar');
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

    /*
     * The carousel this stepped through is gone (v1.3.3). The catalogue it drew
     * from is now a list under About → News & features, so the claim is the
     * same and simply reads a row instead of a slide: the entry is there, it
     * reads as copy, and its button lands on the tab that holds the setting.
     */
    test('the feature is listed under About → News & features', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.openConfigView('about');
            c.aboutTab = 'news';
            c.render();
        });
        await page.waitForSelector('.config-news-stream', { timeout: 15_000 });

        const title = /button bar|knoppenbalk|barre de boutons|schaltflächenleiste/i;
        const row = page.locator('.config-news-item').filter({ hasText: title }).first();
        await expect(row).toBeVisible();
        // Reads as copy rather than locale keys.
        await expect(row).not.toContainText('config.overviewNewFeature');

        await row.locator('[data-overview-go]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab), { timeout: 5000 }).toBe('buttonbar');
    });
});
