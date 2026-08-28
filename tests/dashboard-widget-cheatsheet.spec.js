// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The keys a widget answers to are written down.
 *
 * They are the grid's own keys and a category header's — that is the point of
 * them — but a reader wondering how to get into a tile will not go looking under
 * bookmark actions. The cheat sheet behind `!` gets a block of its own, in the
 * language the reader is in.
 */
test.describe('the cheat sheet covers widgets', () => {
    test('has a section of its own, with the keys that act on a widget', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await page.keyboard.press('!');
        const sheet = page.locator('.keyboard-cheat-sheet');
        await expect(sheet).toBeVisible({ timeout: 15_000 });

        // textContent, not innerText: the sheet keeps the groups outside the
        // current context collapsed, and a closed <details> renders only its
        // summary — the rows are in the document either way.
        const text = await sheet.evaluate((el) => el.textContent.replace(/\s+/g, ' '));
        expect(text).toContain('Widgets on the page');
        // The four that are a widget's own rather than a bookmark's.
        expect(text).toContain('F2 on widget');
        expect(text).toContain('Shift+W on widget');
        expect(text).toContain('Delete on widget');
        expect(text).toContain('Shift+F10 on row');
    });

    test('reads in Dutch when the dashboard does', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const dutch = await page.evaluate(async () => {
            await window.dashboardInstance.language.loadTranslations('nl');
            const t = (key) => window.dashboardInstance.language.t(`dashboard.cheatsheet.${key}`);
            return { section: t('sectionWidgets'), close: t('wgClose') };
        });
        expect(dutch.section).toBe('Widgets op de pagina');
        expect(dutch.close).toContain('Config → Widgets');
    });
});
