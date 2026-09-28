// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A new bookmark starts on the availability mode Config → Bookmarks → Settings
 * names for it — Periodic unless the reader chose otherwise.
 *
 * The setting said so ("what a bookmark added with & or + starts out as"), but
 * the + form preselected Off whatever it held; only & followed it.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openNewBookmarkForm(page) {
    await page.evaluate(async () => {
        await window.SearchLoader?.ensureReady?.();
        window.dashboardInstance.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
    });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
}

const checkedMode = (page) => page.locator('#bookmark-form-modal .bookmark-inline-checkmode-input:checked');

test.describe('the new bookmark form: availability', () => {
    test('a fresh install starts a new bookmark on Periodic', async ({ page }) => {
        await loadDashboard(page);
        expect(await page.evaluate(() => window.dashboardInstance.settings.newBookmarkCheckMode)).toBe('periodic');
        await openNewBookmarkForm(page);
        await expect(checkedMode(page)).toHaveValue('periodic');
    });

    test('the form follows the setting, whichever it is', async ({ page }) => {
        await loadDashboard(page);
        for (const mode of ['off', 'monitor', 'periodic']) {
            await page.evaluate((m) => { window.dashboardInstance.settings.newBookmarkCheckMode = m; }, mode);
            await openNewBookmarkForm(page);
            await expect(checkedMode(page)).toHaveValue(mode);
            await page.keyboard.press('Escape');
            await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
        }
    });
});
