// @ts-check
const fs = require('fs');
const http = require('http');
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, E2E_WEB_SERVER_ENV, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * App discovery through the dashboard: the containers come from the fixture
 * file the worker's server reads instead of the Docker socket, and each
 * container's published port is a small local server that answers with a
 * page, as a web app does.
 */

const headers = { 'X-NextDash-Token': WRITE_TOKEN };
const stubs = [];

/** A local web app: a page with a title, optionally slow to answer at first. */
async function startApp(title, { delayFirstMs = 0 } = {}) {
    let first = true;
    const server = http.createServer((req, res) => {
        const answer = () => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><title>${title}</title><p>${title}</p>`);
        };
        if (first && delayFirstMs) {
            first = false;
            setTimeout(answer, delayFirstMs);
            return;
        }
        first = false;
        answer();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    stubs.push(server);
    const address = server.address();
    return typeof address === 'object' && address ? address.port : 0;
}

test.afterEach(async () => {
    await Promise.all(stubs.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve(undefined)))));
});

function container(name, image, port) {
    return {
        Id: `${name}-id-0000000000`,
        Names: [`/${name}`],
        Image: image,
        State: 'running',
        Created: Math.floor(Date.now() / 1000) - 3600,
        Ports: [{ IP: '0.0.0.0', PrivatePort: port, PublicPort: port, Type: 'tcp' }],
        Labels: {},
    };
}

function fixturePath(workerServer) {
    return workerServer?.discoveryFixture || E2E_WEB_SERVER_ENV.NEXTDASH_DISCOVERY_FIXTURE;
}

function writeContainers(workerServer, list) {
    fs.writeFileSync(fixturePath(workerServer), JSON.stringify(list));
}

/**
 * The store back to an install; fresh means the first-start card is still
 * unanswered. Port links resolve on 127.0.0.1, where the stubs listen.
 */
async function install(request, { fresh }) {
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    const settings = {
        onboardingCompleted: !fresh,
        discoveryCardDone: false,
        dockerHostAddress: '127.0.0.1',
        quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: fresh ? '' : 'keep' },
    };
    expect((await request.post('/api/settings', { data: settings, headers })).ok()).toBe(true);
}

async function runDiscovery(request) {
    const res = await request.post('/api/discovery/run', { headers, timeout: 60_000 });
    expect(res.ok()).toBe(true);
    return res.json();
}

async function open(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const card = (page) => page.locator('[data-app-discovery-card]');
const templateCard = (page) => page.locator('.first-start-card:not([data-app-discovery-card])');

async function categories(request, pageId = 1) {
    return (await request.get(`/api/categories?page=${pageId}`)).json();
}

async function bookmarks(request, pageId = 1) {
    return (await request.get(`/api/bookmarks?page=${pageId}`)).json();
}

async function settings(request) {
    return (await request.get('/api/settings')).json();
}

test('fresh install with apps: the apps card replaces the template card, Add puts them on the page by kind', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    const jellyfin = await startApp('Jellyfin');
    writeContainers(workerServer, [
        container('sonarr', 'lscr.io/linuxserver/sonarr:latest', sonarr),
        container('jellyfin', 'jellyfin/jellyfin', jellyfin),
    ]);
    await install(request, { fresh: true });
    await runDiscovery(request);
    await open(page);

    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('2 apps found');
    await expect(card(page).getByRole('checkbox')).toHaveCount(2);
    for (const box of await card(page).getByRole('checkbox').all()) await expect(box).toBeChecked();
    await expect(card(page).locator('.app-discovery-kind')).toHaveText([/Media management/i, /^Media$/i]);
    await expect(templateCard(page)).toHaveCount(0);

    await card(page).getByRole('button', { name: 'Add 2 apps' }).click();
    await expect(card(page)).toHaveCount(0);
    // Answered: the template card does not follow.
    await expect(templateCard(page)).toHaveCount(0);

    const cats = await categories(request);
    const mm = cats.find((c) => c.name === 'Media management');
    const media = cats.find((c) => c.name === 'Media');
    expect(mm, JSON.stringify(cats)).toBeTruthy();
    expect(media).toBeTruthy();
    const marks = await bookmarks(request);
    const s = marks.find((b) => b.name === 'sonarr');
    expect(s?.url).toContain(`127.0.0.1:${sonarr}`);
    expect(s?.category).toBe(mm.id);
    expect(s?.checkStatus).toBe(true);
    expect(s?.icon).toBeTruthy();
    await expect(page.locator('#dashboard-layout .bookmark-link', { hasText: 'sonarr' })).toBeVisible();

    const st = await settings(request);
    expect(st.dockerBookmarkLinks?.sonarr).toBe(`1::${s.url}`);
    expect(st.discoveryCardDone).toBe(true);
    expect(st.quickStart?.templatePicked).toBe('apps');
});

test('Close keeps the card away and adds nothing', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: true });
    await runDiscovery(request);
    await open(page);

    await card(page).getByRole('button', { name: 'Close' }).last().click();
    await expect(card(page)).toHaveCount(0);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);
    expect((await settings(request)).discoveryCardDone).toBe(true);

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.waitForTimeout(1000);
    await expect(card(page)).toHaveCount(0);
});

test('an existing install sees only apps without a bookmark', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    const radarr = await startApp('Radarr');
    writeContainers(workerServer, [
        container('sonarr', 'linuxserver/sonarr', sonarr),
        container('radarr', 'linuxserver/radarr', radarr),
    ]);
    await install(request, { fresh: false });
    expect((await request.post('/api/bookmarks/add', {
        data: { page: 1, bookmark: { name: 'TV', url: `http://127.0.0.1:${sonarr}`, category: '' } },
        headers,
    })).ok()).toBe(true);
    await runDiscovery(request);
    await open(page);

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('.app-discovery-row')).toHaveCount(1);
    await expect(card(page).locator('.app-discovery-row')).toContainText('radarr');
    await expect(templateCard(page)).toHaveCount(0);
});

test('a page that already has "Media management" gets no second one', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: false });
    const existing = await categories(request);
    expect((await request.post('/api/categories?page=1', {
        data: [...existing, { id: 'tv-stuff', name: 'media management', pageId: 1 }],
        headers,
    })).ok()).toBe(true);
    await runDiscovery(request);
    await open(page);

    await card(page).getByRole('button', { name: 'Add 1 app' }).click();
    await expect(card(page)).toHaveCount(0);
    const cats = await categories(request);
    expect(cats.filter((c) => /^media management$/i.test(c.name))).toHaveLength(1);
    const s = (await bookmarks(request)).find((b) => b.name === 'sonarr');
    expect(s?.category).toBe('tv-stuff');
});

test('while the first run is going the card says it is looking', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr', { delayFirstMs: 3500 });
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: true });
    const running = request.post('/api/discovery/run', { headers, timeout: 60_000 });
    await expect.poll(async () => (await (await request.get('/api/discovery')).json()).running).toBe(true);
    await open(page);

    await expect(card(page)).toContainText('Looking for apps');
    await expect(templateCard(page)).toHaveCount(0);
    await running;
    await expect(card(page)).toContainText('1 app found', { timeout: 10_000 });
    await expect(card(page).locator('.app-discovery-row')).toContainText('sonarr');
});

test('no apps found: the template card shows', async ({ page, request, workerServer }) => {
    writeContainers(workerServer, []);
    await install(request, { fresh: true });
    await runDiscovery(request);
    await open(page);

    await expect(templateCard(page)).toBeVisible();
    await expect(card(page)).toHaveCount(0);
});

test('a settings save from a page loaded earlier does not undo Ignore or Close', async ({ page, request }) => {
    await install(request, { fresh: false });
    expect((await request.post('/api/discovery/ignore', { data: { name: 'radarr' }, headers })).ok()).toBe(true);
    await open(page);

    // Ignored and closed on another device, then this page saves its own copy.
    expect((await request.post('/api/discovery/ignore', { data: { name: 'sonarr' }, headers })).ok()).toBe(true);
    expect((await request.post('/api/discovery/close', { headers })).ok()).toBe(true);
    await page.evaluate(async () => { await window.dashboardInstance.saveSettings(); });
    const st = await settings(request);
    expect(st.discoveryIgnored).toEqual(['radarr', 'sonarr']);
    expect(st.discoveryCardDone).toBe(true);
});
