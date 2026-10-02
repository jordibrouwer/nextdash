// @ts-check
const { test, expect } = require('./fixtures');

/**
 * Config -> Containers -> Docker host address says, as it is typed, where port
 * 8080 would go. The server keeps a bare host only, so a full address is cut
 * to its host before it is saved rather than dropped without a word.
 */
async function open(page) {
    await page.goto('/#config/containers/view');
    await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
    return page.locator('[data-behavior-field="dockerHostAddress"]');
}

test('the rule: bare hosts pass, URLs are cut to their host, the rest is refused', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => ['', '192.168.1.10', 'tower.local', 'http://tower.lan:8080/', '192.168.1.10:9000', 'fe80::1', 'not an address']
        .map((v) => window.DashboardConfig.checkDockerHost(v)));
    expect(out).toEqual([
        { state: 'empty' },
        { state: 'ok', host: '192.168.1.10' },
        { state: 'ok', host: 'tower.local' },
        { state: 'fixable', host: 'tower.lan' },
        { state: 'fixable', host: '192.168.1.10' },
        { state: 'ok', host: '[fe80::1]' },
        { state: 'bad' },
    ]);
});

test('the line follows the typing, and a full address is saved as its host', async ({ page }) => {
    const field = await open(page);
    const line = page.locator('[data-docker-host-check]');
    await expect(line).toContainText('Empty: port 8080 opens http://localhost:8080');
    await field.fill('192.168.1.10');
    await expect(line).toHaveText('✓ Port 8080 opens http://192.168.1.10:8080.');
    await field.fill('http://tower.lan:8080/');
    await expect(line).toContainText('tower.lan is what will be saved');
    await field.press('Tab');
    await expect(field).toHaveValue('tower.lan');
    try {
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerHostAddress).toBe('tower.lan');
    } finally {
        await field.fill('');
        await field.press('Tab');
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerHostAddress ?? '').toBe('');
    }
    await field.fill('not an address');
    await expect(line).toContainText('Not an address');
});
