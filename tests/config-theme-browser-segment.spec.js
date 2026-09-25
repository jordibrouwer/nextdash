// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * The Light and Dark segments decide which half every card shows.
 *
 * They used to filter only: a family with a light half stayed in the grid
 * under Light, but the card kept showing whichever half the theme in use
 * was -- so on a dark theme, pressing Light left every card dark, and moving
 * through the grid previewed dark themes on the dashboard.
 */
async function openBrowser(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('appearance'); });
    await page.locator('[data-appearance-action="browse-themes"]').first().click();
    await expect(page.locator('[data-theme-card]').first()).toBeAttached();
}

const shownHalves = (page) => page.evaluate(() => {
    const halves = { light: 0, dark: 0 };
    document.querySelectorAll('[data-theme-card]').forEach((card) => {
        const id = card.getAttribute('data-theme-id') || '';
        if (id.endsWith('-light') || id === 'light') halves.light += 1;
        else if (id.endsWith('-dark') || id === 'dark') halves.dark += 1;
    });
    return halves;
});

test.describe('theme browser segments', () => {
    test('Light shows every family in its light half, Dark in its dark half', async ({ page }) => {
        await openBrowser(page);

        await page.locator('[data-theme-segment="light"]').click();
        const light = await shownHalves(page);
        expect(light.light).toBeGreaterThan(50);
        expect(light.dark).toBe(0);

        await page.locator('[data-theme-segment="dark"]').click();
        const dark = await shownHalves(page);
        expect(dark.dark).toBeGreaterThan(50);
        expect(dark.light).toBe(0);

        // And back again: the dark press must not stick once Light is chosen.
        await page.locator('[data-theme-segment="light"]').click();
        expect((await shownHalves(page)).dark).toBe(0);
    });

    test('a card switched by hand under Light keeps the half it was switched to', async ({ page }) => {
        await openBrowser(page);
        await page.locator('[data-theme-segment="light"]').click();

        const card = page.locator('[data-theme-card]').first();
        const family = await card.getAttribute('data-theme-card');
        await card.locator('.theme-browser-variant', { hasText: 'Dark' }).click();

        await expect(page.locator(`[data-theme-card="${family}"]`))
            .toHaveAttribute('data-theme-id', /-dark$|^dark$/);
    });
});
