// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * , opens the Config view (Esc leaves it, as with < and Shift+S). The Pages panel is Shift+P now
 * (it was ,), and Shift+S, the old Config key, is Share now: with nothing
 * selected it does nothing.
 */
async function loadDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.activeElement?.blur());
}
const view = (page) => page.evaluate(() => window.dashboardInstance.activeView);

test('comma opens the Config view, and Esc leaves it', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press(',');
    await expect.poll(() => view(page)).toBe('config');
    await page.keyboard.press('Escape');
    await expect.poll(() => view(page)).not.toBe('config');
});

test('a comma typed in a text field stays a comma', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe-field';
        document.body.appendChild(input);
        input.focus();
    });
    await page.keyboard.type('a,b');
    await expect(page.locator('#probe-field')).toHaveValue('a,b');
    expect(await view(page)).not.toBe('config');
});

test('Shift+S with nothing selected no longer opens Config', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Shift+S');
    await page.waitForTimeout(300);
    expect(await view(page)).not.toBe('config');
});

test('Shift+P with no row opens the Pages panel, and again closes it', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Shift+P');
    await expect(page.locator('.page-overview-modal')).toBeVisible();
    await page.keyboard.press('Shift+P');
    await expect(page.locator('.page-overview-modal')).toHaveCount(0);
});

test('Shift+P with a bookmark selected pins it, not the Pages panel', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Shift+P');
    await expect(page.locator('.page-overview-modal')).toHaveCount(0);
});
