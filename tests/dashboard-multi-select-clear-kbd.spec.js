// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Clearing a multi-selection restores the keyboard-cursor's dimmed state
 * (set while hovering dims the keyboard-selected row so it doesn't fight the
 * pointer-hovered one for attention). The toolbar's Clear button used to call
 * `dash.keyboardNav?.restoreKbdSelection?.()` — a property name that does not
 * exist anywhere in the codebase (the dashboard always exposes this as
 * `keyboardNavigation`) — so the optional chain silently no-opped and the dim
 * stuck around after Clear.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
}

test.describe('multi-select — Clear restores the dimmed keyboard selection', () => {
    test('the dimmed class is gone after Clear', async ({ page }) => {
        await openDashboard(page);

        // Put the keyboard cursor on a row, then start and populate a
        // multi-selection the way x does.
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowDown');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1))
            .toBeGreaterThanOrEqual(0);
        await page.keyboard.press('x');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBeGreaterThan(0);

        // Simulate the dim the way a pointer hover over another row would —
        // the toolbar's own real trigger is a hover, not a key, so this calls
        // the same public method that hover calls rather than driving a mouse.
        await page.evaluate(() => window.dashboardInstance.keyboardNavigation.dimKbdSelection());
        await expect(page.locator('body')).toHaveClass(/bookmark-kbd-selection-dimmed/);

        await page.getByText('Clear', { exact: true }).click();

        await expect(page.locator('body')).not.toHaveClass(/bookmark-kbd-selection-dimmed/);
    });
});
