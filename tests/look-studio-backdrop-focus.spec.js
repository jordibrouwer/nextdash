// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Picking a backdrop far down the grid in the look studio repaints the tab and fills the grid
 * again after a fetch. The chosen thumbnail keeps the focus and the pane keeps its scroll; before,
 * the focus fell to the body and the pane jumped down to Backdrop settings.
 */
test('a picked backdrop keeps the focus and the scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.keyboard.press('Shift+A');
    await page.click('[data-studio-tab="backdrop"]');
    const pick = page.locator('[data-backdrop-mode="pick"]');
    if ((await pick.getAttribute('aria-pressed')) !== 'true') await pick.click();
    const thumb = page.locator('[data-backdrop-recipe]').nth(30);
    await thumb.scrollIntoViewIfNeeded();
    const name = await thumb.getAttribute('data-backdrop-recipe');
    const pane = page.locator('[data-studio-pane]');
    const before = await pane.evaluate((el) => el.scrollTop);
    await thumb.click();
    await expect(page.locator(`button[data-backdrop-recipe="${name}"]`)).toBeFocused();
    expect(Math.abs((await pane.evaluate((el) => el.scrollTop)) - before)).toBeLessThan(4);
});
