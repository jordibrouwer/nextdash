// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config's section rail sticks below the section band, not under it.
 *
 * The band (.config-view-head, an .lvs-header) is sticky at the top of the
 * page, and the rail is sticky beside the panel. The rail used a flat 8px
 * offset from when config had no sticky band, so once the page scrolled the
 * band covered the rail's heading and half of "Overview", at every scroll
 * position. The band's height changes with its wrapped description, so the
 * check runs at two widths.
 */

const railClearsBand = (page) => page.evaluate(() => {
    const head = document.querySelector('.config-view-head')?.getBoundingClientRect();
    const rail = document.querySelector('.config-nav-column')?.getBoundingClientRect();
    if (!head || !rail) return null;
    return Math.round(rail.top - head.bottom);
});

for (const width of [1440, 800]) {
    test(`the rail stays below the sticky band when Behavior is scrolled at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await page.locator('a[href="/#config"]').first().click();
        await page.getByRole('tab', { name: 'Behavior' }).click();
        await expect(page).toHaveURL(/#config\/behavior/);

        await page.mouse.move(width / 2, 500);
        await page.mouse.wheel(0, 3000);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

        await expect.poll(() => railClearsBand(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
    });
}
