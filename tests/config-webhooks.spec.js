// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Data & backups → Webhooks: where nextDash pushes to.
 *
 * Sources is the other direction — what a service adds here. This is the same
 * question turned around, for whatever somebody built around this install, and
 * it sits beside Sources for that reason rather than under the alert settings:
 * those send a message to a person, these send an event to a program.
 */
async function openWebhooks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="webhooks"]').click();
    await expect(page.locator('[data-fold="webhook-new"]')).toBeVisible();
}

// The panels here are folded shut, the way Sources is: the tab has to be
// readable before it is usable. Opening one is what a reader does first.
async function openFold(page, fold) {
    const panel = page.locator(`[data-fold="${fold}"]`);
    if (!(await panel.evaluate((el) => el.open))) {
        await panel.locator('summary').click();
    }
    await expect(panel).toHaveAttribute('open', '');
}

/*
 * An endpoint URL goes through the same address rules as a bookmark ping, so a
 * receiver on this machine is only reachable on an install that has allowed
 * local addresses. The test server has no public receiver to point at, so the
 * setting is what the two save tests below differ on.
 */
async function setAllowLocal(page, allow) {
    const ok = await page.evaluate(async (value) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await api('/api/settings')).json();
        current.allowLocalBookmarks = value;
        const res = await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current),
        });
        return res.ok;
    }, allow);
    expect(ok).toBe(true);
}

test.describe('Data & backups → Webhooks', () => {
    test('the tab sits beside Sources', async ({ page }) => {
        await openWebhooks(page);
        const tabs = await page.evaluate(() =>
            [...document.querySelectorAll('[data-db-tab]')].map((b) => b.getAttribute('data-db-tab')));
        expect(tabs.indexOf('webhooks')).toBe(tabs.indexOf('sources') + 1);
        await expect(page.locator('[data-db-tab="webhooks"]')).toHaveText('Webhooks');
    });

    /*
     * The whole round trip: add a receiver, see it listed, get its key once.
     *
     * The key is the point of the flow -- a delivery nobody can verify is a
     * delivery nobody should act on -- and this is the only moment it can be
     * copied into the far side.
     */
    test('adding a receiver shows its signing key exactly once', async ({ page }) => {
        await openWebhooks(page);
        await setAllowLocal(page, true);
        await openFold(page, 'webhook-new');

        const form = page.locator('[data-fold="webhook-new"] [data-webhook-form]');
        await form.locator('[data-webhook-field="id"]').fill('spec-receiver');
        // Nothing is posted to on a save, so an address nothing answers on is
        // exactly as good as a real receiver here.
        await form.locator('[data-webhook-field="url"]').fill('http://127.0.0.1:9/hook');
        await form.locator('[data-webhook-field="enabled"]').check();
        await form.locator('[data-webhook-action="save"]').click();

        const row = page.locator('[data-webhook-id="spec-receiver"]');
        await expect(row).toBeVisible();
        const secretLine = row.locator('[data-webhook-secret]');
        await expect(secretLine).toBeVisible();
        // A key short enough to guess is not a key. The generated one is 32
        // bytes as hex.
        expect(await secretLine.textContent()).toMatch(/[0-9a-f]{64}/);

        // And it is gone on the next paint: a screen that redisplays a key
        // turns every screenshot into a leak.
        await page.locator('[data-db-tab="backups"]').click();
        await page.locator('[data-db-tab="webhooks"]').click();
        await expect(page.locator('[data-webhook-id="spec-receiver"]')).toBeVisible();
        const listed = await page.evaluate(() =>
            JSON.stringify(window.dashboardInstance.config._webhookEndpoints));
        expect(listed).not.toMatch(/[0-9a-f]{64}/);
        expect(listed).toContain('"hasSecret":true');
    });

    /*
     * A refused address is refused while the reader is looking at the field.
     *
     * Accepting it and failing on every delivery instead produces a receiver
     * that appears configured and silently never fires.
     */
    test('an address that cannot be delivered to is refused on save', async ({ page }) => {
        await openWebhooks(page);
        await setAllowLocal(page, false);
        await openFold(page, 'webhook-new');
        const form = page.locator('[data-fold="webhook-new"] [data-webhook-form]');
        await form.locator('[data-webhook-field="id"]').fill('spec-local');
        await form.locator('[data-webhook-field="url"]').fill('http://127.0.0.1:9/hook');
        await form.locator('[data-webhook-action="save"]').click();

        await expect(form.locator('[data-webhook-status]')).not.toHaveText('');
        await expect(page.locator('[data-webhook-id="spec-local"]')).toHaveCount(0);
    });

    // A name is the key the endpoint is stored under; without one there is
    // nothing to save it as.
    test('saving without a name says so instead of failing quietly', async ({ page }) => {
        await openWebhooks(page);
        await openFold(page, 'webhook-new');
        const form = page.locator('[data-fold="webhook-new"] [data-webhook-form]');
        await form.locator('[data-webhook-field="url"]').fill('https://receiver.example/hook');
        await form.locator('[data-webhook-action="save"]').click();
        await expect(form.locator('[data-webhook-status]')).toHaveText(/name/i);
    });
});

/*
 * The MCP panel shares this tab, because it answers the same question the
 * webhooks do — how another program reaches this install — from the other
 * direction.
 */
test.describe('Data & backups → Webhooks → Assistant access', () => {
    test('the endpoint is shut until the panel is ticked', async ({ page }) => {
        await openWebhooks(page);
        await openFold(page, 'mcp');

        // Shut: the endpoint is not there at all, and the address it would be
        // at is not offered either.
        expect((await page.request.post('/mcp', {
            data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        })).status()).toBe(404);
        await expect(page.locator('.config-mcp-address')).toHaveCount(0);

        const toggle = page.locator('[data-backup-toggle="mcpEnabled"]');
        await toggle.check();

        // The address to paste into the assistant appears only once it can be
        // used.
        await expect(page.locator('.config-mcp-address')).toContainText('/mcp');

        const res = await page.request.post('/mcp', {
            data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.result.tools.map((t) => t.name)).toContain('search_bookmarks');

        // And back off again, so nothing is left open by a test.
        await page.locator('[data-backup-toggle="mcpEnabled"]').uncheck();
        await expect.poll(async () => (await page.request.post('/mcp', {
            data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        })).status()).toBe(404);
    });
});
