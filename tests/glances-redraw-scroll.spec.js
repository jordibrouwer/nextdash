// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A Glances section that redraws on its beat leaves a scrolled reader where they were.
 *
 * Every beat hands the open section its new answers and it redraws. In WebKit
 * that redraw moved the scroll to the top, so a reader half-way down the page
 * was thrown back up every few seconds; Chromium kept the place. The test
 * stands in for WebKit by moving the page to the top half-way through every
 * redraw, as the Containers view's test does, and then lets a beat run.
 */

const DIR = path.join(__dirname, '..', 'internal', 'app', 'testdata', 'glances');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
const FILES = {
    quicklook: 'quicklook', load: 'load', sensors: 'sensors', fs: 'fs', alert: 'alert',
    pluginslist: 'pluginslist', network: 'network', system: 'system', uptime: 'uptime',
    containers: 'containers', diskio: 'diskio', smart: 'smart', raid: 'raid',
    connections: 'connections', 'all/limits': 'limits', processlist: 'processlist',
};
const CONFIG = {
    enabled: true, server: 'http://glances.example.test:61208', refresh: 2, hiddenBlocks: [],
    thresholds: { cpuWarn: 80, cpuBad: 90, memWarn: 80, memBad: 90, swapWarn: 80, swapBad: 90, diskWarn: 80, diskBad: 90, tempWarn: 70, tempBad: 85 },
    diskStrip: '/rootfs', diskHide: [], hasPassword: false,
    blocks: ['system', 'figures', 'cores', 'temps', 'network', 'diskio', 'disks', 'smart', 'processes', 'containers', 'alerts'],
    collected: { series: 0, points: 0, incidents: 0, keepDays: 30 }, trackedHistory: [],
};

async function mockGlances(page) {
    await page.route('**/api/glances/**', async (route) => {
        const rest = new URL(route.request().url()).pathname.replace(/^\/api\/glances\//, '');
        let body;
        if (rest === 'status') body = { enabled: true, configured: true, refresh: 2, level: 'ok', ok: true, at: Date.now() };
        else if (rest === 'config') body = CONFIG;
        else if (FILES[rest]) body = fixture(FILES[rest]);
        else body = { available: false };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}

test('a beat that redraws the Glances overview leaves a scrolled reader where they were', async ({ page }) => {
    await mockGlances(page);
    await page.setViewportSize({ width: 1400, height: 700 });
    await markWhatsNewSeen(page);
    await page.goto('/#glances/overview');
    await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-glances-legend]')).toBeVisible();

    // Half-way through every redraw the page is moved to the top, as WebKit did.
    // The place is noted as the redraw starts and checked as it ends, in one task.
    await page.evaluate(() => {
        const inst = window.dashboardInstance.glances._module.sectionInstance;
        const render = inst.render;
        inst.render = function (...args) {
            window.__placeBefore = Math.round(window.scrollY);
            window.scrollTo({ top: 0, behavior: 'instant' });
            const out = render.apply(this, args);
            queueMicrotask(() => { window.__placeAfter = Math.round(window.scrollY); });
            return out;
        };
    });
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(800);

    const [before, after] = await page.evaluate(async () => {
        await window.dashboardInstance.glances._module.refresh({ force: true });
        await Promise.resolve();
        return [window.__placeBefore, window.__placeAfter];
    });
    expect(before).toBeGreaterThan(800);
    expect(Math.abs(after - before)).toBeLessThan(2);
});
