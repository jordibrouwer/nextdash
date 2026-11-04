// @ts-check
/*
 * The MANUAL.md screenshots of what v1.26 changed: the large clock with its
 * greeting, the notifications bell, the Clock widget's face with the moon and
 * the sun, and the AdGuard Home and Pi-hole tiles. Same harness as the other
 * specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-26.spec.js
 *
 * AdGuard Home and Pi-hole are outside services, so their tiles are drawn from
 * made-up answers (domains that do not exist, clients named after nothing).
 */
const fs = require('fs');
const path = require('path');
const {
    test,
    prepare,
    shot,
    snap,
    openDashboard,
    DESKTOP,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** A name for the greeting, and a page of tiles after the three of the seed. */
function v126Data(dir) {
    const settingsFile = path.join(dir, 'settings.json');
    writeJSON(settingsFile, { ...readJSON(settingsFile), greetingName: 'Jordi', headerClockPlacement: 'classic', smartTodayPageIds: [1, 2, 3], feedsEnabled: false, showGridKeyLegend: false });
    const pagesFile = path.join(dir, 'pages.json');
    const pages = readJSON(pagesFile);
    if (!(pages.order || []).includes(4)) pages.order = [...(pages.order || []), 4];
    writeJSON(pagesFile, pages);
    const widgets = [
        { id: 'w_v12600000001', type: 'clock', config: { zones: ['Tokyo=Asia/Tokyo', 'New York=America/New_York', 'Lima=America/Lima'], showDate: true, look: 'face', showMoon: true, showSun: true, columns: 2 } },
        { id: 'w_v12600000002', type: 'adguard', config: { server: 'http://adguard.lab.example:3000', look: 'pulse' } },
        { id: 'w_v12600000003', type: 'pihole', config: { server: 'http://pihole.lab.example', look: 'tiles' } },
    ];
    writeJSON(path.join(dir, 'bookmarks-4.json'), {
        page: { id: 4, name: 'Network' },
        categories: [],
        widgets,
        blockOrder: widgets.map((w) => w.id),
        bookmarks: [],
    });
}

test.use({ viewport: DESKTOP, reducedMotion: 'reduce', dataTweak: { run: v126Data } });

const HOURS = Array.from({ length: 24 }, (_, i) => ({ q: 380 + Math.round(260 * Math.sin((i - 5) / 24 * Math.PI * 2) ** 2) + (i % 4) * 12, b: 70 + (i % 6) * 18 }));

function dnsAnswer(service) {
    const pihole = service === 'pihole';
    return {
        fetchedAt: Date.now(), items: [], libraries: [],
        dns: {
            service,
            queries: pihole ? 21840 : 18420,
            blocked: pihole ? 5120 : 5710,
            blockedPct: pihole ? 23.4 : 31,
            avgMs: pihole ? 9.8 : 14.3,
            protection: true,
            hourly: HOURS,
            topBlocked: [
                { name: 'ads.tracker-one.example', count: 812 }, { name: 'metrics.cdn-two.example', count: 540 },
                { name: 'telemetry.vendor-three.example', count: 377 }, { name: 'pixel.adnet-four.example', count: 251 },
                { name: 'beacon.stats-five.example', count: 198 },
            ],
            topClients: [
                { name: 'laptop', count: 9100 }, { name: 'living-room-tv', count: 5300 },
                { name: 'phone', count: 2800 }, { name: 'nas', count: 1400 },
            ],
            ...(pihole ? {
                gravity: 1204113,
                queryTypes: [{ name: 'A', count: 58 }, { name: 'AAAA', count: 27 }, { name: 'HTTPS', count: 11 }, { name: 'PTR', count: 4 }],
                upstreams: [{ name: 'unbound.lan', pct: 71, ms: 6 }, { name: '1.1.1.1', pct: 22, ms: 11 }],
            } : {}),
            openUrl: pihole ? 'http://pihole.lab.example/admin' : 'http://adguard.lab.example:3000',
        },
    };
}

async function mockDns(page) {
    for (const service of ['adguard', 'pihole']) {
        await page.route(`**/api/widgets/${service}?*`, (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(dnsAnswer(service)),
        }));
    }
}

test('01 the large clock with its greeting', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.locator('.dashboard-greeting, [data-greeting], .header-greeting').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    await shot(page, 'v126-header-clock.jpg');
});

test('02 the notifications bell with its rows', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => {
        try { localStorage.removeItem('nextdash-keyboard-tip-current'); localStorage.removeItem('nextdash-keyboard-tips-offered'); } catch { /* none */ }
        window.dashboardInstance.settings.enableSessionTips = true;
    });
    await page.evaluate(() => window.DashboardKeyboardTip?.tick?.());
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await page.locator('.notification-bell-row').first().waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the panel finishes sliding in.
    await page.waitForTimeout(800);
    await shot(page, 'v126-bell.jpg');
});

test('03 the Clock widget with a face, and the DNS tiles', async ({ page }) => {
    await prepare(page);
    await mockDns(page);
    await openDashboard(page);
    await page.keyboard.press('4');
    await page.locator('.dashboard-widget[data-widget-id="w_v12600000001"] .dashboard-clock-svg').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.dashboard-widget[data-widget-id="w_v12600000002"]').getByText('blocked', { exact: false }).first().waitFor({ timeout: 15_000 });
    // Pacing for the capture, not a condition: the tiles finish drawing their strips.
    await page.waitForTimeout(1_500);
    await shot(page, 'v126-widgets.jpg');
    await snap(page, page.locator('.dashboard-widget[data-widget-id="w_v12600000001"]'), 'v126-clock-face.jpg', { pad: 16 });
    await snap(page, page.locator('.dashboard-widget[data-widget-id="w_v12600000002"]'), 'v126-dns-pulse.jpg', { pad: 16 });
    await snap(page, page.locator('.dashboard-widget[data-widget-id="w_v12600000003"]'), 'v126-dns-tiles.jpg', { pad: 16 });
});
