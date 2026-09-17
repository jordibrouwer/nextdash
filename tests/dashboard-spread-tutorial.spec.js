// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Spreading a category across columns has a walkthrough, and Config → Help is
 * its door. The corner card that also offered it is gone; the tour stays.
 */

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openFromHelp(page) {
    await page.evaluate(async () => {
        const c = window.dashboardInstance.config;
        await c.openConfigView('help');
        c.helpTab = 'organizing';
        c.render();
    });
    const button = page.locator('[data-help-action="spread-tour"]');
    await expect(button).toBeVisible();
    await button.click();
}

test.describe('the spread walkthrough', () => {
    test('the walkthrough has four steps with a diagram each', async ({ page }) => {
        await load(page);
        await openFromHelp(page);

        const tour = page.locator('.spread-tutorial');
        await expect(tour).toBeVisible();
        await expect(page.locator('.spread-tutorial-progress')).toHaveText(/1.*4/);
        await expect(page.locator('.spread-tutorial-dot')).toHaveCount(4);

        // Step one is the before/after shape — the thing a paragraph cannot say.
        await expect(page.locator('.spread-tutorial-visual--compare .spread-tutorial-col')).toHaveCount(3);

        const next = page.locator('#app-modal .modal-actions .modal-button').first();
        await next.click();
        await expect(page.locator('.spread-tutorial-progress')).toHaveText(/2.*4/);
        // The step that shows where the switch is, with the menu row that
        // carries it and its key.
        await expect(page.locator('.spread-tutorial-menu-row.is-current')).toContainText(/spread/i);
        await expect(page.locator('.spread-tutorial-menu-row.is-current kbd')).toHaveText('Shift+W');

        await next.click();
        await expect(page.locator('.spread-tutorial-progress')).toHaveText(/3.*4/);
        // The one everybody needs: the column count is a sum, not a field.
        await expect(page.locator('.spread-tutorial-visual--sum .spread-tutorial-chip')).toHaveCount(2);
        await expect(page.locator('.spread-tutorial-visual--sum .spread-tutorial-col')).toHaveCount(3);
    });

    test('Config → Help opens it over config', async ({ page }) => {
        await load(page);
        await openFromHelp(page);

        await expect(page.locator('.spread-tutorial')).toBeVisible();
        // Config is a view on this page and the tour is a modal over it, so it
        // does not throw the reader back to the grid.
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

});
