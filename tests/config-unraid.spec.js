// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config -> Unraid: one connection for every Unraid widget. The
 * server side is intercepted; what is under test is what the section sends and
 * what it says back.
 */

async function openSection(page, settings) {
    await page.route('**/api/unraid/settings', async (route) => {
        if (route.request().method() === 'GET') {
            if (settings.__status) return route.fulfill({ status: settings.__status, contentType: 'text/plain', body: 'boom' });
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
        }
        page.__saved = JSON.parse(route.request().postData() || '{}');
        return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ server: { ...page.__saved.server, id: 'u_1' }, keySet: true }) });
    });
    await markWhatsNewSeen(page);
    await page.goto('/#config/unraid');
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('[data-unraid-field="baseUrl"]', { timeout: 20_000 });
    // A load draws config twice; text typed before the second draw is lost.
    await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
}

const SAVED = { id: 'u_1', name: 'tower', baseUrl: 'http://192.168.1.10', enabled: true, insecureTls: false, notify: true };

test.describe('Unraid connection', () => {
    test('suggests the bridge gateway when nothing is saved', async ({ page }) => {
        await openSection(page, { server: null, keySet: false, suggestedBaseUrl: 'http://172.17.0.1' });
        await expect(page.locator('[data-unraid-field="baseUrl"]')).toHaveAttribute('placeholder', 'http://172.17.0.1');
    });

    test('Test connection shows name, versions and what the key may read', async ({ page }) => {
        await page.route('**/api/unraid/test', (route) => route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, info: { name: 'tower', unraid: '7.2.1', api: '4.37.5', roles: ['ADMIN'] },
                areas: { array: 'ok', parity: 'ok', shares: 'ok', vms: 'forbidden', ups: 'unsupported', notifications: 'ok' },
                viewerIsEnough: true }) }));
        await openSection(page, { server: null, keySet: false, suggestedBaseUrl: '' });
        await page.locator('[data-unraid-field="baseUrl"]').fill('http://192.168.1.10');
        await page.locator('[data-unraid-field="key"]').fill('abc');
        await page.locator('[data-unraid-test]').click();
        const result = page.locator('[data-unraid-result]');
        await expect(result).toContainText('tower');
        await expect(result).toContainText('7.2.1');
        await expect(result).toContainText('VMs: not allowed');
        await expect(result).toContainText('Viewer is enough');
    });

    test('Save sends the server, and the key only when it was typed', async ({ page }) => {
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        await expect(page.locator('[data-unraid-field="key"]')).toHaveAttribute('placeholder', /Set/);
        await page.locator('[data-unraid-field="insecureTls"]').check();
        await page.locator('[data-unraid-save]').click();
        await expect.poll(() => page.__saved?.server?.insecureTls).toBe(true);
        expect('key' in page.__saved).toBe(false);
        expect(page.__saved.server.notify).toBe(true);
    });

    test('a new address says it needs the key again, before Save', async ({ page }) => {
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        const warn = page.locator('[data-unraid-key-warning]');
        await expect(page.locator('[data-unraid-address-hint]')).toContainText('A new address needs the key again');
        await expect(warn).toBeHidden();
        await page.locator('[data-unraid-field="baseUrl"]').fill('http://192.168.1.20');
        await expect(warn).toBeVisible();
        await page.locator('[data-unraid-field="key"]').fill('abc');
        await expect(warn).toBeHidden();
        await page.locator('[data-unraid-field="key"]').fill('');
        await page.locator('[data-unraid-field="baseUrl"]').fill('http://192.168.1.10/');
        await expect(warn).toBeHidden();
    });

    test('Save with a typed key sends it, and the field is cleared', async ({ page }) => {
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        // The saved server is read first: Save is shut until it is known.
        await expect(page.locator('[data-unraid-save]')).toBeEnabled();
        await page.locator('[data-unraid-field="key"]').fill('secret-key');
        await page.locator('[data-unraid-save]').click();
        await expect.poll(() => page.__saved?.key).toBe('secret-key');
        await expect(page.locator('[data-unraid-field="key"]')).toHaveValue('');
        await expect(page.locator('[data-unraid-result]')).toContainText('Saved');
    });

    test('a settings answer that fails keeps Save and Test shut', async ({ page }) => {
        await openSection(page, { __status: 500 });
        await expect(page.locator('[data-unraid-result]')).toContainText('Could not read the Unraid settings');
        await expect(page.locator('[data-unraid-save]')).toBeDisabled();
        await expect(page.locator('[data-unraid-test]')).toBeDisabled();
    });

    test('the eye shows what is typed, and hides it again', async ({ page }) => {
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        const key = page.locator('[data-unraid-field="key"]');
        await key.fill('abc');
        await expect(key).toHaveAttribute('type', 'password');
        await page.locator('[data-unraid-reveal]').click();
        await expect(key).toHaveAttribute('type', 'text');
        await page.locator('[data-unraid-reveal]').click();
        await expect(key).toHaveAttribute('type', 'password');
    });

    test('a refused write token is named, and the buttons rest while a request is out', async ({ page }) => {
        let release;
        const held = new Promise((r) => { release = r; });
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        await page.route('**/api/unraid/test', async (route) => {
            await held;
            return route.fulfill({ status: 401, contentType: 'text/plain', body: 'no token' });
        });
        await page.locator('[data-unraid-test]').click();
        await expect(page.locator('[data-unraid-save]')).toBeDisabled();
        release();
        await expect(page.locator('[data-unraid-result]')).toContainText('Not allowed: the write token');
        await expect(page.locator('[data-unraid-save]')).toBeEnabled();
    });
});

// The page sends back every setting it loaded with each ordinary save. The
// Unraid server is not one of them: a page opened before the address changed
// must not put the old one back.
test('an ordinary settings save leaves the Unraid server alone', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const api = (path, init) => page.evaluate(async ({ path, init }) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await f(path, init);
        return res.json().catch(() => ({}));
    }, { path, init });
    const put = (baseUrl) => api('/api/unraid/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: { name: 'tower', baseUrl, enabled: true } }),
    });
    try {
        await put('http://192.168.1.10');
        // Loaded with the first address, as a page opened before the change.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.settings != null, null, { timeout: 20_000 });
        await put('http://192.168.1.20');
        await page.evaluate(() => window.dashboardInstance.data.saveSettings());
        const state = await api('/api/unraid/settings');
        expect(state.server?.baseUrl, 'a settings save brought the old address back').toBe('http://192.168.1.20');
    } finally {
        await put('');
    }

});

test.describe('Config -> Unraid explains itself', () => {
    // How it works: three steps, each ticked off from what the server says.
    test('the steps tick off: key saved, server answering, a widget on a page', async ({ page }) => {
        await page.route('**/api/unraid/area/info', (route) => route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ area: 'info', status: 'ok', data: { name: 'tower' } }) }));
        await page.route('**/api/pages/*/blocks', (route) => route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ pageId: 1, widgets: [{ id: 'w_1', type: 'unraidArray' }], order: ['w_1'] }) }));
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        for (const id of ['key', 'connect', 'widgets']) {
            await expect(page.locator(`[data-unraid-step="${id}"]`)).toHaveClass(/is-done/);
        }
        await expect(page.locator('[data-unraid-flow-address]')).toHaveText('192.168.1.10');
    });

    test('nothing set up: no step is ticked', async ({ page }) => {
        await page.route('**/api/pages/*/blocks', (route) => route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ pageId: 1, widgets: [], order: [] }) }));
        await openSection(page, { server: null, keySet: false, suggestedBaseUrl: '' });
        await expect(page.locator('[data-unraid-step="widgets"]')).not.toHaveClass(/is-done/);
        await expect(page.locator('.unraid-step.is-done')).toHaveCount(0);
    });

    // What you get: each kind's Add leads to that kind in Widgets -> Types,
    // with its own Add focused -- one Enter from a widget on the page.
    test('Add on a kind opens Widgets -> Types on that kind', async ({ page }) => {
        await openSection(page, { server: SAVED, keySet: true, suggestedBaseUrl: '' });
        await expect(page.locator('[data-unraid-preview] .unraid-mini')).toHaveCount(7);
        await page.locator('[data-unraid-add="unraidParity"]').click();
        await expect(page.locator('#config-section-widgets')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-widgets-tab="types"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#config-widgets-body [data-widget-add="unraidParity"]')).toBeFocused();
    });

    test('Open Widgets -> Types lands on the Unraid group', async ({ page }) => {
        await openSection(page, { server: null, keySet: false, suggestedBaseUrl: '' });
        await page.locator('[data-unraid-explain] [data-unraid-goto-widgets]').click();
        await expect(page.locator('[data-widgets-tab="types"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#config-widgets-body [data-widget-add="unraid"]')).toBeInViewport();
    });
});
