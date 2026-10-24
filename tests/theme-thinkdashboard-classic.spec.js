// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * ThinkDashboard (Classic): the page the first release drew, as its own theme.
 *
 * Behaviour only: the page colour is the palette's, the backdrop is the dot
 * grid and nothing else, and the theme is found under the Classic collection
 * in the theme browser, next to the original ThinkDashboard which is still there.
 */
const DARK = 'thinkdashboard-classic-dark';
const LIGHT = 'thinkdashboard-classic-light';

async function openDashboard(page, theme) {
    await page.request.post('/api/settings', {
        data: { theme, themeBackdrop: 'follow', backgroundPattern: 'auto' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const bodyBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const layer = (page) => page.evaluate(() => {
    const el = document.querySelector('body > .theme-backdrop-layer');
    if (!el) return null;
    const css = getComputedStyle(el);
    return { image: css.backgroundImage, size: css.backgroundSize, display: css.display };
});

test.describe('ThinkDashboard (Classic)', () => {
    test.describe.configure({ mode: 'serial' });

    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', {
            data: { theme: 'dark', backgroundPattern: 'auto' },
            headers: { 'X-NextDash-Token': WRITE_TOKEN },
        });
    });

    test('dark: the palette page with a grid of dots and nothing else', async ({ page }) => {
        await openDashboard(page, DARK);
        await expect(page.locator('html')).toHaveAttribute('data-theme', DARK);
        // The page is the palette's black, as the first release had it.
        await expect.poll(() => bodyBackground(page)).toBe('rgb(0, 0, 0)');

        const drawn = await layer(page);
        expect(drawn, 'the backdrop layer is missing').not.toBeNull();
        expect(drawn.display).toBe('block');
        // Dots: one radial gradient in the dot colour, on a 15px tile -- no colour blobs, no quiet centre.
        expect(drawn.image).toContain('radial-gradient');
        expect(drawn.image).toContain('rgb(31, 41, 55)');
        expect(drawn.image).not.toContain('ellipse');
        expect(drawn.size).toContain('15px');
        // The older dot layer on <body> stays quiet, so the dots are not drawn twice.
        const before = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
        expect(before).toBe('none');
    });

    test('light: the same page in the first release\'s light palette', async ({ page }) => {
        await openDashboard(page, LIGHT);
        await expect(page.locator('html')).toHaveAttribute('data-theme', LIGHT);
        await expect.poll(() => bodyBackground(page)).toBe('rgb(249, 250, 251)');
        const drawn = await layer(page);
        expect(drawn && drawn.image).toContain('radial-gradient');
        expect(drawn && drawn.image).toContain('rgb(229, 231, 235)');
    });

    test('the theme browser lists it under the Classic collection, beside the original', async ({ page }) => {
        await openDashboard(page, 'dark');
        await page.keyboard.press('Shift+A');
        await page.waitForSelector('[data-theme-browser]', { timeout: 20_000 });
        const cards = page.locator('[data-theme-card]');
        const all = await cards.count();

        await page.locator('[data-theme-more]').click();
        const chip = page.locator('[data-theme-collection="classic"]');
        await expect(chip).toHaveText('Classic');
        await chip.click();
        await expect.poll(() => cards.count()).toBeLessThan(all);
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText('ThinkDashboard');
        await expect(cards.first()).toHaveAttribute('data-theme-card', 'thinkdashboard-classic');

        // The original keeps its place in the full list, under a name of its own.
        await chip.click();
        await expect.poll(() => cards.count()).toBe(all);
        await page.locator('[data-theme-search]').fill("ThinkDashboard Modern");
        await expect(page.locator('[data-theme-card="__default"]')).toContainText('ThinkDashboard Modern');
    });
});
