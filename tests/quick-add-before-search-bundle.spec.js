// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Adding a bookmark works before the search bundle has landed.
 *
 * The :new form is part of the search stack, which is fetched by the key that
 * opens it -- and the add-bookmark routes are not among those keys. So for the
 * first seconds of a visit on a slow link, the toolbar button and Shift+B
 * found no handler and returned: no form, no message, nothing. The press was
 * not queued either, so it stayed lost after the bundle arrived.
 *
 * These hold the bundle back deliberately, which is the only way to see it --
 * on a warm cache the prefetch wins the race and every route works.
 */

/**
 * Hold the search bundle at the door until the test opens it.
 *
 * A timed delay would be a race of its own -- a busy machine spends it on the
 * onboarding and overlay dismissals and the bundle lands before the assertions
 * start. A gate the test releases is the same slow link without the guesswork.
 *
 * @returns {() => void} releases the request
 */
async function holdBackSearchBundle(page) {
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/static/bundle/search.js*', async (route) => {
        await gate;
        await route.continue();
    });
    return release;
}

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The point of the fixture: the component really is missing at this stage.
    expect(await page.evaluate(() => Boolean(window.dashboardInstance.searchComponent)),
        'the search bundle should still be in flight').toBe(false);
}

test.describe('adding a bookmark before the search bundle lands', () => {
    test('the toolbar button opens the form', async ({ page }) => {
        const release = await holdBackSearchBundle(page);
        await loadDashboard(page);

        // Clicked while the bundle is still held: the press has to survive the
        // wait, which is exactly what it used to fail to do.
        const clicked = page.click('#quick-add-toolbar-btn');
        release();
        await clicked;
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/, { timeout: 15_000 });
    });

    test('Shift+B opens the form', async ({ page }) => {
        const release = await holdBackSearchBundle(page);
        await loadDashboard(page);

        const pressed = page.keyboard.press('Shift+B');
        release();
        await pressed;
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/, { timeout: 15_000 });
    });
});
