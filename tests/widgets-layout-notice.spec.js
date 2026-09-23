// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The invitation to try the Widgets layout.
 *
 * The presets live three clicks deep, so somebody who never opens Appearance →
 * Grid stays on whatever the install started them on. This card applies the
 * one preset that changes the most — and offers the way back in the same card,
 * because a card that rearranges your dashboard and then walks away is not an
 * invitation, it is a change.
 */

const PROMO = 'widgets-layout-try-v1';

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The card waits on a random budget of active time, which no test should
    // sit through. Everything after this is the gate and the buttons, which is
    // what the reader meets.
    await page.evaluate(() => window.DiscoverabilityState?.resetSettingPromoSeen?.('widgets-layout-try-v1'));
}

const preset = (page) => page.evaluate(() => window.dashboardInstance.settings.layoutPreset);

const setPreset = (page, value) => page.evaluate((p) => {
    window.LayoutUtils.applyLayoutPreset(window.dashboardInstance.settings, p,
        { syncDashboard: true, saveDashboard: true });
}, value);

test('it offers the layout, applies it, and puts back what was there', async ({ page }) => {
    await openDashboard(page);
    await setPreset(page, 'masonry');

    await page.evaluate(() => window.DashboardWidgetsLayoutNotice.showNow());
    const card = page.locator('.widgets-layout-notice-card');
    await expect(card, 'the card never arrived').toBeVisible({ timeout: 15_000 });

    await card.locator('[data-wl-action="try"]').click();
    await expect.poll(() => preset(page), { message: 'Try it did not apply the layout' }).toBe('widgets');
    expect(await page.evaluate(() => document.body.getAttribute('data-layout-preset')),
        'the page was not redrawn with it').toBe('widgets');

    // The way back names where it goes, rather than saying "undo" and leaving
    // the reader to find out.
    const undo = card.locator('[data-wl-action="undo"]');
    await expect(undo).toContainText(/masonry/i);

    await undo.click();
    await expect.poll(() => preset(page), { message: 'the previous layout was not restored' }).toBe('masonry');
    await expect(card, 'the card stayed up after the undo').toHaveCount(0);
});

test('it is not offered to somebody already on that layout', async ({ page }) => {
    await openDashboard(page);
    await setPreset(page, 'widgets');

    expect(await page.evaluate(() => window.DashboardWidgetsLayoutNotice.shouldShow()),
        'the card offered a layout the reader is already using').toBe(false);
});

test('an answer is remembered, whichever answer it was', async ({ page }) => {
    await openDashboard(page);
    await setPreset(page, 'masonry');

    await page.evaluate(() => window.DashboardWidgetsLayoutNotice.showNow());
    const card = page.locator('.widgets-layout-notice-card');
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.locator('[data-wl-action="dismiss"]').first().click();
    await expect(card).toHaveCount(0);

    expect(await page.evaluate(() => window.DashboardWidgetsLayoutNotice.shouldShow()),
        'no thanks was not remembered').toBe(false);

    /*
     * And it survives a reload, which is the whole point of recording it.
     *
     * The write is debounced, so reloading straight after the click raced it:
     * the answer was in memory and not yet on the server, and the card came
     * back. Waited for rather than slept through.
     */
    await expect.poll(() => page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const stored = await (await api('/api/settings')).json();
        const promos = stored.discoverabilityState?.seenSettingPromos;
        return Array.isArray(promos) && promos.includes('widgets-layout-try-v1');
    }), { message: 'the answer never reached the server', timeout: 10_000 }).toBe(true);

    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await expect.poll(() => page.evaluate(
        () => window.DashboardWidgetsLayoutNotice?.shouldShow() ?? true),
    { message: 'the card came back after a reload' }).toBe(false);
});
