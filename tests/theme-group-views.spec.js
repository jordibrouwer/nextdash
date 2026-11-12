// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The theme groups draw their frame on a category of the dashboard; the other
 * views (Inbox, Containers, Glances, Tags, Config) sit in a panel of their own
 * and used to keep the plain one. What is asserted is that the panel takes the
 * frame the group gives a category, not how it looks.
 */
const FRAMES = [
    { theme: 'instrument-oscilloscope-dark', border: '10px', radius: '30px' },
    { theme: 'instrument-dive-computer-dark', border: '8px', radius: '28px' },
    { theme: 'spatial-lightbox-dark', border: '14px', radius: '2px' },
    { theme: 'riso-pink-blue-light', border: '3px', radius: '0px' },
    { theme: 'cartographic-nautical-dark', border: '3px', radius: '0px' },
    { theme: 'legible-high-contrast-calm-dark', border: '4px', radius: '0px' },
    { theme: 'living-tidewatch-dark', border: '0px', radius: '0px' },
];

async function use(page, theme) {
    await page.evaluate(async (t) => {
        const d = window.dashboardInstance;
        await d.config.ensureSection('appearance');
        await d.config.setTheme(t);
        d.setupDOM();
    }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
}

const PANELS = {
    inbox: '#dashboard-layout.inbox-layout > .lvs',
    config: '#dashboard-layout.config-layout > .config-view',
};

test.describe('theme groups on the other views', () => {
    test('the panel of Inbox and Config takes the frame of the group', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        for (const view of ['inbox', 'config']) {
            await page.evaluate((v) => { location.hash = '#' + v; }, view);
            await expect(page.locator(PANELS[view])).toBeVisible();
            for (const { theme, border, radius } of FRAMES) {
                await use(page, theme);
                await expect.poll(() => page.locator(PANELS[view]).evaluate((el) => {
                    const cs = getComputedStyle(el);
                    return `${cs.borderTopWidth} ${cs.borderTopLeftRadius}`;
                }), { message: `${view} in ${theme}` }).toBe(`${border} ${radius}`);
            }
        }
    });
});
