// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What "Follow the theme" means for a category header.
 *
 * The header style is one setting for the install. On its default a theme can
 * state a header of its own; none does today. Confetti did (clean), which hid the
 * // grip and a widget's panel icon. A style the reader picks is never replaced.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const head = (page) => page.evaluate(() => document.body.getAttribute('data-cat-head'));

/** Pick a theme and style through the app's own writer, then wait for the page to follow. */
async function use(page, theme, style) {
    await page.evaluate(async ([t, s]) => {
        const d = window.dashboardInstance;
        d.settings.categoryHeaderStyle = s;
        await d.config.ensureSection('appearance');   // setTheme lives in Appearance's file
        await d.config.setTheme(t);
        d.setupDOM();
    }, [theme, style]);
}

test.describe('category header follows the theme', () => {
    test('Confetti keeps the theme header, in both halves', async ({ page }) => {
        await openDashboard(page);
        for (const theme of ['look-confetti-dark', 'look-confetti-light']) {
            await use(page, theme, 'theme');
            await expect.poll(() => head(page), theme).toBe('theme');
        }
    });

    test('on Confetti the // and a widget\'s panel icon are drawn', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'look-confetti-dark', 'theme');
        // A font-size of 0 on the handle is how the other styles hide them.
        const sizes = await page.evaluate(() => [...document.querySelectorAll('#dashboard-layout .category-reorder-handle:not(.is-static)')]
            .map((h) => ({ widget: !!h.querySelector('.category-reorder-glyph--widget'), size: parseFloat(getComputedStyle(h).fontSize) })));
        expect(sizes.filter((s) => !s.widget).length).toBeGreaterThan(0);
        expect(sizes.filter((s) => s.widget).length).toBeGreaterThan(0);
        for (const s of sizes) expect(s.size).toBeGreaterThan(0);
    });

    test('a style the reader picked is not replaced, on Confetti either', async ({ page }) => {
        await openDashboard(page);
        for (const style of ['clean', 'boxed', 'underlined', 'label', 'group']) {
            await use(page, 'look-confetti-dark', style);
            await expect.poll(() => head(page), style).toBe(style);
        }
    });

    test('the first paint has it: the server writes the theme header', async ({ page, request }) => {
        await openDashboard(page);
        await use(page, 'look-confetti-dark', 'theme');
        await expect.poll(async () => (await (await request.get('/')).text()).includes('data-cat-head="theme"')).toBe(true);
    });
});
