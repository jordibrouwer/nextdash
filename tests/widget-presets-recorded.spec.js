// @ts-check
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Every preset, against an answer recorded from its service.
 *
 * A preset is data -- an address, a sign-in and the paths of its figures --
 * so nothing failed when a service moved a field: the tile just read "—".
 * Each preset here is pointed at a stub that answers with the service's own
 * documented response (the source of each is in its fixture), through the same
 * route Ask now uses: the real fetch, the real sign-in, the real path reader and
 * formatter. A figure that finds nothing fails the test.
 *
 * One stub per preset, on its own port: a sign-in posts to the login path on
 * the widget's host, which replaces the whole path, so a shared stub with a
 * prefix per preset would lose track of whose login it was.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'widget-presets');
const KEY = 'test-key';
const USER = 'me@example.com';
const PASSWORD = 'test-password';

function loadPresets() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'dashboard', 'dashboard-widget-presets.js'), 'utf8');
    // URL too: addressFor parses with it, and without it every preset fell
    // back to its sample host.
    const sandbox = { window: {}, URL };
    vm.runInNewContext(source, sandbox);
    return sandbox.window.DashboardWidgetPresets;
}

const catalogue = loadPresets();
const live = catalogue.PRESETS.filter((preset) => !preset.retired);

/*
 * What the service itself demands, from the fixture -- never from the preset.
 *
 * Reading it off the preset would test a preset against itself: a wrong
 * header name or a missing "Bearer " would be expected by the stub as well,
 * and pass. The fixture records the service's side of the contract.
 */
function authorised(fixture, req, url, token) {
    const auth = fixture.auth || {};
    const expected = (template) => String(template).replace('%KEY%', KEY).replace('%TOKEN%', token);
    if (auth.header && req.headers[auth.header.toLowerCase()] !== expected(auth.value)) return false;
    if (auth.alsoHeaders && !Object.entries(auth.alsoHeaders)
        .every(([name, value]) => req.headers[name.toLowerCase()] === value)) return false;
    if (auth.query && url.searchParams.get(auth.query) !== KEY) return false;
    if (auth.basic && req.headers.authorization !== `Basic ${Buffer.from(`u:${PASSWORD}`).toString('base64')}`) return false;
    if (auth.cookie && String(req.headers.cookie || '') !== `${auth.cookie}=${token}`) return false;
    return true;
}

function loginAccepted(login, contentType, body) {
    if (login.format === 'json') {
        if (!String(contentType || '').includes('application/json')) return false;
        const sent = JSON.parse(body || '{}');
        return sent[login.passField] === PASSWORD && (!login.userField || sent[login.userField] === 'u');
    }
    const form = new URLSearchParams(body);
    return form.get(login.passField) === PASSWORD && form.get(login.userField) === 'u';
}

function startStub(fixture) {
    const token = 'tok-recorded';
    const seen = { logins: 0, data: 0 };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://stub');
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const login = fixture.login;
            if (login && url.pathname === login.path && req.method === 'POST') {
                seen.logins += 1;
                if (!loginAccepted(login, req.headers['content-type'], body)) {
                    res.writeHead(401).end();
                    return;
                }
                if (fixture.auth?.cookie) {
                    res.writeHead(200, { 'Set-Cookie': `${fixture.auth.cookie}=${token}` }).end('Ok.');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' })
                    .end(JSON.stringify(login.body).replace('%TOKEN%', token));
                return;
            }
            seen.data += 1;
            if (!authorised(fixture, req, url, token)) {
                res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorised"}');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fixture.body));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

/** The credential the panel would send for a key it has not saved yet. */
function draftCredential(preset) {
    switch (preset.auth) {
        case 'header':
            return { headers: { ...(preset.fixedHeaders || {}), [preset.authName]: `${preset.scheme || ''}${KEY}` } };
        case 'query':
            return { query: { [preset.queryName]: KEY }, ...(preset.fixedHeaders ? { headers: { ...preset.fixedHeaders } } : {}) };
        case 'basic':
            return { basicUser: 'u', basicPassword: PASSWORD };
        case 'session':
            return { session: { ...preset.session, user: preset.session.userField === '' ? '' : 'u', password: PASSWORD } };
        default:
            return null;
    }
}

function fillIn(text, preset, fixture) {
    return preset.fillIn && fixture.fillIn ? String(text).split(preset.fillIn).join(fixture.fillIn) : text;
}

test.describe('every preset reads its service\'s recorded answer', () => {
    test.beforeAll(async ({ request }) => {
        // The stubs are on 127.0.0.1, which a widget reaches only with local
        // addresses allowed -- as anyone running these services on a LAN has.
        const res = await request.post('/api/settings', {
            headers: { 'X-NextDash-Token': WRITE_TOKEN },
            data: { allowLocalBookmarks: true },
        });
        expect(res.ok()).toBe(true);
    });

    test('there is a recording for every preset still offered', () => {
        const missing = live.filter((preset) => !fs.existsSync(path.join(FIXTURES, `${preset.id}.json`)));
        expect(missing.map((preset) => preset.id)).toEqual([]);
    });

    for (const preset of live) {
        test(`${preset.name}`, async ({ request }) => {
            const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${preset.id}.json`), 'utf8'));
            const stub = await startStub(fixture);
            try {
                const config = catalogue.configFor(preset, stub.base);
                config.url = fillIn(config.url, preset, fixture);
                config.fields = config.fields.map((field) => ({ ...field, path: fillIn(field.path, preset, fixture) }));
                const credential = draftCredential(preset);
                if (credential) config.draftCredential = credential;

                const res = await request.post('/api/widgets/custom/test', {
                    headers: { 'X-NextDash-Token': WRITE_TOKEN },
                    data: config,
                });
                expect(res.ok()).toBe(true);
                const answer = await res.json();
                expect(answer.error || '', `${preset.id}: ${answer.body || ''}`).toBe('');
                expect(answer.status).toBe(200);
                const values = answer.result?.values || [];
                expect(values).toHaveLength(preset.fields.length);
                for (const value of values) {
                    expect(value.missing, `${preset.id}: "${value.label}" found nothing`).toBeFalsy();
                    expect(String(value.value), `${preset.id}: "${value.label}" is empty`).not.toBe('');
                    // One figure is one value: a path that lands on a whole
                    // entry or list has found the wrong thing, however full.
                    expect(typeof value.raw === 'object' && value.raw !== null,
                        `${preset.id}: "${value.label}" is an object, not a figure`).toBe(false);
                }
                if (preset.auth === 'session') expect(stub.seen.logins).toBe(1);
            } finally {
                stub.server.close();
            }
        });
    }
});

test.describe('presets in the widget panel', () => {
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
            await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
        });
        await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
        await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
    }

    /** Add a custom widget through the catalogue and return its row index. */
    async function addCustom(page) {
        const before = await page.locator('[data-widget-settings]').count();
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('.modal--widget-catalogue [data-widget-add="custom"]').click();
        await expect.poll(() => page.locator('[data-widget-settings]').count()).toBe(before + 1);
        await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]'))
            .toBeFocused({ timeout: 10_000 });
        const toggle = page.locator('[data-widget-settings]').last();
        const index = await toggle.getAttribute('data-widget-settings');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await expect(page.locator(`[data-widget-row="${index}"] [data-widget-setting="url"]`)).toBeVisible();
        return index;
    }

    test('a retired service is not offered for a new widget', async ({ page }) => {
        await openWidgets(page);
        const index = await addCustom(page);
        const offered = await page.locator(`[data-widget-row="${index}"] [data-widget-preset] option`)
            .evaluateAll((options) => options.map((option) => option.value));
        expect(offered).toContain('sonarr');
        expect(offered).toContain('npm');
        for (const id of ['readarr', 'pihole5', 'truenas']) expect(offered).not.toContain(id);
    });

    test('Pi-hole v6 asks for a password only, and Ask now signs in with it', async ({ page, request }) => {
        await request.post('/api/settings', {
            headers: { 'X-NextDash-Token': WRITE_TOKEN }, data: { allowLocalBookmarks: true },
        });
        const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'pihole6.json'), 'utf8'));
        const stub = await startStub(fixture);
        try {
            await openWidgets(page);
            const index = await addCustom(page);
            const row = page.locator(`[data-widget-row="${index}"]`);
            await row.locator('[data-widget-preset]').selectOption('pihole6');

            await expect(row.locator('[data-widget-auth="basicUser"]')).toBeHidden();
            const url = row.locator('[data-widget-setting="url"]');
            await url.fill(`${stub.base}/api/stats/summary`);
            await url.blur();
            await row.locator('[data-widget-auth="secret"]').fill(PASSWORD);
            await page.locator(`[data-custom-test="${index}"]`).click();

            await expect(row.locator('.config-custom-found').first()).toHaveText(/51/);
            expect(stub.seen.logins).toBe(1);
        } finally {
            stub.server.close();
        }
    });
});
