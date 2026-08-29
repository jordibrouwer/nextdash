// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Previewing a theme has to show the backdrop it comes with.
 *
 * The texture behind the bookmarks is part of a theme's character, and
 * theme-depth.css picks its *shape* -- scanlines, grid, hatch, dots -- with
 * rules that select on html[data-theme="…"]. previewThemeColors wrote the
 * candidate's colours under the *active* theme's selector and left the
 * attribute alone, so a preview showed the new palette wearing the old
 * theme's texture: a combination that matches no theme at all.
 */
async function openAppearance(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('config');
}

/** The pattern with its colours stripped, so only the shape is compared. */
const shapeOf = (page) => page.evaluate(() => getComputedStyle(document.body)
    .getPropertyValue('--theme-pattern-image')
    .replace(/#[0-9a-f]{3,8}|color-mix\([^)]*\)|rgba?\([^)]*\)/gi, 'C')
    .replace(/\s+/g, ' ')
    .trim());

const preview = (page, id) => page.evaluate((theme) => {
    const cfg = window.dashboardInstance.config.instance || window.dashboardInstance.config;
    cfg.previewThemeChoice(theme);
}, id);

test('previewing a theme shows that theme’s backdrop', async ({ page }) => {
    await openAppearance(page);

    // Two themes from different pattern families, so the shapes genuinely
    // differ: retro-crt draws scanlines (one linear-gradient), sumi-ink draws
    // a 45-degree hatch (a repeating-linear-gradient). Picking two themes from
    // the same family would compare a shape against itself and pass on the bug.
    await preview(page, 'retro-crt-dark');
    const scanlines = await shapeOf(page);
    await preview(page, 'sumi-ink-dark');
    const hatch = await shapeOf(page);

    expect(scanlines, 'the scanline theme drew no pattern at all').not.toBe('');
    expect(scanlines, 'retro-crt did not draw the scanlines it is defined with')
        .toContain('linear-gradient');
    expect(hatch, 'the backdrop kept the shape of the previously active theme')
        .not.toBe(scanlines);
    expect(hatch, 'the hatch theme did not draw a hatch').toContain('repeating-linear-gradient');
});

test('leaving the picker puts the original backdrop back', async ({ page }) => {
    await openAppearance(page);

    const before = { theme: await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        shape: await shapeOf(page) };

    await preview(page, 'neon-grid-dark');
    await preview(page, 'retro-crt-light');
    await page.evaluate(() => {
        const cfg = window.dashboardInstance.config.instance || window.dashboardInstance.config;
        cfg.revertThemePreview();
    });

    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(before.theme);
    expect(await shapeOf(page), 'the backdrop did not return to the applied theme')
        .toBe(before.shape);
});

test('a random theme still brings its own backdrop', async ({ page }) => {
    await openAppearance(page);

    // Not broken today -- random goes through applyTheme, which really does
    // swap the attribute. Pinned so the preview fix cannot regress it.
    const seen = new Set();
    for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() => {
            const settings = window.dashboardInstance.settings;
            const next = window.ThemeLoader.rotateSessionRandomTheme(settings);
            window.ThemeLoader.applyTheme(next, window.ThemeLoader.getFontSize?.(settings));
        });
        seen.add(await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    }
    expect(seen.size, 'rotating never changed the theme').toBeGreaterThan(1);
});
