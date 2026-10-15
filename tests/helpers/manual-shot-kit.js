// @ts-check
/*
 * The harness the screenshot specs share: a server of its own per test over a
 * copy of the demo data, the outside world answered from fixtures, and the
 * helpers that settle the page and take a picture.
 *
 * Written for tests/manual-screenshots.spec.js and moved here unchanged so
 * tests/whats-new-media.spec.js takes its pictures the same way. See the
 * manual-screenshots spec for how a run is started.
 */
const base = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

/** tests/, where this kit's paths were written from. */
const TESTS_DIR = path.join(__dirname, '..');
const { binaryPath } = require('../worker-server');
const { mockDocker } = require('./docker-mock');
const { markWhatsNewSeen } = require('../e2e-helpers');

const ROOT = path.join(TESTS_DIR, '..');
const OUT = path.join(ROOT, 'screenshots', 'manual.md');
const FIX = path.join(TESTS_DIR, 'fixtures', 'manual-screenshots');
const json = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const fixture = (name) => JSON.parse(json(name));
const unraidAnswer = (name) => JSON.parse(fs.readFileSync(path.join(TESTS_DIR, 'fixtures-unraid', `${name}.json`), 'utf8'));

const NOW = new Date('2026-10-06T09:12:00');
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };
/** The demo data's own theme, given to a new install as well. */
const DEMO_THEME = 'matrix-bluepill-dark';

/** A port nothing else is on (never 8080: the OS hands out a free one). */
function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = /** @type {import('net').AddressInfo} */ (server.address());
            server.close(() => resolve(port));
        });
    });
}

async function waitForServer(baseURL) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${baseURL}/api/pages`, { signal: AbortSignal.timeout(2_000) });
            if (res.ok) return;
        } catch { /* not up yet */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`server at ${baseURL} did not come up`);
}

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

/** A ping between 8 and 67 ms that stays the same for an address. */
function pingFor(url) {
    let h = 0;
    for (const ch of String(url)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 8 + (h % 60);
}

/*
 * The demo data as it was seeded, before a server ran on it.
 *
 * The seed wrote a heartbeat every half hour, a few outages among them. A
 * server left running on the copy then checked the example hosts for real,
 * found none of them, and wrote every check down as a failure -- so the
 * samples off the seed's half-hour grid are put back to what the seed says
 * a working service looks like, the health cache and the trend agree with
 * them, and the feeds forget their failed polls. Each monitor gets a sample
 * from a minute ago, so none is due while the shot is taken.
 *
 * The rest is what the shots need: a weather place for the header, a tidy
 * note on Home, and the Containers widgets on Homelab.
 */
function tidyDemoData(dir, patch) {
    const now = Date.now();
    const historyFile = path.join(dir, 'health-history.json');
    if (fs.existsSync(historyFile)) {
        const history = readJSON(historyFile);
        for (const [url, samples] of Object.entries(history.samples || {})) {
            const seedStart = samples[0]?.t || 0;
            for (const s of samples) {
                if ((s.t - seedStart) % 1_800_000 === 0) continue;
                s.u = true;
                s.c = 200;
                s.p = pingFor(`${url}${s.t}`) * 2;
                delete s.e;
            }
            samples.push({ t: now - 60_000, u: true, p: pingFor(url), c: 200 });
        }
        history.generatedAt = now;
        writeJSON(historyFile, history);
    }
    const cacheFile = path.join(dir, 'health-cache.json');
    if (fs.existsSync(cacheFile)) {
        const cache = readJSON(cacheFile);
        for (const [url, entry] of Object.entries(cache.cache || {})) {
            Object.assign(entry, { status: 'online', pingMs: pingFor(url), lastScanned: now - 60_000 });
            delete entry.error;
        }
        cache.generatedAt = now;
        // The last sweep: half an hour before the clock in the shots when that
        // is within a day, so the sweep is not due again while the shot is taken.
        cache.lastAutoRecheck = Math.max(now - 23 * 3_600_000, NOW.getTime() - 30 * 60_000);
        writeJSON(cacheFile, cache);
    }
    const trendFile = path.join(dir, 'health-trend.json');
    if (fs.existsSync(trendFile)) {
        const trend = readJSON(trendFile);
        (trend.points || []).forEach((p) => { p.h += p.d || 0; p.d = 0; });
        writeJSON(trendFile, trend);
    }
    const feedsFile = path.join(dir, 'feeds.json');
    if (fs.existsSync(feedsFile)) {
        const feeds = readJSON(feedsFile);
        Object.values(feeds.feeds || {}).forEach((f) => {
            if (f.failures) { f.failures = 0; f.triedAt = now; f.checkedAt = now; }
        });
        writeJSON(feedsFile, feeds);
    }

    // The same failed checks, mirrored onto the bookmarks themselves.
    for (const file of fs.readdirSync(dir).filter((f) => /^bookmarks-\d+\.json$/.test(f))) {
        const page = readJSON(path.join(dir, file));
        (page.bookmarks || []).forEach((b) => {
            if (!/DNS lookup failed|Timeout/i.test(String(b.lastError || ''))) return;
            delete b.lastError;
            delete b.brokenSince;
            b.lastChecked = now - 60_000;
        });
        writeJSON(path.join(dir, file), page);
    }

    // A backup's age is its file's: the copy gave every file the time it was
    // copied, so each stored backup gets the time in its own name back.
    const backups = path.join(dir, 'auto-backups');
    if (fs.existsSync(backups)) {
        for (const name of fs.readdirSync(backups)) {
            const m = /(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z\.zip$/.exec(name);
            if (!m) continue;
            const at = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
            fs.utimesSync(path.join(backups, name), at, at);
        }
    }

    const settingsFile = path.join(dir, 'settings.json');
    const settings = readJSON(settingsFile);
    settings.weatherLocation = 'Leiden';
    writeJSON(settingsFile, settings);

    const homeFile = path.join(dir, 'bookmarks-1.json');
    const home = readJSON(homeFile);
    const note = (home.widgets || []).find((w) => w.type === 'notes');
    if (note) {
        note.config = { ...(note.config || {}), text: '[x] Renew the domain\n[x] Clean out the Inbox\n[ ] Check the backup report\n[ ] Update the router' };
    }
    writeJSON(homeFile, home);

    const labFile = path.join(dir, 'bookmarks-2.json');
    const lab = readJSON(labFile);
    lab.widgets = [
        { id: 'w_m00000000001', type: 'docker' },
        { id: 'w_m00000000002', type: 'containers' },
        { id: 'w_m00000000003', type: 'cpu' },
        { id: 'w_m00000000004', type: 'memory' },
        { id: 'w_m00000000005', type: 'disks' },
        ...(lab.widgets || []),
    ];
    // Containers first, the machine beside the services, the rest after.
    lab.blockOrder = ['w_m00000000001', 'w_b00000000001', 'services', 'w_m00000000002',
        'w_m00000000003', 'w_m00000000004', 'w_b00000000002', 'w_b00000000003', 'tools',
        'w_m00000000005', 'w_b00000000004', 'w_b00000000005'];
    writeJSON(labFile, lab);

    const patches = String(patch || '').split(',');
    const settingsPatch = {
        // The category header with its count beside the name.
        catcount: { showCategoryCount: true },
        // A web search engine to ask; the answers are mocked in the shot.
        websearch: { webSearchEngine: 'searxng', webSearchSearxngUrl: 'http://searx.lab.example' },
        // The server log recording from the start, so the boot is in it.
        serverlog: { serverLogEnabled: true },
        // Quiet hours held, as 12-quiet-hours sets them through the panel.
        quiet: { quietHoursEnabled: true },
    };
    for (const name of patches) {
        if (!settingsPatch[name]) continue;
        const s = readJSON(settingsFile);
        writeJSON(settingsFile, { ...s, ...settingsPatch[name] });
    }

    // One shot only: the wiki on Homelab watched for drift, and retitled.
    if (patches.includes('drift')) {
        const labNow = readJSON(labFile);
        const wiki = (labNow.bookmarks || []).find((b) => b.url === 'https://wiki.lab.example/');
        Object.assign(wiki, {
            watchDrift: true,
            driftUrl: 'https://wiki.lab.example/',
            driftTitle: 'Wiki',
            driftNoticed: 'title-parked',
            driftSince: now - 2 * 86_400_000,
            driftReason: 'Page title now reads "Domain for sale"',
            previewDesc: 'The homelab wiki: how every service here is set up, and how to bring it back.',
        });
        writeJSON(labFile, labNow);
    }

    // One shot only: two pages of tiles -- the machine's three in one row on
    // the first, the weather and a feed on the second.
    if (patches.includes('widgets')) {
        // Today stays on the other pages and Fresh is off, so the tiles lead
        // these. (The server keeps no page list for Fresh.)
        const s = readJSON(settingsFile);
        writeJSON(settingsFile, { ...s, smartTodayPageIds: [1, 2, 3], feedsEnabled: false });
        const pages = readJSON(path.join(dir, 'pages.json'));
        pages.order = [...(pages.order || []), 4, 5];
        writeJSON(path.join(dir, 'pages.json'), pages);
        const tilePage = (id, name, widgets) => writeJSON(path.join(dir, `bookmarks-${id}.json`), {
            page: { id, name },
            categories: [],
            widgets,
            blockOrder: widgets.map((w) => w.id),
            bookmarks: [],
        });
        tilePage(4, 'Server', [
            { id: 'w_s00000000001', type: 'cpu' },
            { id: 'w_s00000000002', type: 'memory' },
            { id: 'w_s00000000003', type: 'disks' },
        ]);
        tilePage(5, 'Outside', [
            { id: 'w_s00000000004', type: 'weather' },
            { id: 'w_s00000000005', type: 'rss', config: { feedUrls: ['https://blog.reading.example/feed.xml', 'https://news.lab.example/rss'] } },
        ]);
    }

    // One shot only: a page with the Home Assistant tile (its answer is mocked).
    if (patch === 'homeassistant') {
        const pages = readJSON(path.join(dir, 'pages.json'));
        pages.order = [...(pages.order || []), 4];
        writeJSON(path.join(dir, 'pages.json'), pages);
        const widgets = [{
            id: 'w_h00000000001',
            type: 'homeassistant',
            config: { server: 'http://homeassistant.local:8123', layout: 'list', groupBy: 'none', entities: ['light.ceiling', 'sensor.temperature', 'light.reading', 'scene.movie_night', 'binary_sensor.back_door'] },
        }];
        writeJSON(path.join(dir, 'bookmarks-4.json'), {
            page: { id: 4, name: 'Home' },
            categories: [],
            widgets,
            blockOrder: widgets.map((w) => w.id),
            bookmarks: [],
        });
    }

    // One shot only: a page with the Emby tile and the now playing tiles of
    // Jellyfin and Plex (their answers are mocked).
    if (patches.includes('media')) {
        const pages = readJSON(path.join(dir, 'pages.json'));
        pages.order = [...(pages.order || []), 4];
        writeJSON(path.join(dir, 'pages.json'), pages);
        const widgets = [
            { id: 'w_m00000000001', type: 'emby', config: { server: 'http://emby.local:8096', layout: 'list' } },
            { id: 'w_m00000000002', type: 'jellyfin-playing', config: { server: 'http://jellyfin.local:8096' } },
            { id: 'w_m00000000003', type: 'plex-playing', config: { server: 'http://tautulli.local:8181' } },
        ];
        writeJSON(path.join(dir, 'bookmarks-4.json'), {
            page: { id: 4, name: 'Media' },
            categories: [],
            widgets,
            blockOrder: widgets.map((w) => w.id),
            bookmarks: [],
        });
    }

    // One shot only: a few bookmarks with no tags, so the tag view of every
    // bookmark has something to show under Without tags.
    if (patches.includes('untagged')) {
        for (const id of [1, 2, 3]) {
            const file = path.join(dir, `bookmarks-${id}.json`);
            const data = readJSON(file);
            (data.bookmarks || []).forEach((b, i) => {
                if (i % 4 === 3) b.tags = [];
            });
            writeJSON(file, data);
        }
    }

    // One shot only: an inbox of sites the tag catalogue knows, so Find tags
    // has something to offer without a network.
    if (patches.includes('inbox-tags')) {
        const inbox = readJSON(path.join(dir, 'inbox.json'));
        const known = [
            ['https://github.com/jellyfin/jellyfin', 'Jellyfin, the free software media system'],
            ['https://www.proxmox.com/en/proxmox-virtual-environment/overview', 'Proxmox VE overview'],
            ['https://news.ycombinator.com/', 'Hacker News'],
            ['https://www.reddit.com/r/selfhosted/', 'r/selfhosted'],
            ['https://www.docker.com/', 'Docker: accelerated containers'],
            ['https://www.wikipedia.org/', 'Wikipedia'],
        ];
        inbox.items = inbox.items.slice(0, known.length).map((item, i) => ({
            ...item, url: known[i][0], title: known[i][1], domain: new URL(known[i][0]).hostname, tags: [],
        }));
        writeJSON(path.join(dir, 'inbox.json'), inbox);
    }

    // One shot only: a page of the seven Unraid widgets.
    if (patch === 'unraid') {
        const pages = readJSON(path.join(dir, 'pages.json'));
        pages.order = [...(pages.order || []), 4];
        writeJSON(path.join(dir, 'pages.json'), pages);
        const types = ['unraid', 'unraidArray', 'unraidParity', 'unraidShares', 'unraidVms', 'unraidUps', 'unraidNotifications'];
        const widgets = types.map((type, i) => ({ id: `w_u0000000000${i + 1}`, type }));
        writeJSON(path.join(dir, 'bookmarks-4.json'), {
            page: { id: 4, name: 'Server' },
            categories: [],
            widgets,
            blockOrder: widgets.map((w) => w.id),
            bookmarks: [],
        });
    }

    // One shot only: Utilities on Home grown past the fifteen a column holds,
    // so spreading it gives it a second column.
    if (patches.includes('spread')) {
        const homeNow = readJSON(homeFile);
        const tools = [
            ['Unit converter', 'units'], ['Time zones', 'zones'], ['Colour picker', 'colours'],
            ['Regex tester', 'regex'], ['JSON formatter', 'json'], ['Base64 decoder', 'base64'],
            ['Password generator', 'passwords'], ['QR maker', 'qr'], ['Calendar weeks', 'weeks'],
            ['Package tracking', 'parcels'], ['Speed test', 'speed'], ['Sunrise and sunset', 'sun'],
            ['Image resizer', 'resize'], ['Diff checker', 'diff'],
        ];
        tools.forEach(([name, slug], i) => homeNow.bookmarks.push({
            name, url: `https://${slug}.tools.example/`, pageId: 1, shortcut: '', category: 'utilities',
            checkStatus: false, icon: '', createdAt: now - (i + 3) * 86_400_000, tags: ['tools'],
        }));
        writeJSON(homeFile, homeNow);
    }

    // One shot only: three bookmarks whose last check failed, each its own way.
    if (patches.includes('broken')) {
        const failed = {
            'https://gone.example/old-page': 'DNS lookup failed',
            'https://kitchen.reading.example/slow': 'HTTP 404',
            'https://backup.lab.example/': 'HTTP 502',
        };
        const cache = fs.existsSync(cacheFile) ? readJSON(cacheFile) : { cache: {} };
        for (const file of fs.readdirSync(dir).filter((f) => /^bookmarks-\d+\.json$/.test(f))) {
            const page = readJSON(path.join(dir, file));
            (page.bookmarks || []).forEach((b) => {
                if (!failed[b.url]) return;
                b.lastError = failed[b.url];
                b.brokenSince = now - 3 * 86_400_000;
                b.lastChecked = now - 60_000;
                const key = b.url.replace(/\/$/, '');
                cache.cache[key] = { url: key, status: 'offline', pingMs: 0, lastScanned: now - 60_000, error: failed[b.url] };
            });
            writeJSON(path.join(dir, file), page);
        }
        writeJSON(cacheFile, cache);
    }
}

/** The urls the 'broken' patch fails, as the status pings answer them. */
const BROKEN_HOSTS = ['gone.example', 'kitchen.reading.example', 'backup.lab.example'];

const test = base.test.extend({
    /** A change to the data for one shot only; see tidyDemoData. */
    dataPatch: ['', { option: true }],
    /** This test's own server over its own copy of the demo data. */
    server: async ({ dataPatch }, use) => {
        const source = process.env.NEXTDASH_DATA_DIR;
        if (!source || !fs.existsSync(path.join(source, 'settings.json'))) {
            throw new Error('NEXTDASH_DATA_DIR must point at a copy of data-demo');
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-manual-'));
        // 'empty' is a new install: no data at all, as the server first finds it.
        if (dataPatch !== 'empty') {
            fs.cpSync(source, dir, { recursive: true });
            tidyDemoData(dir, dataPatch);
        }
        const port = await freePort();
        const baseURL = `http://localhost:${port}`;
        if (!fs.existsSync(binaryPath())) {
            throw new Error(`no server binary at ${binaryPath()}: run with PW_WORKERS above 1, so global setup builds it`);
        }
        const boot = async () => {
            const child = spawn(binaryPath(), [], {
                cwd: ROOT,
                env: {
                    ...process.env,
                    PORT: String(port),
                    NEXTDASH_DATA_DIR: dir,
                    NEXTDASH_DISABLE_PREFETCH: '1',
                    NEXTDASH_ICON_SETS_FIXTURE: path.join(ROOT, 'internal', 'app', 'testdata', 'icon-sets'),
                },
                stdio: 'ignore',
            });
            // A server that cannot start says so, rather than leaving the test to
            // time out waiting for a port nothing will ever answer on.
            const failed = new Promise((_, reject) => {
                child.on('error', (error) => reject(new Error(`server binary failed to start: ${error.message}`)));
                child.on('exit', (code) => {
                    if (code) reject(new Error(`server exited with code ${code} before it answered`));
                });
            });
            failed.catch(() => {});
            try {
                await Promise.race([waitForServer(baseURL), failed]);
            } catch (error) {
                await stop(child);
                throw error;
            }
            return child;
        };
        const stop = (child) => {
            child.kill('SIGTERM');
            return new Promise((resolve) => {
                if (child.exitCode !== null) return resolve(undefined);
                const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(undefined); }, 5_000);
                child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
            });
        };
        let child = null;
        try {
            child = await boot();
            if (dataPatch === 'empty') {
                // The first start writes a new install's settings; the demo's
                // theme is then put in them, and the server started again on
                // them, so this shot has the same look as the rest.
                await fetch(`${baseURL}/api/settings`).catch(() => {});
                await stop(child);
                child = null;
                const settingsFile = path.join(dir, 'settings.json');
                writeJSON(settingsFile, { ...readJSON(settingsFile), theme: DEMO_THEME });
                child = await boot();
            }
            await use({ baseURL, dir });
        } finally {
            if (child) await stop(child);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    },
    baseURL: async ({ server }, use) => use(server.baseURL),
});


/** Everything a shot needs from outside, answered the same way every time. */
async function prepare(page) {
    await page.clock.setFixedTime(NOW);
    // A browser that has been here before: this release's notes and the
    // one-time keyboard note already seen.
    await markWhatsNewSeen(page);
    // ... has had the one-time search hint along the bottom, which would sit
    // over whatever is lowest on the screen for six seconds, and has opened
    // the inbox tab once, which ends the glow that invites a first visit.
    await page.addInitScript(() => {
        try {
            localStorage.setItem('nextdash:search-flow-hint-v2', '1');
            localStorage.setItem('nextdash:inbox-tab-opened-v1', '1');
            // ... and has seen the one-time notes on new config settings,
            // which scroll their field into view and sit over the panel.
            for (const id of ['random-theme-v2', 'bookmarks-page-filter-v1']) {
                localStorage.setItem(`nextdash:config-setting-promo-seen-v1:${id}`, '1');
            }
        } catch { /* storage off */ }
    });

    const docker = await mockDocker(page, { containers: fixture('docker-containers.json'), usage: true });
    docker.disk = fixture('docker-disk.json');
    await page.route('**/api/docker/status', (r) => r.fulfill({ contentType: 'application/json', body: json('docker-status.json') }));
    await page.route('**/api/system/metrics**', (r) => r.fulfill({ contentType: 'application/json', body: json('system-metrics.json') }));

    await page.route('**/api/ping?**', (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        const down = url.includes('gone.example');
        return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(down ? { status: 'offline', ping: null, error: 'DNS lookup failed' } : { status: 'online', ping: pingFor(url) }),
        });
    });

    const weather = fixture('weather.json');
    await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(weather.geocoding) }));
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(weather.forecast) }));

    // No newer release on offer.
    await page.route('**/api/update-status*', async (route) => {
        try {
            const response = await route.fetch();
            const body = await response.json().catch(() => ({}));
            // A clean answer: no newer release, and no complaint about GitHub's
            // rate limit, which a machine that asks a lot runs into.
            const clean = { ...body, updateAvailable: false, latest: body.current, checkedAt: NOW.getTime() - 20 * 60_000 };
            delete clean.errorCode;
            delete clean.error;
            await route.fulfill({ response, json: clean });
        } catch { /* page closed */ }
    });

    await page.route('**/api/unraid/area/**', (route) => {
        const area = route.request().url().split('/').pop().split('?')[0];
        const known = ['overview', 'array', 'parity', 'shares', 'vms', 'ups', 'notifications'];
        return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(known.includes(area)
                ? { ...unraidAnswer(area), fetchedAt: NOW.getTime() - 20_000, lastOkAt: NOW.getTime() - 20_000 }
                : { area, status: 'unsupported' }),
        });
    });
    return { docker };
}

/** Close whatever a reader would close before looking: cards, notes, What's new. */
async function settle(page) {
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 30_000 });
    for (let round = 0; round < 3; round += 1) {
        const modal = page.locator('#app-modal.show');
        if (await modal.count()) {
            await page.keyboard.press('Escape');
            await modal.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
        }
        const checklist = page.locator('.quickstart-checklist [data-qs-action="dismiss"]');
        if (await checklist.count()) await checklist.first().click();
        const cards = page.locator('.notice-card.show [data-notice-dismiss]');
        while (await cards.count()) {
            await cards.first().click();
            // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
            await page.waitForTimeout(400);
        }
        // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
        await page.waitForTimeout(300);
    }
}

/**
 * A full frame. The pointer goes to a corner and focus is let go first, so no
 * hover glow or focus ring is left on whatever was clicked to get here.
 */
async function shot(page, name) {
    const view = page.viewportSize() || DESKTOP;
    await page.mouse.move(5, view.height - 5);
    await page.evaluate(() => document.activeElement?.blur?.());
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(300);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 82 });
}

/*
 * A crop of one element with a margin of the page around it.
 *
 * Every overlay -- palette, modal, card, menu -- is shot this way: the page
 * behind it is blurred, and a full frame of haze with a small box in it
 * shows nothing. Full frames are for shots where the page is the subject.
 */
async function crop(page, locator, name, pad = 24, maxHeight = Infinity) {
    const box = await boxAround(Array.isArray(locator) ? locator : [locator]);
    if (!box) throw new Error(`${name}: nothing to crop`);
    const view = page.viewportSize() || DESKTOP;
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const clip = {
        x, y,
        width: Math.min(view.width - x, Math.ceil(box.width + pad * 2)),
        height: Math.min(view.height - y, Math.ceil(box.height + pad * 2), maxHeight),
    };
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 82, clip });
}

/** The one box around several elements -- a row and the menu it opened. */
async function boxAround(locators) {
    const boxes = (await Promise.all(locators.map((l) => l.boundingBox()))).filter(Boolean);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
        x, y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
}

/*
 * A close crop of one element: a narrow margin, so the element fills the
 * picture, the pointer parked away from it, and focus let go -- unless the
 * focus is the subject (keepFocus).
 */
async function snap(page, locator, name, { pad = 12, maxHeight = Infinity, keepFocus = false } = {}) {
    const view = page.viewportSize() || DESKTOP;
    await page.mouse.move(5, view.height - 5);
    if (!keepFocus) await page.evaluate(() => document.activeElement?.blur?.());
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(300);
    await crop(page, locator, name, pad, maxHeight);
}

/** The dashboard on a page, everything drawn. */
async function openDashboard(page, hash = '') {
    await page.goto(`/${hash}`);
    await page.locator('.category').first().waitFor();
    await settle(page);
    // Pings, icons and widgets land a moment after the grid.
    await page.waitForTimeout(1_500);
}

module.exports = {
    base,
    fs,
    http,
    net,
    os,
    path,
    ROOT,
    OUT,
    FIX,
    json,
    fixture,
    unraidAnswer,
    NOW,
    DESKTOP,
    PHONE,
    TABLET,
    DEMO_THEME,
    freePort,
    waitForServer,
    readJSON,
    writeJSON,
    pingFor,
    tidyDemoData,
    BROKEN_HOSTS,
    test,
    prepare,
    settle,
    shot,
    crop,
    boxAround,
    snap,
    openDashboard,
    spawn,
    binaryPath,
    mockDocker,
    markWhatsNewSeen,
};
