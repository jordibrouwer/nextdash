// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The Glances view (#glances): a side menu with one section per screen, read
 * from one Glances widget through /api/glances/<widgetId>/<path>.
 *
 * Every Glances answer is route-mocked from the recorded fixtures the Go tests
 * use (internal/app/testdata/glances), shaped the way the server passes them
 * on: the process list without command lines, sorted and searched on the
 * server, a plugin the host does not run as {"available":false}.
 */

const DIR = path.join(__dirname, '..', 'internal', 'app', 'testdata', 'glances');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));

const FILES = {
    quicklook: 'quicklook', load: 'load', sensors: 'sensors', fs: 'fs', alert: 'alert',
    pluginslist: 'pluginslist', network: 'network', system: 'system', uptime: 'uptime',
    containers: 'containers', diskio: 'diskio', smart: 'smart', raid: 'raid',
    connections: 'connections', 'all/limits': 'limits', 'cpu/history/60': 'history_cpu',
};

const HASH = '#glances/overview?w=w_gl&p=1';

/** What the server does to /processlist: search, sort, cut, strip cmdline. */
function processes(url) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'cpu';
    const rows = fixture('processlist').filter((r) => !q || r.name.toLowerCase().includes(q));
    const by = {
        cpu: (a, b) => b.cpu_percent - a.cpu_percent,
        mem: (a, b) => b.memory_percent - a.memory_percent,
        name: (a, b) => a.name.localeCompare(b.name),
        pid: (a, b) => a.pid - b.pid,
    }[sort] || ((a, b) => b.cpu_percent - a.cpu_percent);
    return rows.sort(by).slice(0, 200).map(({ cmdline, ...rest }) => rest);
}

/**
 * Mocks every Glances view path. `state.overrides[path]` replaces one answer:
 * a value, a function of the URL, or { status } for a bare HTTP status.
 */
async function mockGlances(page, overrides = {}) {
    const state = { calls: [], overrides };
    await page.route('**/api/glances/**', async (route) => {
        const url = new URL(route.request().url());
        const rest = url.pathname.replace(/^\/api\/glances\/[^/]+\//, '');
        state.calls.push({ path: rest, sort: url.searchParams.get('sort'), q: url.searchParams.get('q') });
        let body;
        if (Object.prototype.hasOwnProperty.call(state.overrides, rest)) {
            const o = state.overrides[rest];
            body = typeof o === 'function' ? await o(url) : o;
            if (body && typeof body === 'object' && body.__status) {
                await route.fulfill({ status: body.__status, contentType: 'text/plain', body: 'Too many requests' });
                return;
            }
        } else if (rest === 'processlist') {
            body = processes(url);
        } else if (rest.startsWith('processes/')) {
            const pid = Number(rest.slice('processes/'.length));
            const row = fixture('processlist').find((r) => r.pid === pid);
            body = row ? { pid, cmdline: [`/usr/bin/${row.name}`, '--config', `/etc/${row.name}.conf`] } : { available: false };
        } else if (FILES[rest]) {
            body = fixture(FILES[rest]);
        } else {
            body = { available: false };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    return state;
}

const count = (state, p) => state.calls.filter((c) => c.path === p).length;

async function openView(page, hash = HASH) {
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible({ timeout: 15_000 });
}

const menuIds = (page) => page.locator('[data-glances-section]')
    .evaluateAll((els) => els.filter((el) => !el.hidden).map((el) => el.getAttribute('data-glances-section')));

async function setVisibility(page, state) {
    await page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
        Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
}

test.describe('the Glances view', () => {
    test('menu lists only sections the host supports', async ({ page }) => {
        const plugins = fixture('pluginslist');
        const state = await mockGlances(page, { pluginslist: plugins.filter((p) => p !== 'processlist') });
        await openView(page);
        await expect.poll(() => menuIds(page)).toEqual(['overview', 'containers', 'disks', 'network', 'history', 'alerts']);

        // A section joins the menu in its order, and only while the host runs its plugin.
        state.overrides.pluginslist = plugins;
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);
        await page.evaluate((h) => { window.location.hash = h; }, HASH);
        await expect.poll(() => menuIds(page)).toEqual(['overview', 'processes', 'containers', 'disks', 'network', 'history', 'alerts']);

        await page.keyboard.press('Escape');
        state.overrides.pluginslist = plugins.filter((p) => p !== 'containers' && p !== 'alert');
        await page.evaluate((h) => { window.location.hash = h; }, HASH);
        await expect.poll(() => menuIds(page)).toEqual(['overview', 'processes', 'disks', 'network', 'history']);

        // One probe per opening, not one per section switch.
        const before = count(state, 'pluginslist');
        await page.locator('[data-glances-section="processes"]').click();
        await expect(page.locator('[data-glances-open="processes"]')).toBeVisible();
        await page.locator('[data-glances-section="overview"]').click();
        await expect(page.locator('[data-glances-open="overview"]')).toBeVisible();
        expect(count(state, 'pluginslist')).toBe(before);
    });

    test('overview shows four number cards and dashes for missing values', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const card = (k) => page.locator(`[data-glances-card="${k}"] .glances-card-value`);
        await expect(card('cpu')).toHaveText('23%');
        await expect(card('ram')).toHaveText('61%');
        await expect(card('load')).toHaveText('0.87');
        // The hottest temperature sensor; a fan is not a temperature.
        await expect(card('temp')).toHaveText('97°');
        await expect(page.locator('[data-glances-card]')).toHaveCount(4);
        await expect(page.locator('[data-glances-chart="cpu"]')).toBeVisible();

        // Unknown is not zero: a reading the host did not send is a dash.
        state.overrides.quicklook = { cpu: 23.1 };
        state.overrides.load = { available: false };
        state.overrides.sensors = { available: false };
        state.overrides['cpu/history/60'] = { available: false };
        await page.reload();
        await expect(card('cpu')).toHaveText('23%');
        await expect(card('ram')).toHaveText('–');
        await expect(card('load')).toHaveText('–');
        await expect(card('temp')).toHaveText('–');
        await expect(page.locator('[data-glances-chart="cpu"]')).toHaveCount(0);
    });

    test('processes: sorts by cpu, search filters, cmdline hidden until expanded', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/processes?w=w_gl&p=1');
        const rows = page.locator('[data-glances-pid]');
        await expect(rows).toHaveCount(12);
        await expect(rows.first().locator('.glances-proc-name')).toHaveText('dockerd');
        expect(state.calls.find((c) => c.path === 'processlist')?.sort).toBe('cpu');
        await expect(page.locator('[data-glances-top-note]')).toContainText('200');

        // Sorting is the server's: a heading asks again with its key.
        await page.locator('[data-glances-sort="name"]').click();
        await expect(rows.first().locator('.glances-proc-name')).toHaveText('containerd');
        expect(state.calls.filter((c) => c.path === 'processlist').at(-1)?.sort).toBe('name');
        await expect(page.locator('[data-glances-sort="name"]')).toHaveAttribute('aria-sort', 'ascending');
        await page.locator('[data-glances-sort="cpu"]').click();
        await expect(rows.first().locator('.glances-proc-name')).toHaveText('dockerd');

        // Search is the server's too, after a pause in typing.
        await page.locator('[data-glances-search]').fill('ple');
        await expect(rows).toHaveCount(1);
        await expect(rows.first().locator('.glances-proc-name')).toHaveText('plex');
        expect(state.calls.filter((c) => c.path === 'processlist').at(-1)?.q).toBe('ple');

        // The command line is never in the list; it is asked for on expand.
        await expect(page.locator('[data-glances-cmdline]')).toHaveCount(0);
        expect(count(state, 'processes/1111')).toBe(0);
        await rows.first().locator('[data-glances-expand]').click();
        await expect(page.locator('[data-glances-cmdline]')).toHaveText('/usr/bin/plex --config /etc/plex.conf');
        expect(count(state, 'processes/1111')).toBe(1);
        await rows.first().locator('[data-glances-expand]').click();
        await expect(page.locator('[data-glances-cmdline]')).toHaveCount(0);
    });

    test('a poll keeps focus and an open command line in place', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page);
        await openView(page, '#glances/processes?w=w_gl&p=1');
        const row = page.locator('[data-glances-pid="1000"]');
        await row.locator('[data-glances-expand]').click();
        await expect(page.locator('[data-glances-cmdline]')).toHaveText('/usr/bin/dockerd --config /etc/dockerd.conf');
        await row.locator('[data-glances-expand]').focus();
        const marked = await row.evaluate((tr) => { tr.dataset.mark = 'kept'; return true; });
        expect(marked).toBe(true);
        const polls = count(state, 'processlist');
        await page.clock.runFor(5_000);
        await expect.poll(() => count(state, 'processlist')).toBeGreaterThan(polls);
        // The same row element, its button still focused, the command line still open.
        await expect(page.locator('[data-glances-pid="1000"][data-mark="kept"]')).toHaveCount(1);
        expect(await page.evaluate(() => document.activeElement?.closest('[data-glances-pid]')?.getAttribute('data-glances-pid'))).toBe('1000');
        expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-glances-expand'))).toBe(true);
        await expect(page.locator('[data-glances-cmdline]')).toHaveText('/usr/bin/dockerd --config /etc/dockerd.conf');
    });

    test('a failed command line read says so and asks again', async ({ page }) => {
        const state = await mockGlances(page, { 'processes/1111': { __status: 429 } });
        await openView(page, '#glances/processes?w=w_gl&p=1');
        const row = page.locator('[data-glances-pid="1111"]');
        await row.locator('[data-glances-expand]').click();
        await expect(page.locator('.glances-proc-cmd')).toContainText('Too many requests, retrying');
        await expect(page.locator('.glances-proc-cmd')).not.toContainText('No command line');
        delete state.overrides['processes/1111'];
        await row.locator('[data-glances-expand]').click();
        await expect(page.locator('[data-glances-cmdline]')).toHaveText('/usr/bin/plex --config /etc/plex.conf');
        expect(count(state, 'processes/1111')).toBe(2);
    });

    test('a section switch drops the stale answer', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-card]')).toHaveCount(4);
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        state.overrides.processlist = async (url) => { await held; return processes(url); };
        await page.locator('[data-glances-section="processes"]').click();
        await expect.poll(() => count(state, 'processlist')).toBe(1);
        await page.locator('[data-glances-section="overview"]').click();
        await expect(page.locator('[data-glances-card]')).toHaveCount(4);
        release();
        // Give the late answer its chance to land, then check it did not.
        await page.waitForTimeout(500);
        await expect(page.locator('[data-glances-open="overview"]')).toBeVisible();
        await expect(page.locator('[data-glances-card]')).toHaveCount(4);
        await expect(page.locator('[data-glances-pid]')).toHaveCount(0);
    });

    test('a widget the server does not know reads as no widget', async ({ page }) => {
        await mockGlances(page, { pluginslist: { __status: 404 } });
        await markWhatsNewSeen(page);
        await page.goto('/#glances/overview?w=gone&p=1');
        await expect(page.locator('[data-glances-empty]')).toContainText('Add a Glances widget to a page first.', { timeout: 15_000 });
        await expect(page.locator('[data-glances-error]')).toHaveCount(0);
    });

    test('a host with none of the sections says so', async ({ page }) => {
        await mockGlances(page, { pluginslist: ['system'] });
        await openView(page);
        await expect(page.locator('[data-glances-body]')).toContainText('Not available on this host.');
    });

    test('processes says so when the host has no process list', async ({ page }) => {
        await mockGlances(page, { processlist: { available: false } });
        await openView(page, '#glances/processes?w=w_gl&p=1');
        await expect(page.locator('[data-glances-open="processes"]')).toContainText('Not available on this host');
        await expect(page.locator('[data-glances-pid]')).toHaveCount(0);
    });

    test('only the open section is polled', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toHaveText('23%');
        const load0 = count(state, 'load');
        await page.clock.runFor(12_000);
        await expect.poll(() => count(state, 'load')).toBeGreaterThanOrEqual(load0 + 2);
        expect(count(state, 'processlist')).toBe(0);

        await page.locator('[data-glances-section="processes"]').click();
        await expect(page.locator('[data-glances-pid]')).toHaveCount(12);
        const procs0 = count(state, 'processlist');
        const load1 = count(state, 'load');
        const hist1 = count(state, 'cpu/history/60');
        await page.clock.runFor(12_000);
        await expect.poll(() => count(state, 'processlist')).toBeGreaterThanOrEqual(procs0 + 2);
        expect(count(state, 'load')).toBe(load1);
        expect(count(state, 'cpu/history/60')).toBe(hist1);
        expect(count(state, 'pluginslist')).toBe(1);
    });

    test('polling pauses when the tab is hidden', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toHaveText('23%');
        await setVisibility(page, 'hidden');
        const calls0 = state.calls.length;
        await page.clock.runFor(40_000);
        expect(state.calls.length).toBe(calls0);

        // Back in view: one read at once, then the timer again.
        const load0 = count(state, 'load');
        await setVisibility(page, 'visible');
        await expect.poll(() => count(state, 'load')).toBe(load0 + 1);
        await page.clock.runFor(5_500);
        await expect.poll(() => count(state, 'load')).toBeGreaterThanOrEqual(load0 + 2);
    });

    test('hash #glances/processes opens that section on load', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/processes?w=w_gl&p=1');
        await expect(page.locator('[data-glances-open="processes"]')).toBeVisible();
        await expect(page.locator('[data-glances-section="processes"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-glances-pid]')).toHaveCount(12);
        expect(count(state, 'load')).toBe(0);
        expect(page.url()).toContain('#glances/processes?w=w_gl&p=1');

        // A section in the menu is an address: switching rewrites the hash.
        await page.locator('[data-glances-section="overview"]').click();
        await expect(page.locator('[data-glances-open="overview"]')).toBeVisible();
        await expect(page).toHaveURL(/#glances\/overview\?w=w_gl&p=1$/);

        // A bare #glances over the open view gets its widget back in the address.
        await page.evaluate(() => { window.location.hash = '#glances'; });
        await expect(page).toHaveURL(/#glances\/overview\?w=w_gl&p=1$/);
    });

    test('without a Glances widget the view says to add one', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#glances');
        const empty = page.locator('[data-glances-empty]');
        await expect(empty).toContainText('Add a Glances widget to a page first.', { timeout: 15_000 });
        await expect(empty.locator('a')).toHaveAttribute('href', /#1$/);
        expect(state.calls.length).toBe(0);
    });

    test('errors and the rate limit read as words', async ({ page }) => {
        const state = await mockGlances(page, {
            quicklook: { error: 'unreachable' }, load: { error: 'unreachable' }, sensors: { error: 'unreachable' },
            mem: { error: 'unreachable' }, 'cpu/history/60': { error: 'unreachable' },
        });
        await openView(page);
        await expect(page.locator('[data-glances-error="unreachable"]')).toContainText('does not answer');

        state.overrides = { quicklook: { __status: 429 } };
        await page.locator('[data-glances-section="processes"]').click();
        await page.locator('[data-glances-section="overview"]').click();
        await expect(page.locator('[data-glances-status="limited"]')).toContainText('Too many requests, retrying');
    });

    test('escape and back leave the view', async ({ page }) => {
        await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        const open = async () => {
            await page.evaluate((h) => { window.location.hash = h; }, HASH);
            await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        };
        const view = () => page.evaluate(() => window.dashboardInstance.activeView);
        const timerOff = () => page.evaluate(() => {
            const g = window.dashboardInstance.glances?.instance;
            return Boolean(g) && g._pollTimer === null && g._badgeTimer === null;
        });

        await open();
        await page.keyboard.press('Escape');
        await expect.poll(view).toBe('bookmarks');
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);
        await expect(page).toHaveURL(/#\d+$/);
        expect(await timerOff()).toBe(true);

        await open();
        await page.goBack();
        await expect.poll(view).toBe('bookmarks');
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);
        expect(await timerOff()).toBe(true);
    });
});

/** A history answer: one series per key, `n` points 30 s apart from 10:00. */
function history(keys, n = 20, base = 10) {
    const out = {};
    keys.forEach((k, ki) => {
        out[k] = Array.from({ length: n }, (_, i) => {
            const sec = i * 30;
            const ts = `2026-10-21T10:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
            return [ts, base + ki + (i % 5)];
        });
    });
    return out;
}

const sectionHash = (id) => `#glances/${id}?w=w_gl&p=1`;

test.describe('the Glances view: containers, disks, network, history, alerts', () => {
    test('containers: a read only table that sorts in the browser', async ({ page }) => {
        const longCommand = `/usr/bin/run ${'--flag=value '.repeat(60)}`;
        const rows = fixture('containers');
        rows[0].command = longCommand;
        await mockGlances(page, { containers: rows });
        await openView(page, sectionHash('containers'));
        const names = () => page.locator('[data-glances-container] .glances-ct-cell--name').allTextContents();
        await expect(page.locator('[data-glances-container]')).toHaveCount(3);
        const first = page.locator('[data-glances-container="jellyfin"]');
        await expect(first.locator('.glances-ct-cell--status')).toHaveText('running');
        await expect(first.locator('.glances-ct-cell--uptime')).toHaveText('3 days');
        await expect(first.locator('.glances-ct-cell--cpu')).toHaveText('4.2%');
        await expect(first.locator('.glances-ct-cell--mem')).toHaveText('774.4 MB');
        await expect(first.locator('.glances-ct-cell--io')).toContainText('1.2 MB');
        await expect(first.locator('.glances-ct-cell--net')).toContainText('2.2 MB');
        await expect(first.locator('.glances-ct-cell--image')).toHaveText('jellyfin/jellyfin:latest');

        // Read only: nothing in the rows to press, and no action anywhere in the body.
        await expect(page.locator('[data-glances-container] button')).toHaveCount(0);
        await expect(page.locator('[data-glances-open="containers"] [data-glances-action]')).toHaveCount(0);

        // A long command is cut to the cell and kept whole in its title.
        const cmd = first.locator('.glances-ct-cell--command');
        await expect(cmd).toHaveAttribute('title', longCommand);
        const fits = await cmd.evaluate((c) => c.getBoundingClientRect().width < 400
            && document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits).toBe(true);

        // Sorting is the browser's: the same rows, reordered.
        expect(await names()).toEqual(['jellyfin', 'old-job', 'postgres']);
        await page.locator('[data-glances-ct-sort="cpu"]').click();
        expect(await names()).toEqual(['jellyfin', 'postgres', 'old-job']);
        await expect(page.locator('[data-glances-ct-sort="cpu"]')).toHaveAttribute('aria-sort', 'descending');
        await page.locator('[data-glances-ct-sort="cpu"]').click();
        expect(await names()).toEqual(['old-job', 'postgres', 'jellyfin']);
        await expect(page.locator('[data-glances-ct-sort="cpu"]')).toHaveAttribute('aria-sort', 'ascending');
    });

    test('containers: no plugin on the host, and a missing field is a dash', async ({ page }) => {
        const state = await mockGlances(page, { containers: [{ name: 'bare' }] });
        await openView(page, sectionHash('containers'));
        const row = page.locator('[data-glances-container="bare"]');
        await expect(row.locator('.glances-ct-cell--cpu')).toHaveText('–');
        await expect(row.locator('.glances-ct-cell--mem')).toHaveText('–');
        await expect(row.locator('.glances-ct-cell--image')).toHaveText('–');
        state.overrides.containers = { available: false };
        await page.locator('[data-glances-section="overview"]').click();
        await page.locator('[data-glances-section="containers"]').click();
        await expect(page.locator('[data-glances-open="containers"]')).toContainText('Glances has no container plugin on this host.');
        await expect(page.locator('[data-glances-container]')).toHaveCount(0);
    });

    test('disks: usage bars without pseudo filesystems, I/O rates, SMART and RAID only when answered', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, sectionHash('disks'));
        const mounts = () => page.locator('[data-glances-fs]').evaluateAll((els) => els.map((e) => e.getAttribute('data-glances-fs')));
        await expect.poll(mounts).toEqual(['/', '/mnt/data']);
        await expect(page.locator('[data-glances-fs="/mnt/data"] .glances-bar-value')).toHaveText('82%');
        await expect(page.locator('[data-glances-fs="/mnt/data"] .glances-bar')).toHaveAttribute('data-tone', 'warn');
        await expect(page.locator('[data-glances-fs="/"] .glances-bar')).not.toHaveAttribute('data-tone', /.+/);

        const io = page.locator('[data-glances-diskio="sdb"]');
        await expect(io.locator('.glances-io-read')).toHaveText('1.0 MB/s');
        await expect(page.locator('[data-glances-diskio="sda"] .glances-io-write')).toHaveText('20.0 KB/s');

        // SMART came with data; RAID answered {} so there is no heading.
        await expect(page.locator('[data-glances-block="smart"]')).toContainText('/dev/sda');
        await expect(page.locator('[data-glances-block="smart"]')).toContainText('EXAMPLE 250GB');
        await expect(page.locator('[data-glances-block="raid"]')).toHaveCount(0);

        state.overrides.raid = { md0: { status: 'active', type: 'raid1', components: { sda1: 0, sdb1: 1 }, available: 2, used: 2 } };
        state.overrides.smart = { available: false };
        await page.locator('[data-glances-section="overview"]').click();
        await page.locator('[data-glances-section="disks"]').click();
        await expect(page.locator('[data-glances-block="raid"]')).toContainText('md0');
        await expect(page.locator('[data-glances-block="raid"]')).toContainText('raid1');
        await expect(page.locator('[data-glances-block="smart"]')).toHaveCount(0);

        state.overrides.smart = [];
        await page.locator('[data-glances-section="overview"]').click();
        await page.locator('[data-glances-section="disks"]').click();
        await expect(page.locator('[data-glances-block="smart"]')).toHaveCount(0);
        await expect(page.locator('[data-glances-fs]')).toHaveCount(2);
    });

    test('disks stay in the menu without SMART, and are not read for it', async ({ page }) => {
        const plugins = fixture('pluginslist').filter((p) => p !== 'smart' && p !== 'raid');
        const state = await mockGlances(page, { pluginslist: plugins });
        await openView(page, sectionHash('disks'));
        await expect.poll(() => menuIds(page)).toContain('disks');
        await expect(page.locator('[data-glances-fs]')).toHaveCount(2);
        await expect(page.locator('[data-glances-block="smart"], [data-glances-block="raid"]')).toHaveCount(0);
        expect(count(state, 'smart')).toBe(0);
        expect(count(state, 'raid')).toBe(0);
    });

    test('network: rates per interface, a dash when missing, connections and wifi when answered', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, sectionHash('network'));
        const eth = page.locator('[data-glances-iface="eth0"]');
        await expect(eth.locator('.glances-net-cell--rx')).toHaveText('122.1 KB/s');
        await expect(eth.locator('.glances-net-cell--tx')).toHaveText('41.0 KB/s');
        await expect(eth.locator('.glances-net-cell--speed')).toHaveText('1 Gbit/s');
        await expect(eth.locator('.glances-net-cell--state')).toHaveText('up');
        await expect(page.locator('[data-glances-iface="wlan0"] .glances-net-cell--state')).toHaveText('down');
        await expect(page.locator('[data-glances-block="connections"]')).toContainText('34');
        await expect(page.locator('[data-glances-block="wifi"]')).toHaveCount(0);

        state.overrides.network = fixture('network_norate');
        state.overrides.connections = { available: false };
        state.overrides.wifi = [{ interface_name: 'wlan0', ssid: 'HomeNet', signal: -52 }];
        await page.locator('[data-glances-section="overview"]').click();
        await page.locator('[data-glances-section="network"]').click();
        await expect(eth.locator('.glances-net-cell--rx')).toHaveText('–');
        await expect(eth.locator('.glances-net-cell--tx')).toHaveText('–');
        await expect(page.locator('[data-glances-block="connections"]')).toHaveCount(0);
        await expect(page.locator('[data-glances-block="wifi"]')).toContainText('HomeNet');
        await expect(page.locator('[data-glances-block="wifi"]')).toContainText('-52');
    });

    test('history: one chart per plugin, span from the timestamps, short series left out', async ({ page }) => {
        await mockGlances(page, {
            'cpu/history/60': history(['total']),
            'mem/history/60': history(['percent'], 40),
            'memswap/history/60': history(['percent'], 1),
            'load/history/60': history(['min1', 'min5', 'min15']),
            'network/history/60': history(['eth0.bytes_recv_rate_per_sec', 'eth0.bytes_sent_rate_per_sec'], 20, 1000),
            'diskio/history/60': { available: false },
        });
        await openView(page, sectionHash('history'));
        const charts = () => page.locator('[data-glances-chart]').evaluateAll((els) => els.map((e) => e.getAttribute('data-glances-chart')));
        await expect.poll(charts).toEqual(['cpu', 'mem', 'load', 'network']);
        // 20 points 30 s apart span 9.5 minutes, 40 points 19.5: read from the answer.
        await expect(page.locator('[data-glances-chart="cpu"] figcaption')).toContainText('last 10 min');
        await expect(page.locator('[data-glances-chart="mem"] figcaption')).toContainText('last 20 min');
        await expect(page.locator('[data-glances-chart="cpu"] svg polyline')).toHaveCount(1);
        await expect(page.locator('[data-glances-chart="load"] svg polyline')).toHaveCount(3);
        await expect(page.locator('[data-glances-history-empty]')).toHaveCount(0);
    });

    test('history: nothing yet says so', async ({ page }) => {
        await mockGlances(page, {
            'cpu/history/60': { total: [] }, 'mem/history/60': { available: false },
            'load/history/60': history(['min1'], 1),
        });
        await openView(page, sectionHash('history'));
        await expect(page.locator('[data-glances-history-empty]')).toHaveText('Glances has no history yet.');
        await expect(page.locator('[data-glances-chart]')).toHaveCount(0);
    });

    test('alerts: newest first, ongoing marked, limits beside the meters, count in the menu', async ({ page }) => {
        const alerts = [
            { begin: 1792500000, end: 1792503600, state: 'CRITICAL', type: 'CPU', max: 97.2 },
            ...fixture('alert'),
            { begin: 1792560000, end: 1792561000, state: 'WARNING', type: 'LOAD', max: null },
        ];
        await mockGlances(page, { alert: alerts });
        await openView(page, sectionHash('alerts'));
        const rows = page.locator('[data-glances-alert]');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.glances-al-cell--type')).toHaveText('MEM');
        await expect(rows.nth(0).locator('.glances-al-cell--end')).toHaveText('Ongoing');
        await expect(rows.nth(0).locator('.glances-al-cell--state')).toHaveText('WARNING');
        await expect(rows.nth(0).locator('.glances-al-cell--max')).toHaveText('88.1');
        await expect(rows.nth(1).locator('.glances-al-cell--type')).toHaveText('LOAD');
        await expect(rows.nth(1).locator('.glances-al-cell--max')).toHaveText('–');
        await expect(rows.nth(2).locator('.glances-al-cell--end')).not.toHaveText('Ongoing');
        await expect(page.locator('[data-glances-limit="mem_careful"]')).toContainText('50');
        await expect(page.locator('[data-glances-limits]')).toContainText('90');
        // One alert is ongoing, and that is what the menu counts.
        await expect(page.locator('[data-glances-section="alerts"] .lvs-filter-count')).toHaveText('1');
    });

    test('alerts: none says so, and limits that did not answer are left out', async ({ page }) => {
        await mockGlances(page, { alert: [], 'all/limits': { available: false } });
        await openView(page, sectionHash('alerts'));
        await expect(page.locator('[data-glances-open="alerts"]')).toContainText('No alerts.');
        await expect(page.locator('[data-glances-limits]')).toHaveCount(0);
        await expect(page.locator('[data-glances-section="alerts"] .lvs-filter-count')).toHaveText('');
    });

    test('every new section reads {available:false} as words, not a crash', async ({ page }) => {
        const none = { available: false };
        await mockGlances(page, {
            containers: none, fs: none, diskio: none, smart: none, raid: none, network: none, connections: none,
            wifi: none, alert: none, 'all/limits': none, 'cpu/history/60': none,
        });
        await openView(page, sectionHash('disks'));
        await expect(page.locator('[data-glances-open="disks"]')).toContainText('Not available on this host.');
        await page.locator('[data-glances-section="network"]').click();
        await expect(page.locator('[data-glances-open="network"]')).toContainText('Not available on this host.');
        await page.locator('[data-glances-section="alerts"]').click();
        await expect(page.locator('[data-glances-open="alerts"]')).toContainText('Not available on this host.');
        await page.locator('[data-glances-section="history"]').click();
        await expect(page.locator('[data-glances-open="history"]')).toContainText('Glances has no history yet.');
    });

    test('only the open section is polled', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page);
        await openView(page, sectionHash('containers'));
        await expect(page.locator('[data-glances-container]')).toHaveCount(3);
        const mark = state.calls.length;
        await page.clock.runFor(11_000);
        await expect.poll(() => count(state, 'containers')).toBeGreaterThan(1);
        const since = state.calls.slice(mark).map((c) => c.path);
        for (const other of ['diskio', 'smart', 'raid', 'network', 'connections', 'wifi', 'processlist', 'all/limits']) {
            expect(since, other).not.toContain(other);
        }
    });
});
