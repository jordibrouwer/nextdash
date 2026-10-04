// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Every key gate in search was printable ASCII, so an accented letter (or any
 * Chinese) could not be typed, and the matcher compared raw strings, so
 * "meteo" did not find "Météo" either.
 */
test('accented letters can be typed, and either spelling finds the name', async ({ page }) => {
    const name = `Météo ${Date.now()}`;
    const url = `https://meteo-${Date.now()}.example.test`;
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await page.evaluate(async ({ n, u }) => {
        const res = await nextDashFetch('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: Number(window.dashboardInstance.currentPageId), bookmark: { name: n, url: u, category: '' } }),
        });
        if (!res.ok) throw new Error(`seed ${res.status}`);
    }, { n: name, u: url });
    try {
        await page.reload();
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        const search = () => page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            return { query: s?.currentQuery, names: (s?.searchMatches || []).map((m) => m.bookmark?.name || m.name) };
        });
        const open = async () => {
            await page.keyboard.press('>');
            await expect.poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
                { timeout: 10_000 }).toBe(true);
        };
        await open();
        // Playwright types a letter that is not on its US layout as text
        // alone, with no keydown; a real keyboard sends one, so that is what
        // goes to the document here.
        await page.keyboard.type('m');
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'é', bubbles: true, cancelable: true })));
        await page.keyboard.type('t');
        // Then / in front: a search by name.
        await page.keyboard.press('/');
        await expect.poll(async () => (await search()).query).toBe('/mét');
        await expect.poll(async () => (await search()).names).toContain(name);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.()))).toBe(false);
        await open();
        await page.keyboard.type('meteo');
        await page.keyboard.press('/');
        await expect.poll(async () => (await search()).names).toContain(name);
    } finally {
        await page.evaluate(async ({ u }) => {
            await nextDashFetch('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: Number(window.dashboardInstance.currentPageId), bookmark: { url: u } }),
            });
        }, { u: url });
    }
});
