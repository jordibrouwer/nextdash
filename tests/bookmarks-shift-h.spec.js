// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Shift+H opens the Bookmarks view the way its header button does: the whole
 * list, no Health filter and nothing selected. It used to land on the Broken
 * filter, the old Health view's front page, so the key and the button opened
 * two different things.
 */
test('Shift+H opens the whole Bookmarks list, as the header button does', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.keyboard.press('Shift+H');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });

    const state = await page.evaluate(() => ({
        hash: window.location.hash,
        selected: document.querySelectorAll('#config-bm-list .config-bm-row.is-selected, #config-bm-list .config-bm-row[aria-selected="true"]').length,
    }));
    expect(state.hash).not.toMatch(/health=/);
    expect(state.selected).toBe(0);
});
