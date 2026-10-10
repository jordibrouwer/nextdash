const { test, expect } = require('./fixtures');
const { WRITE_TOKEN } = require('./e2e-helpers');

const H = { 'X-NextDash-Token': WRITE_TOKEN };
const DAY = 24 * 3600 * 1000;

function days(overrides = {}) {
    const today = Math.floor(Date.now() / DAY) * DAY;
    return Array.from({ length: 30 }, (_, i) => ({ d: today - (29 - i) * DAY, s: overrides[i] || 'operational' }));
}

function snapshot(kind = 'issue') {
    const now = Date.now();
    const issue = kind === 'issue';
    return {
        generatedAt: now, title: 'Home services', notice: 'Guest wifi: HomeGuest',
        problems: issue ? 2 : 0, anyDown: issue,
        maintenance: [{ start: now + 3 * DAY, end: now + 3 * DAY + 2 * 3600e3, active: false, label: 'Backups', groups: ['Media'] }],
        groups: [
            { name: 'Media', working: issue ? 1 : 2, total: 2, services: [
                { name: 'Jellyfin', url: 'https://jf.example.test', state: issue ? 'down' : 'operational', since: issue ? now - 27 * 60e3 : 0, ms: 64, spark: [60, 70, 64], uptime: 0.9979, days: days({ 29: issue ? 'down' : 'operational', 12: 'down' }) },
                { name: 'Requests', state: 'operational', uptime: 1, days: days() },
            ] },
            { name: 'Home', working: issue ? 0 : 1, total: 1, services: [
                { name: 'Home Assistant', state: issue ? 'degraded' : 'operational', reason: issue ? 'restarting' : '', days: days({ 5: 'maintenance' }) },
            ] },
        ],
    };
}

async function openStatusPage(page, request, data) {
    const put = await request.put('/api/status-page', { headers: H, data: { enabled: true, title: 'Home services', notice: 'Guest wifi: HomeGuest', groups: [] } });
    expect(put.ok()).toBeTruthy();
    const { path } = await put.json();
    let calls = 0;
    await page.route('**/s/*/data.json', async (route) => {
        calls += 1;
        await route.fulfill({ json: typeof data === 'function' ? data(calls) : data });
    });
    await page.goto(path);
    return { path, calls: () => calls };
}

test.describe('status page for visitors', () => {
    test('draws the overall line, rows, pills and 30 bars', async ({ page, request }) => {
        await openStatusPage(page, request, snapshot('issue'));
        await expect(page.locator('h1')).toHaveText('Home services');
        await expect(page.locator('[data-status-overall]')).toHaveText('2 services have a problem');
        await expect(page.locator('[data-status-overall]')).toHaveClass(/down/);
        await expect(page.locator('[data-status-service]')).toHaveCount(3);
        const jf = page.locator('[data-status-service]', { hasText: 'Jellyfin' });
        await expect(jf).toHaveAttribute('data-state', 'down');
        await expect(jf.locator('.pill')).toHaveText('Down');
        await expect(jf.locator('[data-status-since]')).toContainText('Down since');
        await expect(jf.locator('a')).toHaveAttribute('href', 'https://jf.example.test');
        await expect(jf.locator('.bars > span')).toHaveCount(30);
        await expect(jf.locator('.bars > span').nth(12)).toHaveAttribute('data-state', 'down');
        await expect(jf.locator('[data-status-uptime]')).toHaveText('99.79%');
        await expect(page.locator('[data-status-service]', { hasText: 'Home Assistant' }).locator('[data-status-since]')).toHaveText('Restarting repeatedly');
        await expect(page.locator('[data-status-maint]')).toContainText('Planned maintenance');
        await expect(page.locator('body')).not.toContainText(/nextdash/i);
    });

    test('all working', async ({ page, request }) => {
        await openStatusPage(page, request, snapshot('ok'));
        await expect(page.locator('[data-status-overall]')).toHaveText('All services are working');
        await expect(page.locator('[data-status-overall]')).toHaveClass(/ok/);
    });

    test('refreshes after 60 s and pauses while hidden', async ({ page, request }) => {
        await page.clock.install();
        const { calls } = await openStatusPage(page, request, (n) => snapshot(n === 1 ? 'issue' : 'ok'));
        await expect(page.locator('[data-status-overall]')).toHaveText('2 services have a problem');
        await page.clock.runFor(61_000);
        await expect(page.locator('[data-status-overall]')).toHaveText('All services are working');
        expect(calls()).toBe(2);
        await expect(page.locator('[data-status-updated]')).toContainText('ago');

        const setHidden = (hidden) => page.evaluate((h) => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
            document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        await setHidden(true);
        await page.clock.runFor(180_000);
        expect(calls()).toBe(2);
        await setHidden(false);
        await expect.poll(calls).toBe(3);
    });

    test('follows the visitor colour scheme', async ({ page, request }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await openStatusPage(page, request, snapshot('ok'));
        const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        await page.emulateMedia({ colorScheme: 'light' });
        const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(dark).not.toBe(light);
    });

    test('fits a phone without sideways scroll', async ({ page, request }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await openStatusPage(page, request, snapshot('issue'));
        await expect(page.locator('[data-status-service]')).toHaveCount(3);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('no console errors and no CSP violations', async ({ page, request }) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await openStatusPage(page, request, snapshot('issue'));
        await expect(page.locator('[data-status-service]')).toHaveCount(3);
        expect(errors).toEqual([]);
    });
});

test.describe('status page west of UTC', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('a day bar carries its own date, not the day before', async ({ page, request }) => {
        const snap = snapshot('ok');
        await openStatusPage(page, request, snap);
        const last = snap.groups[0].services[0].days[29].d;
        const want = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(last);
        const bar = page.locator('[data-status-service]').first().locator('.bars > span').last();
        await expect(bar).toHaveAttribute('title', new RegExp(`^${want} · `));
    });
});
