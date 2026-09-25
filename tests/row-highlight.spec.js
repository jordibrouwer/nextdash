// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * How far a row's accent carries is a preference about rows.
 *
 * The modern layout lit a bookmark row much further across than classic does
 * -- the same gradient from the same edge, carried to 58% of the accent
 * instead of 22%. It was one of twenty-one tokens describing a whole visual
 * language, and the only one of them that is a taste about rows rather than a
 * layout: everything else modern brought (bigger radii, more opaque surfaces,
 * a softer shadow) either already exists in the shared layer or is something
 * the depth ladder now does better.
 *
 * So it is a setting, not a layout -- which is what let that layout be folded
 * away without anyone losing their rows.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** What the row tokens resolve to, painted rather than read as text. */
const rowTokens = (page) => page.evaluate(() => {
    const paint = (expr) => {
        const probe = document.createElement('span');
        probe.style.background = expr;
        document.body.appendChild(probe);
        const value = window.getComputedStyle(probe).backgroundImage;
        probe.remove();
        return value;
    };
    return {
        attr: document.body.getAttribute('data-row-highlight'),
        hover: paint('var(--bookmark-row-hover-bg)'),
        selected: paint('var(--bookmark-row-selected-bg)'),
    };
});

test.describe('how a row lights up', () => {
    test('subtle is what a fresh install draws', async ({ page }) => {
        await dashboard(page);
        const { attr, hover } = await rowTokens(page);

        expect(attr, 'the server did not stamp the setting').toBe('subtle');
        // Still a gradient: classic was never flat, it simply carried less far.
        expect(hover, 'the row lost its gradient').toContain('linear-gradient');
    });

    test('strong carries the same light further', async ({ page }) => {
        await dashboard(page);
        const subtle = await rowTokens(page);

        await page.evaluate(() => document.body.setAttribute('data-row-highlight', 'strong'));
        const strong = await rowTokens(page);

        expect(strong.hover, 'strong draws the same as subtle').not.toBe(subtle.hover);
        expect(strong.selected, 'the keyboard cursor did not follow').not.toBe(subtle.selected);
        // From the same edge, at the same angle: it is a strength, not a
        // different effect.
        expect(strong.hover).toContain('90deg');
    });

    test('and choosing it in config lands without a reload', async ({ page }) => {
        await dashboard(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
        await page.evaluate(() => { window.__notReloaded = true; });
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c.appearanceTab = c.appearanceTab || 'general';
            // Awaited: switching the tab while the section is still drawing
            // redrew the control under the click, which then never landed.
            await c.openConfigView('appearance');
            c.switchAppearanceTab?.('display');
        });
        const strongChoice = page.locator('[data-behavior-field="rowHighlight"][data-behavior-value="strong"]');
        await expect(strongChoice).toBeVisible({ timeout: 20_000 });
        await strongChoice.click();

        await expect.poll(() => rowTokens(page).then((r) => r.attr)).toBe('strong');
        expect(await page.evaluate(() => window.__notReloaded === true),
            'the page reloaded to apply the setting').toBe(true);
    });

});
