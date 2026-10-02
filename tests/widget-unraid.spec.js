// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const fs = require('fs');
const path = require('path');

/**
 * The Unraid tiles. /api/unraid/area/* is intercepted with answers in the
 * server's own shape, so these never need an Unraid server.
 */

const A = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-unraid', `${name}.json`), 'utf8'));

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function render(page, type, answers, width = 320) {
    await page.route('**/api/unraid/area/**', (route) => {
        const area = route.request().url().split('/').pop();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[area] || { area, status: 'unsupported' }) });
    });
    return page.evaluate(async ({ t, w }) => {
        document.querySelectorAll('.unraid-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unraid-probe';
        host.style.cssText = `width:${w}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        await window.DashboardWidgets[t](body, { id: 'probe', type: t, config: {} }, window.dashboardInstance);
        const shown = (el) => el && el.offsetParent !== null;
        return {
            text: body.innerText.replace(/\s+/g, ' ').trim(),
            rows: [...body.querySelectorAll('.dashboard-widget-row')].filter(shown).map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
            tones: [...body.querySelectorAll('.dashboard-widget-row')].filter(shown).map((r) => (r.className.match(/--(good|warn|bad|off)/) || [])[1] || ''),
        };
    }, { t: type, w: width });
}

test.describe('Unraid widgets', () => {
    test('the overview reads a line per subject, problems in colour', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraid', { overview: A('overview') });
        expect(out.rows[0]).toContain('array');
        expect(out.rows[0]).toContain('started');
        const disks = out.rows.findIndex((r) => r.startsWith('disks'));
        expect(out.rows[disks]).toContain('disk5');
        expect(out.tones[disks]).toBe('bad');
        expect(out.text).toContain('1 unread');
        expect(out.text).toContain('1 of 3 running');
    });

    test('the overview leaves out what the key may not read', async ({ page }) => {
        await openDashboard(page);
        const ov = A('overview');
        delete ov.data.vms;
        ov.data.missing = ['vms'];
        const out = await render(page, 'unraid', { overview: ov });
        expect(out.rows.some((r) => r.startsWith('VMs'))).toBe(false);
    });

    test('the overview says when the server is out of reach, and when the key is refused', async ({ page }) => {
        await openDashboard(page);
        const gone = A('overview');
        Object.assign(gone, { status: 'unreachable', error: 'unraid: no answer within 8 seconds', lastOkAt: Date.now() - 5 * 60_000 });
        const stale = await render(page, 'unraid', { overview: gone });
        expect(stale.text).toContain('did not answer — last reading 5 min ago');
        expect(stale.rows[0]).toContain('array');
        const refused = await render(page, 'unraid', { overview: { area: 'overview', status: 'unauthorized', error: 'unraid: the API key was refused' } });
        expect(refused.text).toContain('Unraid refused the API key');
        expect(refused.rows.length).toBe(0);
    });

    test('the array narrow shows only the problems', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidArray', { array: A('array') }, 320);
        expect(out.rows.map((r) => r.split(' ')[0])).toEqual(['disk5', 'disk3']);
    });

    test('the array wide shows every disk, an asleep one grey', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidArray', { array: A('array') }, 700);
        expect(out.rows.length).toBe(11);
        const disk6 = out.rows.findIndex((r) => r.startsWith('disk6'));
        expect(out.rows[disk6]).toContain('asleep');
        expect(out.tones[disk6]).toBe('off');
    });

    test('not connected says where to set it up', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidArray', { array: { area: 'array', status: 'not-configured' } });
        expect(out.text).toContain('Config → Containers');
    });

    test('parity while running: progress and time left; history when wide', async ({ page }) => {
        await openDashboard(page);
        const narrow = await render(page, 'unraidParity', { parity: A('parity') }, 320);
        expect(narrow.text).toContain('43%');
        expect(narrow.text).toMatch(/left/);
        const paused = A('parity');
        paused.data.paused = true;
        expect((await render(page, 'unraidParity', { parity: paused }, 320)).text).toContain('— left');
        const wide = await render(page, 'unraidParity', { parity: A('parity') }, 700);
        expect(wide.rows.length).toBe(4);
        expect(wide.tones[2]).toBe('bad'); // the run with 12 errors
    });

    test('shares fullest first, cut at the row count', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidShares', { shares: A('shares') });
        expect(out.rows[0]).toMatch(/^media/);
        expect(out.tones[0]).toBe('bad');
        const bars = await page.evaluate(() => [...document.querySelectorAll('.unraid-probe .dashboard-widget-row')]
            .map((r) => {
                const bar = r.querySelector('.unraid-disk-bar');
                return bar ? [bar.style.getPropertyValue('--fill'), bar.className.includes('--warn')] : null;
            }));
        expect(bars).toEqual([['94%', true], ['73%', false], ['48%', false], ['12%', false], ['11%', false]]);
        expect(out.rows[0]).toMatch(/^media 94%/);
    });

    test('VMs: running of total and a row each', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidVms', { vms: A('vms') });
        expect(out.text).toContain('1 of 3 running');
        expect(out.tones).toEqual(['good', 'warn', 'off']);
    });

    test('UPS on battery turns amber and says so', async ({ page }) => {
        await openDashboard(page);
        const ups = A('ups');
        Object.assign(ups.data, { onBattery: true, charge: 87, runtimeSec: 2460, tone: 'warn' });
        const out = await render(page, 'unraidUps', { ups });
        expect(out.text).toContain('on battery');
        expect(out.text).toContain('87%');
        const amber = await page.evaluate(() => !!document.querySelector('.unraid-probe .dashboard-widget-headline-value--warn'));
        expect(amber).toBe(true);
        const line = await render(page, 'unraidUps', { ups: A('ups') });
        expect(line.text).toContain('on line power');
        expect(await page.evaluate(() => !!document.querySelector('.unraid-probe .dashboard-widget-headline-value--warn'))).toBe(false);
    });

    test('notifications newest first, the alert red', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidNotifications', { notifications: A('notifications') });
        expect(out.rows[0]).toContain('Disk 5 has read errors');
        expect(out.tones[0]).toBe('bad');
        expect(out.text).toContain('alerts 1 · warnings 2 unread');
    });

    test('notifications: no foot when nothing is unread', async ({ page }) => {
        await openDashboard(page);
        const n = A('notifications');
        Object.assign(n.data, { alerts: 0, warnings: 0, items: [] });
        const out = await render(page, 'unraidNotifications', { notifications: n });
        expect(out.text).toContain('Nothing unread.');
        expect(out.text).not.toContain('unread alerts');
        expect(out.text).not.toMatch(/alerts \d/);
    });

    test('a forbidden area explains itself', async ({ page }) => {
        await openDashboard(page);
        const out = await render(page, 'unraidVms', { vms: { area: 'vms', status: 'forbidden' } });
        expect(out.text).toContain('may not read');
    });

    test('a row opens its page in Unraid when the server address is known', async ({ page }) => {
        await page.route('**/api/unraid/settings', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ server: { baseUrl: 'http://tower', enabled: true }, keySet: true }),
        }));
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance._unraidBaseUrl = undefined; });
        await render(page, 'unraid', { overview: A('overview') });
        const hrefs = await page.evaluate(() => [...document.querySelectorAll('.unraid-probe .dashboard-widget-row')]
            .map((r) => r.dataset.widgetHref || ''));
        expect(hrefs[0]).toBe('http://tower/Main');
    });

    test('click none: no row carries an address and none is a button', async ({ page }) => {
        await page.route('**/api/unraid/settings', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ server: { baseUrl: 'http://tower', enabled: true }, keySet: true }),
        }));
        await openDashboard(page);
        await page.route('**/api/unraid/area/**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(A('overview')),
        }));
        const out = await page.evaluate(async () => {
            window.dashboardInstance._unraidBaseUrl = undefined;
            const body = document.createElement('div');
            document.body.appendChild(body);
            await window.DashboardWidgets.unraid(body, { id: 'probe', type: 'unraid', config: { click: 'none' } }, window.dashboardInstance);
            const rows = [...body.querySelectorAll('.dashboard-widget-row')];
            return {
                count: rows.length,
                hrefs: rows.filter((r) => r.dataset.widgetHref).length,
                buttons: rows.filter((r) => r.tagName === 'BUTTON').length,
            };
        });
        expect(out.count).toBeGreaterThan(0);
        expect(out.hrefs).toBe(0);
        expect(out.buttons).toBe(0);
    });
});
