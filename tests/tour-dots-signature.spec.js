// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/** Under signature materials the tour dots stay round and their container stays a row. */
test('tour progress dots keep their shape under a signature material', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The tour sheets ride in the lazy views bundle; load it as a view would.
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
    await page.evaluate(() => {
        document.body.setAttribute('data-material-style', 'signature');
        document.body.setAttribute('data-material', 'glass');
        window.KeyboardTutorial.open();
    });
    const dots = page.locator('#app-modal.show .keyboard-tutorial-dot');
    await expect(dots.first()).toBeVisible({ timeout: 15_000 });
    const m = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
        return {
            container: box(document.querySelector('#app-modal.show .keyboard-tutorial-dots')),
            dots: [...document.querySelectorAll('#app-modal.show .keyboard-tutorial-dot')].map(box),
        };
    });
    expect(m.dots.length).toBeGreaterThan(1);
    for (const d of m.dots) expect(d.w).toBeGreaterThanOrEqual(6);
    for (const d of m.dots) expect(Math.abs(d.w - d.h)).toBeLessThanOrEqual(1);
    expect(m.container.w).toBeGreaterThan(m.dots[0].w * 2);
});
