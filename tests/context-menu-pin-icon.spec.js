// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * One emoji in a column of theme-coloured marks.
 *
 * Every context-menu entry is a glyph tinted with the accent colour — ⧉ for
 * copy, ✎ for edit, → for move — except Pin, which was 📌: painted by the
 * system font in its own red and yellow, on every theme, and deaf to the red a
 * destructive row is given. It is drawn now, in `currentColor`.
 */

async function openRowMenu(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.locator('.bookmark-link .bookmark-open').first().click({ button: 'right' });
    await expect(page.locator('#bookmark-context-menu')).toBeVisible({ timeout: 10_000 });
}

test.describe('the pin entry is drawn, not typed', () => {
    test('the grid menu carries an svg and no emoji', async ({ page }) => {
        await openRowMenu(page);
        const menu = page.locator('#bookmark-context-menu');
        const pin = menu.locator('[data-action="pin"]');
        await expect(pin).toBeVisible();
        await expect(pin.locator('.move-popover-check svg')).toHaveCount(1);
        await expect(menu).not.toContainText('📌');

        // Drawn in the same colour as the glyphs beside it, which is the whole
        // point: an emoji ignored the theme.
        const colours = await menu.evaluate((el) => {
            const slot = (action) => el.querySelector(`[data-action="${action}"] .move-popover-check`);
            const read = (node) => (node ? getComputedStyle(node).color : null);
            return { pin: read(slot('pin')), copy: read(slot('copy-url')) };
        });
        expect(colours.pin).toBe(colours.copy);
    });

    test('the config list menu draws it too', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });

        await page.locator('#config-bm-list .config-bm-row').first().click({ button: 'right' });
        const menu = page.locator('.move-popover[role="menu"], #config-bm-context-menu').first();
        await expect(menu).toBeVisible({ timeout: 10_000 });
        await expect(menu.locator('[data-action="pin"] .move-popover-check svg')).toHaveCount(1);
        await expect(menu).not.toContainText('📌');
    });
});
