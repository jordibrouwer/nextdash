// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The address a preset fills in, and what happens when it is retyped.
 *
 * A preset contributes two things: a sample host, which is meant to be
 * replaced, and the path its API answers on, which is not. One text box holds
 * both, so replacing the host by hand throws the path away -- and the service
 * then answers its own front page, which is a 200 that is not JSON.
 */
async function openWidgets(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    /*
     * The store is reset per spec file, not per test, so without this each
     * test inherits the widgets the one before it added -- and every widget
     * here is added by the test that needs it.
     */
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', {
            method: 'PUT', headers, body: JSON.stringify({ widgets: [] }),
        });
    });
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
}

/**
 * Add a custom widget and open its settings; returns the row index.
 *
 * The list repaints when the widget lands, so the count is waited on rather
 * than the click being followed straight by a lookup: a locator resolved
 * against the list as it was is a node the repaint has already replaced.
 */
async function addCustom(page) {
    const before = await page.locator('[data-widget-settings]').count();
    await page.locator('[data-widget-catalogue]').click();
    await page.locator('.modal--widget-catalogue [data-widget-add="custom"]').click();
    await expect.poll(() => page.locator('[data-widget-settings]').count()).toBe(before + 1);

    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    await toggle.click();
    await expect(page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`))
        .toBeVisible();
    return index;
}

test.describe('a preset’s path survives the host being replaced', () => {
    test('retyping the address as a bare host puts the path back', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const url = page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`);

        await page.locator(`[data-widget-row="${index}"] [data-widget-preset]`).selectOption('adguard');
        await expect(url).toHaveValue('http://adguard.local:3000/control/stats');

        // What someone actually does next: replace the sample with their own
        // box. Typed and blurred, which is what fires change.
        await url.fill('http://192.168.0.3');
        await url.blur();

        await expect(url).toHaveValue('http://192.168.0.3/control/stats');
    });

    test('a port that was typed is kept, even when it is the scheme’s default',
        async ({ page }) => {
            await openWidgets(page);
            const index = await addCustom(page);
            const url = page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`);

            await page.locator(`[data-widget-row="${index}"] [data-widget-preset]`).selectOption('adguard');
            // :80 is http's default, so URL.origin drops it. Someone who wrote
            // it meant it, and a box that silently deletes what was typed into
            // it reads as a box refusing the value.
            await url.fill('http://192.168.0.3:80');
            await url.blur();

            await expect(url).toHaveValue('http://192.168.0.3:80/control/stats');
        });

    test('an address that names its own path is left alone', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const url = page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`);

        await page.locator(`[data-widget-row="${index}"] [data-widget-preset]`).selectOption('adguard');
        await url.fill('http://192.168.0.3/control/some-other-endpoint');
        await url.blur();

        await expect(url).toHaveValue('http://192.168.0.3/control/some-other-endpoint');
    });

    test('without a preset the address is never rewritten', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const url = page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`);

        // No preset chosen: nothing knows a path, so nothing may invent one.
        await url.fill('http://192.168.0.3');
        await url.blur();

        await expect(url).toHaveValue('http://192.168.0.3');
    });

    test('the restored path is what gets saved', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const url = page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`);

        await page.locator(`[data-widget-row="${index}"] [data-widget-preset]`).selectOption('adguard');
        await url.fill('http://192.168.0.3:80');
        await url.blur();

        // AdGuard signs in with a username and password, and the panel refuses
        // to save a half-filled credential -- so this is the whole journey the
        // reader makes, not just the address half of it.
        const row = page.locator(`[data-widget-row="${index}"]`);
        await row.locator('[data-widget-auth="basicUser"]').fill('someone');
        await row.locator('[data-widget-auth="secret"]').fill('a-password');
        await row.locator('[data-widget-save]').click();

        await expect.poll(async () => page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await f('/api/pages/1/blocks')).json();
            return (blocks.widgets || []).filter((w) => w.type === 'custom').map((w) => w.config?.url);
        })).toEqual(['http://192.168.0.3:80/control/stats']);
    });
});
