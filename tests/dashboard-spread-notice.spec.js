// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Spreading a category across columns is invisible until someone shows you: the
 * switch lives in a right-click menu, and nothing on the grid hints that a
 * category could be anything other than one column wide. So it is announced
 * once, in the corner, with a walkthrough behind it — the same pair the side
 * rail and the inbox use.
 */

const PROMO_ID = 'category-spread-v1';

async function loadWithCardPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (id) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        const d = window.dashboardInstance;
        d.settings.columnsPerRow = 3;
        await d.saveSettings?.();
        // The quick-start card owns the same corner, and on a fresh install it
        // is still up — a card that politely waits its turn cannot be tested.
        document.querySelectorAll('.quickstart-card:not(.spread-notice-card)').forEach((el) => el.remove());
    }, PROMO_ID);
}

test.describe('the spread announcement', () => {
    test('offers the walkthrough, and answering is final', async ({ page }) => {
        await loadWithCardPending(page);
        expect(await page.evaluate(() => window.DashboardSpreadNotice.render())).toBe(true);

        const card = page.locator('.spread-notice-card');
        await expect(card).toBeVisible();
        await expect(card).toContainText(/columns/i);

        // Two elements answer to this: the × in the corner and the text
        // button, deliberately the same answer.
        await card.locator('[data-spread-action="dismiss"]').last().click();
        await expect(card).toBeHidden();

        // Dismissed is an answer, not a postponement: an invitation that comes
        // back is nagging.
        expect(await page.evaluate(() => window.DashboardSpreadNotice.shouldShow())).toBe(false);
    });

    test('Show me how opens the walkthrough, four steps with a diagram each', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardSpreadNotice.render());
        await page.locator('.spread-notice-card [data-spread-action="show"]').click();

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

    test('Config → Help keeps the walkthrough after the card is gone', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.openConfigView('help');
            c.helpTab = 'organizing';
            c.render();
        });

        // Most readers of this page have already dismissed the card, which is
        // exactly why the tour has a second door.
        const button = page.locator('[data-help-action="spread-tour"]');
        await expect(button).toBeVisible();
        await button.click();

        await expect(page.locator('.spread-tutorial')).toBeVisible();
        // Config is a view on this page and the tour is a modal over it, so it
        // does not throw the reader back to the grid.
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('it stays out of the way where spreading cannot be used', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.columnsPerRow = 1;
            await d.saveSettings?.();
            d.renderDashboard({ animate: false, forceFull: true });
        });

        // One column has nothing to spread across, so announcing it there would
        // be an advert for something the reader cannot do.
        expect(await page.evaluate(() => window.DashboardSpreadNotice.shouldShow())).toBe(false);
    });
});
