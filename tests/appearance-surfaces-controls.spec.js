// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Appearance → Theme, drawn as one kind of control.
 *
 * Text contrast was a slider where its two neighbours are dropdowns — and a
 * slider over twenty-nine steps for a question with four answers. It is a
 * select now, on the same line as Depth and Glow, carrying the four words
 * inkGapLabelFor already used.
 *
 * And every setting on the page can be put back: the five under Surfaces and
 * Backdrop had no default recorded, so renderFieldAffordances drew no ↺ for
 * them at all.
 */
async function openAppearance(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.waitForTimeout(300);
}

const FIELDS = ['theme', 'autoDarkMode', 'randomThemeMode', 'themeDepth', 'glowStrength',
    'inkGap', 'themeBackdrop', 'backgroundPattern'];

test('text contrast is a dropdown, like the two above it', async ({ page }) => {
    await openAppearance(page);

    const select = page.locator('[data-appearance-select="inkGap"]');
    await expect(select).toBeVisible();
    await expect(page.locator('[data-appearance-range="inkGap"]'), 'the slider is still there')
        .toHaveCount(0);

    // Four answers, in the words the slider's read-out used.
    const options = await select.locator('option').allTextContents();
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.trim())).toEqual(['Soft', 'Normal', 'High', 'Maximum']);

    // And it is drawn like Depth and Glow: same class, same panel.
    const shape = await page.evaluate(() => {
        const box = (sel) => {
            const el = document.querySelector(sel);
            const r = el.getBoundingClientRect();
            return { className: el.className, x: Math.round(r.x), width: Math.round(r.width) };
        };
        return {
            depth: box('[data-appearance-select="themeDepth"]'),
            glow: box('[data-appearance-select="glowStrength"]'),
            ink: box('[data-appearance-select="inkGap"]'),
        };
    });
    expect(shape.ink.className).toBe(shape.depth.className);
    expect(shape.ink.x, 'the three controls do not line up').toBe(shape.depth.x);
    expect(shape.glow.x).toBe(shape.depth.x);
});

test('choosing a contrast applies it and it sticks', async ({ page }) => {
    await openAppearance(page);

    await page.locator('[data-appearance-select="inkGap"]').selectOption('0.34');
    await expect.poll(() => page.evaluate(
        () => Number(window.dashboardInstance.settings.inkGap)), { timeout: 5_000 }).toBe(0.34);
    // Written onto the body as the custom property the ink derives from.
    expect(await page.evaluate(
        () => document.body.style.getPropertyValue('--ink-gap-3').trim())).toBe('0.34');

    await page.reload();
    // Config reopens where it was left, so the grid is not what comes back.
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    // Polled: the dashboard object is built after the markup it is measured on.
    await expect.poll(() => page.evaluate(
        () => Number(window.dashboardInstance?.settings?.inkGap ?? -1),
    ), { timeout: 10_000 }).toBe(0.34);
});

test('every setting on the page carries a way back to its default', async ({ page }) => {
    await openAppearance(page);

    /*
     * Two kinds of way back, because there are two kinds of answer.
     *
     * Text contrast is the install's and carries the ↺. Depth, Glow and
     * Effects belong to the theme on screen until "Every theme" is ticked, so
     * theirs is the panel's own button -- one reset for the three of them,
     * because they are one answer about one theme.
     */
    const perTheme = ['themeDepth', 'glowStrength', 'themeEffects'];
    const installWide = FIELDS.filter((f) => !perTheme.includes(f));

    const missing = await page.evaluate((fields) => fields.filter(
        (field) => !document.querySelector(`[data-reset-field="${field}"]`),
    ), installWide);
    expect(missing, `no reset control for: ${missing.join(', ')}`).toEqual([]);

    await expect(page.locator('[data-appearance-action="reset-theme-surfaces"]'),
        'the three that belong to the theme have no reset').toHaveCount(1);

    // One button, not one per setting and not a second one beside the ↺: the
    // three are one answer about one theme.
    await expect.poll(() => page.evaluate((fields) => fields.filter(
        (field) => document.querySelector(`[data-reset-field="${field}"]`),
    ), perTheme), { message: 'the three carry a ↺ as well as the button' }).toEqual([]);
});

test('the reset puts the value back and repaints the page', async ({ page }) => {
    await openAppearance(page);

    /*
     * The ↺ is the installation default's reset, so this is about the mode
     * where the three Surfaces answers are the installation's.
     *
     * With "Every theme" off they belong to the theme on screen, the setting
     * stays on "follow" whatever is picked, and the reset that applies is the
     * panel's own button rather than the ↺ — which is why this ticks the box
     * first. The per-theme reset has its own test in theme-archetypes.spec.js.
     */
    await page.locator('[data-appearance-select="themeDepth"]').selectOption('flat');
    await page.locator('[data-appearance-select="glowStrength"]').selectOption('full');
    await page.locator('[data-appearance-select="inkGap"]').selectOption('0.58');
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => document.body.getAttribute('data-depth'))).toBe('flat');
    expect(await page.evaluate(() => document.body.getAttribute('data-glow'))).toBe('full');

    // The one button puts all three back to what the theme asks for.
    await page.locator('[data-appearance-action="reset-theme-surfaces"]').click();
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-depth')), { timeout: 5_000 }).not.toBe('flat');
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-glow')), { timeout: 5_000 }).not.toBe('full');

    // Text contrast is the install's own answer and keeps its ↺.
    const reset = (field) => page.locator(`[data-reset-field="${field}"]`);
    await expect(reset('inkGap')).toHaveClass(/is-visible/);
    await reset('inkGap').click();
    await expect.poll(() => page.evaluate(
        () => Number(window.dashboardInstance.settings.inkGap)), { timeout: 5_000 }).toBe(0.44);
});
