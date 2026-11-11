// @ts-check
const { test, expect } = require('./fixtures');
const {
    WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
} = require('./e2e-helpers');

const THEMES = [
    'legible-high-contrast-calm-dark', 'legible-high-contrast-calm-light',
    'legible-low-vision-amber-dark', 'legible-low-vision-amber-light',
    'legible-colour-blind-safe-dark', 'legible-colour-blind-safe-light',
];

/**
 * Three promises of the group, measured on the real dashboard: a row is a
 * 44px target, the keyboard row wears a thick ring, and nothing moves.
 */
test.describe('legible theme group', () => {
    for (const theme of THEMES) {
        test(`${theme}: target, ring and stillness`, async ({ page }) => {
            const res = await page.request.post('/api/settings', {
                data: { theme }, headers: { 'X-NextDash-Token': WRITE_TOKEN },
            });
            expect(res.ok()).toBeTruthy();
            await markWhatsNewSeen(page);
            await page.goto('/');
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            await dismissOnboardingIfPresent(page);
            await dismissBlockingOverlays(page);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

            // The recipe is the theme's own (not a reader's pick), so it shows as
            // the drawn SVG on the layer rather than as a recipe attribute.
            const layer = await page.locator('.theme-backdrop-layer').evaluate((e) => {
                const cs = getComputedStyle(e);
                return { display: cs.display, image: cs.backgroundImage };
            });
            expect(layer.display).not.toBe('none');
            expect(layer.image).toContain('svg+xml');

            // A widget is the same card as a category: surface, border, radius and depth.
            const card = (sel) => page.locator(sel).first().evaluate((e) => {
                const cs = getComputedStyle(e);
                return [cs.backgroundColor, cs.borderTopWidth, cs.borderTopColor, cs.borderTopLeftRadius, cs.boxShadow];
            });
            expect(await card('.category.dashboard-widget')).toEqual(await card('.category:not(.dashboard-widget)'));

            const rows = page.locator('.bookmark-link');
            await expect(rows.first()).toBeVisible();

            const heights = await rows.evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
            expect(heights.length).toBeGreaterThan(0);
            expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);

            await page.evaluate(() => {
                const kn = window.dashboardInstance.keyboardNavigation;
                kn.updateNavigableElements();
                kn.currentIndex = 0;
                kn.highlightCurrentElement({ keyboardNav: true });
            });
            const selected = page.locator('.bookmark-link.keyboard-selected').first();
            await expect(selected).toBeVisible();
            const ring = await selected.evaluate((e) => {
                const cs = getComputedStyle(e);
                return { width: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
            });
            expect(ring.style).not.toBe('none');
            expect(ring.width).toBeGreaterThanOrEqual(3);

            const motion = await rows.first().evaluate((e) => {
                const cs = getComputedStyle(e);
                const secs = (v) => v.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1));
                return {
                    transition: Math.max(...secs(cs.transitionDuration)),
                    animation: Math.max(...secs(cs.animationDuration)),
                };
            });
            expect(motion.transition).toBe(0);
            expect(motion.animation).toBeLessThanOrEqual(0.001);
        });
    }
});
