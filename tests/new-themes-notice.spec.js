// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The popover that introduces the eight new theme groups to an install that was already in use:
 * once, with a tab per group, a line and a screenshot per theme, a button that puts the theme on
 * the page, a large picture on a click, and a way into the theme studio on the New themes.
 * A fresh install does not see it.
 */
async function asInstall(page, { fresh }) {
    /*
     * firstRunInstall belongs to the server and a POST cannot change it: open() tells the page what
     * kind of install this is, before the popover's first look. The setup cards are answered on the server, so
     * none holds the corner, and the promo is put back to "not asked".
     */
    const res = await page.request.post('/api/settings', {
        data: {
            quickStart: { dismissed: true, visitedConfig: true, seenCheatsheet: true, seenAnalyticsNotice: true, analyticsChoiceMade: true },
            discoverabilityState: { seenSettingPromos: [] },
        },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    if (!res.ok()) throw new Error(`settings not set: HTTP ${res.status()}`);
    page._ndFresh = fresh;
    await markWhatsNewSeen(page);
}

async function open(page) {
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await page.evaluate((fresh) => { window.dashboardInstance.settings.firstRunInstall = fresh; }, page._ndFresh === true);
    // The promo is put back to "not asked" in the page's copy as well.
    await page.evaluate(() => {
        const state = window.dashboardInstance.settings.discoverabilityState || {};
        state.seenSettingPromos = (state.seenSettingPromos || []).filter((id) => id !== 'theme-groups-v1');
    });
}

const popover = (page) => page.locator('.new-themes-modal');

test.describe('the new theme groups popover', () => {
    // One server, and the install's state is written to it: one test at a time.
    test.describe.configure({ mode: 'serial' });

    test('an upgraded install is shown the groups, a line per theme and the special ones named', async ({ page }) => {
        await asInstall(page, { fresh: false });
        await open(page);
        await expect(popover(page)).toBeVisible({ timeout: 25_000 });
        await expect(popover(page)).toContainText('Eight new theme groups');
        await expect(popover(page).locator('.new-themes-tab')).toHaveCount(8);
        await popover(page).locator('.new-themes-tab', { hasText: 'Living' }).click();
        const sky = popover(page).locator('.new-themes-card', { hasText: 'Skywatch' });
        await expect(sky).toContainText('Reacts to the weather');
        await expect(sky.locator('.new-themes-desc')).not.toHaveText('');
        await expect(popover(page).locator('.new-themes-card')).toHaveCount(3);
    });

    test('a click on a screenshot opens it large, and Escape closes that first', async ({ page }) => {
        await asInstall(page, { fresh: false });
        await open(page);
        await expect(popover(page)).toBeVisible({ timeout: 25_000 });
        await popover(page).locator('.new-themes-shot').first().click();
        const big = page.locator('#new-themes-lightbox');
        await expect(big).toBeVisible();
        await expect(big.locator('img')).toHaveAttribute('src', /-large\.webp$/);
        await page.keyboard.press('Escape');
        await expect(big).toHaveCount(0);
        await expect(popover(page)).toBeVisible();
    });

    test('Use this theme puts the theme on the page and the card says In use', async ({ page }) => {
        await asInstall(page, { fresh: false });
        await open(page);
        await expect(popover(page)).toBeVisible({ timeout: 25_000 });
        await popover(page).locator('.new-themes-tab', { hasText: 'Living' }).click();
        await popover(page).locator('.new-themes-mode, [data-new-themes-mode="dark"]').first().click();
        const card = popover(page).locator('.new-themes-card', { hasText: 'Tidewatch' });
        await card.locator('.new-themes-use').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('living-tidewatch-dark');
        await expect(popover(page).locator('.new-themes-card', { hasText: 'Tidewatch' }).locator('.new-themes-use')).toHaveText('In use');
        await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('living-tidewatch-dark');
    });

    test('the Light switch turns every card to the light half', async ({ page }) => {
        await asInstall(page, { fresh: false });
        await open(page);
        await expect(popover(page)).toBeVisible({ timeout: 25_000 });
        await popover(page).locator('[data-new-themes-mode="light"]').click();
        await expect(popover(page).locator('.new-themes-card').first()).toHaveAttribute('data-new-themes-card', /-light$/);
    });

    test('Open the theme studio opens it on the New themes', async ({ page }) => {
        await asInstall(page, { fresh: false });
        await open(page);
        await expect(popover(page)).toBeVisible({ timeout: 25_000 });
        await page.locator('#modal-actions .modal-button', { hasText: 'Open the theme studio' }).click();
        await expect(page.locator('.theme-browser-segment[data-theme-segment="new"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    });

    test('a fresh install never sees it', async ({ page }) => {
        await asInstall(page, { fresh: true });
        await open(page);
        // Not asked yet, and still not wanted: it is the install that is fresh.
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('theme-groups-v1'))).toBe(false);
        expect(await page.evaluate(() => window.NewThemesNotice.wanted())).toBe(false);
        await page.waitForTimeout(7_000);
        await expect(page.locator('.new-themes-modal')).toHaveCount(0);
    });

    test('it counts as answered once shown, and does not come back', async ({ page }) => {
        await asInstall(page, { fresh: false });
        await open(page);
        await expect(popover(page)).toBeVisible({ timeout: 25_000 });
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('theme-groups-v1'))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.NewThemesNotice.wanted())).toBe(false);
    });
});
