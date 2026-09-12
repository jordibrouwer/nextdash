// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A key in a tip looks like a key.
 *
 * Thirty-five of the ninety-one help tips name a keystroke, written inline as
 * <code> — "type <code>&gt;</code> to search". Everywhere else in the app a
 * key is a chip: bordered, tinted, unmistakably a thing you press. In the tips
 * it fell back to the browser's idea of <code>, which is a different typeface
 * and nothing else, so the one word that matters in the sentence read like the
 * rest of it.
 *
 * The tips themselves are untouched. Rewriting ninety-one strings across six
 * locales to split a title from an explanation is a translation round, not a
 * styling change.
 */

async function openHelp(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Both the config module and its stylesheet arrive lazily, so this waits
    // for the thing itself rather than for a proxy: the module to exist, the
    // view to render, and then the styling to have actually landed. Waiting
    // on the markup alone read the page a paint too early and the probe came
    // back unstyled about half the time.
    await page.waitForFunction(() => window.dashboardInstance?.config != null, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.waitForFunction(() => {
        const probe = document.createElement('li');
        probe.className = 'config-help-tip';
        const code = document.createElement('code');
        probe.appendChild(code);
        document.body.appendChild(probe);
        const styled = parseFloat(window.getComputedStyle(code).borderTopWidth) > 0;
        probe.remove();
        return styled;
    }, null, { timeout: 20_000 });
}

/** Compares a probe styled as a tip key against one styled as the app's kbd. */
const compare = (page) => page.evaluate(() => {
    const tip = document.createElement('li');
    tip.className = 'config-help-tip';
    const code = document.createElement('code');
    code.textContent = '>';
    tip.appendChild(code);

    const chip = document.createElement('kbd');
    chip.textContent = '>';

    document.body.append(tip, chip);
    const read = (el) => {
        const style = window.getComputedStyle(el);
        return {
            border: style.borderTopWidth,
            radius: style.borderTopLeftRadius,
            background: style.backgroundColor,
            family: style.fontFamily,
        };
    };
    const value = { code: read(code), kbd: read(chip) };
    tip.remove();
    chip.remove();
    return value;
});

test.describe('keys in help tips', () => {
    test('a key in a tip is chipped like every other key', async ({ page }) => {
        await openHelp(page);
        const { code, kbd } = await compare(page);

        expect(parseFloat(code.border), 'the key has no chip border').toBeGreaterThan(0);
        expect(parseFloat(code.radius), 'the key has square corners').toBeGreaterThan(0);
        expect(code.background, 'the key has no fill').not.toBe('rgba(0, 0, 0, 0)');
    });

    test('and it matches the chip the rest of the app uses', async ({ page }) => {
        await openHelp(page);
        const { code, kbd } = await compare(page);

        expect(code.border, 'a second idea of what a key looks like').toBe(kbd.border);
        expect(code.background).toBe(kbd.background);
        expect(code.radius).toBe(kbd.radius);

        // Not the type size: the standalone chip is a fixed 12px with 4px/8px
        // of padding, which inside a sentence would break the line rhythm it
        // sits in. What has to match is the identity -- same border, same
        // ground, same corner -- not the measurements.
    });
});
