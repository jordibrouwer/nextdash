// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Page 0 (#glances): Config → Glances switches it on, a 0 tab and the 0 key
 * open it, and a side menu has one section per screen, read from the host set
 * up in Config through /api/glances/<path>.
 *
 * Every Glances answer is route-mocked from the recordings of a real host that
 * the Go tests use (internal/app/testdata/glances), shaped the way the server
 * passes them on: the process list without command lines, sorted and searched
 * on the server, a plugin the host does not run as {"available":false}.
 */

const DIR = path.join(__dirname, '..', 'internal', 'app', 'testdata', 'glances');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));

const FILES = {
    quicklook: 'quicklook', load: 'load', sensors: 'sensors', fs: 'fs', alert: 'alert',
    pluginslist: 'pluginslist', network: 'network', system: 'system', uptime: 'uptime',
    containers: 'containers', diskio: 'diskio', smart: 'smart', raid: 'raid',
    connections: 'connections', 'all/limits': 'limits',
};

const HASH = '#glances/overview';
const STATUS = { enabled: true, configured: true, refresh: 2, hiddenBlocks: [], thresholds: null, level: 'ok', ok: true, at: 1 };
const CONFIG = {
    enabled: true, server: 'http://glances.example.test:61208', user: '', refresh: 2, hiddenBlocks: ['alerts'],
    thresholds: { cpuWarn: 80, cpuBad: 90, memWarn: 80, memBad: 90, swapWarn: 80, swapBad: 90, diskWarn: 80, diskBad: 90, tempWarn: 70, tempBad: 85 },
    diskStrip: '/rootfs', diskHide: [], hasPassword: false,
    blocks: ['system', 'figures', 'cores', 'temps', 'network', 'diskio', 'disks', 'smart', 'processes', 'containers', 'alerts'],
    collected: { series: 12, points: 3400, since: Date.now() - 36 * 3600 * 1000, incidents: 2, keepDays: 30 },
    trackedHistory: [],
};

/** What /api/glances/insights answers: a host whose disk is filling and whose CPU is busy at night. */
const INSIGHTS = {
    at: Date.now(), range: '24h', since: Date.now() - 86400000,
    health: { score: 87, level: 'good', factors: [{ key: 'disk', value: 75, penalty: 6 }], trendCpu: 4.5 },
    forecast: [{ mount: '/mnt/disk1', percent: 75, slopePerDay: 1.5, daysToFull: 17, hours: 160 }, { mount: '/mnt/cache', percent: 12, slopePerDay: 0, hours: 160 }],
    memory: { slopePerDay: 7.5, r2: 0.9, leak: true },
    stats: { cpu: { avg: 20, p50: 18, p95: 40, p99: 60, max: 80, n: 1000 }, mem: { avg: 30, p50: 30, p95: 31, p99: 31, max: 32, n: 1000 } },
    baseline: [{ key: 'cpu', now: 40, typical: 15, ratio: 2.7 }],
    heatmap: { metric: 'cpu', unit: '%', max: 60, days: Array.from({ length: 7 }, (_, d) => ({ date: `2026-10-${10 + d}`, hours: Array.from({ length: 24 }, (_, h) => (h < 12 ? -1 : h * 2)) })) },
    network: { days: Array.from({ length: 7 }, (_, d) => ({ date: `2026-10-${10 + d}`, rx: 1e9 * (d + 1), tx: 5e8 })), peakRx: 4e6, peakTx: 1e6, p95: 2e6, totalRx: 28e9, totalTx: 3.5e9 },
    availability: { since: 1, day: 99.5, week: 99.9, timeline: Array.from({ length: 96 }, (_, i) => (i === 10 ? 0 : 1)) },
    incidents: { ongoing: [{ kind: 'cpu', start: Date.now() - 600000, peak: 95 }], past: [{ kind: 'disk', subject: '/mnt/disk1', start: Date.now() - 7200000, end: Date.now() - 3600000, peak: 91 }, { kind: 'down', start: Date.now() - 90000000, end: Date.now() - 89000000 }] },
    consumers: [{ name: 'node', kind: 'process', avgCpu: 12, maxCpu: 40, avgMem: 3, share: 60 }, { name: 'app-1', kind: 'container', avgCpu: 4, maxCpu: 9, avgMem: 1e8, share: 40 }],
    temperature: { max: 72, avg: 59, hoursWarn: 1.5, hoursBad: 0, correlationCpu: 0.5 },
};

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

/** What the server's own record answers: points for the series asked. */
function historyAnswer(url) {
    const names = ['cpu', 'mem', 'swap', 'load1', 'load5', 'load15', 'net:eth0:rx', 'net:eth0:tx', 'temp:Core', 'memc:used', 'memc:cache', 'memc:free', ...Array.from({ length: 12 }, (_, i) => `core:${i}`)];
    const asked = (url.searchParams.get('series') || '').split(',').filter(Boolean);
    const since = Number(url.searchParams.get('since')) || Date.now() - 3600 * 1000;
    const series = {};
    asked.filter((n) => names.includes(n)).forEach((name, k) => {
        series[name] = Array.from({ length: 30 }, (_, i) => [since + i * 120000, 10 + ((i * 7 + k * 13) % 60)]);
    });
    // One processor incident inside the window, one outage (drawn on every graph).
    const incidents = [
        { kind: 'cpu', start: since + 10 * 120000, end: since + 14 * 120000, peak: 95 },
        { kind: 'down', start: since + 20 * 120000, end: since + 22 * 120000 },
    ];
    return { names, series, step: 120, now: Date.now(), incidents };
}

/**
 * Mocks every Glances path. `state.overrides[path]` replaces one answer: a
 * value, a function of the URL, or { __status } for a bare HTTP status.
 */
async function mockGlances(page, overrides = {}) {
    const state = { calls: [], overrides, saved: null, tracked: [], wiped: false, paused: false };
    await page.route('**/api/glances/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const rest = url.pathname.replace(/^\/api\/glances\//, '');
        state.calls.push({ range: url.searchParams.get('range'), heat: url.searchParams.get('heat'), path: rest, sort: url.searchParams.get('sort'), q: url.searchParams.get('q'), since: url.searchParams.get('since'), until: url.searchParams.get('until'), ghost: url.searchParams.get('ghost'), series: url.searchParams.get('series') });
        const has = Object.prototype.hasOwnProperty.call(state.overrides, rest);
        let body;
        if (rest === 'data' && request.method() === 'DELETE') {
            state.wiped = true;
            body = { series: 0, points: 0, incidents: 0, keepDays: 30 };
        } else if (rest === 'config' && request.method() === 'PUT') {
            state.saved = JSON.parse(request.postData() || '{}');
            if (Array.isArray(state.saved.trackedHistory)) state.tracked = state.saved.trackedHistory;
            if (typeof state.saved.paused === 'boolean') state.paused = state.saved.paused;
            body = { ...CONFIG, ...state.saved, trackedHistory: state.tracked, paused: state.paused };
        } else if (has) {
            const o = state.overrides[rest];
            body = typeof o === 'function' ? await o(url) : o;
            if (body && typeof body === 'object' && body.__status) {
                await route.fulfill({ status: body.__status, contentType: 'text/plain', body: 'Too many requests' });
                return;
            }
        } else if (rest === 'status') {
            body = { ...STATUS, paused: state.paused };
        } else if (rest === 'config') {
            body = { ...CONFIG, trackedHistory: state.tracked, paused: state.paused, ...(state.wiped ? { collected: { series: 0, points: 0, incidents: 0, keepDays: 30 } } : {}) };
        } else if (rest === 'insights') {
            body = INSIGHTS;
        } else if (rest === 'history') {
            body = historyAnswer(url);
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

const FIRST = fixture('processlist').slice().sort((a, b) => b.cpu_percent - a.cpu_percent)[0];

test.describe('page 0: getting there', () => {
    test('not set up: the 0 key opens Config → Glances, and there is no 0 tab', async ({ page }) => {
        await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false, level: 'unknown', ok: false } });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('#page-nav-glances-btn')).toHaveCount(0);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('0');
        await expect(page).toHaveURL(/#config\/glances/);
        await expect(page.locator('[data-glances-field="server"]')).toBeVisible();
    });

    test('set up: a 0 tab with the verdict as a dot, and the tab and the key open page 0', async ({ page }) => {
        await mockGlances(page, { status: { ...STATUS, level: 'warn' } });
        await markWhatsNewSeen(page);
        await page.goto('/');
        const tab = page.locator('#page-nav-glances-btn');
        await expect(tab).toBeVisible({ timeout: 15_000 });
        await expect(tab.locator('.page-glances-dot')).toHaveAttribute('data-level', 'warn');
        await tab.click();
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        await expect(page).toHaveURL(/#glances\/overview$/);
        await expect(tab).toHaveAttribute('aria-selected', 'true');

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('0');
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
    });

    test('a bare #glances on a host that is not set up says to set it up', async ({ page }) => {
        const state = await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false } });
        await markWhatsNewSeen(page);
        await page.goto('/#glances');
        const empty = page.locator('[data-glances-empty]');
        await expect(empty).toContainText('not set up', { timeout: 15_000 });
        await empty.locator('[data-glances-open-config]').click();
        await expect(page).toHaveURL(/#config\/glances/);
        // Nothing of Glances itself was asked.
        expect(state.calls.filter((c) => !['status', 'config'].includes(c.path))).toEqual([]);
    });
});

test.describe('page 0: the Overview', () => {
    test('every block the host can fill is drawn, with real values', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const blocks = page.locator('[data-glances-block]');
        await expect(blocks.first()).toBeVisible();
        const drawn = await blocks.evaluateAll((els) => els.map((el) => el.getAttribute('data-glances-block')));
        // SMART is empty on this host, so its block is left out; alerts are hidden in Config's mock, not here.
        expect(drawn).toEqual(['system', 'figures', 'cores', 'temps', 'network', 'diskio', 'disks', 'processes', 'containers', 'alerts']);

        const quick = fixture('quicklook');
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toHaveText(`${Math.round(quick.cpu)}%`);
        await expect(page.locator('[data-glances-card="ram"] .glances-card-value')).toHaveText(`${Math.round(quick.mem)}%`);
        await expect(page.locator('[data-glances-card]')).toHaveCount(4);
        // The four big numbers follow the refresh Config sets: no range to pick.
        await expect(page.locator('[data-glances-block="figures"] [data-glances-range-select]')).toHaveCount(0);
        await expect(page.locator('[data-glances-core]')).toHaveCount(quick.percpu.length);
        await expect(page.locator('[data-glances-block="system"]')).toContainText(fixture('system').hr_name);

        // The network shows the real interface only, a 10 Gbit link as such.
        const row = page.locator('[data-glances-iface="eth0"]');
        await expect(row).toContainText('10 Gbit/s');
        await expect(page.locator('[data-glances-iface="lo"]')).toHaveCount(0);
        await expect(page.locator('[data-glances-iface="tunl0"]')).toHaveCount(0);
        // Sensors share a group: "Core 0" and "Core 11" are one line.
        await expect(page.locator('[data-glances-block="temps"] .glances-temp-name', { hasText: /^Core ×/ })).toHaveCount(1);
        expect(count(state, 'status')).toBeGreaterThan(0);
    });

    test('a block switched off in Config is drawn nowhere and asked of Glances never', async ({ page }) => {
        // The Disks block shows what each disk is doing, so it reads diskio too: switched off, nothing asks for it.
        const state = await mockGlances(page, { status: { ...STATUS, hiddenBlocks: ['containers', 'processes', 'diskio', 'disks', 'temps'] } });
        await openView(page);
        await expect(page.locator('[data-glances-block="figures"]')).toBeVisible();
        for (const id of ['containers', 'processes', 'diskio', 'disks', 'temps']) {
            await expect(page.locator(`[data-glances-block="${id}"]`)).toHaveCount(0);
        }
        expect(count(state, 'containers')).toBe(0);
        expect(count(state, 'processlist')).toBe(0);
        expect(count(state, 'diskio')).toBe(0);
    });

    test('a reading the host did not send is a dash, never zero', async ({ page }) => {
        await mockGlances(page, { quicklook: { cpu: 12.4 }, load: { available: false }, memswap: { available: false }, mem: { available: false } });
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toHaveText('12%');
        await expect(page.locator('[data-glances-card="ram"] .glances-card-value')).toHaveText('–');
        await expect(page.locator('[data-glances-card="swap"] .glances-card-value')).toHaveText('–');
        await expect(page.locator('[data-glances-card="load"] .glances-card-value')).toHaveText('–');
    });

    test('the lines come from Config: a cpu at 85 is yellow when yellow starts at 80, red when red starts at 85', async ({ page }) => {
        const thresholds = { ...CONFIG.thresholds };
        await mockGlances(page, { status: { ...STATUS, thresholds }, quicklook: { cpu: 85, mem: 10, swap: 0, percpu: [] } });
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"]')).toHaveAttribute('data-tone', 'warn');

        const page2 = await page.context().newPage();
        await mockGlances(page2, { status: { ...STATUS, thresholds: { ...thresholds, cpuBad: 85 } }, quicklook: { cpu: 85, mem: 10, swap: 0, percpu: [] } });
        await openView(page2);
        await expect(page2.locator('[data-glances-card="cpu"]')).toHaveAttribute('data-tone', 'bad');
        await page2.close();
    });

    test('the cards draw the last hour from nextDash\'s own record', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-spark svg')).toBeVisible();
        const asked = state.calls.find((c) => c.path === 'history' && c.since);
        expect(Number(asked?.since)).toBeGreaterThan(Date.now() - 3600 * 1000 - 60_000);
        await expect(page.locator('.glances-ov-span')).toContainText('last');
    });

    test('a beat that brings nothing keeps the last data on screen, with one quiet line', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const cpu = page.locator('[data-glances-card="cpu"] .glances-card-value');
        await expect(cpu).toHaveText(`${Math.round(fixture('quicklook').cpu)}%`);

        // The host stops answering: the numbers stay, nothing flashes empty.
        state.overrides.quicklook = { error: 'unreachable' };
        state.overrides.load = { error: 'unreachable' };
        state.overrides.system = { error: 'unreachable' };
        await expect(page.locator('[data-glances-status="stale"]')).toBeVisible({ timeout: 10_000 });
        await expect(cpu).toHaveText(`${Math.round(fixture('quicklook').cpu)}%`);
        await expect(page.locator('[data-glances-error]')).toBeHidden();
        await expect(page.locator('[data-glances-block="system"]')).toContainText(fixture('system').hr_name);

        // It comes back: the line goes, the numbers follow the host again.
        delete state.overrides.quicklook;
        delete state.overrides.load;
        delete state.overrides.system;
        await expect(page.locator('[data-glances-status="stale"]')).toBeHidden({ timeout: 10_000 });
    });

    test('an error from the host reads as words', async ({ page }) => {
        await mockGlances(page, { quicklook: { error: 'unreachable' }, system: { error: 'unreachable' } });
        await openView(page);
        await expect(page.locator('[data-glances-error]')).toContainText('does not answer');
    });
});

test.describe('page 0: the sections', () => {
    test('the menu lists only sections the host supports', async ({ page }) => {
        const plugins = fixture('pluginslist');
        await mockGlances(page, { pluginslist: plugins.filter((p) => p !== 'processlist' && p !== 'containers') });
        await openView(page);
        await expect.poll(() => menuIds(page)).toEqual(['overview', 'disks', 'network', 'insights', 'history', 'alerts']);
    });

    test('processes: sorts, searches on the server, and keeps the command line until asked', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/processes');
        const rows = page.locator('[data-glances-pid]');
        await expect(rows.first()).toBeVisible();
        await expect(rows.first().locator('.glances-proc-name')).toHaveText(FIRST.name);
        expect(state.calls.find((c) => c.path === 'processlist')?.sort).toBe('cpu');

        await page.locator('[data-glances-sort="name"]').click();
        await expect.poll(() => state.calls.filter((c) => c.path === 'processlist').at(-1)?.sort).toBe('name');
        await expect(page.locator('[data-glances-sort="name"]')).toHaveAttribute('aria-sort', 'ascending');

        const wanted = fixture('processlist').filter((r) => r.name.toLowerCase().includes('jelly'));
        await page.locator('[data-glances-search]').fill('jelly');
        await expect(rows).toHaveCount(wanted.length);
        expect(state.calls.filter((c) => c.path === 'processlist').at(-1)?.q).toBe('jelly');

        const pid = wanted[0].pid;
        await expect(page.locator('[data-glances-cmdline]')).toHaveCount(0);
        expect(count(state, `processes/${pid}`)).toBe(0);
        await rows.first().locator('[data-glances-expand]').click();
        await expect(page.locator('[data-glances-cmdline]')).toHaveText(`/usr/bin/${wanted[0].name} --config /etc/${wanted[0].name}.conf`);
        expect(count(state, `processes/${pid}`)).toBe(1);
    });

    test('a poll keeps focus and an open command line in place', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page);
        await openView(page, '#glances/processes');
        const row = page.locator(`[data-glances-pid="${FIRST.pid}"]`);
        await row.locator('[data-glances-expand]').click();
        await expect(page.locator('[data-glances-cmdline]')).toHaveText(`/usr/bin/${FIRST.name} --config /etc/${FIRST.name}.conf`);
        await row.locator('[data-glances-expand]').focus();
        await row.evaluate((tr) => { tr.dataset.mark = 'kept'; });
        const polls = count(state, 'processlist');
        await page.clock.runFor(5_000);
        await expect.poll(() => count(state, 'processlist')).toBeGreaterThan(polls);
        await expect(page.locator(`[data-glances-pid="${FIRST.pid}"][data-mark="kept"]`)).toHaveCount(1);
        expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-glances-expand'))).toBe(true);
    });

    test('going back to a section draws it from the cache and reads nothing again', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page, { status: { ...STATUS, refresh: 10, hiddenBlocks: [] } });
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toBeVisible();
        await page.locator('[data-glances-section="processes"]').click();
        await expect(page.locator('[data-glances-pid]').first()).toBeVisible();
        const quick0 = count(state, 'quicklook');
        await page.locator('[data-glances-section="overview"]').click();
        // Drawn at once, from what it read a moment ago: no new read of the host.
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toBeVisible();
        expect(count(state, 'quicklook')).toBe(quick0);
    });

    test('only the open section is polled, at the refresh Config says', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page, { status: { ...STATUS, refresh: 5, hiddenBlocks: [] } });
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toBeVisible();
        const load0 = count(state, 'load');
        await page.clock.runFor(4_000);
        expect(count(state, 'load')).toBe(load0);
        await page.clock.runFor(2_000);
        await expect.poll(() => count(state, 'load')).toBeGreaterThanOrEqual(load0 + 1);

        await page.locator('[data-glances-section="processes"]').click();
        await expect(page.locator('[data-glances-pid]').first()).toBeVisible();
        const load1 = count(state, 'load');
        const procs0 = count(state, 'processlist');
        await page.clock.runFor(12_000);
        await expect.poll(() => count(state, 'processlist')).toBeGreaterThanOrEqual(procs0 + 2);
        expect(count(state, 'load')).toBe(load1);
        expect(count(state, 'pluginslist')).toBe(1);
    });

    test('polling pauses while the tab is hidden', async ({ page }) => {
        await page.clock.install();
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toBeVisible();
        await setVisibility(page, 'hidden');
        const calls0 = state.calls.length;
        await page.clock.runFor(40_000);
        expect(state.calls.length).toBe(calls0);
        const load0 = count(state, 'load');
        await setVisibility(page, 'visible');
        await expect.poll(() => count(state, 'load')).toBeGreaterThan(load0);
    });

    test('an address names a section, and a menu click rewrites it', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/processes');
        await expect(page.locator('[data-glances-open="processes"]')).toBeVisible();
        expect(count(state, 'load')).toBe(0);
        await page.locator('[data-glances-section="overview"]').click();
        await expect(page).toHaveURL(/#glances\/overview$/);
        await page.evaluate(() => { window.location.hash = '#glances'; });
        await expect(page).toHaveURL(/#glances\/overview$/);
    });

    test('history: charts from the record, and the range asks again', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/history');
        await expect(page.locator('[data-glances-chart="cpu"]')).toBeVisible();
        await expect(page.locator('[data-glances-chart="network"]')).toBeVisible();
        await expect(page.locator('[data-glances-chart="temps"]')).toBeVisible();
        // Each graph has its own range, in a dropdown: the minute, hour, 6, 12, 24 hours, 7 and 30 days.
        const select = page.locator('[data-glances-range-select="cpu"]');
        await expect(select.locator('option')).toHaveText(['1 min', '1 hour', '6 hours', '12 hours', '24 hours', '7 days', '30 days']);
        const first = state.calls.filter((c) => c.path === 'history' && String(c.series || '').startsWith('cpu')).at(-1);
        await select.selectOption('30d');
        await expect.poll(() => Number(state.calls.filter((c) => c.path === 'history' && String(c.series || '').startsWith('cpu')).at(-1)?.since))
            .toBeLessThan(Number(first?.since) - 20 * 24 * 3600 * 1000);
        await expect(select).toHaveValue('30d');
        // The others did not move.
        await expect(page.locator('[data-glances-range-select="memory"]')).toHaveValue('1h');
        // And the choice is remembered.
        await page.reload();
        await expect(page.locator('[data-glances-range-select="cpu"]')).toHaveValue('30d');
    });

    test('a graph shows the reading under the pointer, and the , and . keys change its range', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/history');
        const plot = page.locator('[data-glances-plot="cpu"]');
        await expect(plot).toBeVisible();
        await plot.hover({ position: { x: 100, y: 30 } });
        await expect(page.locator('.glances-tip')).toContainText('%');
        await expect(page.locator('.glances-crosshair').first()).toBeVisible();
        await page.keyboard.press('.');
        await expect(page.locator('[data-glances-range-select="cpu"]')).toHaveValue('6h');
        await page.keyboard.press(',');
        await expect(page.locator('[data-glances-range-select="cpu"]')).toHaveValue('1h');
    });

    test('history: nothing yet says so', async ({ page }) => {
        await mockGlances(page, { history: { names: [], series: {}, step: 10, now: Date.now() } });
        await openView(page, '#glances/history');
        await expect(page.locator('[data-glances-history="empty"]')).toContainText('collecting');
    });

    test('the command line is behind the write token: a refusal says so', async ({ page }) => {
        await mockGlances(page, { [`processes/${FIRST.pid}`]: { __status: 401 } });
        await openView(page, '#glances/processes');
        await page.locator(`[data-glances-pid="${FIRST.pid}"] [data-glances-expand]`).click();
        await expect(page.locator('.glances-proc-cmd')).toContainText('write access');
    });

    test('containers: a read only table', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/containers');
        await expect(page.locator('.glances-ct-row').first()).toBeVisible();
        await expect(page.locator('.glances-ct-row')).toHaveCount(fixture('containers').length);
        await expect(page.locator('[data-glances-open="containers"] button:not(.glances-proc-sort)')).toHaveCount(0);
    });

    test('alerts: an ongoing alert from the real log', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/alerts');
        await expect(page.locator('[data-glances-open="alerts"]')).toContainText(fixture('alert')[0].type);
    });
});

test.describe('page 0: tables, cards and keys', () => {
    test('a table sorts on its columns, and keeps its order across the redraw every beat', async ({ page }) => {
        await mockGlances(page);
        await openView(page);
        const table = page.locator('[data-glances-table="overview-processes"]');
        await expect(table).toBeVisible();
        const names = () => table.locator('tbody tr td:first-child').allTextContents();
        const byCpu = await names();
        expect(byCpu[0]).toBe(FIRST.name);

        await table.locator('[data-glances-sort-col="name"]').click();
        await expect(table.locator('th').first()).toHaveAttribute('aria-sort', 'ascending');
        const alphabetical = (await names());
        expect(alphabetical).toEqual([...alphabetical].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
        // The next press reverses it.
        await table.locator('[data-glances-sort-col="name"]').click();
        await expect(table.locator('th').first()).toHaveAttribute('aria-sort', 'descending');
        // A beat later it is still the order that was asked for.
        await page.waitForTimeout(2600);
        await expect(table.locator('th').first()).toHaveAttribute('aria-sort', 'descending');
    });

    test('pointing at a row gives a card with more about it', async ({ page }) => {
        await mockGlances(page);
        await openView(page);
        const row = page.locator(`[data-glances-process="${FIRST.pid}"]`);
        await row.hover();
        const card = page.locator('.glances-tip');
        await expect(card).toBeVisible();
        await expect(card).toContainText(FIRST.name);
        await expect(card).toContainText(String(FIRST.pid));
        await expect(card).toContainText(FIRST.username);
        // It goes when the pointer does.
        await page.mouse.move(5, 5);
        await expect(card).toHaveCount(0);

        await page.locator('[data-glances-card="cpu"]').hover();
        await expect(card).toContainText('Cores');
    });

    test('keys: sections by letter, [ and ] step, r reads now, / searches the processes', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('p');
        await expect(page.locator('[data-glances-open="processes"]')).toBeVisible();
        await page.keyboard.press('/');
        await expect(page.locator('[data-glances-search]')).toBeFocused();
        await page.keyboard.press('Escape');
        await page.keyboard.press(']');
        await expect(page.locator('[data-glances-open="containers"]')).toBeVisible();
        await page.keyboard.press('[');
        await expect(page.locator('[data-glances-open="processes"]')).toBeVisible();
        await page.keyboard.press('h');
        await expect(page.locator('[data-glances-open="history"]')).toBeVisible();
        const before = count(state, 'history');
        await page.keyboard.press('r');
        await expect.poll(() => count(state, 'history')).toBeGreaterThan(before);
        await page.keyboard.press('o');
        await expect(page.locator('[data-glances-open="overview"]')).toBeVisible();
        // The legend names them.
        await expect(page.locator('[data-glances-legend] kbd')).toHaveCount(6);
        // And the letters did not open the shortcut search.
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });
});

test.describe('Config → Glances', () => {
    test('the settings are read, changed and saved without the password coming back', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const server = page.locator('[data-glances-field="server"]');
        await expect(server).toHaveValue(CONFIG.server);
        await expect(page.locator('[data-glances-block="alerts"]')).not.toBeChecked();
        await expect(page.locator('[data-glances-block="system"]')).toBeChecked();
        await expect(page.locator('[data-glances-field="diskStrip"]')).toHaveValue('/rootfs');

        await page.locator('[data-glances-field="refresh"]').selectOption('5');
        await page.locator('[data-glances-block="containers"]').uncheck();
        await page.locator('[data-glances-field="user"]').fill('me');
        await page.locator('[data-glances-field="password"]').fill('s3cret');
        await page.locator('[data-glances-line="cpuWarn"]').fill('70');
        await page.locator('[data-glances-field="diskHide"]').fill('/mnt/cache\n/mnt/user');
        await page.locator('[data-glances-save]').click();
        await expect(page.locator('[data-glances-saved]')).toContainText('Saved');

        expect(state.saved).toMatchObject({
            enabled: true, server: CONFIG.server, user: 'me', password: 's3cret', refresh: 5,
            diskHide: ['/mnt/cache', '/mnt/user'],
        });
        expect(state.saved.hiddenBlocks.sort()).toEqual(['alerts', 'containers']);
        expect(state.saved.thresholds.cpuWarn).toBe(70);
        // The field is emptied after a save: a password is never shown again.
        await expect(page.locator('[data-glances-field="password"]')).toHaveValue('');
    });

    test('Test connection says what Glances answered', async ({ page }) => {
        await mockGlances(page, { connect: { connected: 'Glances 4.5.8', version: '4.5.8', plugins: ['cpu', 'mem'] } });
        await page.route('**/api/glances/connect', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: 'Glances 4.5.8', version: '4.5.8', plugins: ['cpu', 'mem'] }) });
        });
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        await page.locator('[data-glances-connect]').click();
        await expect(page.locator('[data-glances-result]')).toContainText('Glances 4.5.8');
    });

    test('a refused login reads as words', async ({ page }) => {
        await mockGlances(page);
        await page.route('**/api/glances/connect', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'login refused' }) });
        });
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        await page.locator('[data-glances-connect]').click();
        await expect(page.locator('[data-glances-result]')).toContainText('refused that login');
    });
});

test.describe('page 0: recording, insights and the data kept', () => {
    test('a process or container records its history only when switched on', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/containers');
        const row = page.locator('[data-glances-container]').first();
        await expect(row).toBeVisible();
        await row.click();
        const drawer = page.locator('[data-glances-drawer="container"]');
        await expect(drawer).toBeVisible();
        await drawer.getByRole('tab', { name: 'History' }).click();
        // Off by default: a button, no graphs, and nothing recorded yet.
        const on = drawer.locator('[data-glances-track="on"]');
        await expect(on).toBeVisible();
        await expect(drawer.locator('[data-glances-chart]')).toHaveCount(0);
        await on.click();
        await expect.poll(() => state.tracked.length).toBe(1);
        expect(state.tracked[0]).toMatch(/^ct:/);
        await expect(drawer.locator('[data-glances-track="off"]')).toBeVisible();
        await expect(drawer.locator('[data-glances-chart]').first()).toBeVisible();
        await drawer.locator('[data-glances-track="off"]').click();
        await expect.poll(() => state.tracked.length).toBe(0);
        await expect(drawer.locator('[data-glances-track="on"]')).toBeVisible();
    });

    test('Insights: health, forecast, busy hours, incidents, with a range of its own', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/insights');
        await expect(page.locator('[data-glances-score]')).toHaveText('87');
        await expect(page.locator('[data-glances-insight="health"]')).toContainText('/mnt/disk1');
        await expect(page.locator('[data-glances-insight="health"]')).toContainText('17 days');
        await expect(page.locator('[data-glances-memory-trend="leak"]')).toBeVisible();
        await expect(page.locator('[data-glances-baseline="cpu"]')).toContainText('2.7×');
        await expect(page.locator('[data-glances-heat="cpu"] .glances-heat-cell')).toHaveCount(7 * 24);
        await expect(page.locator('[data-glances-avail] .glances-avail-cell')).toHaveCount(96);
        await expect(page.locator('[data-glances-insight="incidents"]')).toContainText('ongoing');
        await expect(page.locator('[data-glances-insight="incidents"]')).toContainText('/mnt/disk1');
        await expect(page.locator('[data-glances-insight="consumers"]')).toContainText('app-1');

        // A range of its own, and a metric for the heatmap: each asks again.
        await page.locator('[data-glances-insights-range]').selectOption('7d');
        await expect.poll(() => state.calls.some((c) => c.path === 'insights' && c.range === '7d')).toBe(true);
        await page.locator('[data-glances-heat-select]').selectOption('net');
        await expect.poll(() => state.calls.some((c) => c.path === 'insights' && c.heat === 'net')).toBe(true);
        // The table sorts on its columns.
        await page.locator('[data-glances-table="ins-consumers"] [data-glances-sort-col="name"]').click();
        await expect(page.locator('[data-glances-table="ins-consumers"] tbody tr').first()).toContainText('app-1');
        // The CSV of what is on screen.
        await expect(page.locator('[data-glances-insights-csv]')).toHaveAttribute('href', /\/api\/glances\/history\.csv\?since=\d+/);
    });

    test('Config → Glances says what is collected and deletes it on confirmation', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const info = page.locator('[data-glances-collected]');
        await expect(info).toContainText('3400');
        await expect(info).toContainText('2 incidents');
        await expect(page.locator('[data-glances-export]')).toHaveAttribute('href', /history\.csv/);
        // Declining changes nothing.
        await page.locator('[data-glances-wipe]').click();
        await page.getByRole('button', { name: /cancel/i }).click();
        expect(state.wiped).toBe(false);
        await page.locator('[data-glances-wipe]').click();
        await page.getByRole('button', { name: 'Delete data' }).click();
        await expect.poll(() => state.wiped).toBe(true);
        await expect(page.locator('[data-glances-wiped]')).toContainText('Deleted');
        await expect(info).toContainText('Nothing recorded yet');
        await expect(page.locator('[data-glances-wipe]')).toBeDisabled();
    });
});

test.describe('the connection switch', () => {
    test('page 0 and Config → Glances hold the same switch', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const toggle = page.locator('[data-glances-connection]');
        await expect(toggle).toBeChecked();
        await expect(page.locator('.glances-switch')).toContainText('Connected');
        const quick0 = count(state, 'quicklook');

        // Off on the page: saved, shown, and the host is not asked any more.
        await toggle.setChecked(false, { force: true });
        await expect.poll(() => state.paused).toBe(true);
        expect(state.saved).toEqual({ paused: true });
        await expect(page.locator('.glances-switch')).toContainText('Connection off');
        await expect(page.locator('[data-glances-status="stale"]')).toContainText('connection is off');
        await expect(page.locator('[data-glances-card="cpu"] .glances-card-value')).toBeVisible();
        const quick1 = count(state, 'quicklook');
        await page.waitForTimeout(2500);
        expect(count(state, 'quicklook')).toBe(quick1);
        expect(quick1).toBeGreaterThanOrEqual(quick0);

        // Config shows it off, and switching it on there is the same switch.
        await page.goto('/#config/glances');
        const config = page.locator('[data-glances-field="connected"]');
        await expect(config).not.toBeChecked();
        await config.setChecked(true, { force: true });
        await expect.poll(() => state.paused).toBe(false);
        await expect(page.locator('[data-glances-saved]')).toContainText('Connected');

        // And the page shows it on again.
        await openView(page);
        await expect(page.locator('[data-glances-connection]')).toBeChecked();
    });
});

test.describe('graph extras: stacked memory, yesterday, incident bands', () => {
    test('memory is a stack of programs, cache and free', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/history');
        const chart = page.locator('[data-glances-chart="memparts"]');
        await expect(chart).toBeVisible();
        await expect(chart.locator('polygon.glances-chart-layer')).toHaveCount(3);
        await expect(chart.locator('.glances-chart-legend')).toContainText('Programs');
        await expect(chart.locator('.glances-chart-legend')).toContainText('Cache');
        await expect(chart.locator('.glances-chart-legend')).toContainText('Free');
        // A stack has no comparison with yesterday.
        await expect(chart.locator('[data-glances-compare]')).toHaveCount(0);
    });

    test('yesterday behind today: a toggle, a dashed line and a question for the day before', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/history');
        const chart = page.locator('[data-glances-chart="cpu"]');
        await expect(chart).toBeVisible();
        await expect(chart.locator('.glances-chart-line--ghost')).toHaveCount(0);
        await chart.locator('[data-glances-compare="cpu"]').check();
        await expect(chart.locator('.glances-chart-line--ghost')).toHaveCount(1);
        await expect(chart.locator('.glances-chart-legend')).toContainText('Yesterday');
        const ask = state.calls.find((c) => c.path === 'history' && c.ghost === '1');
        expect(ask, 'a question for the window a day earlier').toBeTruthy();
        expect(Number(ask.until) - Number(ask.since)).toBeGreaterThan(3000 * 1000);
        expect(Date.now() - Number(ask.until)).toBeGreaterThan(23 * 3600 * 1000);
        // The choice is remembered, and off again takes the line away.
        await chart.locator('[data-glances-compare="cpu"]').uncheck();
        await expect(chart.locator('.glances-chart-line--ghost')).toHaveCount(0);
        // A week is longer than a day: nothing to put behind it.
        await chart.locator('[data-glances-range-select]').selectOption('7d');
        await expect(chart.locator('[data-glances-compare]')).toHaveCount(0);
    });

    test('what went past a red line is a band on the graph it belongs to', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/history');
        await expect(page.locator('[data-glances-chart="cpu"] [data-glances-incident="cpu"]')).toHaveCount(1);
        // The processor incident is not on the load graph; the outage is on both.
        await expect(page.locator('[data-glances-chart="load"] [data-glances-incident="cpu"]')).toHaveCount(0);
        await expect(page.locator('[data-glances-chart="cpu"] [data-glances-incident="down"]')).toHaveCount(1);
        await expect(page.locator('[data-glances-chart="load"] [data-glances-incident="down"]')).toHaveCount(1);
        await expect(page.locator('[data-glances-chart="cpu"] [data-glances-incident="cpu"]')).toHaveAttribute('title', /Processor/);
    });
});

test.describe('page 0 in the navigation and the page overview', () => {
    async function openDashboard(page, status) {
        await mockGlances(page, status ? { status } : {});
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    }

    test('the 0 tab stands right behind the last page number', async ({ page }) => {
        await openDashboard(page);
        const tab = page.locator('#page-navigation + #page-nav-glances-host #page-nav-glances-btn');
        await expect(tab).toBeVisible();
        // Before the home and bookmark icons, not after them.
        const order = await page.evaluate(() => {
            const zero = document.getElementById('page-nav-glances-btn').getBoundingClientRect().left;
            const home = document.getElementById('dashboard-home-link').getBoundingClientRect().left;
            const lastPage = [...document.querySelectorAll('#page-navigation .page-nav-btn')].pop().getBoundingClientRect().right;
            return { afterPages: zero >= lastPage - 1, beforeIcons: zero < home };
        });
        expect(order).toEqual({ afterPages: true, beforeIcons: true });
    });

    test('with the connection off the 0 stays, and without a connection it goes', async ({ page }) => {
        await openDashboard(page, { ...STATUS, paused: true });
        await expect(page.locator('#page-nav-glances-btn')).toBeVisible();
        await page.goto('/');
        await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false, level: 'unknown', ok: false } });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('#page-nav-glances-btn')).toHaveCount(0);
    });

    test('the page overview lists page 0, and its button and the 0 key open it', async ({ page }) => {
        await openDashboard(page);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(',');
        const row = page.locator('#page-overview-glances');
        await expect(row).toBeVisible();
        await expect(row).toContainText('Glances');
        await row.click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('glances');

        // And by the key, from the overview.
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(',');
        await expect(page.locator('#page-overview-glances')).toBeVisible();
        await page.keyboard.press('0');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('glances');
    });

    test('with no connection the page overview has no page 0', async ({ page }) => {
        await openDashboard(page, { ...STATUS, enabled: false, configured: false, level: 'unknown', ok: false });
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(',');
        await expect(page.locator('.page-overview-modal-list')).toBeVisible();
        await expect(page.locator('#page-overview-glances')).toHaveCount(0);
    });
});

test.describe('cores and disks, as tiles and rows', () => {
    test('a tile per core, each with the last minute behind its number', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const tiles = page.locator('[data-glances-core]');
        await expect(tiles).toHaveCount(12);
        await expect(tiles.first().locator('.glances-core-trace svg')).toBeVisible();
        await expect(tiles.first().locator('.glances-core-name')).toContainText('core 0');
        // One question for all of them, over the last minute.
        const ask = state.calls.find((c) => c.path === 'history' && /core:0/.test(c.series || ''));
        expect(ask, 'the cores asked for their history').toBeTruthy();
        expect(Date.now() - Number(ask.since)).toBeLessThan(90_000);
    });

    test('disks are grouped by role, with when they are full and what they are doing', async ({ page }) => {
        const GB = 1e9;
        const fsRows = [
            { mnt_point: '/mnt/disk1', device_name: '/dev/md1p1', size: 18 * 1e12, used: 13.6 * 1e12, free: 4.4 * 1e12, percent: 75 },
            { mnt_point: '/mnt/disk2', device_name: '/dev/md2p1', size: 7.3 * 1e12, used: 1.3 * 1e12, free: 6 * 1e12, percent: 18 },
            { mnt_point: '/mnt/cache', device_name: '/dev/nvme1n1p1', size: 3.6 * 1e12, used: 454 * GB, free: 3.1 * 1e12, percent: 12 },
            { mnt_point: '/boot', device_name: '/dev/sda1', size: 58 * GB, used: 2.7 * GB, free: 55 * GB, percent: 5 },
        ];
        const io = [
            { disk_name: 'md1p1', read_bytes_rate_per_sec: 5e6, write_bytes_rate_per_sec: 0 },
            { disk_name: 'md2p1', read_bytes_rate_per_sec: 0, write_bytes_rate_per_sec: 0 },
        ];
        await mockGlances(page, { fs: fsRows, diskio: io });
        await openView(page);
        const group = (role) => page.locator(`[data-glances-disk-group="${role}"]`);
        await expect(group('array').locator('[data-glances-mount]')).toHaveCount(2);
        await expect(group('pool')).toContainText('/mnt/cache');
        await expect(group('system')).toContainText('/boot');
        const disk1 = page.locator('[data-glances-mount="/mnt/disk1"]');
        await expect(disk1.locator('[data-glances-forecast]')).toContainText('full in 17 days');
        await expect(disk1.locator('[data-glances-activity="busy"]')).toContainText('Read');
        await expect(page.locator('[data-glances-mount="/mnt/disk2"] [data-glances-activity="idle"]')).toBeVisible();
        await expect(page.locator('[data-glances-mount="/mnt/cache"] [data-glances-forecast]')).toContainText('steady');
        await expect(disk1.locator('.glances-disk-free')).toContainText('free');
    });

    test('processes scroll sideways on a small screen instead of being cut off', async ({ page }) => {
        await page.setViewportSize({ width: 420, height: 800 });
        await mockGlances(page);
        await openView(page, '#glances/processes');
        await expect(page.locator('[data-glances-pid]').first()).toBeVisible();
        const box = await page.locator('.glances-proc-scroll').evaluate((el) => ({
            overflowX: getComputedStyle(el).overflowX, scrolls: el.scrollWidth > el.clientWidth,
        }));
        expect(box).toEqual({ overflowX: 'auto', scrolls: true });
    });
});
