const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/*
 * The corner cards can be asked for again.
 *
 * A card you waved away had no road back. Config → Behavior → Privacy lists them
 * with what became of each, and Show again puts back the ones that were answered.
 */

let stateBefore = null;

async function openPanel(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    stateBefore = await page.evaluate(() => window.DiscoverabilityState.exportState());
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.waitForSelector('[data-behavior-tab="privacy"]', { timeout: 15_000 });
    await page.locator('[data-behavior-tab="privacy"]').click();
}

test.describe('notice cards on the config panel', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(async (previous) => {
            const d = window.dashboardInstance;
            if (!d?.settings) return;
            window.DiscoverabilityState?.init?.(previous || {});
            await d.saveSettings?.();
            localStorage.removeItem('nextdashHealthReviewDoneOn');
        }, stateBefore).catch(() => { /* the page may already be closed */ });
        stateBefore = null;
    });

    test('an answered promo card is put back and the others stay answered', async ({ page }) => {
        await openPanel(page);
        await page.evaluate(() => {
            const s = window.DiscoverabilityState;
            s.markSettingPromoSeen('fresh-feeds-v1', { persist: false });
            s.markSettingPromoSeen('kept-pile-v1', { persist: false });
            window.dashboardInstance.config.render();
        });
        const fresh = page.locator('[data-notice-card="fresh"]');
        await expect(fresh).toBeEnabled({ timeout: 10_000 });
        await expect(page.locator('[data-notice-card="theme-browser"]')).toBeDisabled();
        await fresh.click();
        await expect.poll(() => page.evaluate(
            () => window.DiscoverabilityState.hasSeenSettingPromo('fresh-feeds-v1')), { timeout: 10_000 }).toBe(false);
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('kept-pile-v1'))).toBe(true);
    });

    test('a card kept in this browser is put back by clearing its keys', async ({ page }) => {
        await openPanel(page);
        await page.evaluate(() => {
            localStorage.setItem('nextdashHealthReviewDoneOn', '2026-01-01');
            window.dashboardInstance.config.render();
        });
        const btn = page.locator('[data-notice-card="health-review"]');
        await expect(btn).toBeEnabled({ timeout: 10_000 });
        await btn.click();
        await expect.poll(() => page.evaluate(
            () => localStorage.getItem('nextdashHealthReviewDoneOn')), { timeout: 10_000 }).toBeNull();
    });
});
