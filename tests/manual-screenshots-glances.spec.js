// @ts-check
/*
 * The Glances screenshots in MANUAL.md, taken through the real UI.
 *
 * Run on purpose only, like tests/manual-screenshots.spec.js (see there for
 * the data copy and the kit this uses):
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<copy of data-demo> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-glances.spec.js
 *
 * Glances is an outside service, so every /api/glances/** answer is a fixture:
 * tests/fixtures/manual-screenshots/glances-host.json holds what a Glances 4
 * host answers (eight cores, 16 GB, five disks, twelve processes, eight
 * containers) and glances-state.json what nextDash itself says about three
 * hosts, plus the recipe for the history points -- a daily rhythm and one
 * processor incident forty-five minutes before the browser clock.
 *
 * Shots show Glances content only: the pages are cropped to the Glances view,
 * and the widget page is a patched copy with no bookmarks at all.
 */
const {
    fixture,
    NOW,
    DESKTOP,
    test,
    prepare,
    settle,
    snap,
    crop,
    openDashboard,
} = require('./helpers/manual-shot-kit');
const { expect } = require('@playwright/test');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

const HOST = fixture('glances-host.json');
const STATE = fixture('glances-state.json');
const NOW_MS = NOW.getTime();
const HOUR = 3600_000;
const FILES = ['quicklook', 'load', 'sensors', 'fs', 'alert', 'pluginslist', 'network', 'system', 'uptime', 'containers', 'diskio', 'smart', 'raid', 'connections'];

/** A small deterministic noise, so the same shot draws the same line every time. */
const wobble = (i, k) => Math.sin(i * 12.9898 + k * 78.233) * 0.5 + Math.sin(i * 3.1 + k) * 0.5;

/** The points of one series between two times, from the recipe in glances-state.json. */
function points(name, since, until, k, quiet = false) {
    const recipe = STATE.history.series[name] || (name.startsWith('core:')
        ? { base: 20 + (Number(name.slice(5)) * 7) % 30, amp: 8, peakHour: 3, noise: 5 }
        : name.startsWith('fs:') ? { base: 60, amp: 0.2, peakHour: 12, noise: 0.05 } : { base: 10, amp: 4, peakHour: 12, noise: 2 });
    const step = Math.max(STATE.history.stepSeconds * 1000, Math.round((until - since) / 240));
    const inc = STATE.history.incident;
    const incStart = NOW_MS - inc.hoursAgo * HOUR;
    const out = [];
    for (let t = Math.ceil(since / step) * step, i = 0; t <= until; t += step, i += 1) {
        const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
        let v = (quiet ? 0.35 : 1) * (recipe.base + recipe.amp * Math.cos(((hour - recipe.peakHour) / 24) * 2 * Math.PI) + recipe.noise * wobble(i, k));
        if (!quiet && inc.series.includes(name) && t >= incStart && t <= incStart + inc.minutes * 60_000) {
            const f = Math.sin(((t - incStart) / (inc.minutes * 60_000)) * Math.PI);
            const peak = name === 'cpu' ? inc.peak : recipe.base + (inc.peak - 26) * 0.08;
            v = v + (peak - v) * Math.min(1, f * 1.4);
        }
        out.push([t, Math.max(0, +v.toFixed(2))]);
    }
    return out;
}

/** What /api/glances/history answers. */
function history(url) {
    const asked = (url.searchParams.get('series') || '').split(',').filter(Boolean);
    // The other hosts are quiet: no incident, a low line.
    const quiet = Boolean(url.searchParams.get('host')) && url.searchParams.get('host') !== 'main';
    const until = Number(url.searchParams.get('until')) || NOW_MS;
    const since = Number(url.searchParams.get('since')) || until - HOUR;
    const names = [...Object.keys(STATE.history.series), ...Array.from({ length: 8 }, (_, i) => `core:${i}`), 'fs:/', 'fs:/mnt/data', 'fs:/mnt/media'];
    const series = {};
    asked.filter((n) => names.includes(n) || n.startsWith('ct:')).forEach((name, k) => { series[name] = points(name, since, until, k, quiet); });
    const inc = STATE.history.incident;
    const start = NOW_MS - inc.hoursAgo * HOUR;
    return {
        names, series, step: 120, now: NOW_MS,
        incidents: quiet ? [] : [{ kind: inc.kind, start, end: start + inc.minutes * 60_000, peak: inc.peak }],
        restarts: [],
    };
}

/** What the server does to /processlist: search, sort, strip the command lines. */
function processes(url) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'cpu';
    const by = { cpu: (a, b) => b.cpu_percent - a.cpu_percent, mem: (a, b) => b.memory_percent - a.memory_percent, name: (a, b) => a.name.localeCompare(b.name), pid: (a, b) => a.pid - b.pid }[sort];
    return HOST.processlist.filter((r) => !q || r.name.toLowerCase().includes(q)).sort(by || ((a, b) => b.cpu_percent - a.cpu_percent))
        .map(({ cmdline, ...rest }) => rest);
}

const summaries = () => STATE.hosts.map((h) => ({ id: h.id, name: h.name, configured: true, paused: false, level: h.level, ok: h.ok }));

/** Every Glances path, answered from the fixtures. */
async function mockGlances(page) {
    const tracked = [];
    await page.route('**/api/glances/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const rest = url.pathname.replace(/^\/api\/glances\//, '');
        const asked = url.searchParams.get('host');
        const now = STATE.hosts.find((h) => h.id === asked) || STATE.hosts[0];
        const bits = { id: now.id, name: now.name, hostConfigured: true, hosts: summaries() };
        let body;
        if (rest === 'status') {
            body = { enabled: true, configured: true, refresh: 2, hiddenBlocks: [], thresholds: STATE.config.thresholds, level: now.level, ok: true, at: NOW_MS, paused: false, recordEvery: 30, retentionDays: 30, ...bits };
        } else if (rest === 'config') {
            body = { ...STATE.config, server: now.server, collected: { ...STATE.config.collected, since: NOW_MS - 30 * 24 * HOUR }, trackedHistory: tracked, paused: false, ...bits };
            if (request.method() !== 'GET') body = { ...body, ...JSON.parse(request.postData() || '{}') };
        } else if (rest === 'hosts') {
            body = { hosts: STATE.hosts.map((h) => ({ id: h.id, name: h.name, configured: true, paused: false, level: h.level, ok: h.ok, at: NOW_MS - 8000, lastOk: NOW_MS - 8000, every: 30, cpu: h.cpu, mem: h.mem, disk: h.disk, diskMount: h.diskMount, temp: h.temp })) };
        } else if (rest === 'insights') {
            body = { ...STATE.insights, at: NOW_MS, since: NOW_MS - 24 * HOUR };
            const start = NOW_MS - STATE.history.incident.hoursAgo * HOUR;
            body.incidents = { ongoing: [], past: [{ kind: 'cpu', start, end: start + STATE.history.incident.minutes * 60_000, peak: STATE.history.incident.peak }] };
        } else if (rest === 'docker-link') {
            body = STATE.link;
        } else if (rest === 'history') {
            body = history(url);
        } else if (rest === 'processlist') {
            body = processes(url);
        } else if (rest.startsWith('processes/')) {
            const pid = Number(rest.slice('processes/'.length));
            const row = HOST.processlist.find((r) => r.pid === pid);
            body = row ? { pid, cmdline: row.cmdline } : { available: false };
        } else if (rest === 'all/limits') {
            body = HOST.limits;
        } else if (FILES.includes(rest)) {
            body = HOST[rest];
        } else {
            body = { available: false };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}

/**
 * The Glances view alone, without the dashboard's header (it carries the
 * weather place and the page badges): the card, and a side panel when one is open.
 */
async function frame(page, name, withPanel = false) {
    const view = page.locator('#dashboard-layout.glances-layout');
    const parts = withPanel ? [view, page.locator('[data-glances-drawer]').first()] : [view];
    await view.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.mouse.move(5, 895);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(300);
    await crop(page, parts, name, 6);
}

/** The Glances page, opened with its header icon. */
async function openGlances(page, section = 'overview') {
    await prepare(page);
    await mockGlances(page);
    await openDashboard(page);
    await page.locator('#page-nav-glances-link').click();
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    if (section !== 'overview') await page.locator(`[data-glances-section="${section}"]`).click();
    // The tour is offered once on a first visit; settle closes it with Escape, as a reader would.
    await page.waitForTimeout(1_500);
    await settle(page);
    await page.waitForTimeout(800);
}

test('15a glances overview', async ({ page }) => {
    await openGlances(page);
    await expect(page.locator('[data-glances-block="figures"]')).toBeVisible();
    await frame(page, '15a-glances-overview.jpg');
});

test('15a glances processes with the side panel', async ({ page }) => {
    await openGlances(page, 'processes');
    await page.locator('[data-glances-pid]').first().waitFor();
    await page.locator('[data-glances-pid]', { hasText: 'jellyfin' }).first().click();
    await page.locator('[data-glances-drawer]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await frame(page, '15a-glances-processes.jpg', true);
});

test('15a glances history', async ({ page }) => {
    await openGlances(page, 'history');
    await page.locator('[data-glances-chart]').first().waitFor();
    await page.locator('[data-glances-incident]').first().waitFor();
    await page.waitForTimeout(800);
    await frame(page, '15a-glances-history.jpg');
});

test('15a glances incident', async ({ page }) => {
    await openGlances(page, 'history');
    await page.locator('[data-glances-incident]').first().waitFor();
    await page.locator('button[data-glances-incident]').first().click();
    await page.locator('[data-glances-drawer]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1_200);
    await frame(page, '15a-glances-incident.jpg', true);
});

test('15a glances insights', async ({ page }) => {
    await openGlances(page, 'insights');
    await page.waitForTimeout(800);
    await frame(page, '15a-glances-insights.jpg');
});

test('15a glances hosts', async ({ page }) => {
    await openGlances(page, 'hosts');
    await page.locator('[data-glances-host-row]').first().waitFor();
    await frame(page, '15a-glances-hosts.jpg');
});

test.describe('the widget', () => {
    test.use({ dataPatch: 'glances' });
    test('15a glances widget', async ({ page }) => {
        await prepare(page);
        await mockGlances(page);
        await openDashboard(page);
        await page.locator('.category, [data-widget-type]').first().waitFor();
        const last = await page.evaluate(() => window.dashboardInstance.pages.length);
        await openDashboard(page, `#${last}`);
        const tile = (type) => page.locator(`[data-widget-type="${type}"]`);
        const meters = tile('glances').filter({ has: page.locator('a[href$="host=main"]') });
        const graph = tile('glances').filter({ has: page.locator('a[href$="host=vps"]') });
        await expect(graph.locator('svg.dashboard-widget-glances-spark path')).toBeVisible();
        await expect(meters).toContainText('homelab');
        await page.waitForTimeout(1_000);
        await snap(page, [meters, graph, tile('cpu').first(), tile('memory').first()], '15a-glances-widget.jpg', { pad: 10 });
    });
});

test('15a glances config', async ({ page }) => {
    await prepare(page);
    await mockGlances(page);
    await openDashboard(page);
    await page.evaluate(() => { window.location.hash = '#config/glances'; });
    await page.locator('[data-glances-field="server"]').waitFor();
    await page.waitForTimeout(1_000);
    await settle(page);
    await snap(page, page.locator('#config-glances-body'), '15a-glances-config.jpg', { pad: 12 });
});
