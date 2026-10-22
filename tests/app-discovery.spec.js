// @ts-check
const fs = require('fs');
const http = require('http');
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, E2E_WEB_SERVER_ENV, markWhatsNewSeen, markInboxTutorialSeen, markConfigSettingPromosSeen, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * App discovery through the dashboard: the containers come from the fixture
 * file the worker's server reads instead of the Docker socket, and each
 * container's published port is a small local server that answers with a
 * page, as a web app does.
 */

const headers = { 'X-NextDash-Token': WRITE_TOKEN };
// The apps card waits for the corner cards' own delays after a load.
const CARD_WAIT = 25_000;
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
        ...(fresh ? {} : { enableHealthReviewNotice: false }),
        quickStart: {
            baselineBookmarks: -1, baselineTagged: -1, templatePicked: fresh ? '' : 'keep',
            // A finished onboarding has answered the analytics card too.
            ...(fresh ? {} : { seenAnalyticsNotice: true, analyticsChoiceMade: true }),
        },
        // A finished onboarding has had its dashboard tour as well.
        // ... and its corner cards.
        ...(fresh ? {} : { discoverabilityState: {
            seenTips: ['dashboardTutorialV3', 'blockMoveIntro'],
            seenSettingPromos: ['clock-weather-v1', 'install-count-v1', 'kept-pile-v1', 'theme-browser-try-v1', 'confetti-theme-try-v1', 'berry-theme-try-v1'],
        } }),
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
// A link in the category it was added to. Today, on main since the demo
// starter set, shows a link added today as well.
const placedLink = (page, text) => page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])', { hasText: text });

async function categories(request, pageId = 1) {
    return (await request.get(`/api/categories?page=${pageId}`)).json();
}

async function bookmarks(request, pageId = 1) {
    return (await request.get(`/api/bookmarks?page=${pageId}`)).json();
}

async function settings(request) {
    return (await request.get('/api/settings')).json();
}

test('the apps card lists the apps by kind, and Add puts them on the page', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    const jellyfin = await startApp('Jellyfin');
    writeContainers(workerServer, [
        container('sonarr', 'lscr.io/linuxserver/sonarr:latest', sonarr),
        container('jellyfin', 'jellyfin/jellyfin', jellyfin),
    ]);
    await install(request, { fresh: false });
    await runDiscovery(request);
    await open(page);

    await expect(card(page)).toBeVisible({ timeout: CARD_WAIT });
    await expect(card(page)).toContainText('2 apps are running here');
    await expect(card(page).locator('[data-ad-tick]')).toHaveCount(2);
    for (const box of await card(page).locator('[data-ad-tick]').all()) await expect(box).toBeChecked();
    await expect(card(page).locator('.app-discovery-kind')).toHaveText([/Media management/i, /^Media$/i]);

    await card(page).getByRole('button', { name: 'Add 2 apps' }).click();
    await expect(card(page)).toHaveCount(0);

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
    await expect(placedLink(page, 'sonarr')).toBeVisible();

    const st = await settings(request);
    expect(st.dockerBookmarkLinks?.sonarr).toBe(`1::${s.url}`);
    expect(st.discoveryCardDone).toBe(true);
});

test('Close keeps the card away and adds nothing', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: false });
    await runDiscovery(request);
    await open(page);

    await card(page).getByRole('button', { name: 'Not now' }).click();
    await expect(card(page)).toHaveCount(0);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);
    expect((await settings(request)).discoveryCardDone).toBe(true);

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // A check that the card does NOT come back: give it the time it would take to show.
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

    await expect(card(page)).toBeVisible({ timeout: CARD_WAIT });
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

test('no apps found: the start guide shows', async ({ page, request, workerServer }) => {
    writeContainers(workerServer, []);
    await install(request, { fresh: true });
    await runDiscovery(request);
    await open(page);

    await expect(page.locator('[data-start-guide-bar]')).toBeVisible({ timeout: 10_000 });
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

/** An install past its first run, with sonarr seen and the card answered. */
async function afterFirstRun(request, workerServer, { newApps = '' } = {}) {
    const radarr = await startApp('Radarr');
    writeContainers(workerServer, [container('radarr', 'linuxserver/radarr', radarr)]);
    await install(request, { fresh: false });
    expect((await request.post('/api/settings', { data: { discoveryNewApps: newApps }, headers })).ok()).toBe(true);
    expect((await request.post('/api/discovery/close', { headers })).ok()).toBe(true);
    await runDiscovery(request);
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [
        container('radarr', 'linuxserver/radarr', radarr),
        container('sonarr', 'linuxserver/sonarr', sonarr),
    ]);
    return { radarr, sonarr };
}

const notice = (page) => page.locator('.app-discovery-notice-card');

test('a new container is added to the dashboard with a notice, and Undo takes it back', async ({ page, request, workerServer }) => {
    const { sonarr } = await afterFirstRun(request, workerServer, { newApps: 'add' });
    expect((await runDiscovery(request)).added).toEqual(['sonarr']);
    await open(page);

    await expect(placedLink(page, 'sonarr')).toBeVisible();
    await expect(notice(page)).toContainText('sonarr added to Media management', { timeout: 15_000 });
    const added = (await bookmarks(request)).find((b) => b.name === 'sonarr');
    expect(added?.url).toContain(`127.0.0.1:${sonarr}`);

    await notice(page).getByRole('button', { name: 'Undo' }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator('#dashboard-layout .bookmark-link', { hasText: 'sonarr' })).toHaveCount(0);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);
    const st = await settings(request);
    expect(st.discoveryIgnored).toContain('sonarr');
    expect(st.dockerBookmarkLinks?.sonarr).toBeUndefined();
    const trash = await (await request.get('/api/trash')).json();
    expect(JSON.stringify(trash)).toContain('sonarr');

    // Recreated or not, it does not come back.
    const again = await runDiscovery(request);
    expect(again.added).toEqual([]);
    expect((await (await request.get('/api/discovery')).json()).recentAdds).toEqual([]);
});

test('Undo all on the notice tries again only what a failed Undo left', async ({ page, request, workerServer }) => {
    const { radarr, sonarr } = await afterFirstRun(request, workerServer, { newApps: 'add' });
    const lidarr = await startApp('Lidarr');
    writeContainers(workerServer, [
        container('radarr', 'linuxserver/radarr', radarr),
        container('sonarr', 'linuxserver/sonarr', sonarr),
        container('lidarr', 'linuxserver/lidarr', lidarr),
    ]);
    expect((await runDiscovery(request)).added).toHaveLength(2);
    await open(page);
    await expect(notice(page)).toContainText('2 apps added', { timeout: 15_000 });

    // The first undo goes through, the second fails.
    let calls = 0;
    await page.route('**/api/discovery/undo', (route) => {
        calls += 1;
        return calls === 2 ? route.fulfill({ status: 500, body: 'down' }) : route.continue();
    });
    await notice(page).getByRole('button', { name: 'Undo all' }).click();
    await expect(notice(page)).toContainText('Could not take it back');

    await page.unroute('**/api/discovery/undo');
    await notice(page).getByRole('button', { name: /^Undo/ }).click();
    await expect(notice(page)).toHaveCount(0);
    const left = (await bookmarks(request)).filter((b) => b.name === 'sonarr' || b.name === 'lidarr');
    expect(left).toEqual([]);
});

test('Move on the notice opens the bookmark form for the new app', async ({ page, request, workerServer }) => {
    const { sonarr } = await afterFirstRun(request, workerServer, { newApps: 'add' });
    await runDiscovery(request);
    await open(page);

    // Done is there next to Undo and Move.
    await expect(notice(page).getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 15_000 });
    await notice(page).getByRole('button', { name: 'Move' }).click({ timeout: 15_000 });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    await expect(page.locator('#bookmark-form-modal [data-field="url"]')).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${sonarr}`));
    await expect(page.locator('#bookmark-form-modal-title')).toHaveText(/Edit bookmark/i);
    expect((await (await request.get('/api/discovery')).json()).recentAdds).toEqual([]);
});

async function openInbox(page) {
    await markInboxTutorialSeen(page);
    await page.evaluate(() => window.dashboardInstance.inbox?.openInboxView?.());
    await expect.poll(async () => page.evaluate(async () => {
        const inbox = window.dashboardInstance.inbox;
        await inbox?.loadAndRender?.({ refresh: true });
        return document.querySelectorAll('.inbox-item').length;
    }), { timeout: 10_000 }).toBeGreaterThan(0);
}

test('with Propose in the Inbox, a new container arrives in the Inbox and Promote opens the form filled in', async ({ page, request, workerServer }) => {
    const { sonarr } = await afterFirstRun(request, workerServer, { newApps: 'inbox' });
    const res = await runDiscovery(request);
    expect(res.proposed).toEqual(['sonarr']);
    expect(res.added).toEqual([]);
    await open(page);
    await openInbox(page);

    const row = page.locator('.inbox-item', { has: page.getByRole('heading', { name: 'New app: sonarr' }) });
    await expect(row).toContainText('Media management');
    await row.getByRole('button', { name: 'Promote' }).click();
    const form = page.locator('#bookmark-form-modal');
    await expect(form).toHaveClass(/show/);
    await expect(form.locator('[data-field="url"]')).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${sonarr}`));
    await expect(form.locator('[data-field="name"]')).toHaveValue('sonarr');
    await form.locator('[data-field="name"]').press('Control+Enter');
    await expect(form).not.toHaveClass(/show/);

    const cats = await categories(request);
    const mm = cats.find((c) => c.name === 'Media management');
    const saved = (await bookmarks(request)).find((b) => b.name === 'sonarr');
    expect(saved?.category).toBe(mm?.id);
    expect(saved?.checkStatus).toBe(true);
    expect(saved?.icon).toBeTruthy();
    await expect.poll(async () => (await settings(request)).dockerBookmarkLinks?.sonarr).toBe(`1::${saved.url}`);
    await expect.poll(async () => {
        const body = await (await request.get('/api/inbox')).json();
        return (Array.isArray(body) ? body : body.items || []).length;
    }).toBe(0);
});

test('Ignore on a proposal removes it and it never returns', async ({ page, request, workerServer }) => {
    await afterFirstRun(request, workerServer, { newApps: 'inbox' });
    await runDiscovery(request);
    await open(page);
    await openInbox(page);

    const row = page.locator('.inbox-item', { has: page.getByRole('heading', { name: 'New app: sonarr' }) });
    await row.getByRole('button', { name: 'Ignore' }).click();
    await expect(row).toHaveCount(0);
    expect((await settings(request)).discoveryIgnored).toContain('sonarr');
    const again = await runDiscovery(request);
    expect(again.proposed).toEqual([]);
});

test('Suggest new apps off: no card and no Inbox proposals', async ({ page, request, workerServer }) => {
    const { radarr, sonarr } = await afterFirstRun(request, workerServer);
    const inboxItems = async () => {
        const body = await (await request.get('/api/inbox')).json();
        return Array.isArray(body) ? body : body.items || [];
    };
    const openConfig = async () => {
        await markWhatsNewSeen(page);
        await markConfigSettingPromosSeen(page);
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.goto('/#config/containers/view');
        await page.waitForSelector('[data-behavior-field="discoverApps"]', { timeout: 20_000 });
        await dismissBlockingOverlays(page);
    };
    const toggle = page.locator('[data-behavior-field="discoverApps"]');
    const newApps = page.locator('[data-behavior-field="discoveryNewApps"]');

    await openConfig();
    await expect(toggle).toBeChecked();
    await expect(newApps).toBeVisible();
    await toggle.uncheck();
    await expect.poll(async () => (await settings(request)).discoverApps).toBe(false);
    await expect(newApps).toHaveCount(0);

    // Off: sonarr is in the list and so is a newcomer; neither is looked at.
    const lidarr = await startApp('Lidarr');
    writeContainers(workerServer, [
        container('radarr', 'linuxserver/radarr', radarr),
        container('sonarr', 'linuxserver/sonarr', sonarr),
        container('lidarr', 'linuxserver/lidarr', lidarr),
    ]);
    await runDiscovery(request);
    await open(page);
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('#dashboard-layout .bookmark-link', { hasText: /sonarr|lidarr/ })).toHaveCount(0);
    const names = (await bookmarks(request)).map((b) => b.name);
    expect(names).not.toContain('sonarr');
    expect(names).not.toContain('lidarr');
    expect(await inboxItems()).toEqual([]);

    // On again, proposing instead of adding.
    await openConfig();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect.poll(async () => (await settings(request)).discoverApps).toBe(true);
    await expect(newApps).toBeVisible();
    await newApps.selectOption('inbox');
    await expect.poll(async () => (await settings(request)).discoveryNewApps).toBe('inbox');

    // The ignored list: Remove goes through the server's own route.
    expect((await request.post('/api/discovery/ignore', { data: { name: 'sonarr' }, headers })).ok()).toBe(true);
    expect((await request.post('/api/discovery/ignore', { data: { name: 'lidarr' }, headers })).ok()).toBe(true);
    // The page has to read the list the server wrote.
    await page.reload();
    await openConfig();
    const ignored = page.locator('[data-discovery-ignored-panel]');
    await expect(ignored).toContainText('sonarr');
    await ignored.locator('[data-discovery-unignore="sonarr"]').click();
    await expect(ignored).not.toContainText('sonarr');
    await expect(ignored).toContainText('lidarr');
    await expect.poll(async () => (await settings(request)).discoveryIgnored).toEqual(['lidarr']);
});

test('a direct add during the quick start still shows its notice with Undo', async ({ page, request, workerServer }) => {
    const radarr = await startApp('Radarr');
    writeContainers(workerServer, [container('radarr', 'linuxserver/radarr', radarr)]);
    await install(request, { fresh: true });
    expect((await request.post('/api/settings', { data: { discoveryNewApps: 'add' }, headers })).ok()).toBe(true);
    await runDiscovery(request);
    await open(page);
    await expect(page.locator('[data-start-guide-bar]')).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toHaveCount(0);

    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [
        container('radarr', 'linuxserver/radarr', radarr),
        container('sonarr', 'linuxserver/sonarr', sonarr),
    ]);
    expect((await runDiscovery(request)).added).toEqual(['sonarr']);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await expect(page.locator('[data-start-guide-bar]')).toHaveCount(1);
    await expect(notice(page)).toContainText('sonarr added to', { timeout: 15_000 });
    await expect(notice(page).getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
});

test('the card waits for What\'s new, then opens in the middle over a dimmed dashboard', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: false });
    // An install that last read an older release gets What's new first.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async () => {
        window.DiscoverabilityState?.setLastWhatsNewRelease?.('2026.08-dashboard-release-v1.3.0');
        await window.dashboardInstance.saveSettings?.();
    });
    await runDiscovery(request);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    const whatsNew = page.locator('.whats-new-modal');
    await expect(whatsNew).toBeVisible({ timeout: 15_000 });
    // A check that the card does NOT show behind What's new: give it the time it would take.
    await page.waitForTimeout(2500);
    await expect(card(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(whatsNew).toHaveCount(0);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    const box = await card(page).boundingBox();
    const center = box.x + box.width / 2;
    expect(Math.abs(center - 700)).toBeLessThan(40);
    expect(box.y).toBeGreaterThan(40);
    await expect(page.locator('[data-app-discovery-overlay]')).toBeVisible();
    // Corner cards wait while it is up.
    expect(await page.evaluate(() => window.NoticeCard.cornerIsFree('probe-card'))).toBe(false);
});

test('after Add the new categories are on top, light up, and a notice offers Undo', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    const radarr = await startApp('Radarr');
    writeContainers(workerServer, [
        container('sonarr', 'linuxserver/sonarr', sonarr),
        container('radarr', 'linuxserver/radarr', radarr),
    ]);
    await install(request, { fresh: false });
    await runDiscovery(request);
    await open(page);

    await expect(card(page)).toContainText('Add puts the ticked apps on this page', { timeout: CARD_WAIT });
    await expect(card(page)).toContainText('After that');
    await card(page).getByRole('button', { name: 'Add 2 apps' }).click();
    await expect(card(page)).toHaveCount(0);

    const cats = await categories(request);
    expect(cats[0].name).toBe('Media management');
    const added = page.locator('.app-discovery-added-card');
    await expect(added).toContainText('2 apps added to main');
    await expect(added).toContainText('Media management: sonarr, radarr');
    await expect(page.locator(`#dashboard-layout .category[data-category-id="${cats[0].id}"]`)).toHaveClass(/app-discovery-new/);
    await added.getByRole('button', { name: 'Done' }).click();
    await expect(added).toHaveCount(0);
});

test('Undo on the notice after Add takes the apps back without ignoring them', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: false });
    await runDiscovery(request);
    await open(page);
    await card(page).getByRole('button', { name: 'Add 1 app' }).click();

    const added = page.locator('.app-discovery-added-card');
    await added.getByRole('button', { name: 'Undo' }).click();
    await expect(added).toHaveCount(0);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);
    const st = await settings(request);
    expect(st.discoveryIgnored || []).not.toContain('sonarr');
    expect(st.dockerBookmarkLinks?.sonarr).toBeUndefined();
});

test('Replace the starter links leaves only the apps on main, and Undo brings them back', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: false });
    const starter = (await bookmarks(request)).length;
    await runDiscovery(request);
    await open(page);

    await expect(card(page)).toBeVisible({ timeout: CARD_WAIT });
    const replace = card(page).getByLabel(/Replace the starter links/);
    await expect(replace).not.toBeChecked();
    await replace.check();
    await card(page).getByRole('button', { name: 'Add 1 app' }).click();
    await expect(card(page)).toHaveCount(0);
    expect((await bookmarks(request)).map((b) => b.name)).toEqual(['sonarr']);

    await page.locator('.app-discovery-added-card').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await bookmarks(request)).length).toBe(starter);
});

test('on a new install the apps card comes last: after the start guide', async ({ page, request, workerServer }) => {
    const sonarr = await startApp('Sonarr');
    writeContainers(workerServer, [container('sonarr', 'linuxserver/sonarr', sonarr)]);
    await install(request, { fresh: true });
    await runDiscovery(request);
    await open(page);

    // First the start guide's bar, as on an install without Docker.
    const bar = page.locator('[data-start-guide-bar]');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    // A check that the apps card does NOT show beside the guide: give it the time it would take.
    await page.waitForTimeout(1500);
    await expect(card(page)).toHaveCount(0);

    // Closing the guide for good ends the onboarding; the apps card is next.
    await bar.locator('[data-start-guide-close]').click();
    await bar.locator('[data-sg-confirm-close]').click();
    await expect(bar).toHaveCount(0);

    // No tour by itself and no other corner card for a while after the guide
    // (the quiet period), so the apps card does not wait for anything else.
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    await expect(card(page)).toContainText('1 app is running here');
});

test('a new container later is asked about in the middle first, and Add puts it on the page', async ({ page, request, workerServer }) => {
    const { sonarr } = await afterFirstRun(request, workerServer);
    const res = await runDiscovery(request);
    expect(res.asked).toEqual(['sonarr']);
    expect(res.added).toEqual([]);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);
    await open(page);

    await expect(card(page)).toContainText('sonarr is running here', { timeout: CARD_WAIT });
    await expect(card(page)).toContainText('New on this server');
    await expect(card(page)).toContainText('Media management');
    await expect(page.locator('[data-app-discovery-overlay]')).toBeVisible();
    await card(page).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card(page)).toHaveCount(0);

    await expect(placedLink(page, 'sonarr')).toBeVisible();
    const added = (await bookmarks(request)).find((b) => b.name === 'sonarr');
    expect(added?.url).toContain(`127.0.0.1:${sonarr}`);
    await expect(notice(page)).toContainText('sonarr added to Media management', { timeout: 15_000 });
    expect((await (await request.get('/api/discovery')).json()).pending).toEqual([]);
});

test('Ignore on the question keeps the container away for good', async ({ page, request, workerServer }) => {
    await afterFirstRun(request, workerServer);
    await runDiscovery(request);
    await open(page);
    await card(page).getByRole('button', { name: 'Ignore' }).click({ timeout: CARD_WAIT });
    await expect(card(page)).toHaveCount(0);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);
    expect((await settings(request)).discoveryIgnored).toContain('sonarr');
    expect((await runDiscovery(request)).asked).toEqual([]);
});

test('Not now asks again on the next load', async ({ page, request, workerServer }) => {
    await afterFirstRun(request, workerServer);
    await runDiscovery(request);
    await open(page);
    await card(page).getByRole('button', { name: 'Not now' }).click({ timeout: CARD_WAIT });
    await expect(card(page)).toHaveCount(0);
    expect((await bookmarks(request)).some((b) => b.name === 'sonarr')).toBe(false);

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(card(page)).toContainText('sonarr is running here', { timeout: CARD_WAIT });
});
