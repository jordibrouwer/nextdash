// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The Glances page (#glances): Config → Glances switches it on, an icon in the navigation and Shift+G
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

/** What /api/glances/docker-link answers: one machine, with one container matched by id. */
const LINK = {
    mode: 'auto', same: true, reason: 'same-name', glancesHost: 'nas', dockerHost: 'nas',
    matches: [{ glances: 'app-1', docker: 'app-1-docker', dockerId: 'abc123', by: 'id' }],
    onlyGlances: ['glances-only'], onlyDocker: ['idle-one'], byId: 1, byName: 0,
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
function historyAnswer(url, extra = []) {
    const names = [...extra, 'cpu', 'mem', 'swap', 'load1', 'load5', 'load15', 'net:eth0:rx', 'net:eth0:tx', 'temp:Core', 'memc:used', 'memc:cache', 'memc:free', ...Array.from({ length: 12 }, (_, i) => `core:${i}`)];
    const asked = (url.searchParams.get('series') || '').split(',').filter(Boolean);
    const since = Number(url.searchParams.get('since')) || Date.now() - 3600 * 1000;
    const series = {};
    asked.filter((n) => names.includes(n) || n.startsWith('ct:')).forEach((name, k) => {
        series[name] = Array.from({ length: 30 }, (_, i) => [since + i * 120000, 10 + ((i * 7 + k * 13) % 60)]);
    });
    // One processor incident inside the window, one outage (drawn on every graph).
    const incidents = [
        { kind: 'cpu', start: since + 10 * 120000, end: since + 14 * 120000, peak: 95 },
        { kind: 'down', start: since + 20 * 120000, end: since + 22 * 120000 },
    ];
    const restarts = url.searchParams.get('restarts') ? [since + 12 * 120000] : [];
    return { names, series, step: 120, now: Date.now(), incidents, restarts };
}

/**
 * Mocks every Glances path. `state.overrides[path]` replaces one answer: a
 * value, a function of the URL, or { __status } for a bare HTTP status.
 */
async function mockGlances(page, overrides = {}) {
    const state = { calls: [], overrides, saved: null, tracked: [], wiped: false, paused: false, recordEvery: 30, retentionDays: 30, reset: false, hosts: null, extraNames: [], link: JSON.parse(JSON.stringify(LINK)) };
    await page.route('**/api/glances/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const rest = url.pathname.replace(/^\/api\/glances\//, '');
        state.calls.push({ range: url.searchParams.get('range'), heat: url.searchParams.get('heat'), path: rest, sort: url.searchParams.get('sort'), q: url.searchParams.get('q'), since: url.searchParams.get('since'), until: url.searchParams.get('until'), ghost: url.searchParams.get('ghost'), series: url.searchParams.get('series'), host: url.searchParams.get('host'), remove: url.searchParams.get('remove') });
        const asked = url.searchParams.get('host');
        const known = state.hosts && state.hosts.find((h) => h.id === asked);
        const hostNow = state.hosts ? (known || state.hosts[0]) : null;
        const summaries = () => state.hosts.map((h) => ({ id: h.id, name: h.name, configured: h.configured !== false, paused: false, level: 'ok', ok: true }));
        const hostBits = () => (state.hosts ? { id: hostNow.id, name: hostNow.name, hostConfigured: hostNow.configured !== false, ...(hostNow.configured === false ? { server: '' } : {}), hosts: summaries() } : {});
        const has = Object.prototype.hasOwnProperty.call(state.overrides, rest);
        let body;
        if (rest === 'config' && request.method() === 'DELETE' && url.searchParams.get('remove') === '1') {
            state.hosts = state.hosts.filter((h) => h.id !== asked);
            body = { ...CONFIG, id: state.hosts[0].id, name: state.hosts[0].name, hosts: state.hosts.map((h) => ({ id: h.id, name: h.name, configured: true, paused: false, level: 'ok', ok: true })) };
        } else if (rest === 'config' && request.method() === 'PUT' && asked === 'new' && state.hosts) {
            const sent = JSON.parse(request.postData() || '{}');
            state.saved = sent;
            const created = { id: String(sent.name || 'host').toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: sent.name };
            state.hosts.push(created);
            body = { ...CONFIG, server: '', id: created.id, name: created.name, hosts: state.hosts.map((h) => ({ id: h.id, name: h.name, configured: true, paused: false, level: 'ok', ok: true })) };
        } else if (rest === 'config' && request.method() === 'DELETE') {
            state.reset = true;
            state.tracked = [];
            state.paused = false;
            body = { ...CONFIG, enabled: false, server: '', user: '', hiddenBlocks: [], hasPassword: false, diskHide: [], collected: { series: 0, points: 0, incidents: 0, keepDays: 30 } };
        } else if (rest === 'data' && request.method() === 'DELETE') {
            state.wiped = true;
            body = { series: 0, points: 0, incidents: 0, keepDays: 30 };
        } else if (rest === 'config' && request.method() === 'PUT') {
            state.saved = JSON.parse(request.postData() || '{}');
            if (Array.isArray(state.saved.trackedHistory)) state.tracked = state.saved.trackedHistory;
            if (typeof state.saved.paused === 'boolean') state.paused = state.saved.paused;
            if (typeof state.saved.recordEvery === 'number') state.recordEvery = state.saved.recordEvery;
            if (typeof state.saved.retentionDays === 'number') state.retentionDays = state.saved.retentionDays;
            body = { ...CONFIG, ...state.saved, ...hostBits(), trackedHistory: state.tracked, paused: state.paused };
        } else if (has) {
            const o = state.overrides[rest];
            body = typeof o === 'function' ? await o(url) : o;
            if (body && typeof body === 'object' && body.__status) {
                await route.fulfill({ status: body.__status, contentType: 'text/plain', body: 'Too many requests' });
                return;
            }
        } else if (rest === 'status') {
            body = { ...STATUS, ...hostBits(), paused: state.paused, recordEvery: state.recordEvery, retentionDays: state.retentionDays };
        } else if (rest === 'config') {
            body = { ...CONFIG, ...hostBits(), ...(state.reset ? { enabled: false, server: '', user: '', hiddenBlocks: [], hasPassword: false } : {}), trackedHistory: state.tracked, paused: state.paused, ...(state.wiped ? { collected: { series: 0, points: 0, incidents: 0, keepDays: 30 } } : {}) };
        } else if (rest === 'insights') {
            body = INSIGHTS;
        } else if (rest === 'hosts') {
            body = { hosts: (state.hosts || []).map((h, i) => (h.configured === false
                ? { id: h.id, name: h.name, configured: false, paused: false, level: 'unknown', ok: false, at: 0, cpu: null, mem: null, disk: null, temp: null }
                : { id: h.id, name: h.name, configured: true, paused: false, level: i ? 'warn' : 'ok', ok: true, at: Date.now(), cpu: i ? 84 : 22, mem: 48, disk: i ? 35 : 91, diskMount: '/mnt/disk1', temp: 54 })) };
        } else if (rest === 'docker-link') {
            body = state.link;
        } else if (rest === 'history') {
            body = historyAnswer(url, state.extraNames);
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

test.describe('Glances page: getting there', () => {
    test('not set up: no Glances icon, and neither Shift+G nor 0 open anything', async ({ page }) => {
        await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false, level: 'unknown', ok: false } });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('#page-nav-glances-link')).toHaveCount(0);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Shift+G');
        await page.keyboard.press('0');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
        await expect(page).not.toHaveURL(/#config\/glances|#glances/);
    });

    test('set up: an icon in the navigation with the verdict as a dot; the icon and Shift+G open the page', async ({ page }) => {
        await mockGlances(page, { status: { ...STATUS, level: 'warn' } });
        await markWhatsNewSeen(page);
        await page.goto('/');
        const link = page.locator('#page-nav-glances-link');
        await expect(link).toBeVisible({ timeout: 15_000 });
        await expect(link).toHaveAttribute('aria-keyshortcuts', 'Shift+G');
        await expect(link).toHaveAttribute('title', /Shift\+G/);
        await expect(link.locator('.glances-link-dot')).toHaveAttribute('data-level', 'warn');
        await link.click();
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        await expect(page).toHaveURL(/#glances\/overview$/);
        await expect(link).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Shift+G');
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
        expect(state.calls.filter((c) => !['status', 'config', 'docker-link'].includes(c.path))).toEqual([]);
    });
});

test.describe('Glances page: the Overview', () => {
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

test.describe('Glances page: the sections', () => {
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
        // The only control in a row is the ↗ to its twin in the Containers view, when there is one.
        await expect(page.locator('[data-glances-open="containers"] button:not(.glances-proc-sort):not(.glances-ct-link):not(.glances-search-clear)')).toHaveCount(0);
    });

    test('containers: a search field in the same place as Processes, with a count and a clear button', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/containers');
        const all = fixture('containers').length;
        const field = page.locator('[data-glances-open="containers"] [data-glances-search]');
        await expect(field).toHaveAttribute('placeholder', 'Search containers');
        await expect(page.locator('[data-glances-ct-note]')).toHaveText(`Containers: ${all}`);
        const name = String(fixture('containers')[0].name);
        await field.fill(name.slice(1, 4).toUpperCase());
        await expect(page.locator('.glances-ct-row').first()).toContainText(name.slice(1, 4), { ignoreCase: true });
        await expect(page.locator('[data-glances-ct-note]')).toContainText('Showing');
        await field.fill('zzz-no-such-container');
        await expect(page.locator('.glances-ct-row')).toHaveCount(0);
        await expect(page.locator('[data-glances-ct-message]')).toContainText('No container matches.');
        await page.locator('.glances-search-clear').click();
        await expect(field).toHaveValue('');
        await expect(page.locator('.glances-ct-row')).toHaveCount(all);
        // The / key reaches this field too.
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('/');
        await expect(field).toBeFocused();
    });

    test('alerts: an ongoing alert from the real log', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/alerts');
        await expect(page.locator('[data-glances-open="alerts"]')).toContainText(fixture('alert')[0].type);
    });
});

test.describe('Glances page: tables, cards and keys', () => {
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
        // No Save button: leaving the last field keeps everything.
        await expect(page.locator('[data-glances-save]')).toHaveCount(0);
        await page.locator('[data-glances-field="diskHide"]').blur();
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

test.describe('Glances page: recording, insights and the data kept', () => {
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
        await chart.locator('[data-glances-compare="cpu"]').selectOption('day');
        await expect(chart.locator('.glances-chart-line--ghost')).toHaveCount(1);
        await expect(chart.locator('.glances-chart-legend')).toContainText('Yesterday');
        const ask = state.calls.find((c) => c.path === 'history' && c.ghost === '1');
        expect(ask, 'a question for the window a day earlier').toBeTruthy();
        expect(Number(ask.until) - Number(ask.since)).toBeGreaterThan(3000 * 1000);
        expect(Date.now() - Number(ask.until)).toBeGreaterThan(23 * 3600 * 1000);
        // The choice is remembered, and off again takes the line away.
        await chart.locator('[data-glances-compare="cpu"]').selectOption('');
        await expect(chart.locator('.glances-chart-line--ghost')).toHaveCount(0);
        // Last week behind today, with its own question a week back.
        await chart.locator('[data-glances-compare="cpu"]').selectOption('week');
        await expect(chart.locator('.glances-chart-line--ghost')).toHaveCount(1);
        await expect(chart.locator('.glances-chart-legend')).toContainText('Last week');
        const weekAsk = state.calls.filter((c) => c.path === 'history' && c.ghost === '1').pop();
        expect(Date.now() - Number(weekAsk.until)).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
        // A week of window has only last week to be compared with, not yesterday.
        await chart.locator('[data-glances-range-select]').selectOption('7d');
        await expect(chart.locator('[data-glances-compare="cpu"] option')).toHaveText(['Compare: off', 'Last week']);
        // A month has nothing to put behind it.
        await chart.locator('[data-glances-range-select]').selectOption('30d');
        await expect(chart.locator('[data-glances-compare]')).toHaveCount(0);
    });

    test('Save image gives the graph as a PNG, from the history and from an incident', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/history');
        const chart = page.locator('[data-glances-chart="cpu"]');
        await expect(chart).toBeVisible();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            chart.locator('[data-glances-snapshot="cpu"]').click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/^glances-.*-cpu-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/);
        const fs = require('fs');
        const bytes = fs.readFileSync(await download.path());
        expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(bytes.length).toBeGreaterThan(4000);
        // The lines carry their own colours: a picture has no stylesheet, and without them every line is a black shape.
        const svg = await page.evaluate(() => window.DashboardGlancesChart.snapshotSvg(document.querySelector('[data-glances-chart="cpu"]'), { dash: window.dashboardInstance }));
        expect(svg).toMatch(/stroke:\s*rgb|stroke:\s*#/);
        expect(svg).not.toMatch(/<polyline[^>]*style="[^"]*stroke:\s*;/);

        // The same button on the graphs around an incident.
        await chart.locator('[data-glances-incident="cpu"]').click();
        const drawer = page.locator('[data-glances-drawer="incident"]');
        await expect(drawer.locator('[data-glances-snapshot="cpu"]')).toBeVisible();
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

    test('a processor incident names who was busiest, from what is recorded', async ({ page }) => {
        const state = await mockGlances(page);
        state.extraNames = ['ct:app-1:cpu'];
        await openView(page, '#glances/history');
        await page.locator('[data-glances-chart="cpu"] [data-glances-incident="cpu"]').click();
        const cause = page.locator('[data-glances-incident-cause]');
        await expect(cause).toHaveAttribute('data-glances-incident-cause', 'app-1');
        await expect(cause).toContainText('Busiest at the time: app-1');
        // Nothing recorded, nothing said.
        state.extraNames = [];
        await page.reload();
        await expect(page.locator('[data-glances-chart="cpu"]')).toBeVisible({ timeout: 15_000 });
        await page.locator('[data-glances-chart="cpu"] [data-glances-incident="cpu"]').click();
        await expect(page.locator('[data-glances-drawer="incident"]')).toBeVisible();
        await expect(page.locator('[data-glances-incident-cause]')).toHaveCount(0);
    });

    test('a click on an incident opens the graphs around that moment in the side panel', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page, '#glances/history');
        await page.locator('[data-glances-chart="cpu"] [data-glances-incident="cpu"]').click();
        const drawer = page.locator('[data-glances-drawer="incident"]');
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(/Processor/);
        await expect(drawer.locator('[data-glances-chart="cpu"]')).toBeVisible();
        await expect(drawer.locator('[data-glances-chart="memory"]')).toBeVisible();
        // The incident is drawn on its own graph, and the window is a fixed one, not a range to pick.
        await expect(drawer.locator('[data-glances-chart="cpu"] [data-glances-incident="cpu"]')).toHaveCount(1);
        await expect(drawer.locator('[data-glances-range-select]')).toHaveCount(0);
        const ask = state.calls.filter((c) => c.path === 'history' && c.until).pop();
        expect(ask, 'a question with a window around the incident').toBeTruthy();
        // From Insights the same incident opens it too.
        await page.keyboard.press('Escape');
        await openView(page, '#glances/insights');
        await page.locator('[data-glances-incident-open]').first().click();
        await expect(page.locator('[data-glances-drawer="incident"]')).toBeVisible();
    });
});

test.describe('Glances in the navigation and the page overview', () => {
    async function openDashboard(page, status) {
        await mockGlances(page, status ? { status } : {});
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    }

    test('the icon stands where Config stood, and Config is one place to the right', async ({ page }) => {
        await openDashboard(page);
        await expect(page.locator('#page-nav-glances-host #page-nav-glances-link')).toBeVisible();
        const order = await page.evaluate(() => [...document.querySelectorAll('.header-destinations > *')]
            .map((el) => el.id || el.className.split(' ')[0]));
        const at = (name) => order.indexOf(name);
        expect(at('page-nav-glances-host')).toBeGreaterThan(-1);
        expect(at('page-nav-docker-host')).toBeLessThan(at('page-nav-glances-host'));
        expect(at('page-nav-glances-host')).toBeLessThan(at('config-link'));
        // Not beside the page numbers any more.
        await expect(page.locator('#page-navigation #page-nav-glances-link')).toHaveCount(0);
        const left = await page.evaluate(() => ({
            glances: document.getElementById('page-nav-glances-link').getBoundingClientRect().left,
            config: document.querySelector('.config-link-anchor').getBoundingClientRect().left,
        }));
        expect(left.glances).toBeLessThan(left.config);
    });

    test('with the connection off the icon stays, and without a connection it goes', async ({ page }) => {
        await openDashboard(page, { ...STATUS, paused: true });
        await expect(page.locator('#page-nav-glances-link')).toBeVisible();
        await page.goto('/');
        await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false, level: 'unknown', ok: false } });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('#page-nav-glances-link')).toHaveCount(0);
    });

    test('the page overview no longer lists Glances, and 0 does nothing there', async ({ page }) => {
        await openDashboard(page);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(',');
        await expect(page.locator('.page-overview-modal-list')).toBeVisible();
        await expect(page.locator('#page-overview-glances')).toHaveCount(0);
        await expect(page.locator('.page-overview-modal-glances')).toHaveCount(0);
        await page.keyboard.press('0');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).not.toBe('glances');
    });

    test('Shift+G is Glances from the dashboard, and stays "last item" inside the Inbox, Config and Bookmarks views', async ({ page }) => {
        await openDashboard(page);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.evaluate(() => { window.__lastKey = null; });
        await page.keyboard.press('Shift+G');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('glances');
        // From Config, G keeps its own meaning (jump to the last section).
        await page.goto('/#config/appearance');
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await page.keyboard.press('Shift+G');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
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

test.describe('graphs on a small screen', () => {
    test('no graph runs past its panel, and the time labels do not collide', async ({ page }) => {
        await page.setViewportSize({ width: 420, height: 900 });
        await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-chart]').first()).toBeVisible();
        const result = await page.evaluate(() => {
            const wide = [...document.querySelectorAll('.glances-chart')].filter((c) => {
                const parent = c.closest('.glances-ov-block');
                return parent && (c.getBoundingClientRect().right > parent.getBoundingClientRect().right + 1 || c.scrollWidth > c.clientWidth + 1);
            }).length;
            const overlapping = [...document.querySelectorAll('.glances-axis-x')].filter((axis) => {
                const ticks = [...axis.querySelectorAll('.glances-axis-tick')].filter((t) => getComputedStyle(t).display !== 'none')
                    .map((t) => t.getBoundingClientRect());
                return ticks.some((r, i) => i > 0 && r.left < ticks[i - 1].right - 1);
            }).length;
            return { wide, overlapping };
        });
        expect(result).toEqual({ wide: 0, overlapping: 0 });
    });
});

test.describe('how long the history is kept', () => {
    test('7, 30 or 90 days on the page; the range menu follows it', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const pick = page.locator('[data-glances-retention]');
        await expect(pick.locator('option')).toHaveText(['7 days', '30 days', '90 days']);
        await expect(pick).toHaveValue('30');
        const ranges = page.locator('[data-glances-range-select]').first();
        await expect(ranges.locator('option').last()).toHaveText('30 days');
        await pick.selectOption('90');
        await expect.poll(() => state.retentionDays).toBe(90);
        expect(state.saved).toEqual({ retentionDays: 90 });
        await openView(page);
        await expect(page.locator('[data-glances-range-select]').first().locator('option').last()).toHaveText('90 days');
        await page.locator('[data-glances-retention]').selectOption('7');
        await expect.poll(() => state.retentionDays).toBe(7);
        await openView(page);
        await expect(page.locator('[data-glances-range-select]').first().locator('option').last()).toHaveText('7 days');
    });
});

test.describe('how often the host is recorded', () => {
    test('a choice on the page, from two seconds to an hour, kept on the server', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        const pick = page.locator('[data-glances-record]');
        await expect(pick).toBeVisible();
        await expect(pick.locator('option')).toHaveText(['2 seconds', '5 seconds', '10 seconds', '30 seconds', '1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour']);
        await expect(pick).toHaveValue('30');
        await pick.selectOption('900');
        await expect.poll(() => state.recordEvery).toBe(900);
        expect(state.saved).toEqual({ recordEvery: 900 });
        // The reading is described: how many an hour that is.
        await expect(pick).toHaveAttribute('title', /4 readings an hour/);
        // It is on the page and in the server's status, not in Config.
        await page.goto('/#config/glances');
        await expect(page.locator('[data-glances-field="refresh"]')).toBeVisible();
        await expect(page.locator('[data-glances-record]')).toHaveCount(0);
        await openView(page);
        await expect(page.locator('[data-glances-record]')).toHaveValue('900');
    });
});

test.describe('the ℹ buttons', () => {
    test('the header ℹ opens the page explainer', async ({ page }) => {
        await mockGlances(page);
        await openView(page);
        await page.locator('[data-glances-help]').click();
        const modal = page.locator('#app-modal .view-explain-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText('How the Glances page works');
        await expect(modal).toContainText('Record every');
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0);
    });

    test('a block ℹ opens a short popover that closes on Escape, outside and on the next one', async ({ page }) => {
        await mockGlances(page);
        await openView(page);
        const cores = page.locator('[data-glances-info="cores"]');
        await cores.click();
        const pop = page.locator('[data-glances-info-pop]');
        await expect(pop).toHaveAttribute('data-glances-info-pop', 'cores');
        await expect(pop).toContainText('single-threaded');
        await expect(cores).toHaveAttribute('aria-expanded', 'true');
        // Inside the window.
        const box = await pop.boundingBox();
        const vp = page.viewportSize();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        // Still on the page: Escape closed the popover, not the view.
        await expect(page.locator('[data-glances-body]')).toBeVisible();
        await expect(cores).toBeFocused();

        // Another ℹ replaces it; a click elsewhere closes it.
        await cores.click();
        await page.locator('[data-glances-info="temps"]').click();
        await expect(pop).toHaveAttribute('data-glances-info-pop', 'temps');
        await page.locator('.glances-switch').first().hover();
        await page.mouse.click(5, 5);
        await expect(pop).toHaveCount(0);

        // Its link goes to the explainer.
        await cores.click();
        await pop.locator('.glances-info-pop-more').click();
        await expect(page.locator('#app-modal .view-explain-modal')).toBeVisible();
    });

    test('from the keyboard: Enter opens it with focus inside, Escape closes it and gives the focus back', async ({ page }) => {
        await mockGlances(page);
        await openView(page);
        const cores = page.locator('[data-glances-info="cores"]');
        await cores.focus();
        await page.keyboard.press('Enter');
        const pop = page.locator('[data-glances-info-pop]');
        await expect(pop).toBeVisible();
        await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-glances-info-pop]')))).toBe(true);
        await expect(pop).toHaveAttribute('role', 'dialog');
        await expect(pop).toHaveAttribute('aria-labelledby', /.+/);
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(cores).toBeFocused();
        await expect(cores).toHaveAttribute('aria-expanded', 'false');
    });

    test('the settings, the graphs and the cryptic terms have theirs', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/history');
        await expect(page.locator('[data-glances-info="record"]')).toBeVisible();
        await expect(page.locator('[data-glances-info="connection"]')).toBeVisible();
        await expect(page.locator('[data-glances-chart="cpu"] [data-glances-info="chart-cpu"]')).toBeVisible();
        await expect(page.locator('[data-glances-chart="cpu"] [data-glances-info="yesterday"]')).toBeVisible();
        // A stack has no Yesterday, and so no ℹ for it.
        await expect(page.locator('[data-glances-chart="memparts"] [data-glances-info="yesterday"]')).toHaveCount(0);
        await page.locator('[data-glances-chart="cpu"] [data-glances-info="chart-cpu"]').click();
        await expect(page.locator('[data-glances-info-pop]')).toContainText('Red bands');

        await page.locator('[data-glances-section="insights"]').click();
        await expect(page.locator('[data-glances-insight="health"] [data-glances-info="score"]')).toBeVisible();
        await expect(page.locator('[data-glances-insight="health"] [data-glances-info="forecast"]')).toBeVisible();
        await expect(page.locator('[data-glances-insight="heatmap"] [data-glances-info="heatmap"]')).toBeVisible();
        // The popover goes when the page does.
        await page.locator('[data-glances-info="score"]').click();
        await expect(page.locator('[data-glances-info-pop]')).toHaveCount(1);
        await page.locator('[data-glances-section="history"]').click();
        await page.locator('[data-glances-info="record"]').click();
        await expect(page.locator('[data-glances-info-pop]')).toHaveCount(1);
    });

    test('every ℹ has a name for a screen reader and text behind it', async ({ page }) => {
        await mockGlances(page);
        await openView(page);
        const buttons = await page.locator('[data-glances-info]').evaluateAll((els) => els.map((el) => ({
            id: el.getAttribute('data-glances-info'), label: el.getAttribute('aria-label') || '',
        })));
        expect(buttons.length).toBeGreaterThan(8);
        buttons.forEach((b) => expect(b.label, b.id).toMatch(/^About /));
        const known = await page.evaluate(() => Object.keys(window.DashboardGlancesInfo.TEXTS));
        buttons.forEach((b) => expect(known, b.id).toContain(b.id));
    });
});

test.describe('Config → Glances: reset', () => {
    test('Show Glances and the connection go off together, and the connection follows Show Glances', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const shown = page.locator('[data-glances-field="enabled"]');
        const connected = page.locator('[data-glances-field="connected"]');
        await expect(shown).toBeChecked();
        await expect(connected).toBeChecked();
        // Off with Show Glances: the connection reads off and cannot be switched.
        await shown.uncheck();
        await expect(connected).not.toBeChecked();
        await expect(connected).toBeDisabled();
        await shown.check();
        await expect(connected).toBeEnabled();
        await expect(connected).toBeChecked();

        // Reset asks first, then clears the settings and the record.
        await page.locator('[data-glances-reset]').click();
        await page.getByRole('button', { name: /cancel/i }).click();
        expect(state.reset).toBe(false);
        await page.locator('[data-glances-reset]').click();
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect.poll(() => state.reset).toBe(true);
        await expect(page.locator('[data-glances-reset-result]')).toContainText('reset');
        await expect(page.locator('[data-glances-field="server"]')).toHaveValue('');
        await expect(shown).not.toBeChecked();
        await expect(connected).not.toBeChecked();
        await expect(connected).toBeDisabled();
        await expect(page.locator('[data-glances-collected]')).toContainText('Nothing recorded yet');
    });
});

test.describe('Config → Glances: how often an open page reads', () => {
    test('from a second to a quarter of an hour, saved as seconds', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        // Named apart from Record every, on the Glances page: the two are different things.
        await expect(page.locator('label[for="config-glances-refresh"]')).toHaveText('Refresh while the page is open');
        await expect(page.locator('#config-glances-body')).not.toContainText('Read the host');
        const refresh = page.locator('[data-glances-field="refresh"]');
        await expect(refresh.locator('option')).toHaveText(['Every 1 s', 'Every 2 s', 'Every 5 s', 'Every 10 s', 'Every 30 s', 'Every 1 min', 'Every 5 min', 'Every 15 min']);
        await refresh.selectOption('900');
        await expect(page.locator('[data-glances-saved]')).toContainText('Saved');
        expect(state.saved.refresh).toBe(900);
    });
});

test.describe('Config navigation: Glances', () => {
    test('the Glances section carries the "new" badge in the rail', async ({ page }) => {
        await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const item = page.locator('[data-config-section="glances"]');
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('data-config-new', /new/i);
        // Its own name stays the section's name, for readers and searches.
        await expect(item).toHaveAttribute('title', 'Glances');
    });
});

test.describe('Config → Glances: every change is kept', () => {
    test('a checkbox or a choice is saved at once, and the field being typed in is left alone', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        await expect(page.locator('[data-glances-field="server"]')).toHaveValue(CONFIG.server);

        await page.locator('[data-glances-block="containers"]').uncheck();
        await expect.poll(() => state.saved && state.saved.hiddenBlocks && state.saved.hiddenBlocks.includes('containers')).toBe(true);
        await expect(page.locator('[data-glances-saved]')).toContainText('Saved');

        // Typing in a field while an earlier save answers does not lose what is typed.
        const user = page.locator('[data-glances-field="user"]');
        await page.locator('[data-glances-block="smart"]').uncheck();
        await user.focus();
        await user.pressSequentially('mar');
        await expect.poll(() => state.saved && state.saved.hiddenBlocks && state.saved.hiddenBlocks.includes('smart')).toBe(true);
        await expect(user).toHaveValue('mar');
        await user.blur();
        await expect.poll(() => state.saved.user).toBe('mar');
    });

    test('notices per kind of incident: all off at first, each saved at once', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const boxes = page.locator('[data-glances-notify]');
        await expect(boxes).toHaveCount(6);
        for (let i = 0; i < 6; i += 1) await expect(boxes.nth(i)).not.toBeChecked();
        await page.locator('[data-glances-notify="down"]').check();
        await page.locator('[data-glances-notify="disk"]').check();
        await expect.poll(() => state.saved && state.saved.notify && state.saved.notify.slice().sort().join(',')).toBe('disk,down');
        await page.locator('[data-glances-notify="down"]').uncheck();
        await expect.poll(() => state.saved.notify.join(',')).toBe('disk');
    });

    test('Show Glances without an address says so and stays off', async ({ page }) => {
        const state = await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false } });
        await page.route('**/api/glances/config', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...CONFIG, enabled: false, server: '' }) });
            } else {
                await route.fallback();
            }
        });
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const shown = page.locator('[data-glances-field="enabled"]');
        await expect(page.locator('[data-glances-field="server"]')).toHaveValue('');
        await shown.check();
        await expect(page.locator('[data-glances-saved]')).toContainText('Fill in the address first');
        await expect(shown).not.toBeChecked();
        // What was asked of the server never switched it on.
        await expect.poll(() => state.saved && state.saved.enabled).toBe(false);
    });
});

test.describe('the public demo has no Glances', () => {
    // The server writes <meta name="nextdash-demo"> in demo mode; here it is put into the page.
    async function asDemo(page) {
        await page.route('**/', async (route) => {
            if (route.request().resourceType() !== 'document') return route.fallback();
            const response = await route.fetch();
            const body = (await response.text()).replace('<head>', '<head><meta name="nextdash-demo" content="1">');
            return route.fulfill({ response, body });
        });
    }

    test('no icon, Shift+G and #glances open nothing, and Config has no Glances section', async ({ page }) => {
        // Even a server that says it is set up changes nothing in the demo.
        await mockGlances(page, { status: { ...STATUS, level: 'ok' } });
        await asDemo(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('meta[name="nextdash-demo"]')).toHaveCount(1);
        await expect(page.locator('#page-nav-glances-link')).toHaveCount(0);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Shift+G');
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        await page.goto('/#glances');
        await page.waitForTimeout(800);
        await expect(page.locator('#dashboard-layout.glances-layout')).toHaveCount(0);

        await page.goto('/#config/glances');
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await expect(page.locator('[data-config-section="glances"]')).toHaveCount(0);
        await expect(page.locator('[data-glances-field="server"]')).toHaveCount(0);
    });
});

test.describe('Glances and the Containers view: the same machine', () => {
    test('a container links to its twin by the server\'s map, with the Docker name', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/containers');
        const link = page.locator('[data-glances-ct-link]');
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('data-glances-ct-link', 'app-1-docker');
        await link.click();
        await expect(page).toHaveURL(/#docker\/app-1-docker/);
    });

    test('the side panel names the twin, and its history marks the restarts', async ({ page }) => {
        const state = await mockGlances(page);
        state.tracked = ['ct:app-1'];
        await openView(page, '#glances/containers');
        await page.locator('[data-glances-container="app-1"]').click();
        const drawer = page.locator('[data-glances-drawer="container"]');
        await expect(drawer).toContainText('Containers: app-1-docker');
        await drawer.getByRole('tab', { name: 'History' }).click();
        await expect(drawer.locator('[data-glances-restart]').first()).toBeAttached();
        // The restarts of this container were asked with its history.
        expect(state.calls.some((c) => c.path === 'history' && /ct:app-1:/.test(c.series || ''))).toBe(true);
    });

    test('not one machine: no ↗ and no twin in the panel', async ({ page }) => {
        const state = await mockGlances(page);
        state.link = { ...state.link, same: false, reason: 'different-name', matches: [] };
        await openView(page, '#glances/containers');
        await expect(page.locator('[data-glances-container]').first()).toBeVisible();
        await expect(page.locator('[data-glances-ct-link]')).toHaveCount(0);
        await page.locator('[data-glances-container="app-1"]').click();
        await expect(page.locator('[data-glances-drawer="container"]')).not.toContainText('Containers: ');
    });

    test('the ranking of who used the most links a container too', async ({ page }) => {
        await mockGlances(page);
        await openView(page, '#glances/insights');
        // The sample ranking has a container named app-1.
        await expect(page.locator('[data-glances-insight="consumers"] [data-glances-consumer-link="app-1-docker"]')).toBeVisible();
    });

    test('Config → Glances: Auto, Yes or No, with what was detected and what matched', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const select = page.locator('[data-glances-field="dockerLink"]');
        await expect(select).toHaveValue('auto');
        await expect(select.locator('option')).toHaveText(['Auto', 'Yes', 'No']);
        const info = page.locator('[data-glances-link-state]');
        await expect(info).toContainText('Detected: the same machine (nas)');
        await expect(info).toContainText('1 containers matched: 1 by id');
        await expect(page.locator('[data-glances-link-lists]')).toBeVisible();
        await page.locator('[data-glances-link-lists] summary').click();
        await expect(page.locator('[data-glances-link-only]')).toContainText('glances-only');
        await expect(page.locator('[data-glances-link-only]')).toContainText('idle-one');

        // Different machines: said so, with both names, and a way out.
        state.link = { ...state.link, same: false, reason: 'different-name', dockerHost: 'tower', matches: [] };
        await select.selectOption('no');
        await expect.poll(() => state.saved && state.saved.dockerLink).toBe('no');
        await expect(info).toContainText('Different machines: Glances says nas, Docker says tower');
        await expect(page.locator('[data-glances-link-lists]')).toBeHidden();
    });
});

test.describe('Config → Glances: from the address to the page', () => {
    test('an address that was just left is tried, and the page is one click away', async ({ page }) => {
        await mockGlances(page);
        let connects = 0;
        await page.route('**/api/glances/connect', async (route) => {
            connects += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: 'Glances 4.5.8', plugins: ['cpu', 'mem'] }) });
        });
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const open = page.locator('[data-glances-open-page]');
        await expect(open).toBeVisible();
        // Leaving the address field tries it without pressing Test connection.
        const server = page.locator('[data-glances-field="server"]');
        await server.fill('http://192.168.0.20:61208');
        await server.blur();
        await expect.poll(() => connects).toBeGreaterThan(0);
        await expect(page.locator('[data-glances-result]')).toContainText('Glances 4.5.8');
        await open.click();
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
    });

    test('with Glances off there is no button to open it', async ({ page }) => {
        await mockGlances(page, { status: { ...STATUS, enabled: false, configured: false } });
        await page.route('**/api/glances/config', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...CONFIG, enabled: false }) });
            } else await route.fallback();
        });
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        await expect(page.locator('[data-glances-field="server"]')).toHaveValue(CONFIG.server);
        await expect(page.locator('[data-glances-open-page]')).toBeHidden();
    });
});

test.describe(':glances in the command palette', () => {
    async function openPalette(page, query) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await page.keyboard.press('>');
        await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
        await page.keyboard.type(query);
    }

    test('a section opens; record and pause change the settings', async ({ page }) => {
        const state = await mockGlances(page);
        await openPalette(page, ':glances proc');
        await page.locator('.search-match', { hasText: /Glances — Processes/ }).click();
        await expect(page).toHaveURL(/#glances\/processes/);

        await openPalette(page, ':glances record 15m');
        await page.locator('.search-match', { hasText: /Record every 15m/ }).click();
        await expect.poll(() => state.recordEvery).toBe(900);

        await openPalette(page, ':glances pause');
        await page.locator('.search-match', { hasText: /Pause the connection/ }).click();
        await expect.poll(() => state.paused).toBe(true);
    });

    test('track and untrack offer the names Glances shows', async ({ page }) => {
        const state = await mockGlances(page);
        const name = fixture('containers')[0].name;
        await openPalette(page, ':glances ');
        // The names are read when :glances is typed.
        await page.waitForTimeout(300);
        await page.keyboard.type(`track ${name.slice(0, 4)}`);
        await page.locator('.search-match', { hasText: new RegExp(`Record the history of container ${name}`) }).click();
        await expect.poll(() => state.tracked).toContain(`ct:${name}`);
    });

    test('nothing is offered while Glances is off', async ({ page }) => {
        await mockGlances(page, { status: { ...STATUS, configured: false } });
        await openPalette(page, ':glances');
        await expect(page.locator('.search-match', { hasText: /Set up Glances/ })).toBeVisible();
        await expect(page.locator('.search-match', { hasText: /Record every/ })).toHaveCount(0);
    });
});

test.describe('Glances page: names, focus and contrast', () => {
    const SECTIONS = ['overview', 'processes', 'containers', 'disks', 'network', 'insights', 'history', 'alerts'];

    /** What a screen reader would be missing, and the text a reader could not read, in the theme shown. */
    async function audit(page) {
        return page.evaluate(() => {
            const root = document.querySelector('#dashboard-layout.glances-layout');
            const visible = (el) => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
            };
            const nameOf = (el) => {
                const label = el.getAttribute('aria-label') || '';
                if (label.trim()) return label;
                const by = el.getAttribute('aria-labelledby');
                if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim())) return 'labelled';
                if ((el.textContent || '').trim()) return 'text';
                if (el.getAttribute('title')) return 'title';
                if (el.id && document.querySelector(`label[for="${el.id}"]`)) return 'label';
                if (el.closest('label')?.textContent.trim()) return 'label';
                return '';
            };
            const unnamed = [...root.querySelectorAll('button, a[href], select, input:not([type=hidden]), textarea, [role=button], [role=switch]')]
                .filter(visible).filter((el) => !nameOf(el)).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
            const hiddenFocusable = [...root.querySelectorAll('[aria-hidden="true"]')]
                .flatMap((h) => [...h.querySelectorAll('button, a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])')])
                .filter((el) => !el.disabled).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);

            const parse = (c) => {
                const m = c.match(/rgba?\(([^)]+)\)/);
                if (!m) return null;
                const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
                return { r, g, b, a };
            };
            const over = (top, under) => ({
                r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1,
            });
            const backdrop = (el) => {
                const stack = [];
                for (let n = el; n; n = n.parentElement) {
                    const bg = parse(getComputedStyle(n).backgroundColor);
                    if (bg && bg.a > 0) stack.push(bg);
                    if (bg && bg.a >= 1) break;
                }
                return stack.reverse().reduce((acc, c) => over(c, acc), { r: 255, g: 255, b: 255, a: 1 });
            };
            const lum = ({ r, g, b }) => {
                const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const weak = [];
            root.querySelectorAll('*').forEach((el) => {
                if (!visible(el)) return;
                const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
                if (!own) return;
                const cs = getComputedStyle(el);
                if (Number(cs.opacity) < 1) return;
                const fg = parse(cs.color);
                if (!fg) return;
                const bg = backdrop(el);
                const text = over(fg, bg);
                const a = lum(text); const b = lum(bg);
                const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                if (ratio < 3) weak.push(`${ratio.toFixed(2)} ${el.tagName.toLowerCase()}.${el.className} "${own.slice(0, 24)}"`);
            });
            return { unnamed: [...new Set(unnamed)], hiddenFocusable: [...new Set(hiddenFocusable)], weak: [...new Set(weak)].slice(0, 12) };
        });
    }

    for (const theme of [null, 'paper-ink-light']) {
        test(`every section has names on its controls, no focus in hidden parts and readable text (${theme || 'default theme'})`, async ({ page }) => {
            await mockGlances(page);
            for (const id of SECTIONS) {
                await openView(page, `#glances/${id}`);
                if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
                await page.waitForTimeout(400);
                const result = await audit(page);
                expect(result, `section ${id}`).toEqual({ unnamed: [], hiddenFocusable: [], weak: [] });
            }
        });
    }
});

test.describe('several hosts', () => {
    const TWO = () => [{ id: 'main', name: 'Home' }, { id: 'nas', name: 'NAS' }];

    test('one host: no menu. Several: a menu in the header, the address carries the host, and every read follows it', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-host]')).toHaveCount(0);

        state.hosts = TWO();
        await page.reload();
        const pick = page.locator('[data-glances-host]');
        await expect(pick.locator('option')).toHaveText(['Home', 'NAS']);
        await expect(pick).toHaveValue('main');
        // The first host's address names no host.
        await expect(page).toHaveURL(/#glances\/overview$/);
        await pick.selectOption('nas');
        await expect(page).toHaveURL(/#glances\/overview\?host=nas$/);
        await expect.poll(() => state.calls.some((c) => c.path === 'pluginslist' && c.host === 'nas')).toBe(true);
        await expect.poll(() => state.calls.some((c) => c.path === 'status' && c.host === 'nas')).toBe(true);
        // Remembered here, and an address with a host opens on it.
        state.calls.length = 0;
        await page.goto('/#glances/history');
        await page.reload();
        await expect(page.locator('[data-glances-host]')).toHaveValue('nas');
        await expect.poll(() => state.calls.some((c) => c.path === 'history' && c.host === 'nas')).toBe(true);
        await pick.selectOption('main');
        await expect(page).toHaveURL(/#glances\/history$/);
    });

    test('the pace and the retention chosen on the page are saved for the host shown', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = TWO();
        await openView(page, '#glances/overview?host=nas');
        await page.locator('[data-glances-record]').selectOption('900');
        await expect.poll(() => state.calls.some((c) => c.path === 'config' && c.host === 'nas')).toBe(true);
        expect(state.saved).toEqual({ recordEvery: 900 });
    });

    test('Config: a button per host, add one by name, edit it, remove it', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = TWO();
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const tabs = page.locator('[data-glances-host-tab]');
        await expect(tabs).toHaveText(['Home', 'NAS']);
        await expect(page.locator('[data-glances-host-tab="main"]')).toHaveAttribute('aria-pressed', 'true');

        await page.locator('[data-glances-host-tab="nas"]').click();
        await expect(page.locator('[data-glances-host-tab="nas"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-glances-field="name"]')).toHaveValue('NAS');
        await expect.poll(() => state.calls.some((c) => c.path === 'config' && c.host === 'nas')).toBe(true);
        // A change is saved for that host.
        await page.locator('[data-glances-field="dockerLink"]').selectOption('no');
        await expect.poll(() => state.calls.some((c) => c.path === 'config' && c.host === 'nas' && state.saved && state.saved.dockerLink === 'no')).toBe(true);

        await page.locator('[data-glances-host-add]').click();
        await page.locator('[data-glances-host-new-name]').fill('Pi');
        await page.locator('[data-glances-host-new-ok]').click();
        await expect(page.locator('[data-glances-host-tab="pi"]')).toHaveAttribute('aria-pressed', 'true');
        expect(state.saved).toEqual({ name: 'Pi' });
        await expect(tabs).toHaveText(['Home', 'NAS', 'Pi']);

        await page.locator('[data-glances-host-remove]').click();
        await page.getByRole('button', { name: 'Remove', exact: true }).click();
        await expect(tabs).toHaveText(['Home', 'NAS']);
        expect(state.calls.some((c) => c.path === 'config' && c.host === 'pi' && c.remove === '1')).toBe(true);
    });

    test('with one host there is nothing to remove, and five is the most', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = [{ id: 'main', name: 'Home' }];
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        await expect(page.locator('[data-glances-host-tab]')).toHaveCount(1);
        await expect(page.locator('[data-glances-host-remove]')).toBeHidden();
        state.hosts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase() }));
        await page.reload();
        await expect(page.locator('[data-glances-host-tab]')).toHaveCount(5);
        await expect(page.locator('[data-glances-host-add]')).toBeHidden();
    });

    test('Config: Glances readings for the Containers view are on, and keeping Docker\'s own is saved', async ({ page }) => {
        const state = await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const box = page.locator('[data-glances-field="useForContainers"]');
        await expect(box).toBeChecked();
        await box.uncheck();
        await expect.poll(() => state.saved && state.saved.keepDockerStats).toBe(true);
        await box.check();
        await expect.poll(() => state.saved.keepDockerStats).toBe(false);
    });

    test('Config says which host the Containers view is linked to', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = [{ id: 'main', name: 'Home' }, { id: 'nas', name: 'NAS' }];
        state.link.hostId = 'nas';
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        const line = page.locator('[data-glances-link-docker-host]');
        await expect(line).toContainText('linked to NAS');
        await page.locator('[data-glances-host-tab="nas"]').click();
        await expect(line).toContainText('This is the Docker host');
    });

    test('Hosts: a section only with several hosts, a row each, and a click opens that host', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-section="hosts"]')).toHaveCount(0);
        state.hosts = [{ id: 'main', name: 'Home' }, { id: 'nas', name: 'NAS' }, { id: 'pi', name: 'Pi', configured: false }];
        await page.reload();
        await page.locator('[data-glances-section="hosts"]').click();
        await expect(page.locator('[data-glances-host-row]')).toHaveCount(3);
        const nas = page.locator('[data-glances-host-row="nas"]');
        await expect(nas).toContainText('84%');
        await expect(nas.locator('.glances-hosts-dot')).toHaveAttribute('data-level', 'warn');
        await expect(page.locator('[data-glances-host-row="pi"]')).toContainText('No address yet');
        await nas.locator('[data-glances-host-open]').click();
        await expect(page).toHaveURL(/#glances\/overview\?host=nas$/);
        await expect(page.locator('[data-glances-host]')).toHaveValue('nas');
    });

    test('the Overview has a strip of the hosts, and a chip looks at that host', async ({ page }) => {
        const state = await mockGlances(page);
        await openView(page);
        await expect(page.locator('[data-glances-host-strip]')).toHaveCount(0);
        state.hosts = [{ id: 'main', name: 'Home' }, { id: 'nas', name: 'NAS' }];
        await page.reload();
        const strip = page.locator('[data-glances-host-strip]');
        await expect(strip.locator('[data-glances-host-chip]')).toHaveCount(2);
        await expect(strip.locator('[data-glances-host-chip="main"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(strip.locator('[data-glances-host-chip="nas"]')).toContainText('84%');
        await strip.locator('[data-glances-host-chip="nas"]').click();
        await expect(page).toHaveURL(/#glances\/overview\?host=nas$/);
        await expect(page.locator('[data-glances-host]')).toHaveValue('nas');
        await expect(page.locator('[data-glances-host-chip="nas"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('a host without an address says so and lets the reader go to another; Glances itself stays', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = [{ id: 'main', name: 'Home' }, { id: 'pi', name: 'Pi', configured: false }];
        await markWhatsNewSeen(page);
        await page.goto('/#glances/overview?host=pi');
        const empty = page.locator('[data-glances-empty="host"]');
        await expect(empty).toContainText('no address yet', { timeout: 15_000 });
        // The icon is still there: another host is set up.
        await expect(page.locator('#page-nav-glances-link')).toBeVisible();
        await empty.locator('[data-glances-host-switch="main"]').click();
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-glances-host]')).toHaveValue('main');
    });

    test('Config: a host without an address does not switch Glances off, and a typed change is kept when another host is picked', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = [{ id: 'main', name: 'Home' }, { id: 'pi', name: 'Pi', configured: false }];
        await markWhatsNewSeen(page);
        await page.goto('/#config/glances');
        await page.locator('[data-glances-host-tab="pi"]').click();
        await expect(page.locator('[data-glances-field="name"]')).toHaveValue('Pi');
        await page.locator('[data-glances-notify="cpu"]').check();
        await expect.poll(() => state.saved && state.saved.notify && state.saved.notify.join(',')).toBe('cpu');
        expect(state.saved.enabled).toBe(true);
        // Typed, not yet left: picking the other host still saves it, for the host it was typed for.
        const calls = state.calls.length;
        await page.locator('[data-glances-field="user"]').fill('someone');
        await page.locator('[data-glances-host-tab="main"]').click();
        await expect.poll(() => state.calls.slice(calls).some((c) => c.path === 'config' && c.host === 'pi' && state.saved.user === 'someone')).toBe(true);
    });

    test(':glances host moves the page to another host', async ({ page }) => {
        const state = await mockGlances(page);
        state.hosts = TWO();
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await page.keyboard.press('>');
        await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
        await page.keyboard.type(':glances host na');
        await page.locator('.search-match', { hasText: /Look at NAS/ }).click();
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-glances-host]')).toHaveValue('nas');
    });
});
