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

/*
 * And the other way round: a save that had already reached the server when
 * another device saved after it. The read that follows holds both, so it is
 * the one to show -- keeping this tab's copy then left the other device's
 * change off the screen while the server held it.
 */
test('a save that landed before the other device does not hide its change', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(() => window.dashboardInstance.data.refreshIfDataRevisionChanged());

    // This tab's save reaches the server; its answer is held, so the save is
    // still on the wire when the refresh reads.
    let holdPost = true;
    let landed = false;
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/settings', async (route) => {
        if (!holdPost || route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        holdPost = false;
        const response = await route.fetch();
        landed = true;
        await gate;
        await route.fulfill({ response });
    });

    const before = await page.evaluate(() => {
        const d = window.dashboardInstance;
        window.__save = d.saveSettings();
        return d.settings.showTitle;
    });
    await expect.poll(() => landed, { timeout: 10_000 }).toBe(true);

    // Another device, after that save: the title flips.
    await page.evaluate(async (was) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await api('/api/settings')).json();
        current.showTitle = !was;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current),
        });
    }, before);

    await page.evaluate(() => {
        window.__refresh = window.dashboardInstance.data.refreshIfDataRevisionChanged();
    });
    await page.waitForTimeout(300);
    release();
    await page.evaluate(async () => { await window.__save; await window.__refresh; });

    const seen = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const server = (await (await api('/api/settings')).json()).showTitle;
        return { client: window.dashboardInstance.settings.showTitle, server };
    });
    expect(seen.server).toBe(!before);
    expect(seen.client).toBe(seen.server);
});
