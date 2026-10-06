// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A setting changed here outlives a refresh that was already on its way.
 *
 * When another device saves settings, the revision poll reloads them. If you
 * change a setting while that read is still on the wire, its answer was taken
 * before your save and still carries the old value -- and it replaced
 * d.settings wholesale when it landed. The header went back to the old style
 * while the server held the new one, and stayed that way: your own save had
 * already told the poll there was nothing left to fetch.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('a setting saved while a refresh is on the wire stays on screen', async ({ page }) => {
    await openDashboard(page);
    expect(await page.evaluate(() => document.body.getAttribute('data-header-buttons'))).toBe('plain');
    // The poll compares against the revision this tab last saw.
    await page.evaluate(() => window.dashboardInstance.data.refreshIfDataRevisionChanged());

    // Hold the next settings read: its answer is taken now, and handed over
    // only once the change below has been made and saved.
    let holding = false;
    let held = false;
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/settings', async (route) => {
        if (!holding || route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        holding = false;
        const response = await route.fetch();
        held = true;
        await gate;
        await route.fulfill({ response });
    });

    // Another device saves a setting this tab does not show.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await api('/api/settings')).json();
        current.weatherLocation = `Elsewhere ${Date.now()}`;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current),
        });
    });
    // From here the next settings read is the refresh's.
    holding = true;
    await page.evaluate(() => {
        window.__refresh = window.dashboardInstance.data.refreshIfDataRevisionChanged();
    });
    await expect.poll(() => held, { timeout: 10_000 }).toBe(true);

    // Meanwhile, here: the header style changes and is saved.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.headerButtonStyle = 'plated';
        await d.saveSettings();
        d.setupDOM();
    });
    expect(await page.evaluate(() => document.body.getAttribute('data-header-buttons'))).toBe('plated');

    release();
    await page.evaluate(() => window.__refresh);

    expect(await page.evaluate(() => window.dashboardInstance.settings.headerButtonStyle)).toBe('plated');
    expect(await page.evaluate(() => document.body.getAttribute('data-header-buttons'))).toBe('plated');
});
