// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

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
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config section rail follows the ARIA tabs pattern', () => {
    test('arrow keys move between sections and wrap around', async ({ page }) => {
        await openSection(page, 'overview');
        const tabs = page.locator('[data-config-section]');
        const searchJump = page.locator('[data-config-action="settings-jump"]');
        // Counted against SECTIONS rather than a literal: the rail has grown
        // twice — About with the overview rebuild, Widgets in v1.4.0 — and each
        // time this failed for being out of date rather than for anything being
        // wrong.
        const sections = await page.evaluate(() =>
            (window.DashboardConfig || window.DashboardConfigLoader).SECTIONS.length);
        await expect(tabs).toHaveCount(sections);

        await tabs.first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

        await tabs.first().focus();
        await page.keyboard.press('ArrowUp');
        // The settings-jump button sits after Help in the rail focus order.
        await expect(searchJump).toBeFocused();
    });

    test('Home and End jump to the ends', async ({ page }) => {
        await openSection(page, 'stats');
        const tabs = page.locator('[data-config-section]');
        const searchJump = page.locator('[data-config-action="settings-jump"]');

        await tabs.nth(6).focus();
        await page.keyboard.press('End');
        await expect(searchJump).toBeFocused();

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
        await page.keyboard.press('ArrowDown');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowUp');
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    });

    test('j and k move between sections from the panel', async ({ page }) => {
        await openSection(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('j');
        await expect(page.locator('[data-config-section="bookmarks"][aria-selected="true"]')).toBeVisible();
        await page.keyboard.press('k');
        await expect(page.locator('[data-config-section="overview"][aria-selected="true"]')).toBeVisible();
    });

    test('digit keys 1–9 leave config for a bookmark page', async ({ page }) => {
        await openSection(page, 'bookmarks');
        await page.locator('#config-section-panel').focus();

        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });
});
