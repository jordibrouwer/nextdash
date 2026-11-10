const { test, expect } = require('./fixtures');
const { WRITE_TOKEN } = require('./e2e-helpers');

/**
 * Network checks on the status page: opt-in per service (a tick in Config ->
 * Status page), and the public data carries a name, a state and day bars, never
 * the host, the port or the check id. The real server is used; the check is
 * only stored, so nothing here depends on the network.
 */

const H = { 'X-NextDash-Token': WRITE_TOKEN };

async function seedCheck(request) {
    const pages = await (await request.get('/api/pages')).json();
    const pageId = pages[0].id;
    const list = await (await request.get(`/api/bookmarks?page=${pageId}`)).json();
    const bm = list[0];
    const put = await request.put('/api/net/checks', {
        headers: H,
        data: { pageId, url: bm.url, checks: [{ type: 'tcp', port: 32400, enabled: true }] },
    });
    expect(put.ok()).toBeTruthy();
    const checks = (await put.json()).checks;
    return { bm, pageId, id: checks[0].id };
}

test.describe('network checks on the status page', () => {
    test('a check is on the page only after its tick, and the page shows no internals', async ({ page, request }) => {
        const { bm, pageId, id } = await seedCheck(request);
        const put = await request.put('/api/status-page', {
            headers: H,
            data: { enabled: true, title: 'Home', groups: [{ name: 'Media', services: [{ name: 'Plex', monitorUrl: bm.url }] }] },
        });
        const { path } = await put.json();
        const data = async () => (await request.get(`${path}/data.json`)).text();

        // Not ticked: the service is an unmonitored bookmark, nothing of the check.
        expect(JSON.parse(await data()).groups[0].services[0].state).toBe('unknown');

        await page.goto('/#config/status-page');
        await page.waitForSelector('[data-sp-enabled]');
        const box = page.locator(`[data-sp-net-check="${id}"]`);
        await expect(box).toBeVisible();
        await expect(box).not.toBeChecked();
        await box.check();
        await expect.poll(async () => JSON.stringify(((await (await request.get('/api/status-page', { headers: H })).json()).config.groups[0].services[0].netChecks) || [])).toBe(JSON.stringify([id]));

        const raw = await data();
        const svc = JSON.parse(raw).groups[0].services[0];
        expect(svc.name).toBe('Plex');
        expect(svc.days).toHaveLength(30);
        for (const leak of ['32400', id, 'tcp', 'TCP', new URL(bm.url).hostname]) {
            expect(raw).not.toContain(leak);
        }

        // Switched off: the check is gone from the page, and with it a service
        // that was nothing but that check (the tick stays for later).
        await request.put('/api/net/checks', {
            headers: H,
            data: { pageId, url: bm.url, checks: [{ id, type: 'tcp', port: 32400, enabled: false }] },
        });
        expect(JSON.parse(await data()).groups[0].services).toHaveLength(0);
    });
});
