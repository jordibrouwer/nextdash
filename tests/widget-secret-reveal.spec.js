// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The eye beside a widget's API key.
 *
 * A key is stored write-only -- the panel is drawn from the shape around it,
 * never the value -- which leaves one question unanswerable from the screen:
 * what is actually in there. An Authorization header missing its "Bearer"
 * prefix looks exactly like a correct one, and the service answers 401 either
 * way, so the difference was only visible by reading the file on disk.
 */
async function openWidgets(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
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

async function addCustom(page) {
    const before = await page.locator('[data-widget-settings]').count();
    await page.locator('[data-widget-catalogue]').click();
    await page.locator('.modal--widget-catalogue [data-widget-add="custom"]').click();
    await expect.poll(() => page.locator('[data-widget-settings]').count()).toBe(before + 1);
    await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]'))
        .toBeFocused({ timeout: 10_000 });

    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    await toggle.click();
    await expect(page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`))
        .toBeVisible();
    return index;
}

/** Choose "An API key" and name the header, the way the form is filled in. */
async function chooseApiKey(page, index, headerName) {
    const row = `[data-widget-row="${index}"]`;
    await page.locator(`${row} [data-widget-auth="kind"]`).selectOption('header');
    const name = page.locator(`${row} [data-widget-auth="headerName"]`);
    await expect(name).toBeVisible();
    await name.fill(headerName);
    await name.blur();
}

test.describe('a widget’s stored key can be looked at', () => {
    test('what is being typed is masked until the eye is pressed', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        await chooseApiKey(page, index, 'Authorization');

        const row = `[data-widget-row="${index}"]`;
        const key = page.locator(`${row} [data-widget-auth="secret"]`);
        await key.fill('Bearer typed-just-now');

        // Masked by default: the box is a password box until asked otherwise.
        await expect(key).toHaveAttribute('type', 'password');

        const eye = page.locator(`${row} [data-secret-reveal]`);
        await eye.click();
        await expect(key).toHaveAttribute('type', 'text');
        await expect(key).toHaveValue('Bearer typed-just-now');

        // And away again, without losing what was typed -- that is an edit.
        await eye.click();
        await expect(key).toHaveAttribute('type', 'password');
        await expect(key).toHaveValue('Bearer typed-just-now');
    });

    test('a saved key is shown as itself, not as an empty box', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        await chooseApiKey(page, index, 'Authorization');

        const row = `[data-widget-row="${index}"]`;
        const key = page.locator(`${row} [data-widget-auth="secret"]`);
        await key.fill('Bearer stored-and-saved');
        await key.blur();
        await page.locator(`${row} [data-widget-save]`).click();

        // Redrawn from what is stored: the box is empty and says so, which is
        // the state this whole feature exists for.
        await expect.poll(async () => key.inputValue()).toBe('');
        await expect(key).toHaveAttribute('type', 'password');

        await page.locator(`${row} [data-secret-reveal]`).click();

        await expect(key).toHaveValue('Bearer stored-and-saved', { timeout: 10_000 });
        await expect(key).toHaveAttribute('type', 'text');
    });

    test('hiding a fetched key takes it back out of the box', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        await chooseApiKey(page, index, 'Authorization');

        const row = `[data-widget-row="${index}"]`;
        const key = page.locator(`${row} [data-widget-auth="secret"]`);
        await key.fill('Bearer stored-and-saved');
        await key.blur();
        await page.locator(`${row} [data-widget-save]`).click();
        await expect.poll(async () => key.inputValue()).toBe('');

        const eye = page.locator(`${row} [data-secret-reveal]`);
        await eye.click();
        await expect(key).toHaveValue('Bearer stored-and-saved', { timeout: 10_000 });

        /*
         * A masked box still holds its value, so re-masking a fetched key would
         * leave it in the DOM behind a dot pattern -- the appearance of putting
         * it away rather than putting it away.
         */
        await eye.click();
        await expect(key).toHaveValue('');
        await expect(key).toHaveAttribute('type', 'password');
    });

    test('an Authorization header says it wants a scheme in front', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        await chooseApiKey(page, index, 'X-Api-Key');
        // Not every key takes a scheme; only Authorization carries one.
        await expect(page.locator(`${row} .config-widget-note-hint`)).toHaveCount(0);

        await page.locator(`${row} [data-widget-auth="headerName"]`).fill('Authorization');
        await page.locator(`${row} [data-widget-auth="headerName"]`).blur();

        await expect(page.locator(`${row} .config-widget-note-hint`)).toContainText('Bearer');
    });
});

test.describe('a preset seeds the scheme its header needs', () => {
    test('Speedtest Tracker fills in Bearer, ready for the token', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        await page.locator(`${row} [data-widget-preset]`).selectOption('speedtest');

        const key = page.locator(`${row} [data-widget-auth="secret"]`);
        // Shown rather than masked: the scheme is not the secret, and it is
        // the half the reader could not have known to type.
        await expect(key).toHaveValue('Bearer ');
        await expect(key).toHaveAttribute('type', 'text');
        await expect(page.locator(`${row} [data-widget-auth="headerName"]`))
            .toHaveValue('Authorization');
    });

    test('the scheme is the one that preset wants, not always Bearer', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;
        const key = page.locator(`${row} [data-widget-auth="secret"]`);

        // Paperless takes "Token ", and a shared "Bearer " would be wrong for
        // it in exactly the silent way this feature exists to prevent.
        await page.locator(`${row} [data-widget-preset]`).selectOption('paperless');
        await expect(key).toHaveValue('Token ');

        await page.locator(`${row} [data-widget-preset]`).selectOption('proxmox');
        await expect(key).toHaveValue('PVEAPIToken=');
    });

    test('a preset whose header carries no scheme seeds nothing', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        // Sonarr's key goes in X-Api-Key whole; there is no scheme to add.
        await page.locator(`${row} [data-widget-preset]`).selectOption('sonarr');
        await expect(page.locator(`${row} [data-widget-auth="headerName"]`))
            .toHaveValue('X-Api-Key');
        await expect(page.locator(`${row} [data-widget-auth="secret"]`)).toHaveValue('');
    });

    test('the seeded scheme alone is refused as a key', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        await page.locator(`${row} [data-widget-preset]`).selectOption('speedtest');
        await expect(page.locator(`${row} [data-widget-auth="secret"]`)).toHaveValue('Bearer ');

        // Pressing Save now would file the word "Bearer" as the secret: a
        // header that looks filled in and authenticates as nothing.
        await page.locator(`${row} [data-widget-save]`).click();

        await expect(page.locator(`${row} [data-widget-save-state]`))
            .toContainText('key', { ignoreCase: true });
    });
});
