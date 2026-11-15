// @ts-check
const { test, expect } = require('./fixtures');

/**
 * Config -> Containers -> Connection -> Other Docker hosts: add, test, switch
 * actions on, edit and remove a host. The hosts API is answered here, in
 * memory, so the dev data dir is left alone; what is asserted is what the page
 * sends and what it shows. Certificates are write-only: an edit that leaves a
 * field empty sends nothing for it.
 */
async function mockHosts(page) {
    const state = { hosts: [], sent: [], probes: [], nextProbe: { ok: true, version: '27.3.1' }, testHttpError: false };
    await page.route('**/api/docker/hosts**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const method = req.method();
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (method === 'GET') return json({ max: 4, hosts: state.hosts });
        const body = req.postDataJSON() || {};
        if (path.endsWith('/test')) {
            state.probes.push(body);
            if (state.testHttpError) return route.fulfill({ status: 401, contentType: 'text/plain', body: 'Unauthorized' });
            return json(state.nextProbe);
        }
        if (method === 'POST') {
            state.sent.push({ method, body });
            if (!body.name) return route.fulfill({ status: 400, contentType: 'text/plain', body: 'A host needs a name' });
            const host = { id: 'd_000000000001', name: body.name, kind: body.kind, address: body.address, allowActions: Boolean(body.allowActions),
                hasCA: Boolean(body.ca), hasCert: Boolean(body.cert), hasKey: Boolean(body.key) };
            state.hosts.push(host);
            return json(host);
        }
        const id = decodeURIComponent(path.split('/').pop() || '');
        if (method === 'PUT') {
            state.sent.push({ method, body });
            const host = state.hosts.find((h) => h.id === id);
            Object.assign(host, { name: body.name, kind: body.kind, address: body.address, allowActions: Boolean(body.allowActions) });
            if (body.ca) host.hasCA = true;
            return json(host);
        }
        if (method === 'DELETE') {
            state.sent.push({ method, id });
            state.hosts = state.hosts.filter((h) => h.id !== id);
            return json({ ok: true });
        }
        return route.fallback();
    });
    return state;
}

async function open(page) {
    await page.goto('/#config/containers/connection');
    await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
    return page.locator('[data-docker-hosts-panel]');
}

test('add a tcp host, test it, switch actions on, remove it', async ({ page }) => {
    const state = await mockHosts(page);
    const panel = await open(page);
    await expect(panel).toContainText('No other host yet.');

    await panel.locator('[data-docker-host-add]').click();
    const form = panel.locator('[data-docker-host-form]');
    await form.locator('[data-docker-host-field="name"]').fill('pi');
    await form.locator('[data-docker-host-field="address"]').fill('192.168.1.20:2375');
    // The certificate fields belong to tls only.
    await expect(form.locator('[data-docker-host-tls]')).toBeHidden();

    await form.locator('[data-docker-host-form-test]').click();
    await expect(form.locator('[data-docker-host-form-result]')).toContainText('Docker 27.3.1');
    expect(state.probes[0]).toMatchObject({ kind: 'tcp', address: '192.168.1.20:2375' });

    await form.locator('[data-docker-host-save]').click();
    const row = panel.locator('[data-docker-host-row]');
    await expect(row).toContainText('pi');
    await expect(row).toContainText('192.168.1.20:2375');
    // Actions start switched off.
    expect(state.sent[0].body.allowActions).toBe(false);
    await expect(row.locator('[data-docker-host-actions]')).not.toBeChecked();

    await row.locator('[data-docker-host-actions]').check();
    await expect.poll(() => state.hosts[0].allowActions).toBe(true);

    state.nextProbe = { ok: false, reason: 'refused' };
    await row.locator('[data-docker-host-test]').click();
    await expect(row.locator('[data-docker-host-result]')).toContainText('refused the connection');

    await row.locator('[data-docker-host-remove]').click();
    await page.locator('#app-modal.show button').filter({ hasText: /^Remove$/ }).click();
    await expect.poll(() => state.hosts.length).toBe(0);
    await expect(panel).toContainText('No other host yet.');
});

test('a tls host shows its certificate fields, and an edit leaves saved ones alone', async ({ page }) => {
    const state = await mockHosts(page);
    state.hosts.push({ id: 'd_000000000009', name: 'nas', kind: 'tls', address: 'nas.lan:2376', allowActions: false,
        hasCA: true, hasCert: true, hasKey: true });
    const panel = await open(page);
    const row = panel.locator('[data-docker-host-row="d_000000000009"]');
    await expect(row).toContainText('CA + client certificate');

    await row.locator('[data-docker-host-edit]').click();
    const form = panel.locator('[data-docker-host-form]');
    await expect(form.locator('[data-docker-host-tls]')).toBeVisible();
    // A saved part says so and is never shown back.
    await expect(form.locator('[data-docker-host-field="ca"]')).toHaveAttribute('placeholder', /Saved/);
    await expect(form.locator('[data-docker-host-field="ca"]')).toHaveValue('');
    await form.locator('[data-docker-host-field="name"]').fill('nas2');
    await form.locator('[data-docker-host-save]').click();
    await expect(panel.locator('[data-docker-host-row]')).toContainText('nas2');
    const put = state.sent.find((s) => s.method === 'PUT');
    expect(put.body).not.toHaveProperty('ca');
    expect(put.body).not.toHaveProperty('cert');
    expect(put.body).not.toHaveProperty('key');
});

test('a refused host shows the server\'s reason in the form', async ({ page }) => {
    await mockHosts(page);
    const panel = await open(page);
    await panel.locator('[data-docker-host-add]').click();
    await panel.locator('[data-docker-host-save]').click();
    await expect(panel.locator('[data-docker-host-error]')).toContainText('A host needs a name');
});

test('a saved certificate can be removed, and only when asked', async ({ page }) => {
    const state = await mockHosts(page);
    state.hosts.push({ id: 'd_000000000009', name: 'nas', kind: 'tls', address: 'nas.lan:2376', allowActions: false,
        hasCA: true, hasCert: false, hasKey: false });
    const panel = await open(page);
    await panel.locator('[data-docker-host-edit]').click();
    const form = panel.locator('[data-docker-host-form]');
    // Only a saved part offers removal.
    await expect(form.locator('[data-docker-host-clear="ca"]')).toBeVisible();
    await expect(form.locator('[data-docker-host-clear="cert"]')).toHaveCount(0);
    await form.locator('[data-docker-host-clear="ca"]').check();
    await form.locator('[data-docker-host-save]').click();
    await expect.poll(() => state.sent.find((s) => s.method === 'PUT')?.body.ca).toBe('');
});

test('a Test that fails outright is not shown in the colour of an earlier success', async ({ page }) => {
    const state = await mockHosts(page);
    state.hosts.push({ id: 'd_000000000009', name: 'nas', kind: 'tcp', address: 'nas.lan:2375', allowActions: false,
        hasCA: false, hasCert: false, hasKey: false });
    const panel = await open(page);
    const out = panel.locator('[data-docker-host-result="d_000000000009"]');
    await panel.locator('[data-docker-host-test]').click();
    await expect(out).toHaveAttribute('data-state', 'ok');
    state.testHttpError = true;
    await panel.locator('[data-docker-host-test]').click();
    await expect(out).toHaveAttribute('data-state', 'bad');
    await expect(out).toContainText('Unauthorized');
});
