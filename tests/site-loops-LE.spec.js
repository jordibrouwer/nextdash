// @ts-check
/*
 * Loops (loop.webm) of the nextdash.cc feature pages app-discovery and
 * page-templates. 1440x900, Tarnished Brass dark, demo seed.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=1 \
 *     npx playwright test tests/site-loops-LE.spec.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    test,
    prepare,
    settle,
    openDashboard,
    DESKTOP,
    OUT,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'serial' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce', video: { mode: 'on', size: { width: 1440, height: 900 } } });
test.setTimeout(60_000);

const TRIM = '/private/tmp/claude-501/agents/trim-loop.sh';
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** Cuts the finished recording into <OUT>/<slug>/loop.webm. */
async function finishLoop(page, slug, startAt, seconds) {
    const video = page.video();
    await page.close();
    const src = await video.path();
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    writeJSON(path.join(dir, 'loop.json'), { startAt, video: src });
    const out = execFileSync(TRIM, [src, String(startAt), String(seconds), path.join(dir, 'loop.webm')]).toString();
    console.log(`LOOP ${slug} duration/size ${out.trim()}`);
}

/* ---- app discovery ---- */
const discoveredApp = (name, kind, port, icon, displayName) => ({
    name, kind, url: `http://192.168.1.10:${port}`, icon: icon ? `dashboard-icons/${name}` : '', source: 'port',
    ...(icon ? { iconUrl: `/data/icon-sets/dashboard-icons/${name}.svg` } : {}),
    ...(displayName ? { displayName } : {}),
});
const FOUND_APPS = [
    discoveredApp('plex', 'Media', 32400, true, 'Plex'),
    discoveredApp('jellyseerr', 'Media management', 5055, true, 'Jellyseerr'),
    discoveredApp('grafana', 'Monitoring', 3000, false, 'Grafana'),
    discoveredApp('home-assistant', 'Home', 8123, false, 'Home Assistant'),
];

test.describe('app discovery', () => {
    // The server remembers what a run found (the shot servers have no Docker socket), so Add and Undo act on real bookmarks.
    test.use({
        dataPatch: 'discovery',
        dataTweak: {
            run(dir) {
                writeJSON(path.join(dir, 'discovery.json'), {
                    firstRunDone: true,
                    apps: FOUND_APPS.map(({ iconUrl, ...app }) => ({ ...app, hostBound: false })),
                });
            },
        },
    });
    test('loop app-discovery', async ({ page }) => {
        const t0 = Date.now();
        await prepare(page);
        await page.route('**/api/discovery', (route) => (route.request().method() === 'GET'
            ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, docker: true, running: false, cardDone: false, apps: FOUND_APPS }) })
            : route.fallback()));
        await openDashboard(page);
        await page.waitForTimeout(4_000); // Pacing for the capture, not a condition: the digest corner card goes first.
        await settle(page);
        const card = page.locator('.app-discovery-card').first();
        await card.waitFor({ state: 'visible', timeout: 40_000 });
        const startAt = (Date.now() - t0) / 1000;
        // Pacing for the capture, not a condition: a rest on the card opens the loop.
        await page.waitForTimeout(2_500);
        await card.locator('[data-ad-app="grafana"]').click();
        await page.waitForTimeout(1_500);
        await card.locator('[data-ad-add]').click();
        const notice = page.locator('.notice-card.show').first();
        await notice.waitFor({ state: 'visible', timeout: 15_000 });
        // Pacing for the capture, not a condition: the page scrolls to the new categories and the notice is read.
        await page.waitForTimeout(2_800);
        await notice.getByRole('button', { name: 'Undo' }).click();
        await page.locator('.category[data-category-id]', { hasText: 'Plex' }).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForFunction(() => window.scrollY < 2);
        // Pacing for the capture, not a condition: a rest on the starting screen closes the loop.
        await page.waitForTimeout(1_500);
        await finishLoop(page, 'app-discovery', startAt, (Date.now() - t0) / 1000 - startAt);
    });
});

/* ---- page templates ---- */
test.describe('page templates', () => {
    test.use({
        dataTweak: {
            run(dir) {
                const sf = path.join(dir, 'settings.json');
                writeJSON(sf, { ...readJSON(sf), showGridKeyLegend: false, pageSwitcherStyle: 'compact' });
                const file = path.join(dir, 'bookmarks-2.json');
                const data = readJSON(file);
                const at = Date.now();
                [['Media server', 'http://192.168.1.20:8096/web/', 'MS'], ['Download manager', 'http://192.168.1.20:8080/', 'DM']].forEach(([name, url, shortcut], i) => data.bookmarks.push({
                    name, url, shortcut, pageId: 2, category: '', checkStatus: false, createdAt: at - (i + 5) * 86_400_000, tags: ['media'],
                }));
                writeJSON(file, data);
            },
        },
    });
    test('loop page-templates', async ({ page }) => {
        const t0 = Date.now();
        await prepare(page);
        await openDashboard(page);
        // The page with the home-network links is the one on screen.
        await page.evaluate(() => window.dashboardInstance.pageNav.requestPageNavigation(2));
        await page.waitForFunction(() => Number(window.dashboardInstance.currentPageId) === 2);
        await settle(page);
        const trigger = page.locator('.page-nav-btn[aria-selected="true"]');
        await trigger.waitFor({ state: 'visible' });
        await page.screenshot({ path: '/private/tmp/claude-501/agents/loops-LE/pt-start.png' });
        const startAt = (Date.now() - t0) / 1000;
        // Pacing for the capture, not a condition: a rest on the page opens the loop.
        await page.waitForTimeout(2_000);
        await trigger.click();
        await page.locator('.page-switcher-share').waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the menu is read.
        await page.waitForTimeout(1_500);
        await page.locator('.page-switcher-share').click();
        const dialog = page.locator('#config-template-export');
        await dialog.waitFor({ state: 'visible' });
        await page.screenshot({ path: '/private/tmp/claude-501/agents/loops-LE/pt-dialog.png' });
        // Pacing for the capture, not a condition: the dialog is read.
        await page.waitForTimeout(2_000);
        const name = dialog.locator('[data-tpl-key]').first();
        await name.fill('jellyfin');
        await page.waitForTimeout(1_500); // Pacing for the capture, not a condition: the new name is read.
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForTimeout(1_500); // Pacing for the capture, not a condition: a rest closes the loop.
        await finishLoop(page, 'page-templates', startAt, (Date.now() - t0) / 1000 - startAt);
    });
});
