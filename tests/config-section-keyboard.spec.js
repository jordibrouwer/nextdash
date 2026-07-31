// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The section rail carried role="tablist" and role="tab" but bound only click,
 * so the standard tab keys did nothing. These pin the ARIA tabs pattern for the
 * primary config navigation rail.
 */
async function openSection(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config section rail follows the ARIA tabs pattern', () => {
    test('arrow keys move between sections and wrap around', async ({ page }) => {
        await openSection(page, 'overview');
        const tabs = page.locator('[data-config-section]');
        const count = await tabs.count();
        expect(count).toBe(8);

        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

        await tabs.first().focus();
        await page.keyboard.press('ArrowLeft');
        await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
    });

    test('Home and End jump to the ends', async ({ page }) => {
        await openSection(page, 'stats');
        const tabs = page.locator('[data-config-section]');
        const count = await tabs.count();

        await tabs.nth(6).focus();
        await page.keyboard.press('End');
        await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true');

        await page.keyboard.press('Home');
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    });

    test('only the active section is in the page tab order', async ({ page }) => {
        await openSection(page, 'appearance');
        const active = page.locator('[data-config-section="appearance"]');
        await expect(active).toHaveAttribute('tabindex', '0');
        const inactive = page.locator('[data-config-section="overview"]');
        await expect(inactive).toHaveAttribute('tabindex', '-1');
    });

    test('each section tab points at the shared panel', async ({ page }) => {
        await openSection(page, 'help');
        const controls = await page.locator('[data-config-section="help"]').getAttribute('aria-controls');
        expect(controls).toBe('config-section-panel');
        await expect(page.locator('#config-section-panel')).toHaveAttribute('role', 'tabpanel');
    });

    test('keyboard navigation survives a section switch that repaints wholesale', async ({ page }) => {
        await openSection(page, 'overview');
        const tabs = page.locator('[data-config-section]');
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowLeft');
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    });

    test('digit keys 1–8 jump to the matching section', async ({ page }) => {
        await openSection(page, 'overview');
        await page.locator('#config-section-panel').focus();

        await page.keyboard.press('3');
        await expect(page.locator('[data-config-section="bookmarks"][aria-selected="true"]')).toBeVisible();

        await page.keyboard.press('8');
        await expect(page.locator('[data-config-section="help"][aria-selected="true"]')).toBeVisible();
    });
});
