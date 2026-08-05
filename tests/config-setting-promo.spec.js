// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

const PROMO_ID = 'random-theme-v2';
const STORAGE_KEY = `nextdash:config-setting-promo-seen-v1:${PROMO_ID}`;

async function openAppearanceFresh(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((key) => {
        localStorage.removeItem(key);
        window.DiscoverabilityState?.resetSettingPromoSeen?.('random-theme-v2', { persist: false });
    }, STORAGE_KEY);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-appearance-randommode="off"]')).toBeVisible();
}

test.describe('Config setting promo', () => {
    test('shows on Appearance and dismisses once', async ({ page }) => {
        await openAppearanceFresh(page);

        const promo = page.locator('.config-setting-promo');
        await expect(promo).toBeVisible({ timeout: 8000 });
        await expect(promo.locator('.config-setting-promo-title')).toContainText(/random theme|willekeurig|zufällig|aléatoire/i);
        await expect(page.locator('[data-config-setting-promo-anchor="randomThemeMode"]')).toHaveClass(/config-setting-promo-anchor-highlight/);

        await promo.locator('.config-setting-promo-dismiss').click();
        await expect(promo).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.config.selectSection('behavior'));
        await page.evaluate(() => window.dashboardInstance.config.selectSection('appearance'));
        await expect(page.locator('.config-setting-promo')).toHaveCount(0, { timeout: 3000 });
    });

    test('Escape dismisses the promo without closing config', async ({ page }) => {
        await openAppearanceFresh(page);
        const promo = page.locator('.config-setting-promo');
        await expect(promo).toBeVisible({ timeout: 8000 });

        await page.keyboard.press('Escape');
        await expect(promo).toHaveCount(0);
        await expect(page.locator('.config-view')).toBeVisible();
    });

    /**
     * Acting on the highlighted setting counts as having seen the promo. Random
     * theme is a button group, which fires no `change` and repaints the panel on
     * save — so the popover came straight back a second later, and the anchor
     * kept its highlight, until the click itself marked the promo seen.
     */
    test('using the highlighted button group dismisses the promo for good', async ({ page }) => {
        await openAppearanceFresh(page);
        await expect(page.locator('.config-setting-promo')).toBeVisible({ timeout: 8000 });

        await page.locator('[data-appearance-randommode="view"]').click();

        // The repaint after saving must not resurrect it.
        await expect(page.locator('.config-setting-promo')).toHaveCount(0, { timeout: 5000 });
        await page.waitForTimeout(1500);
        await expect(page.locator('.config-setting-promo')).toHaveCount(0);
        await expect(page.locator('.config-setting-promo-anchor-highlight')).toHaveCount(0);
        expect(await page.evaluate((id) => window.ConfigSettingPromo.hasSeen(id), PROMO_ID)).toBe(true);

        // The click still did its real job.
        expect(await page.evaluate(() => window.dashboardInstance.settings.randomThemeMode)).toBe('view');

        await page.evaluate(() => window.dashboardInstance.config.selectSection('behavior'));
        await page.evaluate(() => window.dashboardInstance.config.selectSection('appearance'));
        await expect(page.locator('.config-setting-promo')).toHaveCount(0, { timeout: 3000 });
    });

    /** The popover points at the button group, not the whole field with its label. */
    test('the promo is anchored to the button group', async ({ page }) => {
        await openAppearanceFresh(page);
        await expect(page.locator('.config-setting-promo')).toBeVisible({ timeout: 8000 });

        const centres = await page.evaluate(() => {
            const group = document.querySelector('[data-config-setting-promo-anchor="randomThemeMode"] .config-choices');
            const pop = document.querySelector('.config-setting-promo');
            const g = group.getBoundingClientRect();
            const p = pop.getBoundingClientRect();
            return { group: g.left + g.width / 2, promo: p.left + p.width / 2, below: p.top >= g.bottom };
        });
        expect(Math.abs(centres.group - centres.promo)).toBeLessThan(24);
        expect(centres.below).toBe(true);
    });



});
