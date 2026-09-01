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

/*
 * SABnzbd, Tautulli, Pi-hole v5 and Plex take their key in the address and offer
 * no header form. That used to mean the sign-in block vanished entirely and the
 * reader was left replacing YOUR_KEY in the address by hand -- an API key box
 * that asked for nothing, above an address that asked for everything.
 */
test.describe('a service whose key goes in the address', () => {
    test('still asks for the key in the sign-in block', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        await page.locator(`${row} [data-widget-preset]`).selectOption('sabnzbd');

        await expect(page.locator(`${row} [data-widget-auth="kind"]`)).toHaveValue('query');
        await expect(page.locator(`${row} [data-widget-auth="secret"]`)).toBeVisible();
        // Named, so the note can say where the key is going.
        await expect(page.locator(`${row} .config-widget-note-hint`)).toContainText('apikey');
    });

    test('the address a preset writes never mentions the key', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;
        const url = page.locator(`${row} [data-widget-setting="url"]`);

        /*
         * The address used to arrive reading `apikey=YOUR_KEY`, directly above a
         * box asking for that same key -- so the panel asked for the key twice
         * and meant it once. The parameter is left out entirely now; the server
         * adds it, and what is on screen is only what the reader has to fill in.
         */
        await page.locator(`${row} [data-widget-preset]`).selectOption('sabnzbd');
        await expect(url).not.toHaveValue(/apikey/);
        await expect(url).not.toHaveValue(/YOUR_/);
        // The rest of the path survives: without mode and output SABnzbd
        // answers something else entirely.
        await expect(url).toHaveValue(/mode=queue/);
        await expect(url).toHaveValue(/output=json/);

        await page.locator(`${row} [data-widget-preset]`).selectOption('plex');
        await expect(url).not.toHaveValue(/X-Plex-Token/);
        await expect(url).not.toHaveValue(/YOUR_/);
    });

    test('the key is stored rather than written into the address', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        await page.locator(`${row} [data-widget-preset]`).selectOption('sabnzbd');
        const url = page.locator(`${row} [data-widget-setting="url"]`);
        await url.fill('http://sab.local:8081/api?mode=queue&output=json');
        await url.blur();

        const key = page.locator(`${row} [data-widget-auth="secret"]`);
        await key.fill('746071e5e78f4f36b71b3536e46f1ec9');
        await key.blur();
        await page.locator(`${row} [data-widget-save]`).click();
        await expect.poll(async () => key.inputValue(), { timeout: 10_000 }).toBe('');

        /*
         * The key is nowhere in the address. A url is stored in
         * bookmarks-N.json, which is in the backup allowlist and in every
         * export, so a key written here would travel in a ZIP -- the whole
         * reason the credential file exists. The server puts the parameter on
         * as the request goes out.
         */
        await expect(url).not.toHaveValue(/746071e5/);
        await expect(url).not.toHaveValue(/apikey/);
    });

    test('the stored address key can be looked at too', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        await page.locator(`${row} [data-widget-preset]`).selectOption('sabnzbd');
        const url = page.locator(`${row} [data-widget-setting="url"]`);
        await url.fill('http://sab.local:8081/api?mode=queue&output=json');
        await url.blur();

        const key = page.locator(`${row} [data-widget-auth="secret"]`);
        await key.fill('746071e5e78f4f36b71b3536e46f1ec9');
        await key.blur();
        await page.locator(`${row} [data-widget-save]`).click();
        await expect.poll(async () => key.inputValue(), { timeout: 10_000 }).toBe('');

        await page.locator(`${row} [data-secret-reveal]`).click();
        await expect(key).toHaveValue('746071e5e78f4f36b71b3536e46f1ec9', { timeout: 10_000 });
    });

    test('Plex asks for the token, not for the Accept header', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        /*
         * Plex was the worst of the four: its API key box asked for an Accept
         * header -- which is not a secret and is the same for everyone -- while
         * the token that actually signs the request had to go in the address by
         * hand.
         */
        await page.locator(`${row} [data-widget-preset]`).selectOption('plex');

        await expect(page.locator(`${row} [data-widget-auth="kind"]`)).toHaveValue('query');
        await expect(page.locator(`${row} .config-widget-note-hint`)).toContainText('X-Plex-Token');
    });
});

/*
 * The bug this guards was silent twice over: `auth: 'query'` had no branch in
 * the panel, so four presets fell through to "no credential needed" and their
 * sign-in block simply was not drawn. `auth: 'cookie'` did the same to
 * qBittorrent, and went unnoticed for longer because nobody looked past the
 * preset that was reported.
 *
 * So this asks the question of every preset at once rather than of the ones
 * somebody thought to check.
 */
test.describe('every preset that needs a credential asks for one', () => {
    test('no preset falls through to no sign-in block', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;

        const presets = await page.evaluate(() =>
            (window.DashboardWidgetPresets?.PRESETS || [])
                .map((p) => ({ id: p.id, name: p.name, auth: p.auth || 'none' })));
        expect(presets.length).toBeGreaterThan(20);

        const wrong = [];
        for (const preset of presets) {
            await page.locator(`${row} [data-widget-preset]`).selectOption(preset.id);
            const kind = await page.locator(`${row} [data-widget-auth="kind"]`).inputValue();
            // A preset that needs no credential is allowed to say so; one that
            // does must land on a kind that draws a box to type it into.
            const needsOne = preset.auth !== 'none';
            const asksForOne = kind !== 'none'
                && await page.locator(`${row} [data-widget-auth="secret"]`).count() > 0;
            if (needsOne !== asksForOne) {
                wrong.push(`${preset.id} (auth: ${preset.auth}) landed on kind "${kind}"`);
            }
        }
        expect(wrong).toEqual([]);
    });

    test('no preset leaves a key for the reader to paste into the address', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const row = `[data-widget-row="${index}"]`;
        const url = page.locator(`${row} [data-widget-setting="url"]`);

        const ids = await page.evaluate(() =>
            (window.DashboardWidgetPresets?.PRESETS || []).map((p) => p.id));

        const leaking = [];
        for (const id of ids) {
            await page.locator(`${row} [data-widget-preset]`).selectOption(id);
            const address = await url.inputValue();
            /*
             * YOUR_NODE and YOUR_SENSOR are fine: a Proxmox node and a Home
             * Assistant sensor are names, not secrets, and naming one is the
             * reader's job. A key is not.
             */
            if (/YOUR_(KEY|TOKEN|API|SECRET|PASS)/i.test(address)) {
                leaking.push(`${id}: ${address}`);
            }
        }
        expect(leaking).toEqual([]);
    });
});
