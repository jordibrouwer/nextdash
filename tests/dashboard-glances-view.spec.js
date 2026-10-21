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
        await expect.poll(() => menuIds(page)).toEqual(['overview']);

        // A section registered later (as Task 8's are) joins the menu in its
        // order -- and only while the host runs its plugin.
        await page.evaluate(() => {
            window.DashboardGlancesSections.register({
                id: 'containers', label: 'Containers', order: 30, plugin: 'containers',
                Section: class { endpoints() { return ['containers']; } render(el) { el.textContent = 'stub'; } },
            });
        });
        state.overrides.pluginslist = plugins;
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);
        await page.evaluate((h) => { window.location.hash = h; }, HASH);
        await expect.poll(() => menuIds(page)).toEqual(['overview', 'processes', 'containers']);

        await page.keyboard.press('Escape');
        state.overrides.pluginslist = plugins.filter((p) => p !== 'containers');
        await page.evaluate((h) => { window.location.hash = h; }, HASH);
        await expect.poll(() => menuIds(page)).toEqual(['overview', 'processes']);

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
        await mockGlances(page, { pluginslist: ['alert'] });
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
