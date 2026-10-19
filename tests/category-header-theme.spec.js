// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What "Follow the theme" means for a category header.
 *
 * The header style is one setting for the install. On its default a theme can
 * state a header of its own: Confetti draws it clean, the name alone. A style the
 * reader picks is never replaced, and every other theme keeps the theme's own.
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
        await d.config.setTheme(t);
        d.setupDOM();
    }, [theme, style]);
}

test.describe('category header follows the theme', () => {
    test('Confetti draws its headers clean, in both halves', async ({ page }) => {
        await openDashboard(page);
        for (const theme of ['look-confetti-dark', 'look-confetti-light']) {
            await use(page, theme, 'theme');
            await expect.poll(() => head(page), theme).toBe('clean');
        }
    });

    test('another theme keeps the header the theme and the layout draw', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'slate-dark', 'theme');
        await expect.poll(() => head(page)).toBe('theme');
    });

    test('a style the reader picked is not replaced, on Confetti either', async ({ page }) => {
        await openDashboard(page);
        for (const style of ['boxed', 'underlined', 'label', 'group']) {
            await use(page, 'look-confetti-dark', style);
            await expect.poll(() => head(page), style).toBe(style);
        }
    });

    test('switching theme moves the header with it, without a reload', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'look-confetti-dark', 'theme');
        await expect.poll(() => head(page)).toBe('clean');
        await page.evaluate(() => window.dashboardInstance.config.setTheme('slate-dark'));
        await expect.poll(() => head(page)).toBe('theme');
        await page.evaluate(() => window.dashboardInstance.config.setTheme('look-confetti-dark'));
        await expect.poll(() => head(page)).toBe('clean');
    });

    test('the stored setting still says Follow the theme', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'look-confetti-dark', 'theme');
        const stored = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).categoryHeaderStyle);
        expect(['theme', '', undefined]).toContain(stored);
    });

    test('the first paint has it: the server writes the resolved style', async ({ page, request }) => {
        await openDashboard(page);
        await use(page, 'look-confetti-dark', 'theme');
        await page.waitForTimeout(500);
        const html = await (await request.get('/')).text();
        expect(html).toContain('data-cat-head="clean"');
    });
});
