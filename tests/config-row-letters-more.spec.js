// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, waitForConfigReady, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

const H = { 'X-NextDash-Token': WRITE_TOKEN };

async function savedConfig(request) {
    return (await (await request.get('/api/status-page', { headers: H })).json()).config;
}

test.describe('status page: letters on the row under the cursor', () => {
    test('u and n move a service, d removes it, e goes to its name', async ({ page, request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [
            { id: 'g1', name: 'A', services: [{ id: 's1', name: 'One', container: 'one' }, { id: 's2', name: 'Two', container: 'two' }] },
        ] } });
        await page.goto('/#config/status-page');
        await waitForConfigReady(page);
        await expect(page.locator('[data-sp-enabled]')).toBeAttached();
        await page.locator('[data-sp-service="s1"]').focus();
        await page.keyboard.press('n');
        await expect.poll(async () => (await savedConfig(request)).groups[0].services.map((s) => s.id).join()).toBe('s2,s1');
        await page.locator('[data-sp-service="s1"]').focus();
        await page.keyboard.press('e');
        await expect(page.locator('[data-sp-service="s1"] [data-sp-service-name]')).toBeFocused();
        await page.keyboard.type('x');
        await expect(page.locator('[data-sp-service="s1"] [data-sp-service-name]')).toHaveValue('x');
        await page.keyboard.press('Enter');
        await page.locator('[data-sp-service="s2"]').focus();
        await page.keyboard.press('d');
        await expect(page.locator('[data-sp-service]')).toHaveCount(1);
    });
});

test.describe('stored backups: rows own the letters', () => {
    test('j walks the rows, d presses Delete (which asks first), Esc drops the cursor', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                enabled: true, dir: '/b', insideDataDir: false, limit: 5,
                backups: [
                    { name: 'a.zip', size: 1200, createdAt: new Date(Date.now() - 3600_000).toISOString() },
                    { name: 'b.zip', size: 1300, createdAt: new Date(Date.now() - 7200_000).toISOString() },
                ],
            }) });
        });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await expect(page.locator('[data-backup-row]')).toHaveCount(2, { timeout: 15_000 });
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await expect(page.locator('[data-backup-row="a.zip"]')).toHaveClass(/keyboard-selected/);
        await page.keyboard.press('j');
        await expect(page.locator('[data-backup-row="b.zip"]')).toHaveClass(/keyboard-selected/);
        await expect(page.locator('.config-list-keyboard-legend')).toHaveCount(1);
        await expect(page.locator('.config-form-keyboard-legend')).toHaveCount(0);
        await page.keyboard.press('d');
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-backup-row].keyboard-selected')).toHaveCount(0);
    });
});

async function openBackupsPage(page, backups) {
    await page.route('**/api/auto-backups', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            enabled: true, dir: '/b', insideDataDir: false, limit: 5, backups,
        }) });
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await expect(page.locator('[data-backup-row]')).toHaveCount(backups.length, { timeout: 15_000 });
    await page.evaluate(() => document.activeElement?.blur());
}

const TWO = [
    { name: 'a.zip', size: 1200, createdAt: new Date(Date.now() - 3600_000).toISOString() },
    { name: 'b.zip', size: 1300, createdAt: new Date(Date.now() - 7200_000).toISOString() },
];

test.describe('Data & backups keeps the page keys', () => {
    test('ArrowDown with no cursor scrolls the page and selects no backup; j starts the cursor', async ({ page }) => {
        await openBackupsPage(page, TWO);
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-backup-row].keyboard-selected')).toHaveCount(0);
        await page.keyboard.press('j');
        await expect(page.locator('[data-backup-row="a.zip"]')).toHaveClass(/keyboard-selected/);
    });

    test('with a cursor set, Enter on a fold opens the fold and the letters leave the rows alone', async ({ page }) => {
        await openBackupsPage(page, TWO);
        await page.locator('[data-backup-row="a.zip"]').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('[data-backup-row="a.zip"]')).toHaveClass(/keyboard-selected/);
        // Any fold on the page will do: the import sources are <details> too.
        await page.evaluate(() => {
            const d = document.createElement('details');
            d.id = 'probe-fold';
            d.innerHTML = '<summary>Probe fold</summary><p>inside</p>';
            document.getElementById('config-view-body').appendChild(d);
        });
        const summary = page.locator('#probe-fold > summary');
        await summary.focus();
        const was = await summary.evaluate((el) => el.parentElement.open);
        await page.keyboard.press('Enter');
        expect(await summary.evaluate((el) => el.parentElement.open)).toBe(!was);
    });

    test('ArrowDown on a focused sub-tab does not move the row cursor', async ({ page }) => {
        await openBackupsPage(page, TWO);
        await page.locator('[data-backup-row="a.zip"]').click({ position: { x: 5, y: 5 } });
        await page.locator('[data-db-tab]').first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-backup-row="a.zip"]')).toHaveClass(/keyboard-selected/);
        await expect(page.locator('[data-backup-row="b.zip"]')).not.toHaveClass(/keyboard-selected/);
    });
});

test.describe('the trash list: letters on the rows', () => {
    test('j, x and d work; d forever asks first', async ({ page }) => {
        await openBackupsPage(page, TWO);
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            cfg.dbTab = 'trash';
            cfg._trashData = { count: 2, retentionDays: 30, items: [
                { id: 't1', kind: 'bookmark', bookmark: { name: 'Alpha', url: 'https://a.test' }, deletedAt: Date.now() },
                { id: 't2', kind: 'bookmark', bookmark: { name: 'Beta', url: 'https://b.test' }, deletedAt: Date.now() },
            ] };
            cfg.repaintTrashBody();
        });
        await expect(page.locator('[data-trash-row]')).toHaveCount(2);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await expect(page.locator('[data-trash-row="t1"]')).toHaveClass(/keyboard-selected/);
        await page.keyboard.press('x');
        await expect(page.locator('[data-trash-row="t1"] [data-trash-select]')).toBeChecked();
        await page.keyboard.press('d');
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
    });
});

test.describe('status page: the rest of the letters', () => {
    test('a letter typed in the name field stays text; the group grip answers e, u, n and d', async ({ page, request }) => {
        await request.put('/api/status-page', { headers: H, data: { enabled: true, groups: [
            { id: 'g1', name: 'A', services: [{ id: 's1', name: 'One', container: 'one' }] },
            { id: 'g2', name: 'B', services: [{ id: 's2', name: 'Two', container: 'two' }] },
        ] } });
        await page.goto('/#config/status-page');
        await waitForConfigReady(page);
        await expect(page.locator('[data-sp-enabled]')).toBeAttached();
        const name = page.locator('[data-sp-service="s1"] [data-sp-service-name]');
        await name.focus();
        await name.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
        await page.keyboard.type('edun');
        await expect(name).toHaveValue('Oneedun');
        await name.fill('One');
        await page.keyboard.press('Enter');
        await page.locator('[data-sp-group="g1"] .status-page-group-head [data-sp-grip]').focus();
        await page.keyboard.press('n');
        await expect.poll(async () => (await savedConfig(request)).groups.map((g) => g.id).join()).toBe('g2,g1');
        await page.locator('[data-sp-group="g1"] .status-page-group-head [data-sp-grip]').focus();
        await page.keyboard.press('d');
        await expect(page.getByRole('dialog')).toBeVisible();
    });
});
