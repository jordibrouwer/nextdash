// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The look studio at its edges: Cancel while Apply is saving, a second opening
 * while the first is loading, a settings change from another device while the
 * panel is open, a theme's own look after one with an edge, and a panel that
 * has nothing to show.
 */

async function ready(page) {
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
}

async function setup(page, extra = {}, colors = null) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await ready(page);
    await page.evaluate(async ({ extra, colors }) => {
        try { localStorage.removeItem('nextdash:studio-use-theme-look'); } catch (_) { /* private mode */ }
        const d = window.dashboardInstance;
        if (colors) {
            const c = await (await fetch('/api/colors')).json();
            c.custom = Object.fromEntries(Object.entries(colors).map(([id, t]) => [id, { ...c[t.base], ...t.theme }]));
            await d.config.writeFetch('/api/colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
        }
        Object.assign(d.settings, {
            theme: 'cherry-graphite-dark', categoryHeaderStyle: 'clean', themeSurfacesForceAll: false,
            inboxViewUnreadMark: true, ...extra,
        });
        await d.saveSettings();
    }, { extra, colors });
    await page.reload();
    await ready(page);
}

const studio = (page) => page.locator('[data-look-studio]');
const local = (page, key) => page.evaluate((k) => window.dashboardInstance.settings[k], key);
const stored = (page) => page.evaluate(async () => (await fetch('/api/settings')).json());

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(studio(page)).toBeVisible({ timeout: 15_000 });
}

async function useLook(page, id) {
    await page.locator('[data-studio-tab="looks"]').click();
    await page.locator(`[data-studio-use-look="${id}"]`).click();
}

test('Escape while Apply is saving waits for it: screen and server agree', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await useLook(page, 'terminal');
    await expect.poll(() => local(page, 'categoryHeaderStyle')).toBe('label');

    let release = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() === 'POST') await held;
        await route.continue();
    });
    await page.locator('[data-studio-apply]').click();
    await page.keyboard.press('Escape');
    await expect(studio(page), 'Escape during the save is not a Cancel').toBeVisible();
    release();
    await expect(studio(page)).toHaveCount(0);
    await page.unroute('**/api/settings');

    expect(await local(page, 'categoryHeaderStyle')).toBe('label');
    expect((await stored(page)).categoryHeaderStyle).toBe('label');
});

test('a second opening while the first loads is the same one: config comes back on close', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.isActiveView())).toBe(true);
    await page.evaluate(() => {
        const cfg = window.dashboardInstance.config;
        void cfg.openThemeBrowser();
        void cfg.openThemeBrowser();
    });
    await expect(studio(page)).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-studio-cancel]').click();
    await expect(studio(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.isActiveView())).toBe(true);
});

test('a settings change from another device waits until the studio closes', async ({ page, request }) => {
    await setup(page);
    await openStudio(page);
    await useLook(page, 'terminal');
    await expect.poll(() => local(page, 'categoryHeaderStyle')).toBe('label');
    // The look's own saves first: each sends the whole settings back, and one
    // landing after the other device's would put its value back.
    await page.evaluate(() => window.dashboardInstance.config._settingsSaveChain);

    const res = await request.post('/api/settings', {
        data: { inboxViewUnreadMark: false },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(res.ok()).toBe(true);
    await page.evaluate(() => window.dashboardInstance.data.refreshIfDataRevisionChanged());
    expect(await local(page, 'categoryHeaderStyle'), 'the preview stays').toBe('label');
    await expect(studio(page)).toBeVisible();

    await page.locator('[data-studio-cancel]').click();
    await expect(studio(page)).toHaveCount(0);
    expect(await local(page, 'categoryHeaderStyle')).toBe('clean');
    // A save before the next poll sends every field: it reads the waiting change
    // first, or it puts the other device's value back on the server.
    await page.evaluate(() => window.dashboardInstance.saveSettings());
    const stored = await (await request.get('/api/settings')).json();
    expect(stored.inboxViewUnreadMark, 'a save after Cancel kept the other device\'s change').toBe(false);
    // Asked again on every try: a refresh already running when the studio closed
    // is handed back to the caller as it is, and it settled the change as
    // "wait" before the studio closed, so the first answer can still be the old
    // one. The page's own poll picks the change up after that; this is the poll.
    await expect.poll(async () => {
        await page.evaluate(() => window.dashboardInstance.data.refreshIfDataRevisionChanged());
        return local(page, 'inboxViewUnreadMark');
    }, { message: 'applied once the studio closed', timeout: 15_000 }).toBe(false);
});

test('a theme\'s own look without glass or backdrop clears the ones before it, for every theme', async ({ page }) => {
    const look = { heads: { categoryHeaderStyle: 'boxed' } };
    await setup(page, { themeSurfacesForceAll: true }, {
        'edge-look-dark': { base: 'dark', theme: { name: 'Edge [dark]', look } },
        'edge-look-light': { base: 'light', theme: { name: 'Edge [light]', look } },
    });
    await openStudio(page);
    await useLook(page, 'neon');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.cardGlass?.border)).toBe('on');

    await page.locator('[data-studio-tab="themes"]').click();
    await page.locator('[data-theme-card][data-theme-id="edge-look-dark"]').click();
    await expect.poll(() => local(page, 'categoryHeaderStyle')).toBe('boxed');
    const glass = await local(page, 'cardGlass');
    expect(glass?.border, 'no edge left from Neon').toBeUndefined();
    expect(glass?.alpha).toBeUndefined();
    expect(await local(page, 'themeBackdrop')).toBe('follow');
    expect(await local(page, 'themeDepth')).toBe('follow');
});

test('a studio with nothing to show hands back to config', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.isActiveView())).toBe(true);
    await page.evaluate(async () => {
        const browser = window.ThemeBrowser;
        const open = browser.open;
        browser.open = () => null;
        try {
            await window.dashboardInstance.config.openThemeBrowser();
        } finally {
            browser.open = open;
        }
    });
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.isActiveView())).toBe(true);
    expect(await page.evaluate(() => window.dashboardInstance.config._lookStudio)).toBeNull();
});
