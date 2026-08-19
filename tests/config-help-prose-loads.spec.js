// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Help's prose is a locale scope of its own, and a panel whose text did not
 * arrive is a heading with nothing under it.
 *
 * Two ways in: the scoped fetch fails, or it lands and is then overwritten by a
 * core locale load finishing later — a reload onto a #config/help link, or a
 * settings sync while config is open. Both left the reader on a page of empty
 * panels for as long as the view stayed open, because switching help tabs
 * repaints from the same empty bundle.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const prose = (page) => page.locator('#config-help-body .config-help-prose').first();

test.describe('the help prose is there, or it is fetched again', () => {
    test('prose that went missing comes back without leaving the view', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
        await expect(prose(page)).not.toHaveText('', { timeout: 15_000 });

        // The end state both races leave behind: the scope is gone from the
        // bundle while help is on screen.
        await page.evaluate(() => {
            const config = window.dashboardInstance.language.translations.config;
            Object.keys(config)
                .filter((k) => k.startsWith('help') && k.endsWith('Body'))
                .forEach((k) => delete config[k]);
            window.dashboardInstance.language._helpLoadedFor = null;
        });

        // A reader does what a reader does: clicks another tab. That must be
        // enough — reopening config was never something they would think of.
        await page.click('[data-help-tab="config"]');
        await expect(prose(page)).not.toHaveText('', { timeout: 15_000 });
        await expect(prose(page)).not.toContainText('config.help');
    });

    test('a core locale load does not wipe the prose under an open help page', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
        await expect(prose(page)).not.toHaveText('', { timeout: 15_000 });

        // What a settings sync does while config is open: the whole bundle is
        // replaced by the core scope, which does not carry help.
        const kept = await page.evaluate(async () => {
            const lang = window.dashboardInstance.language;
            await lang.loadTranslations(lang.currentLanguage);
            return typeof lang.translations.config.helpStartBody === 'string';
        });
        expect(kept, 'the core load dropped the help scope').toBe(true);
    });
});
