// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Reset all in the look studio: every look answer back to a fresh install's,
 * for every theme at once, so a look applied earlier cannot follow the reader
 * from theme to theme. The Layout tab (type and grid) is left alone. Like
 * every other control in the studio it is live at once and only stored on
 * Apply.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
}

const studio = (page) => page.locator('[data-look-studio]');

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(studio(page)).toBeVisible({ timeout: 15_000 });
}

const apply = async (page) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await expect(studio(page)).toHaveCount(0);
};

const stored = (page) => page.evaluate(async () => {
    const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    return (await api('/api/settings')).json();
});

const bodyAttr = (page, name) => page.evaluate((n) => document.body.getAttribute(n), name);

async function pickTheme(page, id) {
    await page.locator('[data-studio-tab="themes"]').click();
    const card = page.locator(`[data-theme-card][data-theme-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.settings?.theme)).toBe(id);
}

async function useLook(page, id) {
    await page.locator('[data-studio-tab="looks"]').click();
    await page.locator(`[data-studio-use-look="${id}"]`).click();
}

const FIRST = 'moss-stone-dark';
const SECOND = 'marigold-dusk-dark';

test.describe('Reset all in the look studio', () => {
    test.describe.configure({ mode: 'serial' });

    test('puts every theme back to the defaults, leaves Layout, and only stores on Apply', async ({ page }) => {
        await openDashboard(page);
        const before = await stored(page);

        // A look on two themes, each stored for that theme alone.
        await openStudio(page);
        await pickTheme(page, FIRST);
        await useLook(page, 'glass-boxed');
        await pickTheme(page, SECOND);
        await useLook(page, 'terminal');
        await apply(page);
        await expect.poll(async () => Object.keys((await stored(page)).themeSurfacePrefs || {}).sort())
            .toEqual([SECOND, FIRST].sort());
        const fontAfterLook = (await stored(page)).fontPreset;

        // Cancel after Reset all stores nothing.
        await openStudio(page);
        await page.locator('[data-studio-reset-all]').click();
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).not.toBe('label');
        await page.locator('[data-studio-cancel]').click();
        await expect(studio(page)).toHaveCount(0);
        expect((await stored(page)).categoryHeaderStyle).toBe('label');
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe('label');

        // Reset all, Apply: the defaults, for every theme.
        await openStudio(page);
        await page.locator('[data-studio-reset-all]').click();
        await apply(page);
        const reset = await stored(page);
        expect(reset.themeSurfacePrefs || {}).toEqual({});
        expect(reset.cardGlass || {}).toEqual({});
        expect(reset.themeSurfacesForceAll || false).toBe(false);
        expect(reset.themeBackdrop).toBe('follow');
        expect(reset.themeDepth).toBe('follow');
        expect(reset.glowStrength).toBe('follow');
        expect(reset.themeEffects).toBe('follow');
        expect(reset.backgroundPattern).toBe('auto');
        expect(reset.backdropTuning).toEqual({ strength: 1, scale: 1, seed: 0, blur: 0, brightness: 1, saturate: 1, tint: 0 });
        expect(reset.categoryHeaderStyle).toBe('theme');
        expect(reset.categoryHeaderSize).toBe('m');
        expect(reset.showCategoryIcon).toBe(true);
        expect(reset.showCategoryCount).toBe(false);
        expect(reset.categoryHeaderAccentLine).toBe(false);
        expect(reset.headerButtonStyle).toBe('plain');
        expect(reset.pageSwitcherStyle).toBe('classic');
        // Layout is not part of it: the look's font stays.
        expect(reset.fontPreset).toBe(fontAfterLook);
        expect(reset.theme).toBe(SECOND);

        // The other theme, picked afterwards, follows the theme as well.
        await openStudio(page);
        await pickTheme(page, FIRST);
        await apply(page);
        const picked = await stored(page);
        expect(picked.theme).toBe(FIRST);
        expect(picked.themeSurfacePrefs || {}).toEqual({});
        expect(picked.categoryHeaderStyle).toBe('theme');

        // Put back what this moved, for the specs after it.
        await page.evaluate(async (prev) => {
            const d = window.dashboardInstance;
            const empty = { themeSurfacePrefs: {}, cardGlass: {}, themeBackdrop: 'follow', themeDepth: 'follow',
                glowStrength: 'follow', themeEffects: 'follow', themeSurfacesForceAll: false,
                fontPreset: 'source-code-pro', densityMode: 'comfortable', categorySpacing: 'balanced' };
            ['theme', 'categoryHeaderStyle', 'categoryHeaderSize', 'showCategoryIcon', 'showCategoryCount',
                'categoryHeaderAccentLine', 'headerButtonStyle', 'pageSwitcherStyle', 'themeSurfacePrefs',
                'themeSurfacesForceAll', 'backdropTuning', 'backgroundPattern', 'themeBackdrop', 'cardGlass',
                'themeDepth', 'glowStrength', 'themeEffects', 'fontPreset', 'densityMode', 'categorySpacing']
                .forEach((key) => {
                    if (prev[key] !== undefined) d.settings[key] = prev[key];
                    else if (key in empty) d.settings[key] = empty[key];
                    else delete d.settings[key];
                });
            await d.saveSettings();
        }, before);
    });
});
