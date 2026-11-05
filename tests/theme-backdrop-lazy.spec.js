// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Backdrops are fetched one theme at a time.
 *
 * The linked theme stylesheet holds the colours of every theme and none of
 * their backdrops (inline SVG, 8 of its 9 MB). The page opens with its own
 * theme's backdrop inline, and fetches the backdrop of any other theme the
 * document switches to, whoever switches it.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const backdropOf = (page) => page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--theme-backdrop').trim()
);

test('the linked stylesheet has no backdrops and the page opens with its own', async ({ page }) => {
    await openDashboard(page);

    const linked = await page.evaluate(async () => {
        const link = document.getElementById('nextdash-theme-css');
        const css = await (await fetch(link.href)).text();
        return { bytes: css.length, backdrops: css.includes('--theme-backdrop') };
    });
    expect(linked.backdrops).toBe(false);
    // 386 blocks of colours and surfaces; with the backdrops it was 9 MB.
    expect(linked.bytes).toBeLessThan(1_500_000);

    expect(await backdropOf(page)).not.toBe('');
    expect(await page.locator('#nextdash-backdrop-css').getAttribute('data-themes')).toBeTruthy();
});

test('switching theme brings that theme\'s backdrop, by whatever writes data-theme', async ({ page }) => {
    await openDashboard(page);
    const before = await backdropOf(page);

    const asked = page.waitForRequest((req) => req.url().includes('scope=backdrop') && req.url().includes('absinthe-dark'));
    // Not through ThemeLoader: a preview, a rename and auto dark write the attribute directly.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'absinthe-dark'));
    await asked;

    await expect.poll(() => backdropOf(page)).not.toBe('');
    await expect.poll(() => backdropOf(page)).not.toBe(before);

    // Back again: already held, so nothing is asked twice.
    let again = 0;
    page.on('request', (req) => { if (req.url().includes('scope=backdrop')) again += 1; });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'absinthe-dark'));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'absinthe-dark'));
    // Checks that nothing happens: no further request after the theme is back.
    await page.waitForTimeout(300);
    expect(again).toBeLessThanOrEqual(1);
});

test('a recipe the reader picks is fetched when it is first used', async ({ page }) => {
    await openDashboard(page);
    const asked = page.waitForRequest((req) => req.url().includes('scope=backdrop') && req.url().includes('recipe=hexagons'));
    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('hexagons'));
    await asked;
    // The recipe's rule is on <body>, which wins over what it inherits from <html>.
    const html = await backdropOf(page);
    await expect.poll(() => page.evaluate(
        () => getComputedStyle(document.body).getPropertyValue('--theme-backdrop').trim()
    )).not.toBe(html);
});

test('a held roll is asked for again, and a theme fetched after it carries the same roll', async ({ page }) => {
    await openDashboard(page);
    const reloaded = page.waitForRequest((req) => req.url().includes('scope=backdrop') && req.url().includes('seed=7'));
    await page.evaluate(() => window.ThemeLoader.reloadBackdropCSS({ seed: 7 }));
    await reloaded;

    const next = page.waitForRequest((req) => req.url().includes('scope=backdrop') && req.url().includes('absinthe-dark'));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'absinthe-dark'));
    expect((await next).url()).toContain('seed=7');
});

test('the backdrop element comes before theme-loader, which looks for it as it first runs', async ({ page }) => {
    await openDashboard(page);
    const before = await page.evaluate(() => {
        const style = document.getElementById('nextdash-backdrop-css');
        const loader = document.querySelector('script[src*="theme-loader"]');
        return Boolean(style && loader && (style.compareDocumentPosition(loader) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(before).toBe(true);
});

test('a backdrop asked for while a reload is on its way is not lost to it', async ({ page }) => {
    await openDashboard(page);
    // Hold the reload's answer until the theme has changed and been answered.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let held = false;
    await page.route('**/api/theme.css?scope=backdrop*', async (route) => {
        if (!held && route.request().url().includes('seed=5')) {
            held = true;
            await gate;
        }
        await route.continue();
    });
    await page.evaluate(() => { window.ThemeLoader.reloadBackdropCSS({ seed: 5 }); });
    await expect.poll(() => held).toBe(true);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'absinthe-dark'));
    await expect.poll(() => backdropOf(page)).not.toBe('');
    const text = () => page.locator('#nextdash-backdrop-css').evaluate((el) => el.textContent);
    await expect.poll(async () => (await text()).includes('absinthe-dark')).toBe(true);
    release();
    // The reload lands and replaces the text; absinthe-dark is on screen, so it is asked for again.
    await expect.poll(async () => (await text()).includes('absinthe-dark'), { timeout: 10_000 }).toBe(true);
    expect(await backdropOf(page)).not.toBe('');
});
