// @ts-check
const { test, expect } = require('./fixtures');
const {
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    waitForConfigReady,
    markConfigSettingPromosSeen,
} = require('./e2e-helpers');

/**
 * A long Appearance tab lists its panels above the preview.
 *
 * Only past three panels; choosing an entry opens that panel and brings it on
 * screen, and the filter narrows the list with the panels.
 */
async function openAppearanceTab(page, tab) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await markConfigSettingPromosSeen(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.appearanceTab = c.appearanceTab || 'general';
        return c.openConfigView('appearance');
    });
    await page.locator(`[data-appearance-tab="${tab}"]`).click();
    await expect(page.locator(`[data-appearance-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
}

const index = (page) => page.locator('[data-panel-index]');
const entries = (page) => page.locator('[data-panel-index] [data-panel-index-key]');

test.describe('the panel index', () => {
    test('a tab of more than three panels lists them; a shorter one does not', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await expect(index(page)).toBeVisible();
        const panels = await page.locator('#config-appearance-body .config-panel--fold').count();
        expect(panels).toBeGreaterThan(3);
        await expect(entries(page)).toHaveCount(panels);
        await expect(entries(page)).toHaveText(['Clock & weather', 'Date & time', 'Weather', 'Calendar']);

        await page.locator('[data-appearance-tab="header"]').click();
        await expect(page.locator('[data-appearance-tab="header"]')).toHaveAttribute('aria-selected', 'true');
        expect(await page.locator('#config-appearance-body .config-panel--fold').count()).toBeLessThan(4);
        await expect(index(page)).toBeHidden();
    });

    test('choosing an entry opens its panel and brings it on screen', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        const calendar = page.locator('#config-appearance-body .config-panel--fold', {
            has: page.locator('.config-panel-title', { hasText: /^\s*Calendar\s*$/ }),
        });
        await expect(calendar.locator('.config-panel-fold')).toHaveAttribute('aria-expanded', 'false');
        await entries(page).filter({ hasText: 'Calendar' }).click();
        await expect(calendar.locator('.config-panel-fold')).toHaveAttribute('aria-expanded', 'true');
        await expect(calendar).toBeInViewport();
        await expect(entries(page).filter({ hasText: 'Calendar' })).toHaveAttribute('aria-current', 'true');
    });

    test('the filter narrows the index with the panels', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await expect(index(page)).toBeVisible();
        await page.locator('[data-settings-filter]').first().fill('temperature');
        await expect(index(page)).toBeHidden();
        await page.locator('[data-settings-filter]').first().fill('');
        await expect(index(page)).toBeVisible();
    });
});
