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
});
