// @ts-check
/*
 * The screenshots in README.md (screenshots/nextdash-*.jpg), taken through the
 * real UI over the neutral demo data nextDash seeds itself (public sites, three
 * pages, five neutral inbox items) and never over a real collection.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<copy of the seeded demo> SHOTS_OUT=<dir> \
 *     E2E_SERVER_BINARY=<own build> PW_WORKERS=8 \
 *     npx playwright test tests/readme-screenshots.spec.js --retries=0
 *
 * One file per picture, 1920x1200 (a 1440x900 viewport at 4/3), a theme per
 * picture as the README names it, and the outside world answered by the same
 * mocks tests/manual-screenshots.spec.js uses (Docker, Unraid, Glances).
 */
const {
    fs,
    path,
    OUT,
    NOW,
    DESKTOP,
    test,
    prepare,
    settle,
    readJSON,
    writeJSON,
    fixture,
    unraidAnswer,
    openDashboard,
} = require('./helpers/manual-shot-kit');
const { expect } = require('@playwright/test');

test.skip(!process.env.MANUAL_SHOTS, 'screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, deviceScaleFactor: 4 / 3, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const NOW_MS = NOW.getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A whole screen as README.md shows it: 1920x1200, quality 85. */
async function full(page, name) {
    await page.mouse.move(5, 895);
    await page.evaluate(() => document.activeElement?.blur?.());
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(500);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 85 });
}

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

/** Seven Unraid tiles among the homelab bookmarks. */
function unraidOnHomelab(dir) {
    const labFile = path.join(dir, 'bookmarks-2.json');
    const lab = readJSON(labFile);
    const types = ['unraid', 'unraidArray', 'unraidParity', 'unraidShares', 'unraidVms', 'unraidUps', 'unraidNotifications'];
    const tiles = types.map((type, i) => ({ id: `w_u0000000000${i + 1}`, type }));
    lab.widgets = tiles;
    const id = (i) => tiles[i].id;
    lab.blockOrder = [id(0), 'platforms', id(1), id(2), 'network', id(3), id(4), 'home', id(5), id(6), 'community'];
    writeJSON(labFile, lab);
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

/** Three bookmarks whose last check failed, each its own way. */
function brokenBookmarks(dir) {
    const now = Date.now();
    const failed = {
        'https://podcast.example.net/feed': 'DNS lookup failed',
        'https://wiki.example.org/homelab': 'HTTP 404',
        'https://reader.example.net/': 'HTTP 502',
    };
    const file3 = path.join(dir, 'bookmarks-3.json');
    const p3 = readJSON(file3);
    p3.bookmarks.push({
        name: 'Retired feed reader', url: 'https://reader.example.net/', pageId: 3, shortcut: '', category: 'apps',
        checkStatus: true, icon: '', createdAt: now - 60 * DAY, updatedAt: now - 60 * DAY, openCount: 2, tags: ['news'],
    });
    writeJSON(file3, p3);
    const cacheFile = path.join(dir, 'health-cache.json');
    const cache = fs.existsSync(cacheFile) ? readJSON(cacheFile) : { cache: {} };
    for (const file of fs.readdirSync(dir).filter((f) => /^bookmarks-\d+\.json$/.test(f))) {
        const page = readJSON(path.join(dir, file));
        (page.bookmarks || []).forEach((b) => {
            if (!failed[b.url]) return;
            b.checkStatus = true;
            b.lastError = failed[b.url];
            b.brokenSince = now - 3 * DAY;
            b.lastChecked = now - 60_000;
            const key = b.url.replace(/\/$/, '');
            cache.cache[key] = { url: key, status: 'offline', pingMs: 0, lastScanned: now - 60_000, error: failed[b.url] };
        });
        writeJSON(path.join(dir, file), page);
    }
    writeJSON(cacheFile, cache);
}

/** Paperless updated by itself every night, with a version rolled back. */
function autoUpdates(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, { ...readJSON(file), dockerUpdateInterval: '24h', dockerAutoUpdate: ['paperless', 'sonarr'] });
}

const chain = (...fns) => (dir) => { baseTweak(dir); fns.forEach((fn) => fn(dir)); };

/** What the browser needs besides prepare(): the weather place. */
async function setup(page, { mocked = false } = {}) {
    const { docker } = await prepare(page);
    const weather = fixture('weather.json');
    // Views over the seeded data stand at today's date, so ages and sweeps read
    // true; the Docker, Unraid and Glances mocks are dated by NOW.
    let forecast = weather.forecast;
    if (!mocked) {
        const today = new Date();
        await page.clock.setFixedTime(today);
        const delta = Math.round((today.getTime() - NOW_MS) / DAY);
        forecast = JSON.parse(JSON.stringify(weather.forecast).replace(/2026-10-(\d\d)/g, (m, d) => new Date(Date.UTC(2026, 9, Number(d)) + delta * DAY).toISOString().slice(0, 10)));
    }
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(forecast) }));
    await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ ...weather.geocoding.results[0], name: 'New York', country: 'United States' }] }),
    }));
    return docker;
}

async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

async function openInbox(page) {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await page.locator('.inbox-layout').waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

async function openContainers(page) {
    await openDashboard(page);
    await page.locator('#page-nav-docker-host .docker-link-anchor').click();
    await page.locator('[data-docker-row]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.waitForTimeout(800);
    await settle(page);
}

/** One picture: its theme, its data and its scene. */
function pic(name, theme, scene, { patch = '', tweak = null, viewport = null } = {}) {
    test.describe(name, () => {
        test.use({ shotTheme: theme, dataPatch: patch, dataTweak: { run: tweak ? chain(tweak) : baseTweak }, ...(viewport ? { viewport } : {}) });
        test(name, async ({ page }) => {
            await scene(page);
        });
    });
}

pic('dashboard', 'aurora-glass-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    await full(page, 'nextdash-dashboard.jpg');
}, { tweak: dashboardWidgets });

pic('dashboard-homelab', 'terminal-amber-dark', async (page) => {
    await setup(page);
    await openDashboard(page, '#2');
    await full(page, 'nextdash-dashboard-homelab.jpg');
});

pic('bookmarks-view', 'aurora-glass-light', async (page) => {
    await setup(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'GitHub' }).first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-bookmarks-view.jpg');
});

pic('search', 'porcelain-blue-light', async (page) => {
    await setup(page);
    await openDashboard(page);
    // Bare letters look for a shortcut first; / turns the same letters into a name search.
    await page.keyboard.type('immich', { delay: 150 });
    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-search.jpg');
});

pic('search-tags', 'neon-grid-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    await page.keyboard.press('>');
    await page.keyboard.type('tag:self-hosted', { delay: 80 });
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-search-tags.jpg');
});

pic('commands', 'thinkdashboard-classic-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    await page.keyboard.press(':');
    await page.keyboard.type('docker', { delay: 80 });
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-commands.jpg');
});

pic('inbox', 'paper-ink-light', async (page) => {
    await setup(page);
    await openInbox(page);
    await page.locator('.inbox-layout').getByText('Awesome self-hosted').first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await full(page, 'nextdash-inbox.jpg');
});

pic('triage', 'royal-amethyst-dark', async (page) => {
    await setup(page);
    await openInbox(page);
    await page.locator('.inbox-triage-btn').click();
    await page.locator('#inbox-triage-overlay').waitFor();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-triage.jpg');
});

pic('bookmarks-health', 'oxblood-leather-dark', async (page) => {
    await setup(page);
    await page.route('**/api/ping?**', (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        const bad = { 'podcast.example.net': 'DNS lookup failed', 'wiki.example.org': 'HTTP 404', 'reader.example.net': 'HTTP 502' };
        const host = Object.keys(bad).find((h) => url.includes(h));
        if (!host) return route.fallback();
        return route.fulfill({ json: { status: 'offline', ping: null, error: bad[host] } });
    });
    await openBookmarksView(page);
    await page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]').click();
    await page.waitForTimeout(800);
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'wiki.example.org' }).first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-bookmarks-health.jpg');
}, { tweak: brokenBookmarks });

pic('collection-health', 'salt-flat-light', async (page) => {
    await setup(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('h');
    await page.locator('#app-modal.show .modal').waitFor();
    await page.waitForTimeout(1_500);
    await full(page, 'nextdash-collection-health.jpg');
}, { tweak: brokenBookmarks });

pic('containers', 'harbour-fog-dark', async (page) => {
    await setup(page, { mocked: true });
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
    await page.waitForTimeout(1_500);
    await full(page, 'nextdash-containers.jpg');
}, { tweak: containerBookmarks });

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

pic('containers-health', 'deep-lagoon-dark', async (page) => {
    const docker = await setup(page, { mocked: true });
    await dockerStories(page, docker);
    await openContainers(page);
    await page.locator('[data-docker-group]').selectOption('project');
    await page.waitForTimeout(500);
    await page.locator('[data-docker-row]', { hasText: 'immich-server' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    for (const label of ['Details']) {
        const acc = panel.locator('[data-slp-acc]', { hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
        if (await acc.count() && (await acc.evaluate((el) => el.open))) await acc.locator('summary').click();
    }
    for (const label of ['Health']) {
        const acc = panel.locator('[data-slp-acc]', { hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
        if (await acc.count() && !(await acc.evaluate((el) => el.open))) await acc.locator('summary').click();
    }
    await page.waitForTimeout(1_200);
    await panel.evaluate((el) => { for (let n = el; n; n = n.parentElement) if (n.scrollTop) n.scrollTop = 0; });
    await page.waitForTimeout(400);
    await full(page, 'nextdash-containers-health.jpg');
}, { tweak: containerBookmarks });

pic('containers-updates', 'smoked-plum-dark', async (page) => {
    const docker = await setup(page, { mocked: true });
    await dockerStories(page, docker);
    // Paperless has a newer image on offer that was skipped after the rollback.
    const c = docker.containers.find((x) => x.name === 'paperless');
    c.update = { status: 'skipped', skippedDigest: 'sha256:r1', checkedAt: NOW_MS - 3 * HOUR };
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'paperless' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    for (const label of ['Details']) {
        const acc = panel.locator('[data-slp-acc]', { hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
        if (await acc.count() && (await acc.evaluate((el) => el.open))) await acc.locator('summary').click();
    }
    for (const label of ['Updates', 'Timeline']) {
        const acc = panel.locator('[data-slp-acc]', { hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
        if (await acc.count() && !(await acc.evaluate((el) => el.open))) await acc.locator('summary').click();
    }
    await page.waitForTimeout(1_200);
    await full(page, 'nextdash-containers-updates.jpg');
}, { tweak: (dir) => { containerBookmarks(dir); autoUpdates(dir); } });

pic('themes', 'mulberry-silk-dark', async (page) => {
    await setup(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    await page.locator('[data-look-studio]').waitFor({ state: 'visible' });
    await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
    await page.waitForTimeout(1_200);
    await full(page, 'nextdash-themes.jpg');
});

pic('config-appearance', 'sea-glass-light', async (page) => {
    await setup(page);
    await openConfig(page, 'appearance');
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-config-appearance.jpg');
});

pic('config-statistics', 'copper-circuit-dark', async (page) => {
    await setup(page);
    await openConfig(page, 'stats');
    await page.waitForTimeout(2_000);
    await full(page, 'nextdash-config-statistics.jpg');
});

pic('unraid-black', 'unraid-black-dark', async (page) => {
    await setup(page, { mocked: true });
    await openDashboard(page, '#2');
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-unraid-black.jpg');
}, { tweak: unraidOnHomelab });

pic('unraid-azure', 'unraid-azure-light', async (page) => {
    await setup(page, { mocked: true });
    await openDashboard(page, '#2');
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-unraid-azure.jpg');
}, { tweak: unraidOnHomelab });

pic('unraid-dashboard', 'tarnished-brass-dark', async (page) => {
    await setup(page, { mocked: true });
    await openDashboard(page, '#2');
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-unraid-dashboard.jpg');
}, { tweak: unraidOnHomelab });

pic('unraid-config', 'nordic-frost-dark', async (page) => {
    await setup(page, { mocked: true });
    await page.route('**/api/unraid/settings', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ json: { server: { id: 'u_1', name: 'tower', baseUrl: 'http://tower.local', enabled: true, insecureTls: true, notify: true }, keySet: true, suggestedBaseUrl: '' } });
    });
    await page.route('**/api/unraid/area/info', (route) => route.fulfill({ json: { area: 'info', status: 'ok', data: { name: 'tower' } } }));
    await page.route('**/api/unraid/test', (route) => route.fulfill({ json: {
        ok: true, info: { name: 'tower', unraid: '7.2.1', api: '4.37.5', roles: ['VIEWER'] },
        areas: { array: 'ok', parity: 'ok', shares: 'ok', vms: 'ok', ups: 'ok', notifications: 'ok' },
    } }));
    await openConfig(page, 'unraid');
    await page.locator('[data-unraid-field="baseUrl"]').waitFor();
    await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
    await page.locator('[data-unraid-test]').click();
    await page.waitForTimeout(1_200);
    await full(page, 'nextdash-unraid-config.jpg');
}, { tweak: unraidOnHomelab });

/* ── Glances: every /api/glances/** answer is a fixture ─────────────────── */

const HOST = fixture('glances-host.json');
const STATE = fixture('glances-state.json');
const FILES = ['quicklook', 'load', 'sensors', 'fs', 'alert', 'pluginslist', 'network', 'system', 'uptime', 'containers', 'diskio', 'smart', 'raid', 'connections'];

/** A small deterministic noise, so the same shot draws the same line every time. */
const wobble = (i, k) => Math.sin(i * 12.9898 + k * 78.233) * 0.5 + Math.sin(i * 3.1 + k) * 0.5;

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

function history(url) {
    const asked = (url.searchParams.get('series') || '').split(',').filter(Boolean);
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

function processes(url) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'cpu';
    const by = { cpu: (a, b) => b.cpu_percent - a.cpu_percent, mem: (a, b) => b.memory_percent - a.memory_percent, name: (a, b) => a.name.localeCompare(b.name), pid: (a, b) => a.pid - b.pid }[sort];
    return HOST.processlist.filter((r) => !q || r.name.toLowerCase().includes(q)).sort(by || ((a, b) => b.cpu_percent - a.cpu_percent))
        .map(({ cmdline, ...rest }) => rest);
}

const summaries = () => STATE.hosts.map((h) => ({ id: h.id, name: h.name, configured: true, paused: false, level: h.level, ok: h.ok }));

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

pic('glances', 'deep-lagoon-dark', async (page) => {
    await setup(page, { mocked: true });
    await mockGlances(page);
    await openDashboard(page);
    await page.locator('#page-nav-glances-link').click();
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    // The tour is offered once on a first visit; settle closes it with Escape, as a reader would.
    await page.waitForTimeout(1_500);
    await settle(page);
    await page.waitForTimeout(800);
    await expect(page.locator('[data-glances-block="figures"]')).toBeVisible();
    await full(page, 'nextdash-glances.jpg');
});

pic('glances-widgets', 'deep-lagoon-dark', async (page) => {
    await setup(page, { mocked: true });
    await mockGlances(page);
    await openDashboard(page);
    await page.locator('.category, [data-widget-type]').first().waitFor();
    const last = await page.evaluate(() => window.dashboardInstance.pages.length);
    await openDashboard(page, `#${last}`);
    const tile = (type) => page.locator(`[data-widget-type="${type}"]`);
    const graph = tile('glances').filter({ has: page.locator('a[href$="host=vps"]') });
    await expect(graph.locator('svg.dashboard-widget-glances-spark path')).toBeVisible();
    // The key legend along the bottom is put away, as a reader does with Shift+Z.
    await page.keyboard.press('Shift+Z');
    // The toast that says so comes and goes (it lasts a few seconds).
    await page.locator('#app-notification.show').waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    await page.locator('#app-notification.show').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    await full(page, 'nextdash-glances-widgets.jpg');
}, { patch: 'glances' });
