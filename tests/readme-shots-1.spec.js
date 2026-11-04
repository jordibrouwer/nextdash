// @ts-check
/*
 * README screenshots, batch 1: containers (health, updates, list), Glances
 * (page and widgets), edit mode and the homelab page. 1920x1200, a theme per
 * picture as the README caption names it, over the demo seed.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=2 \
 *     npx playwright test tests/readme-shots-1.spec.js
 */
const { expect } = require('@playwright/test');
const {
    fs,
    path,
    NOW,
    test,
    prepare,
    settle,
    shot,
    readJSON,
    writeJSON,
    openDashboard,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: { width: 1920, height: 1200 }, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const NOW_MS = NOW.getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The data every picture starts from: a neutral place for the weather. */
function baseTweak(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, { ...readJSON(file), weatherLocation: 'New York', columnsPerRow: 4 });
}

/** The first page with the widgets the README names: health, uptime, weather, inbox and notes. */
function dashboardWidgets(dir) {
    const file = path.join(dir, 'bookmarks-1.json');
    const page = readJSON(file);
    const notes = (page.widgets || []).find((w) => w.type === 'notes');
    page.widgets = [
        { id: 'w_d00000000001', type: 'health' },
        { id: 'w_d00000000002', type: 'uptime' },
        { id: 'w_d00000000003', type: 'weather', config: { forecastRange: '3day' } },
        { id: 'w_d00000000004', type: 'inbox' },
        ...(notes ? [notes] : []),
    ];
    const w = page.widgets.map((x) => x.id);
    page.blockOrder = ['code', w[0], 'docs', w[1], 'tools', w[2], 'news', w[3], ...(notes ? [notes.id] : [])];
    writeJSON(file, page);
}
/** Immich's bookmark failing its checks; a few others passing theirs. */
function containerBookmarks(dir) {
    const now = NOW_MS;
    const file = path.join(dir, 'bookmarks-3.json');
    const page = readJSON(file);
    for (const b of page.bookmarks) {
        if (['Jellyfin', 'Vaultwarden', 'nextDash', 'Immich'].includes(b.name)) {
            b.checkStatus = true;
            b.monitor = true;
            b.lastChecked = now - 60_000;
        }
        if (b.name === 'Immich') {
            b.lastError = 'HTTP 502';
            b.brokenSince = now - 3 * HOUR;
        }
    }
    writeJSON(file, page);
    const cacheFile = path.join(dir, 'health-cache.json');
    if (fs.existsSync(cacheFile)) {
        const cache = readJSON(cacheFile);
        for (const b of page.bookmarks) {
            if (!['Jellyfin', 'Vaultwarden', 'nextDash', 'Immich'].includes(b.name)) continue;
            const key = b.url.replace(/\/$/, '');
            cache.cache[key] = b.name === 'Immich'
                ? { url: key, status: 'offline', pingMs: 0, lastScanned: now - 60_000, error: 'HTTP 502' }
                : { url: key, status: 'online', pingMs: 21, lastScanned: now - 60_000 };
        }
        writeJSON(cacheFile, cache);
    }
}
/** Paperless updated by itself every night, with a version rolled back. */
function autoUpdates(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, { ...readJSON(file), dockerUpdateInterval: '24h', dockerAutoUpdate: ['paperless', 'sonarr'] });
}

const chain = (...fns) => (dir) => { baseTweak(dir); fns.forEach((fn) => fn(dir)); };


/** The Docker answers come from prepare(); the weather place is in the settings. */
async function setup(page) {
    const { docker } = await prepare(page);
    return docker;
}

async function openContainers(page) {
    await openDashboard(page);
    await page.locator('#page-nav-docker-host .docker-link-anchor').click();
    await page.locator('[data-docker-row]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}
/** Two paperless entries and a mocked Immich: what the side panels read. */
async function dockerStories(page, docker) {
    const at = (ms) => NOW_MS - ms;
    await page.route('**/api/docker/containers/immich-server/health', (r) => r.fulfill({ json: {
        status: 'unhealthy', failingStreak: 3, command: 'immich-healthcheck',
        checks: [
            { start: new Date(at(35 * 60_000)).toISOString(), end: new Date(at(35 * 60_000 - 1000)).toISOString(), exitCode: 1, output: 'connect ECONNREFUSED 127.0.0.1:2283' },
            { start: new Date(at(36 * 60_000)).toISOString(), end: new Date(at(36 * 60_000 - 1000)).toISOString(), exitCode: 1, output: 'connect ECONNREFUSED 127.0.0.1:2283' },
            { start: new Date(at(37 * 60_000)).toISOString(), end: new Date(at(37 * 60_000 - 1000)).toISOString(), exitCode: 1, output: 'connect ECONNREFUSED 127.0.0.1:2283' },
            { start: new Date(at(48 * 60_000)).toISOString(), end: new Date(at(48 * 60_000 - 1000)).toISOString(), exitCode: 0, output: '' },
            { start: new Date(at(49 * 60_000)).toISOString(), end: new Date(at(49 * 60_000 - 1000)).toISOString(), exitCode: 0, output: '' },
        ],
    } }));
    await page.route('**/api/docker/containers/immich-server/timeline', (r) => r.fulfill({ json: { entries: [
        { at: at(34 * 60_000), kind: 'unhealthy' },
        { at: at(38 * 60_000), kind: 'restart-loop', detail: '4 times in 6 min, last exit code 1', count: 4 },
        { at: at(44 * 60_000), kind: 'crash', detail: 'out of memory (exit code 137)' },
        { at: at(4 * HOUR), kind: 'update', detail: 'v1.118.2 → v1.119.0' },
        { at: at(18 * HOUR), kind: 'healthy' },
        { at: at(18 * HOUR + 60_000), kind: 'start' },
    ] } }));
    // Paperless: last night's automatic update, rolled back.
    const night = NOW_MS - 6 * HOUR;
    await page.route('**/api/docker/containers/paperless', async (r) => {
        if (r.request().method() !== 'GET') return r.fallback();
        const c = docker.containers.find((x) => x.name === 'paperless');
        return r.fulfill({ json: {
            ...c,
            startedAt: new Date(NOW_MS - 12 * DAY).toISOString(), restartPolicy: 'unless-stopped',
            mounts: [{ type: 'bind', source: '/mnt/user/appdata/paperless', destination: '/usr/src/paperless/data', readOnly: false }],
            networks: [{ name: 'bridge', ip: '172.17.0.7' }], envNames: ['PAPERLESS_URL', 'PUID'], version: '2.13.5',
            source: 'https://github.com/paperless-ngx/paperless-ngx',
            updateHistory: [
            { kind: 'rollback', at: night + 4 * 60_000, fromVersion: '2.14.0', toVersion: '2.13.5' },
            { kind: 'update', at: night, fromVersion: '2.13.5', toVersion: '2.14.0' },
            { kind: 'update', at: night - 9 * DAY, fromVersion: '2.13.4', toVersion: '2.13.5' },
            { kind: 'update', at: night - 24 * DAY, fromVersion: '2.13.2', toVersion: '2.13.4' },
        ] } });
    });
    await page.route('**/api/docker/containers/paperless/timeline', (r) => r.fulfill({ json: { entries: [
        { at: night + 4 * 60_000, kind: 'rollback', detail: '2.14.0 → 2.13.5, unhealthy after the update' },
        { at: night + 2 * 60_000, kind: 'unhealthy' },
        { at: night, kind: 'update', detail: '2.13.5 → 2.14.0' },
        { at: night - 12 * DAY, kind: 'start' },
    ] } }));
}

/** One picture: its theme, its data and its scene. */
function pic(name, theme, scene, { patch = '', tweak = null } = {}) {
    test.describe(name, () => {
        test.use({ shotTheme: theme, dataPatch: patch, dataTweak: { run: tweak ? chain(tweak) : baseTweak } });
        test(name, async ({ page }) => {
            await scene(page);
        });
    });
}

/** Open the side panel's accordions: the named ones open, the others closed. */
async function accordions(panel, open, close = []) {
    for (const label of close) {
        const acc = panel.locator('[data-slp-acc]', { hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
        if (await acc.count() && (await acc.evaluate((el) => el.open))) await acc.locator('summary').click();
    }
    for (const label of open) {
        const acc = panel.locator('[data-slp-acc]', { hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
        if (await acc.count() && !(await acc.evaluate((el) => el.open))) await acc.locator('summary').click();
    }
}

pic('containers-health', 'deep-lagoon-dark', async (page) => {
    const docker = await setup(page);
    await dockerStories(page, docker);
    await openContainers(page);
    await page.locator('[data-docker-group]').selectOption('project');
    await page.locator('[data-docker-row]', { hasText: 'immich-server' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await accordions(panel, ['Health'], ['Details']);
    await expect(panel.getByText('connect ECONNREFUSED').first()).toBeVisible();
    await panel.evaluate((el) => { for (let n = el; n; n = n.parentElement) if (n.scrollTop) n.scrollTop = 0; });
    // Pacing for the capture, not a condition: the panel finishes opening before the frame is taken.
    await page.waitForTimeout(800);
    await shot(page, 'readme/nextdash-containers-health.jpg');
}, { tweak: containerBookmarks });

pic('containers-updates', 'smoked-plum-dark', async (page) => {
    const docker = await setup(page);
    await dockerStories(page, docker);
    // Paperless has a newer image on offer that was skipped after the rollback.
    const c = docker.containers.find((x) => x.name === 'paperless');
    c.update = { status: 'skipped', skippedDigest: 'sha256:r1', checkedAt: NOW_MS - 3 * HOUR };
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'paperless' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await accordions(panel, ['Updates', 'Timeline'], ['Details']);
    // Pacing for the capture, not a condition: the panel finishes opening before the frame is taken.
    await page.waitForTimeout(1_000);
    await shot(page, 'readme/nextdash-containers-updates.jpg');
}, { tweak: (dir) => { containerBookmarks(dir); autoUpdates(dir); } });

pic('containers', 'harbour-fog-dark', async (page) => {
    await setup(page);
    // The last hour of sonarr, one sample every minute, as the stats sampler keeps it.
    await page.route('**/api/docker/containers/sonarr/stats**', (r) => r.fulfill({ json: {
        cpuPercent: 2.4, memoryUsed: 301_989_888, memoryLimit: 8_589_934_592, historyEnabled: true,
        history: Array.from({ length: 60 }, (_, i) => {
            const t = NOW_MS - (60 - i) * 60_000;
            const wave = Math.sin(i / 5) * 0.5 + Math.sin(i * 1.7) * 0.2;
            return {
                t, cpu: Math.max(0.2, 2.2 + wave * 3 + (i > 38 && i < 44 ? 9 : 0)),
                mem: 285_000_000 + Math.round(wave * 12_000_000) + i * 220_000,
                netIn: Math.max(0, 40_000 + wave * 30_000 + (i % 11 === 0 ? 250_000 : 0)),
                netOut: Math.max(0, 12_000 + wave * 8_000),
                diskRead: i % 9 === 0 ? 1_800_000 : 20_000, diskWrite: Math.max(0, 90_000 + wave * 60_000),
            };
        }),
    } }));
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'sonarr' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await panel.getByText('Resources', { exact: true }).first().click();
    // Pacing for the capture, not a condition: the charts finish drawing before the frame is taken.
    await page.waitForTimeout(1_500);
    await shot(page, 'readme/nextdash-containers.jpg');
}, { tweak: containerBookmarks });

pic('glances', 'deep-lagoon-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    await page.locator('#page-nav-glances-link').click();
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    await settle(page);
    await expect(page.locator('[data-glances-block="figures"]')).toBeVisible();
    // Pacing for the capture, not a condition: the meters finish drawing before the frame is taken.
    await page.waitForTimeout(1_200);
    await shot(page, 'readme/nextdash-glances.jpg');
});

pic('glances-widgets', 'deep-lagoon-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    const last = await page.evaluate(() => window.dashboardInstance.pages.length);
    await openDashboard(page, `#${last}`);
    const tile = (type) => page.locator(`[data-widget-type="${type}"]`);
    const graph = tile('glances').filter({ has: page.locator('a[href$="host=vps"]') });
    await expect(graph.locator('svg.dashboard-widget-glances-spark path')).toBeVisible();
    await expect(tile('glances').filter({ has: page.locator('a[href$="host=main"]') })).toContainText('homelab');
    // Pacing for the capture, not a condition: the meters finish drawing before the frame is taken.
    await page.waitForTimeout(1_000);
    await shot(page, 'readme/nextdash-glances-widgets.jpg');
}, {
    patch: 'glances',
    tweak: (dir) => {
        const file = path.join(dir, 'settings.json');
        writeJSON(file, { ...readJSON(file), showGridKeyLegend: false });
    },
});

pic('edit-mode', 'oceanic-steel-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+M');
    await page.locator('body[data-edit-mode="on"]').waitFor();
    // A stored category: the first blocks on the page are collections, which have no panel of their own.
    await page.locator('#dashboard-layout .category[data-category-id="code"] .category-title').first().click();
    await page.locator('#edit-mode-panel [data-edit-section="category"]').waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the panel finishes sliding in before the frame is taken.
    await page.waitForTimeout(600);
    await shot(page, 'readme/nextdash-edit-mode.jpg');
}, { tweak: dashboardWidgets });

pic('dashboard-homelab', 'terminal-amber-dark', async (page) => {
    await setup(page);
    await openDashboard(page, '#2');
    await shot(page, 'readme/nextdash-dashboard-homelab.jpg');
});
