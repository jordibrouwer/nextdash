// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The drawings that came with the theme engine and the widgets.
 *
 * Depth and backdrop keep their drop-downs — the drawn choices they briefly had
 * were not an improvement and went back. The drawings live where a shape is
 * genuinely the subject and there is no control to replace: the width a widget
 * takes beside its neighbours, and the opening illustrations on the Help topics
 * this release added.
 */
async function openConfig(page, run) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(run);
}

test.describe('the v1.4.0 setting drawings', () => {
    test('depth and backdrop are drop-downs', async ({ page }) => {
        await openConfig(page, () => {
            const c = window.dashboardInstance.config;
            c.openConfigView('appearance');
            c.switchAppearanceTab?.('theme');
        });
        await expect(page.locator('[data-appearance-select="themeDepth"]')).toHaveCount(1);
        await expect(page.locator('[data-appearance-select="backgroundPattern"]')).toHaveCount(1);
        // Every option is in the list, which is what a select is for.
        const depths = await page.locator('[data-appearance-select="themeDepth"] option')
            .evaluateAll((els) => els.map((e) => e.value));
        expect(depths).toEqual(['flat', 'soft', 'rich']);
        const backdrops = await page.locator('[data-appearance-select="backgroundPattern"] option')
            .evaluateAll((els) => els.map((e) => e.value));
        expect(backdrops).toEqual(['auto', 'dots', 'grid', 'lines', 'hatch', 'none']);
    });

    /*
     * The Help topics this release added open with a drawing.
     *
     * Help is prose, and these four are about shapes and routes: a block beside
     * its neighbours, a service that previews before it writes, a copy made
     * before the page dies, an event leaving the install. A paragraph about a
     * shape is read twice — once to decode, once to picture.
     */
    test('the new help topics open with their drawing', async ({ page }) => {
        for (const [tab, selector] of [
            ['config', '.config-help-art .setting-art-themes'],
            ['organizing', '.config-help-art .setting-art-blocks'],
            ['data', '.config-help-art .setting-art-boundary'],
        ]) {
            await openConfig(page, () => {});
            await page.evaluate((t) => {
                const c = window.dashboardInstance.config;
                c.helpTab = t;
                c.openConfigView('help');
                c.render();
            }, tab);
            await expect(page.locator(selector).first()).toBeAttached({ timeout: 10_000 });
        }
    });

    test('a widget names its width and draws it', async ({ page }) => {
        await openConfig(page, () => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(800);
        const drawn = await page.evaluate(() =>
            typeof window.SettingArt?.render === 'function'
            && /setting-art-block/.test(window.SettingArt.render('widgetSpan', 2) || ''));
        expect(drawn).toBe(true);
    });

    // Decorative by construction: the label beside each drawing already says it
    // in words, so a screen reader should hear the setting once, not twice.
    test('the drawings are out of the accessibility tree', async ({ page }) => {
        await openConfig(page, () => {
            const c = window.dashboardInstance.config;
            c.helpTab = 'config';
            c.openConfigView('help');
            c.render();
        });
        await page.waitForTimeout(600);
        const hidden = await page.evaluate(() =>
            [...document.querySelectorAll('.setting-art')].every((el) => el.getAttribute('aria-hidden') === 'true'));
        expect(hidden).toBe(true);
    });
});
