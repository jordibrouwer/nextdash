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

const sonarr = { type: 'sonarr', title: 'Shows', config: {} };
const jellyfin = { type: 'jellyfin', title: 'Media', config: {} };
const section = (detail, name) => detail.locator(`[data-widget-section="${name}"]`);

test.describe('media widget settings in three sections', () => {
    test('Sonarr: address, key and Connect are in Connection; Page and Width in Display', async ({ page }) => {
        const detail = await openWidget(page, sonarr);
        // The page picker only exists with a second page to move to.
        await page.evaluate(() => {
            const dash = window.dashboardInstance;
            dash.pages = [...dash.pages, { id: 9999, name: 'Other' }];
            (dash.config.instance || dash.config).repaintWidgetsBody();
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
        const order = await detail.locator('[data-widget-section]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('data-widget-section')));
        expect(order.slice(0, 2)).toEqual(['connection', 'display']);
        await expect(detail.locator('.config-widget-settings-body.is-custom.is-media.is-sonarr')).toHaveCount(1);
        await expect(detail.locator('.config-widget-save-bar, [data-widget-save]').first()).toBeVisible();
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
});
