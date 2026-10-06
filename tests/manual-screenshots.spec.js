// @ts-check
/*
 * The screenshots in MANUAL.md, taken through the real UI.
 *
 * Run on purpose only, against a copy of the demo data:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<copy of data-demo> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots.spec.js
 *
 * Without MANUAL_SHOTS every test skips, so a normal run never takes them.
 *
 * Every test gets a server of its own on a free port, started from the binary
 * global setup builds, over its own copy of NEXTDASH_DATA_DIR -- so one shot
 * that adds a widget or dismisses a card leaves the next one alone, and the
 * tests can run side by side. The copy is tidied first (tidyDemoData): the
 * demo's own monitors cannot reach their example hosts, and a server left
 * running on it records them all as down.
 *
 * What a real install would get from outside -- Docker, the weather, the
 * status pings, an Unraid server, a service behind the Custom widget -- is
 * answered here with fixtures from tests/fixtures/manual-screenshots and the
 * fixtures the feature specs already use. The browser clock stands at
 * 06-10-2026 09:12.
 *
 * Views open the way a reader opens them: the key (`&`, `:`, `!`, Shift+A),
 * the header icon, a right-click.
 */
const base = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { binaryPath } = require('./worker-server');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen } = require('./e2e-helpers');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'manual.md');
const FIX = path.join(__dirname, 'fixtures', 'manual-screenshots');
const json = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const fixture = (name) => JSON.parse(json(name));
const unraidAnswer = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-unraid', `${name}.json`), 'utf8'));

const NOW = new Date('2026-10-06T09:12:00');
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

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
}

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
        fs.cpSync(source, dir, { recursive: true });
        tidyDemoData(dir, dataPatch);
        const port = await freePort();
        const baseURL = `http://localhost:${port}`;
        if (!fs.existsSync(binaryPath())) {
            throw new Error(`no server binary at ${binaryPath()}: run with PW_WORKERS above 1, so global setup builds it`);
        }
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
            await use({ baseURL, dir });
        } finally {
            child.kill('SIGTERM');
            await new Promise((resolve) => {
                if (child.exitCode !== null) return resolve(undefined);
                const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(undefined); }, 5_000);
                child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
            });
            fs.rmSync(dir, { recursive: true, force: true });
        }
    },
    baseURL: async ({ server }, use) => use(server.baseURL),
});

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

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
            await page.waitForTimeout(400);
        }
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
    const box = await locator.boundingBox();
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

/** The dashboard on a page, everything drawn. */
async function openDashboard(page, hash = '') {
    await page.goto(`/${hash}`);
    await page.locator('.category').first().waitFor();
    await settle(page);
    // Pings, icons and widgets land a moment after the grid.
    await page.waitForTimeout(1_500);
}

test('04 dashboard', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await shot(page, '04-dashboard.jpg');
    // The bar slides into the edge after two seconds; ' brings it back and keeps it.
    await page.keyboard.press("'");
    const bar = page.locator('.dashboard-section.section-controls .header-shortcuts');
    await page.waitForTimeout(600);
    await crop(page, bar, '04-action-buttons.jpg', 24);
});

test('sh homelab', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#2');
    await shot(page, 'sh-homelab.jpg');
});

/** Let a toast that is on its way come and go (it lasts a few seconds). */
async function waitOutNotice(page) {
    const toast = page.locator('#app-notification.show');
    await toast.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

/** A bookmark row on the grid, by its name. */
const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();
const modal = (page) => page.locator('#app-modal.show .modal');

test('04 preview card', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await row(page, 'Maps').hover();
    const card = page.locator('.bookmark-preview-card').first();
    await card.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_200);
    await crop(page, card, '04-preview-card.jpg');
});

test('05 quick add', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('&');
    const input = page.locator('#omnibox-overlay .omnibox-input');
    await input.waitFor();
    await input.pressSequentially('Jellyfin | https://jellyfin.lab.example | jf', { delay: 10 });
    await page.waitForTimeout(800);
    await crop(page, page.locator('#omnibox-overlay .omnibox-box'), '05-quick-add.jpg');
});

test('05 full form', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('+');
    const form = page.getByRole('dialog', { name: 'Create New Bookmark' });
    await form.waitFor();
    // The form opens with the cursor in URL.
    await page.waitForTimeout(400);
    await page.keyboard.type('https://jellyfin.lab.example', { delay: 10 });
    await page.waitForTimeout(1_000);
    await crop(page, form, '05-full-form.jpg');
});

test('06 context menu', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await row(page, 'Encyclopedia').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await crop(page, menu, '06-context-menu.jpg');
});

test('07 cheat sheet', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('!');
    await page.locator('#app-modal.show .keyboard-cheat-sheet-modal').waitFor();
    await page.waitForTimeout(600);
    await crop(page, modal(page), '07-cheat-sheet.jpg');
});

test('08 search', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // Bare letters look for a shortcut first; / turns the same letters into a
    // name search, as the panel's own hint says.
    await page.keyboard.type('lib', { delay: 120 });
    await page.keyboard.press('/');
    await page.waitForTimeout(800);
    await crop(page, page.locator('#shortcut-search .search-container'), '08-search.jpg');
});

test('08 commands', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press(':');
    await page.waitForTimeout(800);
    await crop(page, page.locator('#shortcut-search .search-container'), '08-commands.jpg');
});

test('09 smart collections', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await crop(page, page.locator('#dashboard-layout .category[data-smart-collection="true"]').first(), '09-smart-collections.jpg', 16);
});

/** The Bookmarks view, by its header icon. */
async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('11 bookmarks view', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'Encyclopedia' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(1_000);
    await shot(page, '11-bookmarks-view.jpg');
    await crop(page, panel, '11-side-panel.jpg', 0);
});

test('11 collection health', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('h');
    await modal(page).waitFor();
    await page.waitForTimeout(1_500);
    await crop(page, modal(page), '11-collection-health.jpg');
});

/** Config, by the gear in the header, then a section on its rail. */
async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.waitForTimeout(800);
    await settle(page);
}

const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/** Scroll the page so an element stands near the top, below the sticky head. */
async function scrollToTop(page, locator, offset = 140) {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, box.y - offset);
    await page.waitForTimeout(500);
    await settleScroll(page);
}

/*
 * Nudge the scroll so no line of text is cut in half where the page meets
 * the top of the window, or the bottom of a sticky header standing there.
 * Tries a pixel at a time, nearest first, up to 30 either way.
 */
async function settleScroll(page) {
    const nudge = await page.evaluate(() => {
        const cx = Math.round(window.innerWidth / 2);
        let edge = 0;
        let sticky = null;
        for (const x of [cx, 300, window.innerWidth - 300]) {
            for (let el = document.elementFromPoint(x, 2); el && el !== document.body; el = el.parentElement) {
                const pos = getComputedStyle(el).position;
                if (pos === 'sticky' || pos === 'fixed') {
                    const bottom = el.getBoundingClientRect().bottom;
                    if (bottom > edge && bottom < window.innerHeight / 3) { edge = bottom; sticky = el; }
                    break;
                }
            }
        }
        const boxes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const el = node.parentElement;
            if (!el || (sticky && sticky.contains(el))) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) {
                if (r.height > 0 && r.bottom > edge - 40 && r.top < edge + 40) boxes.push([r.top, r.bottom]);
            }
        }
        document.querySelectorAll('input, select, textarea, button, img, svg').forEach((el) => {
            if (sticky && sticky.contains(el)) return;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > edge - 40 && r.top < edge + 40) boxes.push([r.top, r.bottom]);
        });
        const cut = (d) => boxes.some(([top, bottom]) => top - d < edge - 1 && bottom - d > edge + 1);
        for (let i = 0; i <= 30; i += 1) {
            for (const d of i ? [i, -i] : [0]) if (!cut(d)) return d;
        }
        return 0;
    });
    if (nudge) {
        await page.mouse.wheel(0, nudge);
        await page.waitForTimeout(400);
    }
}

test('12 alerts', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'behavior');
    await subtab(page, 'Status & alerts').click();
    const heading = page.getByRole('heading', { name: /^Downtime alerts/ }).first();
    await heading.waitFor();
    await scrollToTop(page, heading);
    await shot(page, '12-alerts.jpg');
});

/** The inbox, by its header icon. */
async function openInbox(page) {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await page.locator('.inbox-layout').waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('13 inbox', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    await page.locator('.inbox-layout').getByText('Field notes on quokkas').first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await shot(page, '13-inbox.jpg');
});

test('13 triage', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    await page.locator('.inbox-triage-btn').click();
    await page.locator('#inbox-triage-overlay').waitFor();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);
    await crop(page, page.locator('#inbox-triage-overlay .inbox-triage-card'), '13-triage.jpg');
});

/** The Containers view, by its header icon. */
async function openContainers(page) {
    await openDashboard(page);
    await page.locator('#page-nav-docker-host .docker-link-anchor').click();
    await page.locator('[data-docker-row]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('14 containers', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await shot(page, '14-containers.jpg');
});

test('14 side panel', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'sonarr' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await crop(page, panel, '14-side-panel.jpg', 0);
});

test('14 disk', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await page.keyboard.press('d');
    await page.getByText('Bind mounts').first().waitFor();
    await page.waitForTimeout(1_000);
    // Down past the header, so the first bind mounts are in the frame.
    await scrollToTop(page, page.getByText('Disk', { exact: true }).first(), 16);
    await shot(page, '14-disk.jpg');
});

/*
 * The logs window reads an NDJSON stream that stays open. A route answers in
 * one piece and the stream would end at once, so fetch() for that path hands
 * back a stream that has these lines in it and stays open, as a running
 * container's log does (the same trick as docker-logs-modal.spec.js).
 */
const SONARR_LOG = [
    ['07:00:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:00:04', 'out', '[Info] DownloadDecisionMaker: Processing 48 releases'],
    ['07:00:06', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 48, Reports grabbed: 0'],
    ['07:05:11', 'out', '[Info] RefreshSeriesService: Updating info for Slow Horses'],
    ['07:05:12', 'out', '[Info] DiskScanService: Scanning disk for Slow Horses'],
    ['07:05:13', 'out', '[Info] DiskScanService: Completed scanning disk for Slow Horses'],
    ['07:15:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:15:03', 'err', '[Warn] Newznab: Indexer returned HTTP 503, retrying in 5 minutes'],
    ['07:15:05', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 31, Reports grabbed: 1'],
    ['07:15:06', 'out', '[Info] DownloadService: Report sent to qBittorrent. Slow Horses S05E04 1080p WEB'],
    ['07:30:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:30:05', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 29, Reports grabbed: 0'],
    ['07:41:19', 'out', '[Info] DownloadedEpisodesImportService: Importing Slow Horses S05E04'],
    ['07:41:21', 'out', '[Info] EpisodeFileMovingService: Moving file to /tv/Slow Horses/Season 05'],
    ['07:41:22', 'out', '[Info] Jellyfin: Library refresh requested'],
    ['07:45:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:45:04', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 35, Reports grabbed: 0'],
    ['08:00:00', 'out', '[Info] HousekeepingService: Running housekeeping tasks'],
    ['08:00:02', 'out', '[Info] Database: Vacuuming log database'],
    ['08:00:03', 'out', '[Info] Database: Log database compressed'],
    ['08:00:04', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['08:00:07', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 40, Reports grabbed: 0'],
    // Written in local time (the clock in the shots); Docker stamps in UTC.
].map(([time, s, m]) => ({ t: new Date(`2026-10-06T${time}`).toISOString().replace('.000Z', '.000000000Z'), s, m }));

async function fakeLogStream(page, lines) {
    await page.addInitScript((logLines) => {
        const encoder = new TextEncoder();
        const real = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (!url.includes('/logs/stream')) return real(input, init);
            const body = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(logLines.map((l) => `${JSON.stringify(l)}\n`).join('')));
                },
            });
            return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
        };
    }, lines);
}

test('14 logs window', async ({ page }) => {
    await prepare(page);
    await fakeLogStream(page, SONARR_LOG);
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'sonarr' }).first().click({ button: 'right' });
    await page.getByText('Show logs', { exact: false }).first().click();
    const logs = page.locator('.docker-logs-modal');
    await logs.waitFor({ state: 'visible' });
    await page.getByText('Library refresh requested').first().waitFor();
    await page.waitForTimeout(800);
    await crop(page, logs, '14-logs-window.jpg');
});

test('15 widgets', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#2');
    // Down the Homelab page to where the machine's own widgets stand.
    await scrollToTop(page, page.locator('[data-widget-type="cpu"]').first(), 120);
    await page.waitForTimeout(800);
    await shot(page, '15-widgets.jpg');
});

/**
 * A service for the Custom widget to ask: it answers every path with the
 * Sonarr queue recorded in tests/fixtures/widget-presets/sonarr.json.
 */
async function startSonarrStub() {
    const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'widget-presets', 'sonarr.json'), 'utf8'));
    const answer = { ...recorded.body, totalCount: 4, count: 3, unknownCount: 1 };
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {import('net').AddressInfo} */ (server.address());
    return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Config -> Widgets -> Add a widget -> Custom, as step 1 of §15.5 says. */
async function addCustomWidget(page) {
    await openConfig(page, 'widgets');
    await page.locator('[data-widget-catalogue]').first().click();
    await page.locator('#app-modal.show [data-widget-add="custom"]').first().click();
    const preset = page.locator('[data-widget-preset]').last();
    await preset.waitFor();
    return preset;
}

test('15 custom widget', async ({ page }) => {
    const stub = await startSonarrStub();
    try {
        await prepare(page);
        /*
         * Ask now goes through the real server, which asks the stub and reads
         * the figures out of its answer. The address on screen stays the one
         * a reader would type; only the request is pointed at the stub, and
         * the host in the answer is put back.
         */
        await page.route('**/api/widgets/custom/test', async (route) => {
            const sent = JSON.parse(route.request().postData() || '{}');
            const shown = new URL(sent.url);
            sent.url = `${stub.origin}${shown.pathname}`;
            const response = await route.fetch({ postData: JSON.stringify(sent) });
            const body = await response.json();
            body.host = shown.host;
            body.tookMs = 38;
            await route.fulfill({ response, json: body });
        });
        const preset = await addCustomWidget(page);
        await preset.selectOption('sonarr');
        await page.waitForTimeout(600);
        const address = page.locator('[data-widget-setting="url"]').last();
        await address.fill('http://sonarr.lab.example:8989/api/v3/queue/status');
        await address.press('Tab');
        await page.locator('[data-widget-auth="secret"]').last().fill('demo-key-not-a-real-one');
        await page.locator('[data-custom-test]').last().click();
        await page.getByText('What came back').first().waitFor();
        // The preset's notice goes by itself; the figures are the subject here.
        await waitOutNotice(page);
        await page.waitForTimeout(1_000);
        await scrollToTop(page, page.locator('[data-custom-field="path"]').first(), 260);
        await shot(page, '15-custom-widget.jpg');
    } finally {
        await stub.close();
    }
});

test('15 custom widget presets', async ({ page }) => {
    await prepare(page);
    const preset = await addCustomWidget(page);
    await preset.selectOption('sonarr');
    // The preset's notice goes by itself; it would cover the figures.
    await waitOutNotice(page);
    await page.waitForTimeout(800);
    const group = page.locator('.config-custom-group', { has: page.locator('[data-widget-preset]') }).last();
    await scrollToTop(page, group, 200);
    await shot(page, '15-custom-widget-presets.jpg');
});

test.describe('unraid', () => {
    test.use({ dataPatch: 'unraid' });
    test('15 unraid widgets', async ({ page }) => {
        await prepare(page);
        await openDashboard(page, '#4');
        await page.waitForTimeout(1_000);
        await shot(page, '15-unraid-widgets.jpg');
    });
});

test('16 look studio', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    const studio = page.locator('[data-look-studio]');
    await studio.waitFor({ state: 'visible' });
    await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
    await page.waitForTimeout(1_200);
    await shot(page, '16-look-studio.jpg');
    // The Themes tab close up: search, segments, character chips, first cards.
    await crop(page, studio, '16-theme-browser.jpg', 0, 560);
});

test('16 theme editor', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    await subtab(page, 'Look').click();
    await page.getByRole('button', { name: /Open the theme editor/ }).first().click();
    // Recolour the theme on screen: its colours open below.
    await page.locator('[data-theme-base-select]').selectOption('matrix-bluepill-dark');
    await page.waitForTimeout(1_500);
    await scrollToTop(page, page.locator('[data-theme-base-select]'), 200);
    await shot(page, '16-theme-editor.jpg');
});

test('17 config', async ({ page }) => {
    await prepare(page);
    await openConfig(page);
    await page.waitForTimeout(1_000);
    await shot(page, '17-config.jpg');
});

test('18 statistics', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'stats');
    await page.waitForTimeout(2_000);
    await shot(page, '18-statistics.jpg');
});

test('19 backups', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'data-backups');
    await subtab(page, 'Backups').click();
    await page.waitForTimeout(1_200);
    await shot(page, '19-backups.jpg');
});

test('20 activity trail', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'logs');
    await subtab(page, 'Activity trail').click();
    await page.waitForTimeout(1_200);
    await shot(page, '20-activity-trail.jpg');
});

test.describe('phone', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
    test('22 phone', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // The one-time note about the phone layout, closed with its ×.
        const note = page.getByRole('button', { name: 'Dismiss' }).first();
        if (await note.isVisible().catch(() => false)) await note.click();
        // The tap leaves the row under it lit; a tap on the title lets go.
        await page.locator('h1').first().click().catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, '22-phone.jpg');
    });
});
