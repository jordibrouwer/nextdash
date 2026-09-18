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

    const missing = await page.evaluate((fields) => fields.filter(
        (field) => !document.querySelector(`[data-reset-field="${field}"]`),
    ), FIELDS);
    expect(missing, `no reset control for: ${missing.join(', ')}`).toEqual([]);
});

test('the reset puts the value back and repaints the page', async ({ page }) => {
    await openAppearance(page);

    // Move all three Surfaces answers away from their defaults. Flat is the
    // default now, so the depth moves the other way.
    await page.locator('[data-appearance-select="themeDepth"]').selectOption('glass');
    await page.locator('[data-appearance-select="glowStrength"]').selectOption('full');
    await page.locator('[data-appearance-select="inkGap"]').selectOption('0.58');
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => document.body.getAttribute('data-depth'))).toBe('glass');
    expect(await page.evaluate(() => document.body.getAttribute('data-glow'))).toBe('full');

    // The ↺ is only offered while there is something to undo.
    const reset = (field) => page.locator(`[data-reset-field="${field}"]`);
    await expect(reset('themeDepth')).toHaveClass(/is-visible/);

    await reset('themeDepth').click();
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-depth')), { timeout: 5_000 }).toBe('flat');

    await reset('glowStrength').click();
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-glow')), { timeout: 5_000 }).toBe('off');

    await reset('inkGap').click();
    await expect.poll(() => page.evaluate(
        () => Number(window.dashboardInstance.settings.inkGap)), { timeout: 5_000 }).toBe(0.44);
});
