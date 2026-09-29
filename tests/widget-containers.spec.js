// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
} = require('./e2e-helpers');

/**
 * The container list: the containers themselves, one row each.
 *
 * The containers widget counts; this one names. One column on a tile one wide,
 * two on a tile two wide, and a "more" row for what did not fit. What it
 * shows, in which order, and where a click goes are the widget's settings.
 *
 * /api/docker/containers is mocked, so the rows are exactly these.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;
const DAY = 24 * HOUR;

function container(name, fields = {}) {
    return {
        id: `${name}-id`, shortId: name.slice(0, 12), name, image: `lscr.io/${name}:latest`, tag: 'latest',
        state: 'running', status: 'Up 2 days', health: '', created: NOW - 10 * DAY,
        startedAt: NOW - 2 * DAY, ports: [], ...fields,
    };
}

/** Sixteen containers: fourteen up, two stopped, one of the running unhealthy, one with an update. */
const FLEET = [
    container('adguard', { startedAt: NOW - 3 * DAY, status: 'Up 3 days' }),
    container('bazarr', { startedAt: NOW - 5 * HOUR, status: 'Up 5 hours' }),
    container('calibre', { state: 'exited', status: 'Exited (0) 2 hours ago', startedAt: undefined }),
    container('duplicati', { startedAt: NOW - 20 * DAY, status: 'Up 2 weeks' }),
    container('emby', { startedAt: NOW - 7 * HOUR, status: 'Up 7 hours' }),
    container('frigate', { startedAt: NOW - 60, status: 'Up About a minute' }),
    container('gitea', { startedAt: NOW - 9 * DAY, status: 'Up 9 days' }),
    container('homeassistant', { startedAt: NOW - 4 * DAY, status: 'Up 4 days', webui: 'http://ha.lan:8123/' }),
    container('immich', { startedAt: NOW - 2 * HOUR, status: 'Up 2 hours' }),
    container('jellyfin', { health: 'unhealthy', status: 'Up 1 hour (unhealthy)', startedAt: NOW - HOUR }),
    container('kavita', { startedAt: NOW - 6 * DAY, status: 'Up 6 days' }),
    container('lidarr', { state: 'exited', status: 'Exited (1) 3 days ago', startedAt: undefined }),
    container('mariadb', { startedAt: NOW - 30 * DAY, status: 'Up 4 weeks' }),
    container('navidrome', { startedAt: NOW - 8 * DAY, status: 'Up 8 days' }),
    container('overseerr', { startedAt: NOW - 12 * HOUR, status: 'Up 12 hours' }),
    container('paperless', { startedAt: NOW - 10 * DAY, status: 'Up 10 days', tag: '2.3',
        update: { status: 'available' } }),
];

async function renderContainers(page, body, config = {}, width = 320) {
    await page.unroute('**/api/docker/containers');
    await page.route('**/api/docker/containers', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
    }));

    return page.evaluate(async ({ cfg, w }) => {
        document.querySelectorAll('.ct-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget ct-probe';
        host.style.cssText = `width:${w}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const el = document.createElement('div');
        el.className = 'dashboard-widget-body';
        host.appendChild(el);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetSystem = {};
        await window.DashboardWidgets.containers(el, { id: 'probe', type: 'containers', config: cfg }, d);

        const shown = (node) => node && node.offsetParent !== null;
        const rows = [...el.querySelectorAll('.dashboard-widget-row:not(.dashboard-widget-row--more)')].filter(shown);
        const more = [...el.querySelectorAll('.dashboard-widget-row--more')].filter(shown);
        const lefts = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left)));
        return {
            text: el.innerText.replace(/\s+/g, ' ').trim(),
            names: rows.map((r) => r.querySelector('.dashboard-widget-row-name')?.textContent || ''),
            details: rows.map((r) => r.querySelector('.dashboard-widget-row-detail')?.textContent || ''),
            columns: lefts.size,
            more: more.map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
        };
    }, { cfg: config, w: width });
}

const LIVE = { available: true, containers: FLEET };

test.describe('the container list widget', () => {
    // Busiest first, with CPU and RAM beside the name: a top three is this
    // sort with three rows.
    test('sorts by CPU or memory and shows the usage beside the name', async ({ page }) => {
        await openDashboard(page);
        const usage = { adguard: [2.5, 80], bazarr: [44.1, 300], duplicati: [12, 1600], emby: [0.4, 40] };
        const fleet = FLEET.map((c) => (usage[c.name] ? { ...c, usage: { cpu: usage[c.name][0], mem: usage[c.name][1] * 1024 * 1024 } } : c));
        const byCpu = await renderContainers(page, { available: true, containers: fleet, usageEnabled: true },
            { sort: 'cpu', detail: 'usage', rows: 3 });
        expect(byCpu.names).toEqual(['bazarr', 'duplicati', 'adguard']);
        expect(byCpu.details[0]).toBe('44.1 % · 300 MiB');
        const byMem = await renderContainers(page, { available: true, containers: fleet, usageEnabled: true },
            { sort: 'memory', detail: 'usage', rows: 3 });
        expect(byMem.names).toEqual(['duplicati', 'bazarr', 'adguard']);
        expect(byMem.details[0]).toBe('12.0 % · 1.6 GiB');
    });

    test('is offered with the system widgets', async ({ page }) => {
        await openDashboard(page);
        // The favicon sweep reopens Overview when it finishes; wait it out.
        await waitForFaviconPrefetch(page);
        await page.evaluate(async () => {
            // Config → Widgets introduces itself once; not what this is about.
            window.DiscoverabilityState?.markTipSeen?.('widgetsTutorialV1');
            await window.dashboardInstance.config.openConfigView('widgets');
        });
        await page.locator('[data-widget-catalogue]').first().click();
        await expect(page.locator('.modal--widget-catalogue [data-widget-add="containers"]')).toBeVisible();
        await expect(page.locator('.modal--widget-catalogue')).toContainText('Container list');
        const offered = await page.evaluate(() => {
            const Config = window.DashboardConfig || window.dashboardInstance.config?.constructor;
            return {
                types: [...(Config?.WIDGET_TYPES || [])],
                system: (Config?.WIDGET_TYPE_GROUPS || []).find(([g]) => g === 'system')?.[1] || [],
                name: window.dashboardInstance.config.widgetTypeName('containers'),
            };
        });
        expect(offered.types).toContain('containers');
        expect(offered.system).toContain('containers');
        expect(offered.name).toBe('Container list');
    });

    test('by default: running only, what needs you first, then by name', async ({ page }) => {
        await openDashboard(page);
        const out = await renderContainers(page, LIVE);
        expect(out.columns).toBe(1);
        expect(out.names).toEqual(['jellyfin', 'paperless', 'adguard', 'bazarr', 'duplicati', 'emby']);
        expect(out.names).not.toContain('calibre');
        // Fourteen running, six shown.
        expect(out.more).toEqual(['8 more']);
        expect(out.text).toContain('14 of 16 running');
    });

    test('two wide, two columns and twice the rows', async ({ page }) => {
        await openDashboard(page);
        const out = await renderContainers(page, LIVE, {}, 640);
        expect(out.columns).toBe(2);
        expect(out.names).toHaveLength(12);
        expect(out.more).toEqual(['2 more']);
    });

    test('rows is per column', async ({ page }) => {
        await openDashboard(page);
        expect((await renderContainers(page, LIVE, { rows: 3 })).names).toHaveLength(3);
        expect((await renderContainers(page, LIVE, { rows: 3 }, 640)).names).toHaveLength(6);
    });

    test('all shows the stopped ones too, among the problems', async ({ page }) => {
        await openDashboard(page);
        const out = await renderContainers(page, LIVE, { show: 'all', rows: 20 });
        expect(out.names).toHaveLength(16);
        expect(out.names.slice(0, 4)).toEqual(['jellyfin', 'calibre', 'lidarr', 'paperless']);
    });

    test('sorts by name, and by uptime either way', async ({ page }) => {
        await openDashboard(page);
        expect((await renderContainers(page, LIVE, { sort: 'name', rows: 3 })).names)
            .toEqual(['adguard', 'bazarr', 'duplicati']);
        expect((await renderContainers(page, LIVE, { sort: 'uptime-long', rows: 3 })).names)
            .toEqual(['mariadb', 'duplicati', 'paperless']);
        expect((await renderContainers(page, LIVE, { sort: 'uptime-short', rows: 3 })).names)
            .toEqual(['frigate', 'jellyfin', 'immich']);
    });

    test('the right of a row: uptime, the tag, or nothing', async ({ page }) => {
        await openDashboard(page);
        const uptime = await renderContainers(page, LIVE, { sort: 'name', rows: 3 });
        expect(uptime.details).toEqual(['3 d', '5 h', '20 d']);
        const tag = await renderContainers(page, LIVE, { sort: 'name', rows: 3, detail: 'tag' });
        expect(tag.details).toEqual(['latest', 'latest', 'latest']);
        const none = await renderContainers(page, LIVE, { sort: 'name', rows: 3, detail: 'none' });
        expect(none.details).toEqual(['', '', '']);
    });

    test('a problem says what it is instead of how long', async ({ page }) => {
        await openDashboard(page);
        const out = await renderContainers(page, LIVE, { rows: 2 });
        expect(out.details).toEqual(['unhealthy', 'update']);
    });

    test('a click opens the container in the Containers view', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            window.__opened = [];
            window.dashboardInstance.docker = {
                ...window.dashboardInstance.docker,
                openDockerView: (args) => { window.__opened.push(args); return Promise.resolve(true); },
            };
        });
        await renderContainers(page, LIVE, { sort: 'name' });
        await page.locator('.ct-probe .dashboard-widget-row', { hasText: 'bazarr' }).click();
        expect(await page.evaluate(() => window.__opened)).toEqual([{ select: 'bazarr' }]);
    });

    test('set to WebUI, a click opens it, and falls back to the view without one', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            window.__opened = [];
            window.__tabs = [];
            window.open = (url) => { window.__tabs.push(String(url)); return null; };
            window.dashboardInstance.docker = {
                ...window.dashboardInstance.docker,
                openDockerView: (args) => { window.__opened.push(args); return Promise.resolve(true); },
            };
        });
        await renderContainers(page, LIVE, { sort: 'name', click: 'webui', rows: 20 });
        await page.locator('.ct-probe .dashboard-widget-row', { hasText: 'homeassistant' }).click();
        expect(await page.evaluate(() => window.__tabs)).toEqual(['http://ha.lan:8123/']);
        await page.locator('.ct-probe .dashboard-widget-row', { hasText: 'bazarr' }).click();
        expect(await page.evaluate(() => window.__opened)).toEqual([{ select: 'bazarr' }]);
    });

    test('without a socket it says why, like the containers widget', async ({ page }) => {
        await openDashboard(page);
        const out = await renderContainers(page, { available: false, reason: 'no-docker-socket', containers: [] });
        expect(out.names).toEqual([]);
        expect(out.text).toContain('Not connected to Docker');
    });
});
