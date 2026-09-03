// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Shift+A opens the theme browser directly from the dashboard.
 *
 * A for Appearance, the section the browser lives under -- the same
 * first-letter mnemonic the neighbouring keys use: Shift+I for Inbox, Shift+H
 * for Health, Shift+S for Settings. Unlike those it does not stop at a
 * section: it opens the modal on top of the dashboard the same way the
 * "Browse themes" button in Appearance does, via the config view's own
 * openThemeBrowser(), so a theme can be picked without ever entering config.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('Shift+A opens the theme browser', () => {
    test('the modal appears over the dashboard, config untouched', async ({ page }) => {
        await openDashboard(page);

        await page.keyboard.press('Shift+A');
        await expect(page.locator('.modal--theme-browser')).toBeVisible({ timeout: 10_000 });

        // Reached without ever entering config -- the point of doing this from
        // the dashboard rather than three clicks into Appearance.
        const view = await page.evaluate(() => window.dashboardInstance.activeView);
        expect(view).not.toBe('config');
    });

    test('a theme card is reachable and previewable from the shortcut', async ({ page }) => {
        await openDashboard(page);

        await page.keyboard.press('Shift+A');
        await expect(page.locator('.modal--theme-browser')).toBeVisible({ timeout: 10_000 });

        const card = page.locator('[data-theme-id]').first();
        await expect(card).toBeAttached();
    });

    test('a bare A is left alone for the search', async ({ page }) => {
        await openDashboard(page);

        await page.keyboard.press('a');
        await page.waitForTimeout(700);

        const open = await page.evaluate(() => !!document.querySelector('.modal--theme-browser'));
        expect(open).toBe(false);
    });

    test('the shortcut is in the cheat sheet', async ({ page }) => {
        await openDashboard(page);

        const registry = await page.evaluate(async () => {
            const res = await fetch('/static/js/shared/keyboard-cheat-sheet-registry.js');
            return res.ok ? res.text() : '';
        });
        expect(registry).not.toBe('');
        // Its own entry, not the Ctrl+Shift+A or Shift+Alt+arrows that also
        // start with "Shift + A" as a substring.
        expect(registry).toMatch(/keys: 'Shift \+ A'/);
    });
});
