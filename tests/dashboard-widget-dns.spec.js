// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * AdGuard Home and Pi-hole: one DNS tile, four looks. Drawn with a stubbed
 * answer in the shape the server sends (widgets_dns.go has the Go tests for
 * the service half).
 *
 * What these pin is what the reader sees: one column is terse and two columns
 * say more, protection that is off is said rather than shown green, a day with
 * no queries has no percentage, and a click opens the top ten.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const hours = Array.from({ length: 24 }, (_, i) => ({ q: 200 + i * 10, b: 40 + (i % 5) * 10 }));

function answer(service, extra = {}) {
    return {
        fetchedAt: Date.now(), items: [], libraries: [],
        dns: {
            service, queries: 18420, blocked: 5710, blockedPct: 31, avgMs: 14.3, protection: true,
            hourly: hours,
            topBlocked: [{ name: 'doubleclick.net', count: 812 }, { name: 'graph.facebook.com', count: 540 },
                { name: 'telemetry.vendor.io', count: 377 }, { name: 'ads.tiktok.com', count: 251 }],
            topClients: [{ name: 'macbook-jordi', count: 9100 }, { name: 'tv-woonkamer', count: 5300 }],
            ...(service === 'pihole' ? {
                gravity: 1200000,
                queryTypes: [{ name: 'A', count: 58 }, { name: 'AAAA', count: 27 }, { name: 'HTTPS', count: 11 }],
                upstreams: [{ name: 'unbound.lan', pct: 71, ms: 6 }, { name: '1.1.1.1', pct: 22, ms: 11 }],
            } : {}),
            openUrl: service === 'pihole' ? 'http://pi.example/admin' : 'http://adguard.example',
            ...extra,
        },
    };
}

async function draw(page, { type, result, config = {}, width = 320 }) {
    await page.evaluate(async ({ type, result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        const realNext = window.nextDashFetch;
        const stub = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}`)
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        window.fetch = stub;
        if (realNext) window.nextDashFetch = stub;
        document.getElementById('dns-test')?.remove();
        const host = document.createElement('div');
        host.id = 'dns-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: `w_${type}_${width}`, type, config }, d);
        } finally {
            window.fetch = realFetch;
            if (realNext) window.nextDashFetch = realNext;
            delete d._widgetMedia;
        }
    }, { type, result, config, width });
    return page.locator('#dns-test');
}

/** Opens a fresh widget of this type in Config → Widgets and returns its panel. */
async function addInConfig(page, type) {
    await open(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    // Quickstart sweeps favicons on a fresh store and reopens Overview when it finishes.
    await page.waitForTimeout(6000);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
        await window.dashboardInstance.config.openConfigView('widgets');
    });
    await page.locator('[data-widget-catalogue]').click();
    await page.locator(`.modal--widget-catalogue [data-widget-option="${type}"]`).first().click();
    await page.locator(`.modal--widget-catalogue [data-widget-add="${type}"]`).click();
    await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]')).toBeFocused({ timeout: 10_000 });
    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const panel = page.locator(`[data-widget-detail="${index}"]`);
    await expect(panel).toBeVisible();
    return panel;
}

async function savedConfig(page, type) {
    return page.evaluate(async (type) => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const blocks = await (await send('/api/pages/1/blocks')).json();
        return (blocks.widgets || []).find((w) => w.type === type)?.config ?? null;
    }, type);
}

const TYPES = ['adguard', 'pihole'];
const LOOKS = ['pulse', 'leaders', 'tiles', 'mix'];

test.describe('the DNS blocker widgets', () => {
    test('both offered under System, each with a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async (types) => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const system = (Config?.WIDGET_TYPE_GROUPS || []).find(([group]) => group === 'system')?.[1] || [];
            return types.map((type) => ({
                type,
                offered: (Config?.WIDGET_TYPES || []).includes(type),
                grouped: system.includes(type),
                renderer: typeof window.DashboardWidgets?.[type],
            }));
        }, TYPES);
        for (const one of state) {
            expect(one, one.type).toMatchObject({ offered: true, grouped: true, renderer: 'function' });
        }
    });

    for (const look of LOOKS) {
        test(`${look}: draws on one column and on two, and says the figure`, async ({ page }) => {
            await open(page);
            for (const width of [320, 680]) {
                const tile = await draw(page, { type: 'adguard', result: answer('adguard'), config: { look }, width });
                await expect(tile.locator('.dns-tile'), `${look} ${width}`).toBeVisible();
                await expect(tile.locator('.dns-tile'), `${look} ${width}`).toHaveAttribute('data-dns-look', look);
                // Every look carries the queries somewhere the reader can see.
                await expect(tile.locator('.dns-tile'), `${look} ${width}`).toContainText(/31%|18\.4K|18,420|doubleclick/i);
            }
        });
    }

    test('pulse: one column is terse, two columns add the lists', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { type: 'adguard', result: answer('adguard'), width: 320 });
        await expect(tile.locator('.dns-big:visible')).toHaveText('31%');
        await expect(tile.locator('.dns-bar:visible')).toHaveCount(24);
        await expect(tile.locator('.dns-row:visible')).toHaveCount(0);

        tile = await draw(page, { type: 'adguard', result: answer('adguard'), width: 680 });
        await expect(tile.locator('.dns-list-title:visible').first()).toContainText(/top blocked/i);
        await expect(tile.locator('.dns-row:visible').first()).toContainText('doubleclick.net');
    });

    test('pihole adds query types and upstreams on two columns only', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { type: 'pihole', result: answer('pihole'), width: 320 });
        await expect(tile.locator('.dns-stack:visible')).toHaveCount(0);
        tile = await draw(page, { type: 'pihole', result: answer('pihole'), width: 680 });
        await expect(tile.locator('.dns-stack:visible')).toHaveCount(1);
        await expect(tile).toContainText('unbound.lan');
        await expect(tile).toContainText(/A 60% · AAAA 28%/);
    });

    test('protection that is off is said, not drawn green', async ({ page }) => {
        await open(page);
        const off = answer('pihole', { protection: false });
        const tile = await draw(page, { type: 'pihole', result: off, width: 680 });
        await expect(tile.locator('.dns-dot')).toHaveAttribute('data-state', 'off');
        await expect(tile.locator('.dns-state:visible')).toHaveText(/blocking off/i);
    });

    test('a day with no queries has no percentage and no strip', async ({ page }) => {
        await open(page);
        const empty = answer('adguard', { queries: 0, blocked: 0, blockedPct: undefined, avgMs: undefined, hourly: [] });
        for (const width of [320, 680]) {
            const tile = await draw(page, { type: 'adguard', result: empty, width });
            await expect(tile, `${width}px`).toContainText(/no queries yet/i);
            await expect(tile, `${width}px`).not.toContainText('NaN');
            await expect(tile.locator('.dns-bar'), `${width}px`).toHaveCount(0);
        }
    });

    test('an hour with no queries draws no bar height', async ({ page }) => {
        await open(page);
        const quiet = answer('adguard', { hourly: [{ q: 0, b: 0 }, { q: 100, b: 10 }] });
        const tile = await draw(page, { type: 'adguard', result: quiet, width: 320 });
        const heights = await tile.locator('.dashboard-widget-narrow-only .dns-bar').evaluateAll((bars) => bars.map((b) => b.style.height));
        expect(heights).toEqual(['0px', '100%']);
    });

    test('names from the network are text, never markup', async ({ page }) => {
        await open(page);
        const hostile = answer('adguard', { topBlocked: [{ name: '<img src=x onerror=window.__pwned=1>', count: 9 }] });
        const tile = await draw(page, { type: 'adguard', result: hostile, config: { look: 'leaders' }, width: 680 });
        await expect(tile.locator('.dns-row').first()).toContainText('<img src=x');
        expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    });

    test('parts the reader turned off are not drawn', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'adguard', result: answer('adguard'),
            config: { parts: ['figures'] }, width: 680 });
        await expect(tile.locator('.dns-bar')).toHaveCount(0);
        await expect(tile.locator('.dns-row')).toHaveCount(0);
        await expect(tile.locator('.dns-dot')).toHaveCount(0);
    });

    test('a click opens the top ten, with a way to the service', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'adguard', result: answer('adguard'), width: 320 });
        await tile.locator('.dns-tile').click();
        const card = page.locator('dialog.dns-detail');
        await expect(card).toBeVisible();
        await expect(card).toContainText('doubleclick.net');
        await expect(card).toContainText('macbook-jordi');
        await expect(card.locator('[data-media-open]')).toBeVisible();
        await card.locator('[data-media-close]').click();
        await expect(card).toHaveCount(0);
    });

    test('click: open goes straight to the service', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
        const tile = await draw(page, { type: 'pihole', result: answer('pihole'),
            config: { click: 'open', target: '_blank' }, width: 320 });
        await tile.locator('.dns-tile').click();
        await expect(page.locator('dialog.dns-detail')).toHaveCount(0);
        expect(await page.evaluate(() => window.__opened)).toEqual(['http://pi.example/admin']);
    });

    test('AdGuard: sign in with a username and password, then save the look', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/adguard/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: 'v0.107.52' }) });
        });
        const panel = await addInConfig(page, 'adguard');
        await panel.locator('[data-widget-setting="server"]').fill('http://adguard.lan:3000');
        await panel.locator('[data-widget-auth="basicUser"]').fill('admin');
        await panel.locator('[data-widget-auth="secret"]').fill('adguard-pass-0123');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('v0.107.52');
        expect(sent?.draftCredential).toMatchObject({ basicUser: 'admin', basicPassword: 'adguard-pass-0123' });

        await panel.locator('[data-widget-setting="look"]').selectOption('tiles');
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page, 'adguard'))?.look ?? null, { timeout: 15_000 }).toBe('tiles');
        expect(JSON.stringify(await savedConfig(page, 'adguard'))).not.toContain('adguard-pass-0123');
    });

    test('Pi-hole: a password only, no username box', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/pihole/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: 'v6' }) });
        });
        const panel = await addInConfig(page, 'pihole');
        await expect(panel.locator('[data-widget-auth="basicUser"]')).toHaveCount(0);
        await panel.locator('[data-widget-setting="server"]').fill('http://pi.hole');
        await panel.locator('[data-widget-auth="secret"]').fill('pihole-pass-0123');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('v6');
        expect(sent?.draftCredential?.session).toMatchObject({
            loginPath: '/api/auth', password: 'pihole-pass-0123', tokenHeader: 'X-FTL-SID', tokenPath: 'session.sid' });
        await expect(panel.locator('[data-widget-setting="parts"], [data-widget-setting="look"]').first()).toBeVisible();
    });
});
