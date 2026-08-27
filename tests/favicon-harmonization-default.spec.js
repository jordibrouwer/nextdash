// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Favicon harmonisation is on unless a theme says otherwise.
 *
 * It is stored per *displayed* theme id, and the fresh-install defaults can
 * only name the couple of ids that install starts on. There are over two
 * hundred themes, so reading an absent entry as "off" meant the feature was on
 * for Retro CRT and silently off everywhere else: choosing a theme in setup —
 * the first thing a new install invites you to do — turned it off without any
 * switch being moved, and nothing on screen said so.
 *
 * Driven through the theme picker rather than by writing settings, because the
 * bug was only reachable that way: the entry for the newly chosen theme is
 * never written, so a test that seeds one tests the case that already worked.
 */

/** Load the dashboard and wait until the instance is ready to be driven. */
async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** How many elements are currently harmonised, and what the theme stored. */
function readState(page) {
    return page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        themed: document.querySelectorAll('.icon-themed').length,
        entry: window.dashboardInstance.settings.themeIconStyling?.[
            document.documentElement.getAttribute('data-theme')
        ] ?? null,
    }));
}

/** Choose a theme from the picker, the way the appearance panel offers it. */
async function pickTheme(page, themeId) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.locator('.config-theme-picker-button').click();
    await page.locator(`[data-theme-option="${themeId}"]`).click();
    await expect.poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        { timeout: 10_000 }).toBe(themeId);
}

test.describe('favicon harmonisation defaults to on', () => {
    test('a theme that was never configured still harmonises', async ({ page }) => {
        await loadDashboard(page);

        const before = await readState(page);
        expect(before.themed).toBeGreaterThan(0);

        await pickTheme(page, 'absinthe-dark');
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.config-layout')).toHaveCount(0);

        const after = await readState(page);
        // No entry was written for this theme — that is the whole point.
        expect(after.entry).toBeNull();
        expect(after.themed).toBeGreaterThan(0);
    });

    test('and the toggle says so, rather than reading off', async ({ page }) => {
        await loadDashboard(page);
        await pickTheme(page, 'absinthe-dark');

        await expect(page.locator('[data-appearance-toggle-icons="on"]'))
            .toHaveAttribute('aria-pressed', 'true');
    });

    test('switching it off is still an off, and survives a reload', async ({ page }) => {
        await loadDashboard(page);
        await pickTheme(page, 'absinthe-dark');

        await page.locator('[data-appearance-toggle-icons="off"]').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.config-layout')).toHaveCount(0);

        await expect.poll(() => readState(page).then((s) => s.themed), { timeout: 10_000 }).toBe(0);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        const after = await readState(page);
        expect(after.entry?.enabled).toBe(false);
        expect(after.themed).toBe(0);
    });
});
