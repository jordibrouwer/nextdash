// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/*
 * The page links the theme stylesheet, and a refresh swaps that link for a new
 * one. Use theme refreshes twice in a row, and the second new link went in
 * front of the first: the older copy came last, won the cascade, and was never
 * removed -- so every theme change after it stayed invisible until a reload.
 */
const themeLinks = (page) => page.evaluate(
    () => [...document.querySelectorAll('link[href^="/api/theme.css"]')].map((l) => l.getAttribute('href'))
);

test('two theme refreshes in a row leave one stylesheet, the newest', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.VisualSettings?.reloadThemeCSS, null, { timeout: 15_000 });
    expect(await themeLinks(page)).toHaveLength(1);

    await page.evaluate(() => {
        window.VisualSettings.reloadThemeCSS();
        window.VisualSettings.reloadThemeCSS();
    });
    await expect.poll(() => themeLinks(page).then((l) => l.length)).toBe(1);

    // And the next refresh is the one that applies.
    await page.waitForTimeout(5);
    await page.evaluate(() => window.VisualSettings.reloadThemeCSS());
    await expect.poll(() => themeLinks(page).then((l) => l.length)).toBe(1);
    const [last] = await themeLinks(page);
    const newest = await page.evaluate(() => Math.max(...[...document.querySelectorAll('link[href^="/api/theme.css"]')]
        .map((l) => Number(new URL(l.href).searchParams.get('t')) || 0)));
    expect(new URL(last, 'http://x').searchParams.get('t')).toBe(String(newest));
});
