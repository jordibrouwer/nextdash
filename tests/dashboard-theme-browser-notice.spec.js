// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Two hundred themes and a browser built to make choosing one pleasant, three
 * clicks deep behind Config → Appearance → Browse. Someone who never goes
 * looking never learns their dashboard can look like anything else.
 *
 * So the invitation does not describe the browser — it opens it, from the
 * dashboard, with the preview landing on the page the reader is already looking
 * at. What this pins is that: the button opens the real browser rather than
 * navigating to a settings screen, the dashboard stays the active view, and
 * declining is final.
 */

const PROMO_ID = 'theme-browser-try-v1';

async function loadWithCardPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
    }, PROMO_ID);
}

test.describe('the theme browser invitation', () => {
    test('Browse themes opens the browser on the dashboard itself', async ({ page }) => {
        await loadWithCardPending(page);
        expect(await page.evaluate(() => window.DashboardThemeBrowserNotice.render())).toBe(true);

        const card = page.locator('.theme-browser-notice-card');
        await expect(card).toBeVisible();

        await card.locator('[data-tb-action="try"]').click();

        // The real browser, not a trip to the settings screen: that is the whole
        // point of offering it here, because the preview lands on this page.
        await expect(page.locator('.modal--theme-browser')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-theme-card]').first()).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
    });

    test('the follow-up names where the browser lives, but not before', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardThemeBrowserNotice.render());

        // The invitation stays a single ask — no command hint yet.
        const hint = page.locator('.theme-browser-notice-hint');
        await expect(hint).toHaveCount(0);

        await page.locator('.theme-browser-notice-card [data-tb-action="try"]').click();
        await expect(page.locator('.modal--theme-browser')).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal--theme-browser')).toHaveCount(0);

        await expect(hint).toBeVisible();
        await expect(hint.locator('kbd')).toHaveText(':theme');
        await expect(page.locator('.theme-browser-notice-card [data-tb-action="open-appearance"]')).toBeVisible();
    });

    test('closing the browser without picking leaves the theme alone', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardThemeBrowserNotice.render());
        const before = await page.evaluate(() => window.dashboardInstance.settings.theme);

        await page.locator('.theme-browser-notice-card [data-tb-action="try"]').click();
        await expect(page.locator('.modal--theme-browser')).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal--theme-browser')).toHaveCount(0);

        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(before);
        // And the dashboard is still the dashboard — opening the browser from
        // here must not drag the config view in behind it.
        await expect(page.locator('#dashboard-layout.config-layout')).toHaveCount(0);
    });

    test('dismissing without looking is final', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardThemeBrowserNotice.render());

        await page.locator('.theme-browser-notice-card [data-tb-action="dismiss"]').first().click();
        await expect(page.locator('.theme-browser-notice-card')).toHaveCount(0);

        expect(await page.evaluate((id) =>
            window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.DashboardThemeBrowserNotice.shouldShow())).toBe(false);
    });

    /*
     * The first draft skipped anyone not still on the packaged default, on the
     * theory that a changed theme means the browser was found. It does not:
     * `:theme`, the Appearance dropdown and the setup card all change the theme
     * without showing the grid, the search, the favourites or the preview. That
     * gate hid the card from exactly the readers who care about themes -- it
     * never appeared on an install running Moss & Stone.
     */
    test('it is offered whatever theme is already in use', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(async () => {
            window.dashboardInstance.settings.theme = 'moss-stone-dark';
            await window.dashboardInstance.saveSettings?.();
        });

        expect(await page.evaluate(() => window.DashboardThemeBrowserNotice.shouldShow())).toBe(true);
        expect(await page.evaluate(() => window.DashboardThemeBrowserNotice.render())).toBe(true);
        await expect(page.locator('.theme-browser-notice-card')).toBeVisible();
    });
});
