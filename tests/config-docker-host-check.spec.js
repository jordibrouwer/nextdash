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

// The View tab is drawn again on every visit; the check still cuts a full
// address after a few, and adds one capture listener to the section, not one
// per visit.
test('after going back and forth between tabs the check still works, bound once', async ({ page }) => {
    await page.addInitScript(() => {
        const add = EventTarget.prototype.addEventListener;
        window.__hostChangeCaptures = 0;
        EventTarget.prototype.addEventListener = function (type, fn, opts) {
            if (type === 'change' && (opts === true || opts?.capture) && this.id === 'config-containers-body') {
                window.__hostChangeCaptures += 1;
            }
            return add.call(this, type, fn, opts);
        };
    });
    let field = await open(page);
    for (let i = 0; i < 3; i += 1) {
        await page.locator('[data-containers-tab="connection"]').click();
        await page.locator('[data-containers-tab="view"]').click();
    }
    field = page.locator('[data-behavior-field="dockerHostAddress"]');
    await field.fill('http://tower.lan:8080/');
    await field.press('Tab');
    try {
        await expect(field).toHaveValue('tower.lan');
        await expect(page.locator('[data-docker-host-check]')).toHaveText('✓ Port 8080 opens http://tower.lan:8080.');
    } finally {
        await field.fill('');
        await field.press('Tab');
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerHostAddress ?? '').toBe('');
    }
    expect(await page.evaluate(() => window.__hostChangeCaptures)).toBeLessThanOrEqual(1);
});
