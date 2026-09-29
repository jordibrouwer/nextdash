// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A web address per container, set in the drawer's Custom section.
 *
 * The server hands back webui as the custom address when there is one and the
 * template's otherwise, so everything that opens it -- the drawer's button, the
 * palette, the widget -- follows without choosing. This spec drives the drawer
 * and the palette; the settings write is caught, so the dev data dir is not.
 */

const SONARR = {
    id: 'a'.repeat(64), shortId: 'a'.repeat(12), name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', tag: 'latest',
    state: 'running', status: 'Up 6 days', health: '', created: 1790000000,
    ports: [{ private: 8989, public: 8989, type: 'tcp' }],
    webui: 'http://[IP]:8989/', webuiDefault: 'http://[IP]:8989/',
};

async function openOverview(page, container = SONARR) {
    const state = await mockDocker(page, { containers: [{ ...container }] });
    state.initial = container.webuiCustom ? { sonarr: container.webuiCustom } : undefined;
    const saved = [];
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        // Other settings writes happen on load; only this one is of interest.
        if (!('dockerWebUIs' in body)) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        }
        saved.push(body.dockerWebUIs);
        // What the server does with it: the list answers with the new address.
        const custom = body.dockerWebUIs?.sonarr || '';
        state.containers[0].webuiCustom = custom || undefined;
        state.containers[0].webui = custom || state.containers[0].webuiDefault;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto('/#docker/sonarr');
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer).toContainText('sonarr');
    return { drawer, saved, state };
}

test.describe('a custom web UI address', () => {
    test('Custom sits between Network and Volumes', async ({ page }) => {
        const { drawer } = await openOverview(page);
        const order = await drawer.locator('[data-docker-section]').evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-docker-section')));
        const at = (k) => order.indexOf(k);
        expect(at('custom')).toBeGreaterThan(at('network'));
        expect(at('custom')).toBeLessThan(at('volumes'));
    });

    test('the field shows the default, and saving sets the address everywhere', async ({ page }) => {
        const { drawer, saved } = await openOverview(page);
        await drawer.locator('[data-docker-section="custom"] summary').click();
        const field = drawer.locator('[data-docker-webui-input]');
        await expect(field).toHaveValue('');
        await expect(field).toHaveAttribute('placeholder', 'http://[IP]:8989/');
        await field.fill('https://sonarr.home.lan');
        await drawer.locator('[data-docker-webui-save]').click();
        await expect.poll(() => saved.length).toBe(1);
        expect(saved[0]).toEqual({ sonarr: 'https://sonarr.home.lan' });

        // The drawer's own button now opens it.
        const opened = [];
        await page.exposeFunction('__open', (u) => { opened.push(u); });
        await page.evaluate(() => { window.open = (u) => { window.__open(String(u)); return null; }; });
        await drawer.locator('[data-slp-action="webui"]').click();
        await expect.poll(() => opened).toEqual(['https://sonarr.home.lan']);
    });

    // The settings write failing is a failure: no "saved", and the drawer does
    // not claim the address it could not store.
    test('a save the server refuses says so and keeps nothing', async ({ page }) => {
        const { drawer } = await openOverview(page);
        await page.route('**/api/settings', (route) => (route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'no' })
            : route.fallback()));
        await drawer.locator('[data-docker-section="custom"] summary').click();
        await drawer.locator('[data-docker-webui-input]').fill('https://sonarr.home.lan');
        await drawer.locator('[data-docker-webui-save]').click();
        await expect(page.locator('#app-notification.show')).toContainText(/could not|failed/i);
        await expect(page.locator('#app-notification.show')).not.toContainText('Web UI address saved');
        expect(await page.evaluate(() => window.dashboardInstance?.settings?.dockerWebUIs?.sonarr)).toBeUndefined();
    });

    test('back to the default clears it', async ({ page }) => {
        const { drawer, saved } = await openOverview(page, {
            ...SONARR, webui: 'https://sonarr.home.lan', webuiCustom: 'https://sonarr.home.lan',
        });
        await drawer.locator('[data-docker-section="custom"] summary').click();
        await expect(drawer.locator('[data-docker-webui-input]')).toHaveValue('https://sonarr.home.lan');
        await drawer.locator('[data-docker-webui-reset]').click();
        await expect.poll(() => saved.length).toBe(1);
        expect(saved[0] || {}).toEqual({});
        await expect(drawer.locator('[data-docker-webui-input]')).toHaveValue('');
    });

    // The address sits under the name, where the Bookmarks view shows a
    // bookmark's; a custom one says so, and its tag opens Custom to edit it.
    test('the head shows the address, with a custom tag only for your own', async ({ page }) => {
        const { drawer } = await openOverview(page);
        const url = drawer.locator('.config-bm-panel-head [data-slp-url]');
        await expect(url).toHaveText(/:8989\/$/);
        await expect(drawer.locator('[data-docker-webui-tag]')).toHaveCount(0);
    });

    test('a custom address is tagged, and the tag opens Custom', async ({ page }) => {
        const { drawer } = await openOverview(page, {
            ...SONARR, webui: 'https://sonarr.home.lan', webuiCustom: 'https://sonarr.home.lan',
        });
        await expect(drawer.locator('.config-bm-panel-head [data-slp-url]')).toHaveAttribute('href', 'https://sonarr.home.lan');
        const tag = drawer.locator('[data-docker-webui-tag]');
        await expect(tag).toHaveText(/custom/i);
        await tag.click();
        await expect(drawer.locator('[data-docker-section="custom"]')).toHaveAttribute('open', '');
        await expect(drawer.locator('[data-docker-webui-input]')).toBeVisible();
    });

    test('not a web address: said so, and nothing saved', async ({ page }) => {
        const { drawer, saved } = await openOverview(page);
        await drawer.locator('[data-docker-section="custom"] summary').click();
        await drawer.locator('[data-docker-webui-input]').fill('javascript:alert(1)');
        await drawer.locator('[data-docker-webui-save]').click();
        await expect(drawer.locator('[data-docker-webui-error]')).toBeVisible();
        expect(saved).toEqual([]);
    });

    test(':docker <name> open goes to the custom address', async ({ page }) => {
        await mockDocker(page, { containers: [{ ...SONARR, webui: 'https://sonarr.home.lan', webuiCustom: 'https://sonarr.home.lan' }] });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            window.__opened = [];
            window.open = (u) => { window.__opened.push(String(u)); return null; };
        });
        await page.keyboard.press('>');
        await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
        for (const ch of ':docker sonarr op') {
            await page.keyboard.press(ch);
            await page.waitForTimeout(40);
        }
        await page.locator('.search-match', { hasText: /open sonarr/i }).click();
        await expect.poll(() => page.evaluate(() => window.__opened)).toEqual(['https://sonarr.home.lan']);
    });
});
