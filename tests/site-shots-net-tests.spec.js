// @ts-check
/*
 * The pictures of the network tests feature page on nextdash.cc (v1.28.0):
 * full frames of the Tests tab, one Run once with HTTP detail, the Bookmarks
 * view filtered on checks, and Config → Monitoring → Checks. Same look as the
 * manual (SHOT_THEME), over the public seed of scripts/make-manual-seed.sh:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=4 \
 *     npx playwright test tests/site-shots-net-tests.spec.js
 *
 * The one-off HTTP test is stubbed: the demo runs no test, and a real one would
 * put a real address in the picture.
 */
const { test, prepare, settle, shot, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });

/** The Bookmarks view, with the list drawn. */
async function openBookmarks(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
}

/** A bookmark's side panel on its Tests tab. */
async function openTests(page, name) {
    await openBookmarks(page);
    await page.locator('#config-bm-search').fill(name);
    // Pacing for the capture, not a condition: the list filters after a short delay.
    await page.waitForTimeout(600);
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: new RegExp(`^${name}$`) }) }).first().click();
    await page.locator('#config-bm-panel .config-bm-panel-title', { hasText: new RegExp(`^${name}$`) }).waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('4');
    const tests = page.locator('#config-bm-panel [data-bm-pane="tests"]');
    await tests.locator('[data-net-card]').first().waitFor();
    return tests;
}

test('1 the Tests tab', async ({ page }) => {
    await prepare(page);
    await openTests(page, 'GitLab');
    await page.evaluate(() => document.querySelectorAll('[data-net-card]').forEach((d) => { d.open = true; }));
    // Pacing for the capture, not a condition: the strips and sparklines finish drawing.
    await page.waitForTimeout(1_000);
    await shot(page, 'net-tests-1.jpg');
});

test('2 Run once with HTTP detail', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/net/run', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            type: 'http', ok: true, ms: 96, host: 'jellyfin.org', ip: '203.0.113.9', port: 443, detail: '200 · 2 redirects',
            http: {
                status: 200, proto: 'HTTP/2', ip: '203.0.113.9', size: 34200, url: 'https://jellyfin.org/docs/',
                timings: { dnsMs: 12, connectMs: 28, tlsMs: 41, waitMs: 96, transferMs: 18, redirectMs: 99, ttfbMs: 195, totalMs: 213 },
                redirects: [
                    { url: 'http://jellyfin.org/', status: 301, ms: 38 },
                    { url: 'https://jellyfin.org/', status: 302, ms: 61 },
                ],
                headers: [
                    { name: 'server', value: 'nginx' },
                    { name: 'strict-transport-security', value: 'max-age=15552000' },
                    { name: 'content-type', value: 'text/html; charset=utf-8' },
                ],
                headersTotal: 14, expectStatus: '200-299',
            },
        }),
    }));
    const tests = await openTests(page, 'Jellyfin');
    await tests.locator('summary').filter({ hasText: /run once/i }).first().click();
    await tests.locator('[data-net-run-types]').getByRole('button', { name: 'HTTP' }).click();
    await tests.locator('[data-tests-result="http"]').waitFor({ state: 'visible' });
    await tests.locator('[data-tests-result="http"]').scrollIntoViewIfNeeded();
    // Pacing for the capture, not a condition: the bars of the timeline finish drawing.
    await page.waitForTimeout(800);
    await shot(page, 'net-tests-2.jpg');
});

test('3 the Bookmarks view filtered on checks', async ({ page }) => {
    await prepare(page);
    await openBookmarks(page);
    await page.locator('#config-bm-rail').getByText('Has checks', { exact: true }).first().click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await page.evaluate(() => {
        document.querySelector('#config-bm-list')?.scrollTo?.(0, 0);
        window.scrollTo(0, 0);
    });
    // Pacing for the capture, not a condition: the list redraws after the filter.
    await page.waitForTimeout(900);
    await shot(page, 'net-tests-3.jpg');
});

test('4 Config, Monitoring, Checks', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.monitoringTab = 'checks';
        return c.openConfigView('monitoring');
    });
    await page.locator('[data-behavior-field="netToolsEnabled"]').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('Network checks', { exact: true }).first().evaluate((el) => {
        // Room for the view's sticky head, whichever element scrolls.
        el.style.scrollMarginTop = '150px';
        el.scrollIntoView({ block: 'start' });
    });
    // Pacing for the capture, not a condition: the scroll settles.
    await page.waitForTimeout(800);
    await shot(page, 'net-tests-4.jpg');
});
