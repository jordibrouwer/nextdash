// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Fresh is off by default, and its switch sits four panels down a tab called
 * Status & health — the right home for it, and the wrong place to meet it.
 *
 * So it is offered once in the corner, like the side rail and spreading a
 * category, and the card hands over to a walkthrough rather than switching
 * anything on: "we will tell you what is new" is a promise people have been
 * disappointed by, and it is worth the four steps to say what the count is,
 * what it costs, and what it deliberately is not.
 */

const PROMO_ID = 'fresh-feeds-v1';

/**
 * An all-but-empty page, which is the only thing the gate refuses. Emptied in
 * memory rather than through the API, so this spec leaves nothing behind for
 * the specs that share the data directory.
 */
async function withAnEmptyPage(page) {
    await page.evaluate(() => { window.dashboardInstance.bookmarks = []; });
}

async function loadWithCardPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        window.dashboardInstance.settings.feedsEnabled = false;
        // The quick-start card owns the same corner, and on a fresh install it
        // is still up — a card that politely waits its turn cannot be tested.
        document.querySelectorAll('.quickstart-card:not(.fresh-notice-card)').forEach((el) => el.remove());
    }, PROMO_ID);
}

test.describe('the Fresh notice', () => {
    test('a clean install is offered it — an empty page is not', async ({ page }) => {
        await loadWithCardPending(page);
        // The starter set is what a clean install has, and it is exactly who
        // this card is for: the gate skips a page with almost nothing on it,
        // and nothing else.
        expect(await page.evaluate(() => window.DashboardFreshNotice.shouldShow())).toBe(true);

        await withAnEmptyPage(page);
        expect(await page.evaluate(() => window.DashboardFreshNotice.shouldShow())).toBe(false);
    });

    test('offers the walkthrough rather than switching anything on', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardFreshNotice.render());

        const card = page.locator('.fresh-notice-card');
        await expect(card).toBeVisible();
        // Copy, not locale keys.
        await expect(card).not.toContainText('dashboard.freshNotice');

        const before = await page.evaluate(() => window.dashboardInstance.settings.feedsEnabled);
        await card.locator('[data-fresh-action="show"]').click();

        // The walkthrough opens, four steps, and the setting is still untouched.
        await expect(page.locator('.fresh-tutorial')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('.fresh-tutorial-dot')).toHaveCount(4);
        await expect(page.locator('.fresh-tutorial-progress')).toHaveText(/1.*4/);
        expect(await page.evaluate(() => window.dashboardInstance.settings.feedsEnabled)).toBe(before);
    });

    test('the last step is the switch, and it applies', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.FreshTutorial.open());
        await expect(page.locator('.fresh-tutorial')).toBeVisible();

        // Through all four steps, as a reader goes.
        const next = page.locator('#app-modal .modal-actions .modal-button').first();
        for (let i = 0; i < 3; i += 1) {
            await next.click();
        }
        await expect(page.locator('.fresh-tutorial-progress')).toHaveText(/4.*4/);
        // A walkthrough that ends in "now go and find the setting" wastes the
        // one moment the reader is convinced.
        await expect(next).not.toHaveText(/next/i);

        await next.click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.feedsEnabled), { timeout: 5_000 })
            .toBe(true);
    });

    test('it is not offered to someone who already has Fresh on', async ({ page }) => {
        await loadWithCardPending(page);
        const shown = await page.evaluate(() => {
            window.dashboardInstance.settings.feedsEnabled = true;
            return window.DashboardFreshNotice.shouldShow();
        });
        expect(shown).toBe(false);
    });
});
