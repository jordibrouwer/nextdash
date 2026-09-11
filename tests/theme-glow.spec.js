// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The glow a theme bleeds around a raised surface.
 *
 * Two things are being pinned here, and they failed for different reasons
 * before. The first is that the glow exists at all on more than a handful of
 * themes: the derivation used to multiply by how dark the page is, so all 109
 * light themes landed on exactly zero. The second is that it reaches the
 * classic layout, where the config view's panels carry no box-shadow of their
 * own and therefore stayed flat no matter which theme was picked.
 *
 * The themes are chosen for what they say, not for their colours: aurora-glass
 * declares a full glow, nordic-frost-light is a quiet light theme that has to
 * derive one, and porcelain-light declares -1 and must stay flat.
 */

/** Pick a theme the way a reader does: through the picker on Appearance. */
async function chooseTheme(page, themeId) {
    await page.locator('[data-theme-picker-button]').click();
    await expect(page.locator('[data-theme-picker-list]')).toBeVisible();
    await page.locator(`[data-theme-option="${themeId}"]`).click();
    await expect(page.locator('[data-theme-picker-list]')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(themeId);
}

async function openAppearance(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-theme-picker-button]')).toBeVisible();
}

/** The glow strength and the geometry the server worked out for this theme. */
const glowTokens = (page) => page.evaluate(() => {
    const styles = getComputedStyle(document.body);
    return {
        glow: Number(styles.getPropertyValue('--theme-surface-glow').trim()),
        lift: styles.getPropertyValue('--theme-glow-lift').trim(),
    };
});

/** What a panel in the config view actually paints. */
const panelShadow = (page) => page.evaluate(() => {
    const panel = document.querySelector('.config-panel');
    return panel ? getComputedStyle(panel).boxShadow : '';
});

test.describe('theme glow', () => {
    let original = null;
    test.beforeEach(async ({ page }) => {
        if (original === null) {
            const res = await page.request.get('/api/settings');
            original = res.ok() ? (await res.json()).theme ?? 'dark' : 'dark';
        }
    });
    test.afterEach(async ({ page }) => {
        if (original !== null) {
            await page.request.post('/api/settings', { data: { theme: original } });
        }
    });

    test('a light theme glows as a shadow and a dark one as a halo', async ({ page }) => {
        await openAppearance(page);

        await chooseTheme(page, 'aurora-glass-dark');
        const dark = await glowTokens(page);
        expect(dark.glow).toBeGreaterThan(0);
        expect(dark.lift).toBe('1');
        const darkShadow = await panelShadow(page);

        await chooseTheme(page, 'nordic-frost-light');
        const light = await glowTokens(page);
        // The whole point of the second branch: a quiet light theme derives a
        // glow of its own rather than being flat by omission.
        expect(light.glow).toBeGreaterThan(0);
        expect(light.lift).toBe('0');
        const lightShadow = await panelShadow(page);

        // Same token, two geometries — a halo sits further out than a shadow.
        expect(darkShadow).toContain('10px');
        expect(lightShadow).toContain('6px');
        expect(darkShadow).not.toBe(lightShadow);
    });

    test('a theme that asked for no glow paints none', async ({ page }) => {
        await openAppearance(page);
        await chooseTheme(page, 'porcelain-light');

        expect((await glowTokens(page)).glow).toBe(0);
        // Zero strength leaves the colour fully transparent, which is the
        // property that lets this layer ship without changing such a theme.
        const shadow = await panelShadow(page);
        expect(shadow === 'none' || /rgba?\([^)]*,\s*0\)|\/\s*0\)/.test(shadow)).toBe(true);
    });

    test('the classic layout gets the glow the config view used to miss', async ({ page }) => {
        await openAppearance(page);
        await chooseTheme(page, 'aurora-glass-dark');

        // Classic is where the default sits, and where --layout-shadow-* never
        // resolves: every consumer of it is scoped to the modern layout.
        expect(await page.evaluate(() => document.body.getAttribute('data-layout-version'))).not.toBe('modern');
        const shadow = await panelShadow(page);
        expect(shadow).not.toBe('none');
        expect(shadow).not.toBe('');
    });

    test('flat means flat', async ({ page }) => {
        await openAppearance(page);
        await chooseTheme(page, 'aurora-glass-dark');
        expect(await panelShadow(page)).not.toBe('none');

        const depth = page.locator('[data-appearance-select="themeDepth"]');
        const previous = await depth.inputValue();
        await depth.selectOption('flat');
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-depth'))).toBe('flat');

        // A reader who asked for flat asked for no layers, glow included.
        await expect.poll(() => panelShadow(page)).toBe('none');

        await depth.selectOption(previous);
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-depth'))).toBe(previous);
    });
});
