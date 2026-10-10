const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, waitForConfigReady } = require('./e2e-helpers');
const { mockDocker } = require('./helpers/docker-mock');

const H = { 'X-NextDash-Token': WRITE_TOKEN };

async function openSection(page) {
    await page.goto('/#config/status-page');
    await waitForConfigReady(page);
    await expect(page.locator('[data-sp-enabled]')).toBeAttached();
}

async function savedConfig(request) {
    return (await (await request.get('/api/status-page', { headers: H })).json()).config;
}

test.describe('Config → Status page', () => {
    test.beforeEach(async ({ request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: false, title: '', groups: [] } });
    });

    test('turning it on makes a link that opens', async ({ page, request }) => {
        await openSection(page);
        await expect(page.locator('[data-sp-link]')).toBeHidden();
        // The buttons go with the link: nothing to copy or open while off.
        await expect(page.locator('[data-sp-copy]')).toBeHidden();
        await expect(page.locator('[data-sp-new-link]')).toBeHidden();
        await page.locator('[data-sp-enabled]').check();
        await expect(page.locator('[data-sp-copy]')).toBeVisible();
        await expect(page.locator('[data-sp-link]')).toContainText('/s/');
        await expect(page.locator('[data-sp-qr] svg')).toBeVisible();
        const link = (await page.locator('[data-sp-link]').textContent()).trim();
        expect((await request.get(new URL(link).pathname)).status()).toBe(200);
    });

    test('copy puts the link on the clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openSection(page);
        await page.locator('[data-sp-enabled]').check();
        await expect(page.locator('[data-sp-link]')).toContainText('/s/');
        await page.locator('[data-sp-copy]').click();
        const link = (await page.locator('[data-sp-link]').textContent()).trim();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    });

    test('new link stops the old one', async ({ page, request }) => {
        await openSection(page);
        await page.locator('[data-sp-enabled]').check();
        await expect(page.locator('[data-sp-link]')).toContainText('/s/');
        const oldPath = new URL((await page.locator('[data-sp-link]').textContent()).trim()).pathname;
        await page.locator('[data-sp-new-link]').click();
        await page.getByRole('button', { name: /^new link$/i }).last().click();
        await expect(page.locator('[data-sp-link]')).not.toContainText(oldPath);
        expect((await request.get(oldPath)).status()).toBe(404);
    });

    test('title and notice save and survive a reload', async ({ page, request }) => {
        await openSection(page);
        await page.locator('[data-sp-title]').fill('Home services');
        await page.locator('[data-sp-notice]').fill('Guest wifi: HomeGuest');
        await expect.poll(async () => (await savedConfig(request)).notice).toBe('Guest wifi: HomeGuest');
        await page.reload();
        await waitForConfigReady(page);
        await expect(page.locator('[data-sp-title]')).toHaveValue('Home services');
        await expect(page.locator('[data-sp-notice]')).toHaveValue('Guest wifi: HomeGuest');
    });

    test('LAN-only switch saves', async ({ page, request }) => {
        await openSection(page);
        await page.locator('[data-sp-lan]').check();
        await expect.poll(async () => (await savedConfig(request)).lanOnly).toBe(true);
    });

    test('tabs show one card each, All shows every card, and the tab is in the address', async ({ page }) => {
        await openSection(page);
        const panels = ['link', 'top', 'groups', 'maintenance'];
        await expect(page.locator('[data-sp-about]')).toBeVisible();
        for (const p of panels) await expect(page.locator(`[data-sp-panel="${p}"]`)).toBeVisible();

        await page.locator('[data-sp-tab="groups"]').click();
        await expect(page).toHaveURL(/#config\/status-page\/groups$/);
        await expect(page.locator('[data-sp-panel="groups"]')).toBeVisible();
        for (const p of ['link', 'top', 'maintenance']) await expect(page.locator(`[data-sp-panel="${p}"]`)).toBeHidden();
        await expect(page.locator('[data-sp-about]')).toBeVisible();

        // Typed text survives a switch: cards are hidden, not redrawn.
        await page.locator('[data-sp-tab="top"]').click();
        await page.locator('[data-sp-title]').fill('Kept');
        await page.locator('[data-sp-tab="link"]').click();
        await page.locator('[data-sp-tab="top"]').click();
        await expect(page.locator('[data-sp-title]')).toHaveValue('Kept');

        await page.goto('/#config/status-page/maintenance');
        await waitForConfigReady(page);
        await expect(page.locator('[data-sp-panel="maintenance"]')).toBeVisible();
        await expect(page.locator('[data-sp-panel="link"]')).toBeHidden();
    });

    test('each card has an ℹ button that opens the same modal as the rest of Config', async ({ page }) => {
        await openSection(page);
        const titles = { link: 'Link and access', top: 'Top of the page', groups: 'Groups and services', maintenance: 'Maintenance shown on the page' };
        const modal = page.locator('#app-modal.show .modal');
        for (const [card, title] of Object.entries(titles)) {
            await page.locator(`[data-sp-info="${card}"]`).click();
            await expect(modal).toBeVisible({ timeout: 10_000 });
            await expect(modal).toContainText(title);
            expect((await modal.innerText()).trim().length).toBeGreaterThan(80);
            await modal.getByRole('button', { name: 'Got it' }).click();
            await expect(modal).toBeHidden();
        }
        // Nothing opens on the page itself.
        await expect(page.locator('[data-sp-info-text]')).toHaveCount(0);
    });

    test('the sharing hint names the two paths and leads to Help', async ({ page }) => {
        await openSection(page);
        const hint = page.locator('[data-sp-share-hint]');
        await expect(hint).toContainText('/s/');
        await expect(hint).toContainText('/static/status/');
        await expect(hint).toContainText('NEXTDASH_TRUSTED_PROXIES');
        await hint.getByRole('link', { name: /how to set it up/i }).click();
        await expect(page).toHaveURL(/#config\/help\/monitoring\//);
    });
});

/**
 * A monitored bookmark on the first page. The store is reset per spec file,
 * not per test, so a second seed of the same URL answers 409: already there.
 */
async function seedMonitored(request, name, url) {
    const res = await request.post('/api/bookmarks/add', { headers: H, data: { page: 1, bookmark: { name, url, category: '', monitor: true } } });
    expect(res.ok() || res.status() === 409).toBeTruthy();
    return res;
}

test.describe('Config → Status page groups and services', () => {
    test.beforeEach(async ({ request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, title: 'Home', groups: [] } });
    });

    async function seedMonitor(request) {
        await seedMonitored(request, 'Vault', 'https://vault.home.test');
    }

    test('add a group, pick a monitor, name it, toggle link, survive reload', async ({ page, request }) => {
        await seedMonitor(request);
        await openSection(page);
        await page.locator('[data-sp-add-group]').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('Security');
        await page.keyboard.press('Enter');
        const group = page.locator('[data-sp-group]').first();
        await expect(group.locator('[data-sp-group-name]')).toHaveText('Security');

        await group.locator('[data-sp-add-service]').click();
        await page.locator('[data-sp-picker-search]').fill('vault');
        await page.keyboard.press('Enter');
        const svc = group.locator('[data-sp-service]').first();
        await expect(svc.locator('[data-sp-service-name]')).toHaveValue('Vault');
        await expect(svc.locator('[data-sp-chip="monitor"]')).toBeVisible();

        await svc.locator('[data-sp-service-name]').fill('Passwords');
        await svc.locator('[data-sp-show-link]').check();
        await expect.poll(async () => (await savedConfig(request)).groups[0]?.services[0]?.showLink).toBe(true);
        const saved = await savedConfig(request);
        expect(saved.groups[0].name).toBe('Security');
        expect(saved.groups[0].services[0]).toMatchObject({ name: 'Passwords', monitorUrl: 'https://vault.home.test', showLink: true });

        await page.reload();
        await waitForConfigReady(page);
        await expect(page.locator('[data-sp-service-name]').first()).toHaveValue('Passwords');
    });

    test('remove a service and delete a group', async ({ page, request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [
            { id: 'g1', name: 'A', services: [{ id: 's1', name: 'One', container: 'one' }, { id: 's2', name: 'Two', container: 'two' }] },
            { id: 'g2', name: 'B', services: [{ id: 's3', name: 'Three', container: 'three' }] },
        ] } });
        await openSection(page);
        await page.locator('[data-sp-service="s1"] [data-sp-service-remove]').click();
        await expect(page.locator('[data-sp-group="g1"] [data-sp-service]')).toHaveCount(1);
        await page.locator('[data-sp-group="g2"] [data-sp-group-delete]').click();
        // In the dialog: the group rows carry Delete buttons too, and the
        // dialog's own is not visible until its fade-in starts.
        await page.getByRole('dialog').getByRole('button', { name: /^delete$/i }).click();
        await expect(page.locator('[data-sp-group]')).toHaveCount(1);
        await expect.poll(async () => JSON.stringify((await savedConfig(request)).groups.map((g) => [g.id, g.services.map((s) => s.id)]))).toBe('[["g1",["s2"]]]');
    });

    test('a source that is gone shows as missing', async ({ page, request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [
            { id: 'g1', name: 'A', services: [{ id: 's1', name: 'Old', monitorUrl: 'https://gone.home.test' }] },
        ] } });
        await openSection(page);
        await expect(page.locator('[data-sp-service="s1"] [data-sp-chip="monitor"]')).toHaveClass(/is-missing/);
    });

    test('Alt+ArrowDown moves a service; Escape closes only the picker', async ({ page, request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [
            { id: 'g1', name: 'A', services: [{ id: 's1', name: 'One', container: 'one' }, { id: 's2', name: 'Two', container: 'two' }] },
        ] } });
        await openSection(page);
        await page.locator('[data-sp-service="s1"] [data-sp-grip]').focus();
        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(async () => (await savedConfig(request)).groups[0].services.map((s) => s.id).join()).toBe('s2,s1');
        await page.locator('[data-sp-group="g1"] [data-sp-add-service]').click();
        await expect(page.locator('[data-sp-picker]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-sp-picker]')).toBeHidden();
        await expect(page.locator('[data-sp-enabled]')).toBeAttached();
        await expect(page).toHaveURL(/#config\/status-page/);
    });

    test('a bookmark linked to a container is offered and added as one service', async ({ page, request }) => {
        await mockDocker(page);
        // Port rule: sonarr publishes 8989 on this host (see tests/helpers/docker-mock.js).
        await seedMonitored(request, 'Sonarr', 'http://localhost:8989');
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [{ id: 'g1', name: 'Media', services: [] }] } });
        await openSection(page);
        await page.locator('[data-sp-group="g1"] [data-sp-add-service]').click();
        await page.locator('[data-sp-picker-search]').fill('sonarr');
        const pair = page.locator('[data-sp-picker-item][data-sp-pair]');
        await expect(pair).toHaveCount(1);
        await pair.click();
        const svc = page.locator('[data-sp-group="g1"] [data-sp-service]');
        await expect(svc).toHaveCount(1);
        await expect(svc.locator('[data-sp-chip="monitor"]')).toBeVisible();
        await expect(svc.locator('[data-sp-chip="container"]')).toContainText('sonarr');
        await expect.poll(async () => JSON.stringify((await savedConfig(request)).groups[0].services.map((s) => [s.name, s.monitorUrl, s.container])))
            .toBe('[["Sonarr","http://localhost:8989","sonarr"]]');
    });

    test('picking one side fills the other; the chip ✕ drops it', async ({ page, request }) => {
        await mockDocker(page);
        await seedMonitored(request, 'Sonarr', 'http://localhost:8989');
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [{ id: 'g1', name: 'Media', services: [] }] } });
        await openSection(page);
        await page.locator('[data-sp-group="g1"] [data-sp-add-service]').click();
        await page.locator('[data-sp-picker-search]').fill('sonarr');
        await page.locator('[data-sp-picker-item]:not([data-sp-pair])', { hasText: 'container' }).click();
        const svc = page.locator('[data-sp-group="g1"] [data-sp-service]');
        await expect(svc.locator('[data-sp-chip="monitor"]')).toBeVisible();
        await svc.locator('[data-sp-chip="monitor"] [data-sp-chip-clear]').click();
        await expect(svc.locator('[data-sp-chip="monitor"]')).toHaveCount(0);
        await expect.poll(async () => (await savedConfig(request)).groups[0].services[0]?.monitorUrl || '').toBe('');
    });
});

test.describe('Config → Status page maintenance', () => {
    test.beforeEach(async ({ request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [
            { id: 'media', name: 'Media', services: [{ id: 's1', container: 'jf' }] },
            { id: 'home', name: 'Home', services: [{ id: 's2', container: 'ha' }] },
        ] } });
        await request.post('/api/settings', { headers: H, data: { maintenanceWindows: [{ days: [6], start: '02:00', end: '04:00', label: 'Backups' }] } });
    });

    test('ticking a group links the window', async ({ page, request }) => {
        await openSection(page);
        const row = page.locator('[data-sp-maint-row="0"]');
        await expect(row).toContainText('Backups');
        await row.locator('[data-sp-maint-group="media"]').check();
        await expect.poll(async () => (await (await request.get('/api/settings', { headers: H })).json()).maintenanceWindows?.[0]?.statusGroups).toEqual(['media']);
    });

    test('editing the window in its own panel keeps its groups', async ({ page, request }) => {
        await request.post('/api/settings', { headers: H, data: { maintenanceWindows: [{ days: [6], start: '02:00', end: '04:00', label: 'Backups', statusGroups: ['home'] }] } });
        await page.goto('/#config/behavior');
        await waitForConfigReady(page);
        await page.evaluate(() => {
            window.dashboardInstance.config.behaviorTab = 'status';
            window.dashboardInstance.config.render();
        });
        const label = page.locator('[data-maint-field="maintenanceWindows"] [data-maint-row="0"] [data-maint-label]');
        await expect(label).toHaveValue('Backups');
        await label.fill('Nightly backups');
        await label.dispatchEvent('change');
        await expect.poll(async () => {
            const w = (await (await request.get('/api/settings', { headers: H })).json()).maintenanceWindows?.[0];
            return [w?.label, (w?.statusGroups || []).join()].join('|');
        }).toBe('Nightly backups|home');
    });
});

test('Help → Monitoring explains the status page and how to share it', async ({ page }) => {
    await page.goto('/#config/help/monitoring');
    await waitForConfigReady(page);
    const body = page.locator('#config-help-body');
    await expect(body).toContainText('The status page');
    await expect(body).toContainText('Sharing the status page safely');
    await expect(body).toContainText('/static/status/');
    await expect(body).toContainText('NEXTDASH_TRUSTED_PROXIES');
});
