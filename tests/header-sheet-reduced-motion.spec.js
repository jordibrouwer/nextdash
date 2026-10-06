// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Less motion still puts the header sheets where they belong.
 *
 * The pages panel and the recents panel hang from the header band, centred on
 * the strip by `left: <mid>` plus `translateX(-50%)`. The reduced-motion rule
 * for every modal cleared `transform` to stop the open animation, and took the
 * centring with it: the sheet's left edge landed on the strip's centre line and
 * the pages panel ran off the right of the window. The in-app animations
 * switch did the same through its own rule. Without motion the sheet should
 * not move -- not on open, and not off its line.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Through the key a reader presses, not through the open function. */
async function openWithKey(page, key, selector) {
    await page.keyboard.press(key);
    await page.waitForSelector(selector, { timeout: 10_000 });
    await page.waitForTimeout(350);
}

const measure = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const row = document.querySelector('.header-top').getBoundingClientRect();
    return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        mid: Math.round(r.x + r.width / 2),
        rowMid: Math.round(row.x + row.width / 2),
        viewport: window.innerWidth,
        animation: getComputedStyle(el).animationName,
    };
}, selector);

const SHEETS = [
    { name: 'pages panel', key: ',', selector: '.page-overview-sheet' },
    { name: 'recents panel', key: '*', selector: '.recents-sheet' },
];

async function expectInPlace(page, sheet) {
    await openWithKey(page, sheet.key, sheet.selector);
    const seen = await measure(page, sheet.selector);
    expect(seen.left, `the ${sheet.name} starts off the left edge`).toBeGreaterThanOrEqual(0);
    expect(seen.right, `the ${sheet.name} runs ${seen.right - seen.viewport}px off the right edge`)
        .toBeLessThanOrEqual(seen.viewport);
    expect(Math.abs(seen.mid - seen.rowMid), `the ${sheet.name} is off the strip's centre line`)
        .toBeLessThanOrEqual(1);
    expect(seen.animation, `the ${sheet.name} still animates`).toBe('none');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
}

test.describe('with the OS asking for less motion', () => {
    for (const sheet of SHEETS) {
        test(`the ${sheet.name} stays on its line and inside the window`, async ({ page }) => {
            // emulateMedia, not test.use: the fixtures hand out their own page.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await openDashboard(page);
            expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
            // The app's own switch stays on, so the OS preference does the work.
            await page.evaluate(() => {
                const d = window.dashboardInstance;
                d.settings.animationsEnabled = true;
                d.applyAnimations?.();
            });
            expect(await page.evaluate(() => document.body.classList.contains('no-animations'))).toBe(false);
            await expectInPlace(page, sheet);
        });
    }
});

test.describe('with the app\'s animations switched off', () => {
    for (const sheet of SHEETS) {
        test(`the ${sheet.name} stays on its line and inside the window`, async ({ page }) => {
            await openDashboard(page);
            await page.evaluate(() => {
                const d = window.dashboardInstance;
                d.settings.animationsEnabled = false;
                d.applyAnimations?.();
            });
            expect(await page.evaluate(() => document.body.classList.contains('no-animations'))).toBe(true);
            await expectInPlace(page, sheet);
        });
    }
});
