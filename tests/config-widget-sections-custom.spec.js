// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen,
} = require('./e2e-helpers');

/**
 * The Custom widget uses the same three folding sections as every other kind:
 * its address, credential and probe are Connection, its figures Display.
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

const custom = {
    type: 'custom', title: 'Mine',
    config: { url: 'https://service.example/api/stats', fields: [{ path: 'a.b', label: 'A' }] },
};
const section = (detail, name) => detail.locator(`[data-widget-section="${name}"]`);

test.describe('the Custom widget in three sections', () => {
    test('Custom: address, credential and the probe are in Connection, the figures table in Display', async ({ page }) => {
        const detail = await openWidget(page, custom);
        const names = await detail.locator('[data-widget-section]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('data-widget-section')));
        expect(names).toEqual(['connection', 'display', 'advanced']);
        const connection = section(detail, 'connection');
        await expect(connection.locator('[data-widget-setting="url"]')).toHaveCount(1);
        await expect(connection.locator('[data-widget-setting="method"]')).toHaveCount(1);
        await expect(connection.locator('[data-custom-test]')).toHaveCount(1);
        await expect(connection.locator('[data-custom-live]')).toHaveCount(1);
        await expect(connection.locator('[data-custom-probe]')).toHaveCount(1);
        await expect(connection.locator('[data-widget-auth]').first()).toHaveCount(1);
        const display = section(detail, 'display');
        await expect(display.locator('[data-custom-field="path"]')).toHaveCount(1);
        await expect(display.locator('[data-custom-add]')).toHaveCount(1);
        await expect(display.locator('[data-widget-setting="columns"]')).toHaveCount(1);
        await expect(section(detail, 'advanced').locator('[data-widget-setting="ttl"]')).toHaveCount(1);
        await expect(detail.locator('.config-widget-settings-body.is-custom')).toHaveCount(1);
    });

    test('the figures table keeps the full width of Display', async ({ page }) => {
        const detail = await openWidget(page, custom);
        const display = section(detail, 'display');
        await expect(display).toHaveAttribute('open', '');
        const bodyWidth = (await display.locator('.config-widget-section-body').boundingBox()).width;
        const tableWidth = (await display.locator('.config-custom-group').first().boundingBox()).width;
        expect(Math.abs(bodyWidth - tableWidth)).toBeLessThanOrEqual(8);
    });

    test('Watch keeps running while Connection is collapsed', async ({ page }) => {
        let asked = 0;
        await page.route('**/api/widgets/custom/test', async (route) => {
            asked += 1;
            await route.fulfill({ json: { status: 200, result: { values: [{ label: 'A', value: '1' }] } } });
        });
        const detail = await openWidget(page, custom);
        const connection = section(detail, 'connection');
        // A connected widget starts folded; open it to reach the probe.
        if (await connection.getAttribute('open') === null) await connection.locator('summary').click();
        await detail.locator('[data-custom-live-every]').selectOption('5');
        await detail.locator('[data-custom-live]').check();
        await expect.poll(() => asked).toBeGreaterThanOrEqual(1);
        await connection.locator('summary').click();
        await expect(connection).not.toHaveAttribute('open', /.*/);
        const before = asked;
        await expect.poll(() => asked, { timeout: 15_000 }).toBeGreaterThanOrEqual(before + 2);
        await connection.locator('summary').click();
        await expect(connection).toHaveAttribute('open', '');
        await expect(detail.locator('[data-custom-live]')).toBeChecked();
        const again = asked;
        await expect.poll(() => asked, { timeout: 15_000 }).toBeGreaterThan(again);
    });
});
