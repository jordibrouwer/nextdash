// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The sub-tab strips carried role="tablist" and role="tab" but bound only
 * click, so a screen reader announced a tab widget whose standard keys did
 * nothing. These pin the ARIA tabs pattern: arrows move and wrap, Home/End
 * jump to the ends, and only the active tab stays in the page tab order.
 */
async function openSection(page, section) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config sub-tabs follow the ARIA tabs pattern', () => {
    test('arrow keys move between tabs and wrap around', async ({ page }) => {
        await openSection(page, 'stats');
        const tabs = page.locator('[data-stats-tab]');
        const count = await tabs.count();
        expect(count).toBeGreaterThan(2);

        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

        // Left from the first wraps to the last.
        await tabs.first().focus();
        await page.keyboard.press('ArrowLeft');
        await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
    });

    test('Home and End jump to the ends', async ({ page }) => {
        await openSection(page, 'stats');
        const tabs = page.locator('[data-stats-tab]');
        const count = await tabs.count();

        await tabs.first().focus();
        await page.keyboard.press('End');
        await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true');

        await page.keyboard.press('Home');
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    });

    test('only the active tab is in the page tab order', async ({ page }) => {
        await openSection(page, 'stats');
        const active = page.locator('[data-stats-tab][aria-selected="true"]');
        await expect(active).toHaveAttribute('tabindex', '0');
        const inactive = page.locator('[data-stats-tab][aria-selected="false"]').first();
        await expect(inactive).toHaveAttribute('tabindex', '-1');
    });

    test('each tab points at the panel it controls', async ({ page }) => {
        await openSection(page, 'stats');
        const controls = await page.locator('[data-stats-tab]').first().getAttribute('aria-controls');
        expect(controls).toBe('config-stats-body');
        await expect(page.locator(`#${controls}`)).toHaveAttribute('role', 'tabpanel');
    });

    test('keyboard navigation survives a section that repaints wholesale', async ({ page }) => {
        // Appearance activates through render(), which replaces the strip, so
        // focus has to be restored for a second key press to land.
        await openSection(page, 'appearance');
        const tabs = page.locator('[data-appearance-tab]');
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowLeft');
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    });
});
