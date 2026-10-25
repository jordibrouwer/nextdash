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
