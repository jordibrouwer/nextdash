// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Changing a setting does not move the page.
 *
 * A setting saves, and the panel that holds it is drawn again. For a moment
 * the page was shorter, or the focus went back to the control with the browser
 * scrolling to it, and a reader who had scrolled down was carried up the page
 * after the click. The position is held, whichever tab the setting is on.
 *
 * The one-time setting popovers are left as they are on purpose: a popover
 * that has not been dismissed used to take the page to its setting again after
 * every change, and that is one of the two things this pins.
 */
async function openConfig(page, hash) {
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => document.getElementById('config-view-body'), null, { timeout: 15_000 });
    // Arriving on a section may take the page to a one-time setting popover,
    // half a second after it is drawn. That is wanted; the change comes after it.
    // Pacing for that arrival, not a condition: there is nothing to wait for when
    // the section has no popover.
    await page.waitForTimeout(1500);
}

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

/** Scroll to the very end, change the setting, wait for the save and the repaint. */
async function changeAtTheBottom(page, selector) {
    // A window short enough that the page scrolls at all, or the test proves nothing.
    await page.setViewportSize({ width: 1280, height: 520 });
    const control = page.locator(selector).first();
    await expect(control).toBeAttached();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(100);
    const before = await scrollY(page);
    await control.evaluate((el) => el.click());
    await expect(page.locator('.config-save-state.is-saved').first()).toBeAttached({ timeout: 10_000 });
    // The repaint and its two frames.
    await page.waitForTimeout(400);
    return { before, after: await scrollY(page) };
}

test('turning animations off on General leaves the page where it was', async ({ page }) => {
    await openConfig(page, '#config/appearance/general');
    const { before, after } = await changeAtTheBottom(page, '[data-appearance-toggle="animationsEnabled"]');
    expect(after).toBe(before);
});

test('a row status chip on Rows leaves the page where it was', async ({ page }) => {
    await openConfig(page, '#config/appearance/display');
    await page.locator('button:has-text("Bookmark display")').first().click();
    const { before, after } = await changeAtTheBottom(page, '[data-behavior-field="showPing"]');
    expect(after).toBe(before);
});

test('a news setting on Watch feeds → Settings leaves the page where it was', async ({ page }) => {
    await openConfig(page, '#config/feed-watch/settings');
    const { before, after } = await changeAtTheBottom(page, '[data-behavior-field="showFeedWatchIcon"]');
    expect(after).toBe(before);
});
