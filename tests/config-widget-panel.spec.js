// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What the widgets panel remembers about a widget it has already saved.
 *
 * Two things it forgot. A widget could not be renamed at all -- the row's
 * title box called a method that the panel rebuild had dropped, so every
 * rename threw and nothing was written. And the service picker came back
 * reading "Choose a service" above an address, three figures and a header that
 * Sonarr had plainly filled in, because which preset a widget was started from
 * was never stored.
 */
/**
 * Empty the page's widgets.
 *
 * The store is reset per spec file rather than per test, so without this each
 * test inherits what the ones before it added -- and every widget here is
 * added by the test that needs it. An inherited list also moves the row
 * indexes about, which is what made the last test in the file fail after the
 * four before it and pass on its own.
 */
async function clearWidgets(page) {
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
}

async function openWidgets(page, { keep = false } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    /*
     * Quickstart sweeps favicons in the background on a fresh store and
     * reopens Overview when it finishes, which takes whatever panel is on
     * screen with it. Waited out rather than raced.
     */
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.waitForTimeout(6000);
    if (!keep) await clearWidgets(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
}

/** Add a widget of one type and open its settings; returns the row index. */
async function addWidget(page, type) {
    const before = await page.locator('[data-widget-settings]').count();
    // The catalogue is an overlay, so choosing a kind is: open it, pick.
    await page.locator('[data-widget-catalogue]').click();
    await page.locator(`.modal--widget-catalogue [data-widget-add="${type}"]`).click();
    await expect.poll(() => page.locator('[data-widget-settings]').count()).toBe(before + 1);
    const index = await page.locator('[data-widget-settings]').last().getAttribute('data-widget-settings');
    await page.locator(`[data-widget-settings="${index}"]`).click();
    await expect(page.locator(`[data-widget-row="${index}"] .config-widget-settings`)).toBeVisible();
    return index;
}

/** What the server has stored for the custom widgets on page 1. */
const stored = (page) => page.evaluate(async () => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const blocks = await (await f('/api/pages/1/blocks')).json();
    return (blocks.widgets || []).map((w) => ({ title: w.title || '', presetId: w.config?.presetId }));
});

test.describe('the widgets panel remembers a saved widget', () => {
    test('a widget can be renamed after it has been saved', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));

        await openWidgets(page);
        const index = await addWidget(page, 'health');
        const title = page.locator(`[data-widget-row="${index}"] [data-widget="title"]`);

        await title.fill('Link health');
        await title.blur();

        await expect.poll(() => stored(page)).toContainEqual(
            expect.objectContaining({ title: 'Link health' }));
        // The rename used to throw rather than fail quietly, which is why it
        // left no trace anywhere a reader would look.
        expect(errors).toEqual([]);
    });

    test('the rename survives the panel being closed and reopened', async ({ page }) => {
        await openWidgets(page);
        const index = await addWidget(page, 'health');
        const title = page.locator(`[data-widget-row="${index}"] [data-widget="title"]`);
        await title.fill('Link health');
        await title.blur();
        await expect.poll(() => stored(page)).toContainEqual(
            expect.objectContaining({ title: 'Link health' }));

        await page.reload({ waitUntil: 'networkidle' });
        await openWidgets(page, { keep: true });
        await expect(page.locator(`[data-widget-row="${index}"] [data-widget="title"]`))
            .toHaveValue('Link health');
    });

    /*
     * One preset per kind of sign-in the panel offers, because it is the save
     * path that differs between them: an API key and a username both write a
     * credential first and refuse a half-filled one, and a service that needs
     * nothing writes only the widget.
     */
    for (const [service, auth, secret] of [
        ['sonarr', 'an API key', { field: 'secret', value: 'the-key' }],
        ['adguard', 'a username and password', { field: 'basicUser', value: 'someone', also: 'a-password' }],
        ['traefik', 'nothing', null],
    ]) {
        test(`the picker still names ${service}, which signs in with ${auth}`, async ({ page }) => {
            await openWidgets(page);
            const index = await addWidget(page, 'custom');
            const row = page.locator(`[data-widget-row="${index}"]`);

            await row.locator('[data-widget-preset]').selectOption(service);
            // Named on the picker the moment it is applied, not only later:
            // it was cleared here, so the panel disowned the choice at once.
            await expect(row.locator('[data-widget-preset]')).toHaveValue(service);

            if (secret) {
                await row.locator(`[data-widget-auth="${secret.field}"]`).fill(secret.value);
                if (secret.also) await row.locator('[data-widget-auth="secret"]').fill(secret.also);
            }
            await row.locator('[data-widget-save]').click();
            await expect.poll(() => stored(page)).toContainEqual(
                expect.objectContaining({ presetId: service }));

            await page.reload({ waitUntil: 'networkidle' });
            await openWidgets(page, { keep: true });
            await page.locator(`[data-widget-settings="${index}"]`).click();
            await expect(page.locator(`[data-widget-row="${index}"] [data-widget-preset]`))
                .toHaveValue(service);
        });
    }
});
