// @ts-check
/*
 * The MANUAL.md screenshots of the network checks (v1.28): the Tests tab of a
 * bookmark's side panel, a certificate that is nearly out, one run of HTTP
 * detail, the form that adds a check, and the Checks panel under Monitoring.
 * Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-28.spec.js
 *
 * The four checks come from the demo seed (demo_health_seed.go): a TCP check
 * on github.com, a TLS check on home-assistant.io with nine days left, a DNS
 * check on jellyfin.org whose MX answer changed, and a ping on gitlab.com that
 * has been failing for three hours. A one-off HTTP-detail run is stubbed: the
 * demo does no test, and a real one would put a real address in the picture.
 */
const { test, prepare, settle, snap, shot, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });

/** The Bookmarks view with a bookmark's side panel open on its Tests tab. */
async function openTests(page, name) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
    // The list draws only the rows near the screen: find the bookmark by its name first.
    await page.locator('#config-bm-search').fill(name);
    await page.waitForTimeout(600);
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: new RegExp(`^${name}$`) }) }).first().click();
    const panel = page.locator('#config-bm-panel');
    await panel.locator('.config-bm-panel-title', { hasText: new RegExp(`^${name}$`) }).waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('4');
    const tests = panel.locator('[data-bm-pane="tests"]');
    await tests.waitFor({ state: 'visible' });
    await tests.locator('[data-net-card]').first().waitFor();
    return { panel, tests };
}

test('11 the Tests tab: a ping that is down', async ({ page }) => {
    await prepare(page);
    const { panel } = await openTests(page, 'GitLab');
    await page.evaluate(() => document.querySelectorAll('[data-net-card]').forEach((d) => { d.open = true; }));
    // Pacing for the capture, not a condition: the strips and sparklines finish drawing.
    await page.waitForTimeout(800);
    await snap(page, panel, '11-tests-tab.jpg', { pad: 0 });
});

test('11 the Tests tab: a certificate close to expiry', async ({ page }) => {
    await prepare(page);
    const { panel } = await openTests(page, 'Home Assistant');
    await page.evaluate(() => document.querySelectorAll('[data-net-card]').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(800);
    await snap(page, panel, '11-tests-tls.jpg', { pad: 0 });
});

test('11 Run once with HTTP detail', async ({ page }) => {
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
    const { panel, tests } = await openTests(page, 'Jellyfin');
    // The Run once accordion is folded while the bookmark has a check of its own.
    await tests.locator('summary').filter({ hasText: /run once/i }).first().click();
    await tests.locator('[data-net-run-types]').getByRole('button', { name: 'HTTP' }).click();
    await tests.locator('[data-tests-result="http"]').waitFor({ state: 'visible' });
    await tests.locator('[data-tests-result="http"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await snap(page, panel, '11-tests-run-once.jpg', { pad: 0 });
});

test('11 Add check, step two', async ({ page }) => {
    await prepare(page);
    const { tests } = await openTests(page, 'GitHub');
    await tests.getByRole('button', { name: 'Add check' }).click();
    const form = tests.locator('[data-net-form]');
    await form.waitFor({ state: 'visible' });
    await form.locator('[data-net-field="type"]').selectOption('dns');
    await form.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await snap(page, form, '11-tests-add-check.jpg', { pad: 12, keepFocus: true });
});

test('17 Config, Monitoring, Checks: the network checks panel', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.monitoringTab = 'checks';
        return c.openConfigView('monitoring');
    });
    const field = page.locator('[data-behavior-field="netToolsEnabled"]').first();
    await field.waitFor({ state: 'visible', timeout: 15_000 });
    // The panel starts at the top of the frame, with its table of every check below it.
    await page.getByText('Network checks', { exact: true }).first().evaluate((el) => {
        // Room for the view's sticky head, whichever element scrolls.
        el.style.scrollMarginTop = '150px';
        el.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(800);
    await shot(page, '17-net-checks-config.jpg');
});
