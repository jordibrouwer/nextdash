// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * The Looks collection: a theme that brings the surface its categories sit on.
 *
 * Magma is drawn on solid cards, Polar on the bare page and Ocean under glass.
 * Picking one in the theme browser puts that theme on the page and turns the
 * categories to its surface, with nothing else changed.
 *
 * Depth is set first, through the app's own settings: at flat depth every
 * theme draws its categories open, and the e2e data may well be flat.
 */
async function openBrowser(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    const before = await page.evaluate(async () => {
        const dash = window.dashboardInstance;
        const kept = { themeDepth: dash.settings.themeDepth, categorySurface: dash.settings.categorySurface };
        Object.assign(dash.settings, { themeDepth: 'rich', categorySurface: 'follow' });
        await dash.saveSettings();
        return kept;
    });
    await page.evaluate(async () => { await (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'); });
    await page.locator('[data-appearance-action="browse-themes"]').first().click();
    await expect(page.locator('[data-theme-card]').first()).toBeAttached();
    await page.waitForFunction(() => Array.isArray(window.CustomThemeIds), null, { timeout: 15_000 });
    return before;
}

/** Put back the two settings the test changed, so the next spec starts where it would have. */
async function restore(page, before) {
    await page.evaluate(async (kept) => {
        const dash = window.dashboardInstance;
        if (!dash) return;
        Object.assign(dash.settings, kept);
        await dash.saveSettings();
    }, before);
}

const LOOKS = [
    { id: 'look-magma-dark', surface: 'card' },
    { id: 'look-ocean-dark', surface: 'glass' },
];

test.describe('looks in the theme browser', () => {
    for (const { id, surface } of LOOKS) {
        test(`${id} goes on the page with its ${surface} surface`, async ({ page }) => {
            const before = await openBrowser(page);
            try {
                // The Looks collection lists it.
                const meta = await page.evaluate(async (theme) =>
                    (await (await fetch('/api/themes/meta')).json()).themes[theme], id);
                expect(meta?.collection).toBe('looks');

                const card = page.locator(`[data-theme-id="${id}"]`).first();
                await card.scrollIntoViewIfNeeded();
                await card.click();

                await expect(page.locator('html')).toHaveAttribute('data-theme', id);
                await expect(page.locator('body')).toHaveAttribute('data-cat-surface', surface);
            } finally {
                await restore(page, before);
            }
        });
    }
});
