// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A key in a promo looks like a key.
 *
 * A promo that names keystrokes writes them as <kbd> the way every other key
 * in the app is written. The settings-search promo that did is gone, so this
 * registers one of its own with the same kind of copy. The body was
 * escaped, so what arrived on screen was the literal text "<kbd>Ctrl+Shift+K</kbd>"
 * in the middle of a sentence -- in a popover whose whole job is to teach a
 * shortcut.
 *
 * Opted in for the body alone, the same way the session tip and
 * AppNotification already do it: the string comes from the locale files and
 * never from a bookmark or anything else a reader typed. The title, the badge
 * and the button stay escaped -- they carry no markup to begin with.
 */

const PROMO = 'test-kbd-promo';
const BODY = 'Press <kbd>Ctrl+Shift+K</kbd> (<kbd>Cmd+Shift+K</kbd> on Mac). <kbd>Ctrl+K</kbd> opens quick actions only.';

async function raisePromo(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.config != null, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.waitForSelector('[data-config-setting-promo-anchor="settingsJump"]', { timeout: 20_000 });

    // A promo holds off while onboarding is unfinished, which is how the
    // fixture starts. Say it is done, then ask for this one by name.
    await page.evaluate(([id, body]) => {
        const lang = window.dashboardInstance.language;
        lang.translations.config = lang.translations.config || {};
        lang.translations.config.testKbdPromoTitle = 'Keys';
        lang.translations.config.testKbdPromoBody = body;
        window.ConfigSettingPromo.registerAll([{
            id, section: 'overview', anchor: 'settingsJump', placement: 'beside',
            titleKey: 'config.testKbdPromoTitle', bodyKey: 'config.testKbdPromoBody',
        }]);
        window.dashboardInstance.settings.onboardingCompleted = true;
        window.dashboardInstance.onboardingStartedInSession = false;
        window.ConfigSettingPromo?.resetSeen?.(id, { persist: false });
        window.ConfigSettingPromo?.scheduleForSection?.('overview');
    }, [PROMO, BODY]);
    await page.waitForSelector('.config-setting-promo-body', { timeout: 20_000 });
}

test.describe('a setting promo', () => {
    test('draws the keys it names as keys', async ({ page }) => {
        await raisePromo(page);
        const body = page.locator('.config-setting-promo-body');

        // Three of them: the two ways to open settings search, and the one
        // that opens quick actions.
        await expect(body.locator('kbd')).toHaveCount(3);
        await expect(body).not.toContainText('<kbd>');
    });

    test('and the chips are the app\'s own, not bare text', async ({ page }) => {
        await raisePromo(page);

        const chip = await page.evaluate(() => {
            const el = document.querySelector('.config-setting-promo-body kbd');
            const style = window.getComputedStyle(el);
            return { border: style.borderTopWidth, background: style.backgroundColor, text: el.textContent };
        });

        expect(chip.text, 'the chip is empty').toBeTruthy();
        expect(parseFloat(chip.border), 'the key has no chip border').toBeGreaterThan(0);
        expect(chip.background, 'the key has no fill').not.toBe('rgba(0, 0, 0, 0)');
    });

    test('what is not markup is still escaped', async ({ page }) => {
        await raisePromo(page);

        // The title and the button never carried markup, and nothing about
        // this change may let them start.
        const bare = await page.evaluate(() => ({
            title: document.querySelector('.config-setting-promo-title')?.innerHTML || '',
            dismiss: document.querySelector('.config-setting-promo-dismiss')?.innerHTML || '',
        }));
        expect(bare.title, 'the title is being parsed as markup').not.toContain('<');
        expect(bare.dismiss, 'the button is being parsed as markup').not.toContain('<');
    });
});
