// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Saying once that the filter row scrolls.
 *
 * The strip holds a dozen pills and fits about seven; the ones past the edge are
 * the tidy-up filters — Stale, Unused, Drift, Ignored — and nothing announces
 * them but a fade that reads as decoration.
 *
 * Dismissing is the answer, not a postponement, so it is recorded as a setting
 * promo and never asked again.
 */

const hint = (page) => page.locator('.health-filter-hint');

async function openHealth(page, { width = 700 } = {}) {
    await page.setViewportSize({ width, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Shared data dir: an earlier run may already have answered.
    await page.evaluate(() => {
        const state = window.DiscoverabilityState;
        if (!state?.exportState) return;
        const exported = state.exportState();
        exported.seenSettingPromos = (exported.seenSettingPromos || [])
            .filter((id) => id !== 'health-filter-scroll-v1');
        state.init?.(exported);
    });
    await page.evaluate(async () => {
        await window.dashboardInstance.health.openHealthView();
    });
    await expect(page.locator('.health-view-filter-group')).toBeVisible({ timeout: 15_000 });
}

test.describe('the filter strip hint', () => {
    test('appears over the pills when they do not fit, and points at them', async ({ page }) => {
        await openHealth(page, { width: 620 });

        await expect(hint(page)).toBeVisible({ timeout: 15_000 });
        // Anchored to the strip rather than parked in a corner.
        const placed = await page.evaluate(() => {
            const card = document.querySelector('.health-filter-hint').getBoundingClientRect();
            const strip = document.querySelector('.health-view-filter-group').getBoundingClientRect();
            return {
                overlapsHorizontally: card.left < strip.right && card.right > strip.left,
                near: Math.min(Math.abs(strip.top - card.bottom), Math.abs(card.top - strip.bottom)) < 40,
            };
        });
        expect(placed.overlapsHorizontally).toBe(true);
        expect(placed.near).toBe(true);
    });

    test('says nothing when every pill already fits', async ({ page }) => {
        await openHealth(page, { width: 1600 });
        await page.waitForTimeout(1600);

        const overflowing = await page.evaluate(() => {
            const strip = document.querySelector('.health-view-filter-group');
            return strip.scrollWidth - strip.clientWidth > 8;
        });
        test.skip(overflowing, 'this window is still too narrow to hold every pill');
        await expect(hint(page)).toHaveCount(0);
    });

    test('dismissing it is the answer — it does not come back', async ({ page }) => {
        await openHealth(page, { width: 620 });
        await expect(hint(page)).toBeVisible({ timeout: 15_000 });

        await hint(page).locator('.health-filter-hint-btn').click();
        await expect(hint(page)).toHaveCount(0);

        // Recorded, and recorded where it survives a reload.
        expect(await page.evaluate(() =>
            window.DiscoverabilityState.hasSeenSettingPromo('health-filter-scroll-v1'))).toBe(true);

        await page.evaluate(async () => {
            const health = window.dashboardInstance.health;
            health.closeHealthView();
            await health.openHealthView();
        });
        await page.waitForTimeout(1600);
        await expect(hint(page)).toHaveCount(0);
    });

    test('clicking the strip counts as having read it', async ({ page }) => {
        await openHealth(page, { width: 620 });
        await expect(hint(page)).toBeVisible({ timeout: 15_000 });

        // Someone who scrolls the pills has just learned what the card says.
        await page.locator('.health-view-filter-btn').first().click();
        await expect(hint(page)).toHaveCount(0, { timeout: 10_000 });
        expect(await page.evaluate(() =>
            window.DiscoverabilityState.hasSeenSettingPromo('health-filter-scroll-v1'))).toBe(true);
    });
});
