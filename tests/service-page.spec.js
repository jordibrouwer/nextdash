// @ts-check
const { test, expect } = require('./fixtures');

// One test here is about the live channel's own stream (a health write reaches the page), so the real one stays.
test.use({ realLiveChannel: true });
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The Service popover (#service): one large dialog over the current view for a
 * bookmark and its container.
 *
 * GET /api/service is mocked; the Go tests cover what it gathers. What is
 * checked here is what the page does with it: the ways in, how it closes
 * (Esc, backdrop, button, Back), the empty states, who gets action buttons, the one request it must never make
 * and the refetch on the live channel's ping.
 */

const SONARR_URL = 'http://localhost:8989/';
const row = (name, extra = {}) => ({ id: name.padEnd(64, '0'), shortId: name.padEnd(12, '0'), name, image: `x/${name}`, tag: 'latest',
    state: 'running', status: 'Up', health: '', created: 1790000000, ports: [], ...extra });
const CONTAINERS = [
    row('sonarr', { ports: [{ private: 8989, public: 8989, type: 'tcp' }], webui: 'http://[IP]:8989/' }),
    row('lonely', { ports: [{ private: 9999, public: 9999, type: 'tcp' }] }),
    row('nextdash', { self: true, ports: [{ private: 8080, public: 8099, type: 'tcp' }] }),
];
const BOOKMARKS = [
    { name: 'Sonarr', url: SONARR_URL, pageId: 1, category: 'c1', checkStatus: true },
    { name: 'Plain site', url: 'https://plain.example.com/', pageId: 1, category: 'c1' },
];

const now = Date.now();
function body(overrides = {}) {
    return {
        bookmark: { found: true, name: 'Sonarr', url: SONARR_URL, pageId: 1, index: 0, pageName: 'Home', checkMode: 'monitor', status: 'healthy', score: 100,
            monitor: { uptime24h: { ratio: 1, samples: 30 }, uptime7d: { ratio: 0.9998, samples: 200 }, uptime30d: { ratio: 0.9991, samples: 800 }, lastPingMs: 84, totalChecks: 800 },
            ...(overrides.bookmark || {}) },
        days: [{ d: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()), n: 10, u: 10 }],
        checks: [{ id: 'abcdef012345', type: 'tcp', label: 'TCP 8989', enabled: true, known: true, ok: true, at: now, since: now - 3600_000, ms: 4 }],
        watches: [],
        container: overrides.container === null ? null : { id: 'a'.repeat(64), name: 'sonarr', image: 'x/sonarr', state: 'running', ports: [{ private: 8989, public: 8989, type: 'tcp' }],
            // the real Docker list answers in seconds
            startedAt: Math.floor((now - 86_400_000) / 1000), version: '4.0.1', ...(overrides.container || {}) },
        docker: { available: true },
        timeline: [
            { at: now - 1000_000, source: 'release', kind: 'release', detail: 'v4.1.0' },
            { at: now - 2000_000, source: 'docker', kind: 'crash', detail: 'exit code 1' },
            { at: now - 3000_000, source: 'health', kind: 'down', detail: 'HTTP 502' },
        ],
        control: false, self: false, generatedAt: now,
        ...Object.fromEntries(Object.entries(overrides).filter(([k]) => !['bookmark', 'container'].includes(k))),
    };
}


/** Another Docker host answered on top of the local mock: the strip of host tabs, its container list, its status. */
const PI = 'd_0123456789ab';
const REMOTE_CONTAINERS = [
    row('pihole', { image: 'pihole/pihole', ports: [{ private: 80, public: 8081, type: 'tcp' }] }),
    row('redis', { image: 'redis:7', state: 'exited', status: 'Exited (0) 1 hour ago' }),
];
const PIHOLE_URL = 'http://10.0.0.2:8081/admin';
async function mockRemoteHost(page) {
    const state = { requests: [] };
    await page.route('**/api/docker/**', async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace('/api/docker', '');
        const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
        if (path === '/hosts') {
            return json({ max: 4, hosts: [{ id: PI, name: 'pi', kind: 'tcp', address: '10.0.0.2:2375', allowActions: true, hasCA: false, hasCert: false, hasKey: false }] });
        }
        const host = url.searchParams.get('host');
        if (!host) return route.fallback();
        state.requests.push(`${route.request().method()} ${path}?host=${host}`);
        if (path === '/status') return json({ socket: true, control: true, reason: '', self: '', selfName: '', writeToken: false, host });
        if (path === '/updates') return json({ checkedAt: null, images: {} });
        if (path === '/containers') return json({ available: true, containers: REMOTE_CONTAINERS, usageEnabled: false, host });
        const one = path.match(/^\/containers\/([^/]+)$/);
        const found = one && REMOTE_CONTAINERS.find((c) => c.name === decodeURIComponent(one[1]));
        if (found) {
            return json({ ...found, startedAt: '2026-09-20T10:00:00Z', restartPolicy: 'always', mounts: [], networks: [], envNames: [], version: '', source: '', updateHistory: [] });
        }
        return json({ reason: 'not-found' }, 404);
    });
    return state;
}

/** What GET /api/service answers for a container on another host: no local timeline, and it says so. */
function remoteBody(u) {
    const host = u.searchParams.get('host');
    if (!host) return body();
    const name = u.searchParams.get('container');
    return body({
        bookmark: u.searchParams.get('url') ? undefined : { found: false },
        container: { name, image: `x/${name}`, state: 'running', ports: [{ private: 80, public: 8081, type: 'tcp' }] },
        host, timelinePartial: 'local-only', control: true,
        timeline: [{ at: now - 1000_000, source: 'release', kind: 'release', detail: 'v6.0' }],
    });
}

/** Opens the app on `hash` with Docker and the bookmarks mocked, and /api/service answered by `answer`. */
async function open(page, hash, { answer = body, docker = {}, remote = false, bookmarks = BOOKMARKS } = {}) {
    const state = await mockDocker(page, { containers: CONTAINERS.map((c) => ({ ...c })), ...docker });
    if (remote) state.remote = await mockRemoteHost(page);
    state.service = [];
    state.requests = [];
    page.on('request', (req) => state.requests.push(req.url()));
    await page.route((url) => url.pathname === '/api/bookmarks' && url.searchParams.get('all') === 'true',
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bookmarks) }));
    await page.route('**/api/service**', (route) => {
        const u = new URL(route.request().url());
        state.service.push(u.search);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(u)) });
    });
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    return state;
}

const view = (page) => page.locator('#app-modal.show .service-view');
/** The title bar: the name, the address and the actions. */
const bar = (page) => page.locator('#app-modal.show .modal.service-modal .modal-header');
const dialog = (page) => page.locator('#app-modal.show .modal.service-modal');
const deep = (url = SONARR_URL, page = 1) => `#service?url=${encodeURIComponent(url)}&page=${page}`;
const deepPihole = () => `#service?url=${encodeURIComponent(PIHOLE_URL)}&page=1`;

async function ready(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The page's own bookmarks have loaded (and written their address) before a key is pressed.
    await page.locator('.bookmark-link').first().waitFor({ timeout: 15_000 });
}

test.describe('the Service overview', () => {
    test('a deep link on a bookmark opens it, and the container is found by the page', async ({ page }) => {
        const state = await open(page, deep());
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#modal-title')).toContainText('Sonarr');
        await expect(view(page).locator('[data-service-section="health"]')).toContainText('99.91%');
        await expect(view(page).locator('[data-service-section="container"]')).toContainText('x/sonarr');
        await expect(view(page).locator('[data-service-section="timeline"] li')).toHaveCount(3);
        await expect(view(page).locator('[data-service-hero]')).toContainText('All good');
        await expect(view(page).locator('[data-service-detail]')).toContainText('Web up');
        await expect(view(page).locator('[data-service-kpi="uptime"]')).toContainText('99.91%');
        // The browser worked out which container: the request names it.
        await expect.poll(() => state.service.some((q) => q.includes('container=sonarr') && q.includes('page=1'))).toBe(true);
    });

    test('a deep link on a container finds its bookmark', async ({ page }) => {
        const state = await open(page, '#service?container=sonarr');
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => state.service.some((q) => q.includes(`url=${encodeURIComponent(SONARR_URL)}`) && q.includes('container=sonarr'))).toBe(true);
    });

    test('the button in the Bookmarks panel opens it over the Bookmarks view; Esc closes and focus returns', async ({ page }) => {
        await open(page, '#docker');
        await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible({ timeout: 15_000 });
        // The mark beside the container opens its bookmark in the Bookmarks view, its panel on Details.
        await page.locator('[data-docker-row="sonarr"] [data-docker-bm-dot]').click();
        await expect(page.locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-key', `1::${SONARR_URL}`, { timeout: 15_000 });
        const opener = page.locator('#config-bm-panel [data-bm-panel-action="service"]');
        await opener.focus();
        const hashBefore = await page.evaluate(() => location.hash);
        await opener.click();
        await expect(view(page)).toBeVisible();
        await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('.modal.service-modal[role="dialog"]')).toHaveCount(1);
        await expect(page).toHaveURL(/#service\?url=/);
        // The panel is still under it.
        await expect(page.locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-key', `1::${SONARR_URL}`);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => location.hash)).toBe(hashBefore);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
        await expect(page.locator('#config-bm-panel')).toBeVisible();
        await expect(opener).toBeFocused();
    });

    test('the button in the container drawer opens it over Containers; the browser Back closes it', async ({ page }) => {
        await open(page, '#docker/sonarr');
        const drawer = page.locator('[data-docker-drawer]');
        await expect(drawer).toContainText('sonarr', { timeout: 15_000 });
        await drawer.locator('[data-slp-action="service"]').click();
        await expect(view(page)).toBeVisible();
        await expect(page).toHaveURL(/#service\?container=sonarr/);
        await page.goBack();
        await expect(dialog(page)).toHaveCount(0);
        await expect(page).toHaveURL(/#docker\/sonarr/);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('docker');
        await expect(page.locator('[data-docker-drawer]')).toContainText('sonarr');
        await expect.poll(() => page.evaluate(() => window.ScrollLock.isLocked())).toBe(false);
    });

    test(':service finds a bookmark and opens its popover over the dashboard', async ({ page }) => {
        await open(page, '');
        await ready(page);
        const viewBefore = await page.evaluate(() => window.dashboardInstance.activeView);
        await page.keyboard.press('>');
        await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
        await page.keyboard.type(':service sonarr');
        const hit = page.locator('.search-match', { hasText: /Sonarr — Service overview/ });
        await expect(hit).toBeVisible();
        await hit.click();
        await expect(view(page)).toBeVisible();
        await expect(page).toHaveURL(/#service\?url=/);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe(viewBefore);
    });

    test('a deep link opens it over the active view; the close button and the backdrop close it and drop the hash', async ({ page }) => {
        await open(page, deep());
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('service');
        await expect(page.locator('[data-service-close]')).toBeVisible();
        await page.locator('[data-service-close]').click();
        await expect(dialog(page)).toHaveCount(0);
        expect(await page.evaluate(() => location.hash.startsWith('#service'))).toBe(false);
        // Again, and this time the backdrop beside the panel.
        await page.evaluate((h) => { location.hash = h; }, deep());
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await page.locator('#app-modal.show').click({ position: { x: 4, y: 4 } });
        await expect(dialog(page)).toHaveCount(0);
        expect(await page.evaluate(() => location.hash.startsWith('#service'))).toBe(false);
    });

    test('Escape closes it, releases the scroll lock and stops every request', async ({ page }) => {
        const state = await open(page, deep());
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.ScrollLock.isLocked())).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.ScrollLock.isLocked())).toBe(false);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.service?.instance?._poll ?? null)).toBeNull();
        // Absence check: no refetch after close, however the live channel pings.
        const before = state.service.length;
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:health')));
        // Absence check: the refetch is coalesced for one second, so wait longer than that.
        await page.waitForTimeout(1500);
        expect(state.service.length).toBe(before);
    });
});

test.describe('empty states', () => {
    test('a bare bookmark says it is not monitored and collapses what is missing into one card', async ({ page }) => {
        await open(page, deep('https://plain.example.com/'), {
            answer: () => body({ bookmark: { name: 'Plain site', url: 'https://plain.example.com/', checkMode: 'off', monitor: null }, container: null, checks: [], days: [], timeline: [], docker: { available: false } }),
        });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(view(page).locator('[data-service-hero]')).toContainText('Not monitored yet');
        await expect(view(page).locator('[data-service-kpis]')).toHaveCount(0);
        // Only the note card is a section of its own; the rest is rows of one card.
        for (const key of ['container', 'health', 'releases', 'timeline']) {
            await expect(view(page).locator(`[data-service-section="${key}"]`)).toHaveCount(0);
        }
        await expect(view(page).locator('[data-service-section="setup"]')).toHaveCount(1);
        await expect(view(page).locator('[data-service-action="turn-on-checking"]')).toBeVisible();
        await expect(view(page).locator('[data-service-action="follow-feed"]')).toBeVisible();
        // No socket: no row for a container.
        await expect(view(page).locator('[data-service-action="choose-container"]')).toHaveCount(0);
        await expect(view(page).locator('[data-service-note]')).toHaveAttribute('placeholder', 'No note yet.');
        await expect(view(page).locator('.service-empty')).toHaveCount(0);
    });

    test('a container without a bookmark offers to link one and has no note', async ({ page }) => {
        await open(page, '#service?container=lonely', {
            answer: () => body({ bookmark: { found: false }, container: { name: 'lonely', image: 'x/lonely' }, checks: [], days: [], timeline: [] }),
        });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(view(page).locator('[data-service-action="link-bookmark"]')).toBeVisible();
        await expect(view(page).locator('[data-service-section="health"]')).toHaveCount(0);
        await expect(view(page).locator('[data-service-section="container"]')).toContainText('x/lonely');
        await expect(bar(page).locator('[data-service-action="open"]')).toHaveCount(0);
        // No bookmark, no note: the page keeps no note of its own.
        await expect(view(page).locator('[data-service-section="note"]')).toHaveCount(0);
    });

    test('an incident leads with the time and the key figures show the last 24 hours', async ({ page }) => {
        await open(page, deep(), {
            answer: () => body({ bookmark: { brokenSince: now - 600_000, status: 'offline',
                monitor: { uptime24h: { ratio: 0.979, samples: 30 }, uptime7d: { ratio: 0.99, samples: 200 }, uptime30d: { ratio: 0.999, samples: 800 }, downSince: now - 600_000, totalChecks: 800 } } }),
        });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(view(page).locator('[data-service-headline]')).toContainText('Incident since');
        await expect(view(page).locator('[data-service-hero]')).toHaveAttribute('data-tone', 'bad');
        await expect(view(page).locator('[data-service-kpi="uptime"]')).toContainText('97.9%');
    });

    test('the dialog is as tall as its content, not a fixed 90vh', async ({ page }) => {
        await open(page, deep('https://plain.example.com/'), {
            answer: () => body({ bookmark: { name: 'Plain site', url: 'https://plain.example.com/', checkMode: 'off', monitor: null }, container: null, checks: [], days: [], timeline: [], docker: { available: false } }),
        });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(view(page).locator('[data-service-hero]')).toBeVisible();
        const box = await dialog(page).boundingBox();
        const vh = await page.evaluate(() => window.innerHeight);
        expect(box.height).toBeLessThan(vh * 0.8);
    });
});

test.describe('who gets action buttons', () => {
    test('none without control', async ({ page }) => {
        await open(page, deep(), { answer: () => body({ control: false }) });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(bar(page).locator('[data-service-action="container-panel"]')).toBeVisible();
        await expect(bar(page).locator('[data-service-control]')).toHaveCount(0);
    });

    test('Restart with control', async ({ page }) => {
        const state = await open(page, deep(), { answer: () => body({ control: true }) });
        await expect(bar(page).locator('[data-service-control="restart"]')).toBeVisible({ timeout: 15_000 });
        await bar(page).locator('[data-service-control="restart"]').click();
        await expect.poll(() => state.calls).toContain('POST /containers/sonarr/restart');
    });

    test('Update asks first, and the page is still there after the answer, on its own history entry', async ({ page }) => {
        const state = await open(page, deep(), { answer: () => body({ control: true }) });
        await expect(bar(page).locator('[data-service-control="update"]')).toBeVisible({ timeout: 15_000 });
        const hash = await page.evaluate(() => location.hash);
        await bar(page).locator('[data-service-control="update"]').click();
        // The question is the app modal: it replaced the page's dialog for a moment.
        const ask = page.locator('#app-modal.show .modal:not(.service-modal)');
        await expect(ask).toBeVisible();
        await expect(ask).toContainText('Update sonarr');
        await ask.locator('.modal-button', { hasText: 'Cancel' }).click();
        await expect(view(page)).toBeVisible();
        expect(state.calls).not.toContain('POST /containers/sonarr/update');
        expect(await page.evaluate(() => location.hash)).toBe(hash);
        // Asked again and accepted: the update runs and the page is back.
        await bar(page).locator('[data-service-control="update"]').click();
        await ask.locator('.modal-button', { hasText: 'Update' }).click();
        await expect.poll(() => state.calls.some((c) => c.startsWith('POST /containers/sonarr/update'))).toBe(true);
        await expect(view(page)).toBeVisible();
        expect(await page.evaluate(() => location.hash)).toBe(hash);
        // One entry: Esc closes it and the address goes back to what it was before.
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => location.hash.startsWith('#service'))).toBe(false);
        await expect.poll(() => page.evaluate(() => window.ScrollLock.isLocked())).toBe(false);
    });

    test('Stop asks first when Config says so, and keeps the page', async ({ page }) => {
        const state = await open(page, deep(), { answer: () => body({ control: true }) });
        await page.waitForFunction(() => window.dashboardInstance?.settings, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.dockerConfirmStopRestart = true; });
        await expect(bar(page).locator('[data-service-control="stop"]')).toBeVisible({ timeout: 15_000 });
        await bar(page).locator('[data-service-control="stop"]').click();
        const ask = page.locator('#app-modal.show .modal:not(.service-modal)');
        await expect(ask).toBeVisible();
        await ask.locator('.modal-button', { hasText: 'Cancel' }).click();
        await expect(view(page)).toBeVisible();
        expect(state.calls).not.toContain('POST /containers/sonarr/stop');
    });

    test('never for the container nextDash runs in', async ({ page }) => {
        await open(page, '#service?container=nextdash', {
            answer: () => body({ bookmark: { found: false }, container: { name: 'nextdash', image: 'x/nextdash', self: true }, control: true, self: true }),
        });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect(bar(page).locator('[data-service-action="container-panel"]')).toBeVisible();
        await expect(bar(page).locator('[data-service-control]')).toHaveCount(0);
    });
});

test('opening the page never asks for the changelog', async ({ page }) => {
    const state = await open(page, deep());
    await expect(view(page).locator('[data-service-section="container"]')).toBeVisible({ timeout: 15_000 });
    // Give anything that was going to fire time to.
    await page.waitForTimeout(500);
    expect(state.requests.filter((u) => /\/changelog/.test(u))).toEqual([]);
    expect(state.calls.filter((c) => c.includes('changelog'))).toEqual([]);
});

test('the live channel\'s ping fetches the page again', async ({ page }) => {
    const state = await open(page, deep());
    await expect(view(page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => state.service.length).toBeGreaterThan(0);
    const before = state.service.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:health')));
    await expect.poll(() => state.service.length, { timeout: 5_000 }).toBeGreaterThan(before);
});

test('livechannel:docker fetches the page again, and a closed popover listens to nothing', async ({ page }) => {
    const state = await open(page, deep());
    await expect(view(page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => state.service.length).toBeGreaterThan(0);
    const before = state.service.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:docker')));
    await expect.poll(() => state.service.length, { timeout: 5_000 }).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    const closed = state.service.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:docker')));
    // A ping that fetches again would do so within the one-second coalescing window.
    await page.waitForTimeout(1800);
    expect(state.service.length).toBe(closed);
});

// The channel's own event: the server's "docker" ping becomes the DOM event, and
// "health" still does what it did. A stand-in EventSource, since the real server
// has no Docker socket here to raise one.
test('the live channel turns a docker ping into livechannel:docker and leaves health alone', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.addInitScript(() => {
        window.__sources = [];
        window.EventSource = class {
            constructor() { this.listeners = {}; this.readyState = 1; window.__sources.push(this); }
            addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
            close() { this.readyState = 2; }
            emit(type) { (this.listeners[type] || []).forEach((fn) => fn({})); }
        };
        window.__events = { docker: 0, health: 0 };
        window.addEventListener('livechannel:docker', () => { window.__events.docker += 1; });
        window.addEventListener('livechannel:health', () => { window.__events.health += 1; });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.__sources.length > 0, null, { timeout: 15_000 });
    await page.evaluate(() => { window.__sources.at(-1).emit('docker'); window.__sources.at(-1).emit('docker'); });
    await expect.poll(() => page.evaluate(() => window.__events.docker), { timeout: 5_000 }).toBe(1);
    expect(await page.evaluate(() => window.__events.health)).toBe(0);
    await page.evaluate(() => window.__sources.at(-1).emit('health'));
    await expect.poll(() => page.evaluate(() => window.__events.health), { timeout: 5_000 }).toBe(1);
    expect(await page.evaluate(() => window.__events.docker)).toBe(1);
});

// The channel's own ping, not a stand-in for it: a health write on the server
// reaches the page as the event the Service overview listens to.
test('a health write reaches the page as livechannel:health', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.addInitScript(() => {
        window.__healthEvents = 0;
        window.addEventListener('livechannel:health', () => { window.__healthEvents += 1; });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.LiveChannel?.connected === true, null, { timeout: 15_000 });
    const target = await page.evaluate(() => {
        const d = window.dashboardInstance;
        return { pageId: d.currentPageId ?? d.pages[0].id, url: d.bookmarks[0]?.url };
    });
    expect(target.url).toBeTruthy();
    // The real store: the bookmark's state is put back afterwards (online, or offline with its old error).
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    const before = await page.evaluate(async ({ pageId, url }) => {
        const list = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
        const b = list.find((x) => x.url === url) || {};
        return { down: Number(b.brokenSince) > 0, error: b.lastError || '' };
    }, target);
    const record = (status, error) => page.request.post('/api/health/statuses', {
        headers, data: { pageId: target.pageId, results: [{ url: target.url, status, error }] },
    });
    try {
        const res = await record('offline', 'timeout');
        expect(res.ok()).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__healthEvents), { timeout: 10_000 }).toBeGreaterThan(0);
    } finally {
        await (before.down ? record('offline', before.error) : record('online', ''));
    }
});

test.describe('phase 2: logs, releases, note, stats', () => {
    const logsLine = (m) => JSON.stringify({ t: '2026-11-23T10:00:00.000000000Z', s: 'out', m }) + '\n';

    test('logs load after the strip is opened, with the write token header', async ({ page }) => {
        const state = await open(page, deep());
        const seen = [];
        await page.route('**/api/docker/containers/sonarr/logs/stream**', (route) => {
            const token = route.request().headers()['x-nextdash-token'];
            seen.push(token || '');
            if (token !== WRITE_TOKEN) return route.fulfill({ status: 401, body: 'token' });
            return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: logsLine('hello from sonarr') });
        });
        await expect(view(page).locator('[data-service-section="logs"]')).toBeVisible({ timeout: 15_000 });
        // Absence check: the logs must not be asked for until the strip is opened.
        await page.waitForTimeout(400);
        expect(seen).toEqual([]);
        expect(state.requests.filter((u) => /logs\/stream/.test(u))).toEqual([]);
        await view(page).locator('[data-service-action="open-logs"]').click();
        await expect(view(page).locator('[data-logs-body]')).toContainText('hello from sonarr', { timeout: 10_000 });
        expect(seen).toEqual([WRITE_TOKEN]);
    });

    test('without the token the strip says logs need it', async ({ page }) => {
        await open(page, deep());
        await page.route('**/api/docker/containers/sonarr/logs/stream**', (route) => {
            const token = route.request().headers()['x-nextdash-token'];
            return token ? route.fulfill({ status: 200, body: logsLine('leaked') })
                : route.fulfill({ status: 401, body: 'token' });
        });
        await expect(view(page).locator('[data-service-section="logs"]')).toBeVisible({ timeout: 15_000 });
        await page.evaluate(() => document.querySelector('meta[name="nextdash-write-token"]')?.remove());
        await view(page).locator('[data-service-action="open-logs"]').click();
        await expect(view(page).locator('[data-service-logs-message]')).toHaveText('Logs need the write token');
        await expect(view(page).locator('[data-logs-body]')).toHaveCount(0);
    });

    test('GitHub releases come only after the button, and stay through a live refresh', async ({ page }) => {
        const state = await open(page, deep());
        await expect(view(page).locator('[data-service-action="github-releases"]')).toBeVisible({ timeout: 15_000 });
        // Absence check: GitHub must not be asked for until the button is clicked.
        await page.waitForTimeout(400);
        expect(state.requests.filter((u) => /\/changelog/.test(u))).toEqual([]);
        await view(page).locator('[data-service-action="github-releases"]').click();
        await expect(view(page).locator('[data-service-changes]')).toContainText('4.0.10');
        expect(state.requests.filter((u) => /\/changelog/.test(u))).toHaveLength(1);
        const before = state.service.length;
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:health')));
        await expect.poll(() => state.service.length, { timeout: 5_000 }).toBeGreaterThan(before);
        await expect(view(page).locator('[data-service-changes]')).toContainText('4.0.10');
        expect(state.requests.filter((u) => /\/changelog/.test(u))).toHaveLength(1);
    });

    test('a rate limit shows its reason', async ({ page }) => {
        await open(page, deep());
        await page.route('**/api/docker/containers/sonarr/changelog', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ releases: [], reason: 'rate-limited', links: [] }) }));
        await view(page).locator('[data-service-action="github-releases"]').click();
        await expect(view(page).locator('[data-service-changes]')).toContainText('GitHub is limiting requests');
    });

    test('editing the note sends the PATCH with only the note', async ({ page }) => {
        await open(page, deep());
        const patches = [];
        await page.route((url) => url.pathname === '/api/bookmarks' && url.searchParams.get('page') === '1' && !url.searchParams.has('all'),
            (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOOKMARKS) }));
        await page.route((url) => url.pathname === '/api/bookmarks', (route) => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            patches.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"updated":1}' });
        });
        const note = view(page).locator('[data-service-note]');
        await expect(note).toBeVisible({ timeout: 15_000 });
        await note.fill('Runs behind the proxy');
        await note.blur();
        await expect.poll(() => patches.length).toBe(1);
        expect(patches[0].page).toBe(1);
        expect(patches[0].updates).toHaveLength(1);
        expect(patches[0].updates[0].url).toBe(SONARR_URL);
        expect(Object.keys(patches[0].updates[0].fields)).toEqual(['note']);
        expect(patches[0].updates[0].fields.note).toBe('Runs behind the proxy');
        // Unchanged text on the next blur sends nothing.
        await note.focus();
        await note.blur();
        // Absence check: an unchanged note must send no second PATCH.
        await page.waitForTimeout(300);
        expect(patches).toHaveLength(1);
    });

    test('a note that was not saved says so', async ({ page }) => {
        await open(page, deep());
        await page.route((url) => url.pathname === '/api/bookmarks' && url.searchParams.get('page') === '1' && !url.searchParams.has('all'),
            (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOOKMARKS) }));
        await page.route((url) => url.pathname === '/api/bookmarks', (route) => (route.request().method() === 'PATCH'
            ? route.fulfill({ status: 500, body: 'no' }) : route.fallback()));
        const note = view(page).locator('[data-service-note]');
        await expect(note).toBeVisible({ timeout: 15_000 });
        await note.fill('x');
        await note.blur();
        await expect(view(page).locator('.service-note-status')).toHaveText('Not saved — retry');
    });

    test('the note is still there after a reload', async ({ page }) => {
        // The real store: a bookmark of the e2e data, restored afterwards.
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        const target = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const pageId = d.currentPageId ?? d.pages[0].id;
            const list = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
            return { pageId, index: 0, url: list[0].url, name: list[0].name, note: list[0].note || '' };
        });
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        const restore = () => page.request.patch('/api/bookmarks', { headers,
            data: { page: target.pageId, updates: [{ url: target.url, occurrence: 0, fields: { note: target.note } }] } });
        const answer = () => body({ bookmark: { url: target.url, name: target.name, pageId: target.pageId, index: 0, note: target.note },
            container: null, docker: { available: false } });
        const mine = `service page note ${Date.now()}`;
        try {
            await page.route('**/api/service**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer()) }));
            await page.goto(`/${deep(target.url, target.pageId)}`);
            const note = view(page).locator('[data-service-note]');
            await expect(note).toBeVisible({ timeout: 15_000 });
            await note.fill(mine);
            const saved = page.waitForResponse((r) => r.url().endsWith('/api/bookmarks') && r.request().method() === 'PATCH');
            await note.blur();
            expect((await saved).ok()).toBe(true);
            await page.reload();
            const stored = await page.evaluate(async ({ pageId, url }) => {
                const list = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
                return list.find((b) => b.url === url)?.note;
            }, target);
            expect(stored).toBe(mine);
        } finally {
            await restore();
        }
    });

    test('stats draw a sparkline once the container section is in view', async ({ page }) => {
        const state = await open(page, deep());
        const stats = [];
        await page.route('**/api/docker/containers/sonarr/stats**', (route) => {
            stats.push(new URL(route.request().url()).search);
            const t = Date.now();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                cpuPercent: 3.2, memoryUsed: 262144000, memoryLimit: 8589934592, historyEnabled: true,
                history: [{ t: t - 120_000, cpu: 1 }, { t: t - 60_000, cpu: 4 }] }) });
        });
        await expect(view(page).locator('[data-service-stats]')).toContainText('CPU 3.2%', { timeout: 15_000 });
        await expect(view(page).locator('[data-service-stats] .service-spark-line')).toHaveCount(1);
        expect(stats[0]).toBe('?history=1');
        expect(stats.length).toBe(1);
        // No stats call at all for a container that is not running.
        void state;
    });

    test('a stopped container is not polled', async ({ page }) => {
        await open(page, deep(), { answer: () => body({ container: { state: 'exited' } }) });
        const stats = [];
        await page.route('**/api/docker/containers/sonarr/stats**', (route) => { stats.push(1); return route.fulfill({ status: 200, body: '{}' }); });
        await expect(view(page).locator('[data-service-section="container"]')).toBeVisible({ timeout: 15_000 });
        // Absence check: a stopped container must never be polled.
        await page.waitForTimeout(600);
        expect(stats).toEqual([]);
    });
});

test.describe('the row letter l opens the popover for the selected dashboard bookmark', () => {
    test('with the keyboard cursor on a bookmark it opens; Esc closes it again', async ({ page }) => {
        await open(page, '');
        await ready(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('l');
        await expect(view(page)).toBeVisible();
        await expect(page).toHaveURL(/#service\?url=/);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
    });

    test('with nothing selected the letter does nothing', async ({ page }) => {
        const state = await open(page, '');
        await ready(page);
        await page.keyboard.press('l');
        // Absence check: no popover and no request for one.
        await page.waitForTimeout(500);
        await expect(dialog(page)).toHaveCount(0);
        expect(state.service).toEqual([]);
    });

    test('the Containers menu has a Service entry without a key label', async ({ page }) => {
        await open(page, '#docker');
        const rowEl = page.locator('[data-docker-row="sonarr"]');
        await expect(rowEl).toBeVisible({ timeout: 15_000 });
        await rowEl.click({ button: 'right' });
        const item = page.locator('#docker-row-menu [data-docker-menu-action="service"]');
        await expect(item).toBeVisible();
        await expect(item.locator('kbd')).toHaveCount(0);
        await item.click();
        await expect(view(page)).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('docker');
    });

    test('a remote host has the Service entry now, and the popover names that host', async ({ page }) => {
        const state = await open(page, '#docker', { remote: true, answer: remoteBody });
        await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible({ timeout: 15_000 });
        await page.locator(`[data-docker-host="${PI}"]`).click();
        const rowEl = page.locator('[data-docker-row="pihole"]');
        await expect(rowEl).toBeVisible();
        await rowEl.click({ button: 'right' });
        await page.locator('#docker-row-menu [data-docker-menu-action="service"]').click();
        await expect(view(page)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#service\\?container=pihole&host=${PI}`));
        await expect.poll(() => state.service.some((q) => q.includes('container=pihole') && q.includes(`host=${PI}`))).toBe(true);
        // One line says why the timeline is short; the host row names the machine.
        await expect(view(page).locator('[data-service-timeline-partial]')).toContainText('Timeline only for this host');
        await expect(view(page).locator('[data-service-section="container"]')).toContainText('pi');
        await expect(view(page).locator('[data-service-section="container"]')).not.toContainText('local');
        // Actions on another host are driven from its tab in Containers, not from here.
        await expect(bar(page).locator('[data-service-control]')).toHaveCount(0);
        // "Open in Containers" goes back to that host's tab with the container selected.
        await view(page).locator('[data-service-action="open-in-containers"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator(`[data-docker-host="${PI}"]`)).toHaveAttribute('aria-selected', 'true');
    });

    test('a deep link on a container of another host asks that host, not this one', async ({ page }) => {
        const state = await open(page, `#service?container=pihole&host=${PI}`, { remote: true, answer: remoteBody, bookmarks: [...BOOKMARKS, { name: 'Pi-hole', url: PIHOLE_URL, pageId: 1, category: 'c1' }] });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        // Its bookmark is found against the host's own address (10.0.0.2), not this server's.
        await expect.poll(() => state.service.some((q) => q.includes(`url=${encodeURIComponent(PIHOLE_URL)}`) && q.includes('container=pihole') && q.includes(`host=${PI}`))).toBe(true);
        expect(state.remote.requests).toContain(`GET /containers?host=${PI}`);
    });

    test('a bookmark whose container runs on another host finds it there', async ({ page }) => {
        const state = await open(page, deepPihole(), { remote: true, answer: remoteBody, bookmarks: [...BOOKMARKS, { name: 'Pi-hole', url: PIHOLE_URL, pageId: 1, category: 'c1' }] });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => state.service.some((q) => q.includes('container=pihole') && q.includes(`host=${PI}`))).toBe(true);
    });

    test('a bookmark that has its container at home never asks another host', async ({ page }) => {
        const state = await open(page, deep(), { remote: true });
        await expect(view(page).locator('[data-service-section="container"]')).toBeVisible({ timeout: 15_000 });
        expect(state.remote.requests.filter((r) => r.includes('/containers?'))).toEqual([]);
    });

    test('without any other host nothing is asked of one', async ({ page }) => {
        const state = await open(page, deep());
        await expect(view(page).locator('[data-service-section="container"]')).toBeVisible({ timeout: 15_000 });
        expect(state.requests.filter((u) => /host=/.test(u))).toEqual([]);
    });
});

test.describe('the link of a container on another host', () => {
    test('is stored under hostId::name, and the bare name stays this host\'s', async ({ page }) => {
        const state = await open(page, '#docker', { remote: true, bookmarks: [...BOOKMARKS, { name: 'Pi-hole', url: PIHOLE_URL, pageId: 1, category: 'c1' }] });
        const saved = [];
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            saved.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible({ timeout: 15_000 });
        await page.locator(`[data-docker-host="${PI}"]`).click();
        await page.locator('[data-docker-row="pihole"] .docker-name').click();
        const drawer = page.locator('[data-docker-drawer]');
        await drawer.locator('[data-docker-section="bookmark"] summary').click();
        // Found on the host's own address, by port.
        await expect(drawer.locator('[data-docker-bm-card]')).toContainText('Pi-hole');
        await drawer.locator('[data-docker-bm-link]').selectOption('-');
        await expect.poll(() => saved.some((b) => b.dockerBookmarkLinks?.[`${PI}::pihole`] === '-')).toBe(true);
        expect(saved.some((b) => b.dockerBookmarkLinks && 'pihole' in b.dockerBookmarkLinks)).toBe(false);
        expect(state.remote.requests.length).toBeGreaterThan(0);
    });
});

test.describe('history, hosts and refreshes', () => {
    test('Container panel on Containers leaves the address and the drawer in agreement', async ({ page }) => {
        await open(page, '#docker/sonarr', {
            answer: () => body({ bookmark: { found: false }, container: { name: 'lonely', image: 'x/lonely' }, checks: [], days: [], timeline: [] }),
        });
        await expect(page.locator('[data-docker-drawer]')).toContainText('sonarr', { timeout: 15_000 });
        // The popover for another container, over the drawer of this one.
        await page.evaluate(() => window.dashboardInstance.service.openServiceView({ container: 'lonely' }));
        await expect(view(page)).toBeVisible();
        await bar(page).locator('[data-service-action="container-panel"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('[data-docker-drawer]')).toContainText('lonely');
        await expect(page).toHaveURL(/#docker\/lonely$/);
        // Nothing queued behind it that rewrites the address later.
        await page.waitForTimeout(900);
        await expect(page).toHaveURL(/#docker\/lonely$/);
        await expect(page.locator('[data-docker-drawer]')).toContainText('lonely');
    });

    test('over a remote Containers tab a local container still finds its bookmark and keeps Update', async ({ page }) => {
        const state = await open(page, '#docker', { remote: true, answer: (u) => (u.searchParams.get('host') ? remoteBody(u) : body({ control: true })) });
        await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible({ timeout: 15_000 });
        await page.locator(`[data-docker-host="${PI}"]`).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await page.evaluate(() => window.dashboardInstance.service.openServiceView({ container: 'sonarr' }));
        await expect(view(page)).toBeVisible();
        // Matched on this server's address, not the remote host's (10.0.0.2).
        await expect.poll(() => state.service.some((q) => q.includes(`url=${encodeURIComponent(SONARR_URL)}`) && q.includes('container=sonarr') && !q.includes('host='))).toBe(true);
        await expect(bar(page).locator('[data-service-control="update"]')).toBeVisible();
    });

    test('a plain refresh does not work out who this is again; a container event does', async ({ page }) => {
        const state = await open(page, deep());
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => state.service.length).toBeGreaterThan(0);
        await page.evaluate(() => {
            window.__resolves = 0;
            const index = window.DockerSearchIndex;
            const refresh = index.refresh;
            index.refresh = (...args) => { window.__resolves += 1; return refresh.apply(index, args); };
        });
        const before = state.service.length;
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:health')));
        await expect.poll(() => state.service.length, { timeout: 5_000 }).toBeGreaterThan(before);
        expect(await page.evaluate(() => window.__resolves)).toBe(0);
        const mid = state.service.length;
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('livechannel:docker')));
        await expect.poll(() => state.service.length, { timeout: 5_000 }).toBeGreaterThan(mid);
        expect(await page.evaluate(() => window.__resolves)).toBeGreaterThan(0);
    });

    test('a kept (Unsorted) bookmark gets its container linked', async ({ page }) => {
        const state = await open(page, '#service?container=sonarr', {
            bookmarks: [{ name: 'Sonarr', url: SONARR_URL, pageId: 999999, category: 'c1' }],
        });
        await expect(view(page)).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => state.service.some((q) => q.includes(`url=${encodeURIComponent(SONARR_URL)}`) && q.includes('container=sonarr'))).toBe(true);
    });

    test('forward onto the popover, then closing it, keeps its history entry', async ({ page }) => {
        await open(page, '');
        await ready(page);
        const start = await page.evaluate(() => location.href);
        await page.evaluate((h) => window.dashboardInstance.service.openServiceView({ url: h, page: 1 }), SONARR_URL);
        await expect(view(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => location.href)).toBe(start);
        // Forward lands on its entry again: the popover opens from the address.
        await page.goForward();
        await expect(view(page)).toBeVisible({ timeout: 10_000 });
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => location.href)).toBe(start);
        // The entry was not rewritten into the dashboard's address: Forward still has it.
        await page.goForward();
        await expect(view(page)).toBeVisible({ timeout: 10_000 });
    });
});
