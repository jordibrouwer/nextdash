// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A dot in a key is either a level or part of a name, and both happen.
 *
 * t() split on dots and walked nested objects, which never reached the
 * seventy-odd keys the locale files store as one literal name with a dot in
 * it — "widgetAbout.health" sitting directly under "config" rather than a
 * "widgetAbout" object holding "health". Around three hundred translations
 * across the four languages were written, kept in step, and never displayed:
 * what a reader saw was the English hardcoded beside the call.
 */
async function ready(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.dashboardInstance?.language, null, { timeout: 15_000 });
}

const lookup = (page, keys) => page.evaluate(
    (ks) => Object.fromEntries(ks.map((k) => [k, window.dashboardInstance.language.t(k)])), keys);

test.describe('translation lookup', () => {
    test('reaches a literal name that contains a dot', async ({ page }) => {
        await ready(page);
        // One from each family that was unreachable, so a regression in any of
        // them fails here rather than only the one that was reported.
        const keys = ['config.widgetAbout.health', 'dashboard.widgetType.health',
            'config.widgetFormat.count', 'config.widgetPresetGroup.media',
            'dashboard.weatherCode.unknown', 'config.backgroundPreset.aurora'];
        const got = await lookup(page, keys);
        for (const key of keys) {
            expect(got[key], `${key} came back as its own key`).not.toBe(key);
        }
    });

    test('still walks a genuinely nested key, and still misses an absent one', async ({ page }) => {
        await ready(page);
        const got = await lookup(page, ['config.backupDelete', 'config.thisKeyDoesNotExist']);
        expect(got['config.backupDelete']).not.toBe('config.backupDelete');
        // A miss has to stay a miss: every caller reads "the key came back" as
        // "use my fallback", so resolving to something arbitrary would be worse
        // than not resolving at all.
        expect(got['config.thisKeyDoesNotExist']).toBe('config.thisKeyDoesNotExist');
    });

    test('the translation is the one for the language in use', async ({ page }) => {
        await ready(page);
        const english = await lookup(page, ['config.widgetAbout.health']);
        await page.evaluate(async () => {
            await window.dashboardInstance.language.loadTranslations('nl');
        });
        const dutch = await lookup(page, ['config.widgetAbout.health']);
        // The point of the fix: these were written and never differed on
        // screen, because neither was ever read.
        expect(dutch['config.widgetAbout.health'])
            .not.toBe(english['config.widgetAbout.health']);
    });
});
