// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen,
} = require('./e2e-helpers');

/**
 * The media kinds (Sonarr, Jellyfin, ...) use the same three sections as every
 * other widget: the address, key and Connect in Connection, the page, width and
 * what to show in Display, the refresh and click in Advanced.
 */
async function openWidget(page, widget) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const dash = window.dashboardInstance;
        await f(`/api/pages/${dash.pages[0].id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: list }) });
        await dash.config.openConfigView('widgets');
    }, [widget]);
    await expect(page.locator('#config-widgets-body')).toBeVisible();
    const toggle = page.locator('[data-widget-settings]').first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const detail = page.locator('.config-widget-detail').first();
    await expect(detail).toBeVisible();
    return detail;
}

/*
 * A Sonarr widget with an address and a filed key, opened in a fresh visit:
 * the panel asks the server on its own, and `answer` is what it hears back.
 */
async function openSavedSonarr(page, answer) {
    await page.route('**/api/widgets/sonarr/setup', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
    await openWidget(page, { type: 'sonarr', title: 'Shows', config: { server: 'http://sonarr.lan:8989' } });
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const id = document.querySelector('.config-widget-detail [data-widget-section-of]')
            .getAttribute('data-widget-section-of');
        const res = await f('/api/health/credentials', { method: 'PUT', headers,
            body: JSON.stringify({ id: `widget:${id}`, label: 'Shows', headers: { 'X-Api-Key': 'abc-key' } }) });
        if (!res.ok) throw new Error(`credential PUT ${res.status}`);
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
    const toggle = page.locator('[data-widget-settings]').first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const detail = page.locator('.config-widget-detail').first();
    await expect(detail).toBeVisible();
    return detail;
}

const sonarr = { type: 'sonarr', title: 'Shows', config: {} };
const jellyfin = { type: 'jellyfin', title: 'Media', config: {} };
const section = (detail, name) => detail.locator(`[data-widget-section="${name}"]`);

test.describe('media widget settings in three sections', () => {
    test('Sonarr: address, key and Connect are in Connection; Page and Width in Display', async ({ page }) => {
        const detail = await openWidget(page, sonarr);
        // The page picker only exists with a second page to move to: make a real one.
        const added = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const had = d.pages.length;
            await (d.config._module || d.config.instance || d.config).addPage();
            const until = Date.now() + 10_000;
            while (d.pages.length <= had && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
            (d.config._module || d.config.instance || d.config).repaintWidgetsBody();
            return d.pages[d.pages.length - 1].id;
        });
        const connection = section(detail, 'connection');
        const display = section(detail, 'display');
        await expect(connection.locator('[data-widget-setting="server"]')).toHaveCount(1);
        await expect(connection.locator('[data-widget-auth="secret"]')).toHaveCount(1);
        await expect(connection.locator('[data-media-connect]')).toHaveCount(1);
        await expect(connection.locator('[data-media-status]')).toHaveCount(1);
        await expect(display.locator('[data-widget-move-page]')).toHaveCount(1);
        await expect(display.locator('[data-widget-setting="columns"]')).toHaveCount(1);
        await expect(connection.locator('[data-widget-move-page]')).toHaveCount(0);
        await expect(connection).toContainText('Sonarr');
        await expect(connection.locator('p.config-widget-note').first()).toHaveText('Sonarr');
        const order = await detail.locator('[data-widget-section]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('data-widget-section')));
        expect(order.slice(0, 2)).toEqual(['connection', 'display']);
        await expect(detail.locator('.config-widget-settings-body.is-custom.is-media.is-sonarr')).toHaveCount(1);
        await expect(detail.locator('.config-widget-save-bar, [data-widget-save]').first()).toBeVisible();
        // Leave the install with the pages it had.
        await page.evaluate(async (id) => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {};
            await f(`/api/pages/${id}`, { method: 'DELETE', headers });
        }, added);
    });

    test('Jellyfin choices appear in Display after Connect', async ({ page }) => {
        await page.route('**/api/widgets/jellyfin/setup', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'Home', version: '10.10.3',
                users: [{ id: 'u1', name: 'jordi' }],
                libraries: [{ id: 'lib-movies', name: 'Films' }, { id: 'lib-anime', name: 'Anime' }] }) });
        });
        const detail = await openWidget(page, jellyfin);
        await detail.locator('[data-widget-setting="server"]').fill('http://jellyfin.lan:8096');
        await detail.locator('[data-widget-auth="secret"]').fill('k-123');
        await detail.locator('[data-media-connect]').click();
        await expect(detail.locator('[data-media-status]')).toContainText('Home');
        const display = section(detail, 'display');
        await expect(display.locator('[data-widget-setting="userId"]')).toHaveCount(1);
        await expect(display.locator('[data-widget-setting="libraries"][value="lib-anime"]')).toBeVisible();
        await expect(section(detail, 'connection').locator('[data-widget-setting="libraries"]')).toHaveCount(0);
        // Its own look and refresh sort the same way as for any widget.
        await expect(display.locator('[data-widget-setting="layout"]')).toHaveCount(1);
        await expect(section(detail, 'advanced').locator('[data-widget-setting="ttl"]')).toHaveCount(1);
    });

    test('Connect keeps the typed key and the section open', async ({ page }) => {
        await page.route('**/api/widgets/sonarr/setup', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ serverName: 'Shows', version: '4.0' }) });
        });
        const detail = await openWidget(page, sonarr);
        await detail.locator('[data-widget-setting="server"]').fill('http://sonarr.lan:8989');
        await detail.locator('[data-widget-auth="secret"]').fill('abc-key');
        await detail.locator('[data-media-connect]').click();
        await expect(detail.locator('[data-media-status]')).toContainText(/Shows|connected/i);
        await expect(detail.locator('[data-widget-auth="secret"]')).toHaveValue('abc-key');
        await expect(section(detail, 'connection')).toHaveAttribute('open', '');
    });

    test('a saved widget whose server cannot be reached opens Connection on the error', async ({ page }) => {
        const detail = await openSavedSonarr(page, { error: 'unreachable' });
        const connection = section(detail, 'connection');
        await expect(detail.locator('[data-media-status]')).toContainText('could not be reached', { timeout: 10_000 });
        await expect(connection).toHaveAttribute('open', '');
        await expect(detail.locator('[data-media-status]')).toBeVisible();
        await expect(connection.locator('summary')).toHaveText('Connection · not reachable');
    });

    test('a saved widget that connects keeps Connection folded and says so on its summary', async ({ page }) => {
        const detail = await openSavedSonarr(page, { serverName: 'Shows', version: '4.0' });
        const connection = section(detail, 'connection');
        await expect(detail.locator('[data-media-status]')).toContainText('Shows', { timeout: 10_000 });
        await expect(connection).not.toHaveAttribute('open', /.*/);
        await expect(connection.locator('summary')).toHaveText('Connection · connected');
    });

    test('a media widget with an address but no key keeps Connection open', async ({ page }) => {
        const detail = await openWidget(page, { type: 'sonarr', title: 'Shows', config: { server: 'http://sonarr.lan:8989' } });
        await expect(section(detail, 'connection')).toHaveAttribute('open', '');
        await expect(section(detail, 'connection')).toHaveAttribute('data-widget-section-default', 'open');
    });
});
