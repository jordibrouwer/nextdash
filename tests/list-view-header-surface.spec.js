// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The header of Health and Inbox is a surface, not a rule over the page.
 *
 * It was painted in --background-primary with a hairline under it, so it read
 * as a black band across the top of a dark theme and a white one on a light
 * theme -- the one element on either page taking no colour from the theme at
 * all. It wears the dashboard widget's shape now: a rounded panel tinted with
 * a little of the text colour, so the two views and the dashboard are made of
 * the same thing.
 */

async function openView(page, key) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    // The rows being up is what says the keyboard handlers are bound; the view
    // itself is lazy, and a key pressed before that lands nowhere.
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Through the key someone presses, not through the renderer.
    await page.keyboard.press(key);
    await page.waitForSelector('.lvs-header', { timeout: 20_000 });
}

for (const [view, key] of [['health', 'Shift+H'], ['inbox', 'Shift+I']]) {
    test(`the ${view} header takes its colour from the theme`, async ({ page }) => {
        await openView(page, key);

        const read = await page.evaluate(() => {
            const header = document.querySelector('.lvs-header');
            const cs = window.getComputedStyle(header);
            return {
                background: cs.backgroundColor,
                page: window.getComputedStyle(document.body).backgroundColor,
                radius: parseFloat(cs.borderTopLeftRadius),
                // Sticky: the rows pass behind it, so it cannot be see-through.
                translucent: /\/\s*0?\.\d|,\s*0?\.\d+\)/.test(cs.backgroundColor),
            };
        });

        expect(read.background, 'the header is still the page colour').not.toBe(read.page);
        expect(read.radius, 'the header is still a full-width band').toBeGreaterThan(0);
        expect(read.translucent, 'rows will scroll through the header').toBe(false);
    });
}
