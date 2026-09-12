// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The three modes read as one switch, on both layouts.
 *
 * Search, commands and finders are one panel that changes mode on a key, and
 * the pills at its foot are how that is shown. As three separately outlined
 * buttons they read as three doors to three places; in a single bordered
 * track they read as what they are -- one control with one of three positions
 * lit.
 *
 * The modern layout has drawn them that way since it landed. Classic is the
 * default, which is where most readers are, and there the pills stayed loose.
 * A switch should not look like a switch only for people who changed a layout
 * preference.
 */

async function openSearch(page, layout) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => document.body.setAttribute('data-layout-version', value), layout);
    await page.keyboard.press('>');
    await page.waitForSelector('.search-mode-tabs', { state: 'attached', timeout: 10_000 });
}

const trackStyle = (page) => page.evaluate(() => {
    const el = document.querySelector('.search-mode-tabs');
    const style = window.getComputedStyle(el);
    return {
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
    };
});

const paints = (colour) => colour !== ''
    && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(colour)
    && !/transparent/.test(colour);

test.describe('the mode switch', () => {
    for (const layout of ['classic', 'modern']) {
        test(`reads as one track on ${layout}`, async ({ page }) => {
            await openSearch(page, layout);
            const track = await trackStyle(page);

            expect(paints(track.background), `no track behind the pills: ${track.background}`).toBe(true);
            expect(parseFloat(track.borderWidth), 'the track has no border').toBeGreaterThan(0);
            expect(parseFloat(track.radius), 'the track has square corners').toBeGreaterThan(0);
        });
    }

    test('one position is lit, and it is the one in force', async ({ page }) => {
        await openSearch(page, 'classic');

        const active = await page.evaluate(() => {
            const tabs = [...document.querySelectorAll('.search-mode-tab')];
            return {
                count: tabs.length,
                lit: tabs.filter((t) => t.classList.contains('active')).length,
                mode: tabs.find((t) => t.classList.contains('active'))?.dataset.mode ?? null,
            };
        });

        expect(active.count, 'the switch lost a position').toBe(3);
        expect(active.lit, 'more than one position is lit at once').toBe(1);
        expect(active.mode, 'the key that opened the panel is not the lit one').toBe('search');
    });
});
