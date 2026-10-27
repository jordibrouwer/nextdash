// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/** Config -> Monitoring must not scroll sideways on a phone-width viewport. */
test('monitoring tab does not overflow horizontally at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('monitoring'); });
    // Layout settles after the section opens; there is no event for it.
    await page.waitForTimeout(500);

    const measure = () => page.evaluate(() => {
        const d = document.documentElement;
        const offenders = [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().right > 361 && el.getClientRects().length)
            .slice(0, 5).map((el) => el.tagName + '.' + String(el.className).slice(0, 60));
        return { sw: d.scrollWidth, cw: d.clientWidth, offenders };
    });
    const check = async (label) => {
        const m = await measure();
        expect(m.sw, `${label}: ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.cw);
    };
    await check('monitoring');

    const tabs = page.locator('.config-subtab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
        const t = tabs.nth(i);
        if (!(await t.isVisible())) continue;
        await t.click().catch(() => {});
        // Layout settles after a sub-tab opens; there is no event for it.
        await page.waitForTimeout(200);
        await check('subtab ' + i);
    }
});
