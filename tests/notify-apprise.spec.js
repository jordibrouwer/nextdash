// @ts-check
const http = require('http');
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Apprise as the alert service, set up the way a reader does it: pick it in
 * Downtime alerts, give the notify URL of a configuration key and a tag, and
 * press Send test alert. The stub stands in for apprise-api and records what
 * arrived; its answer decides what the panel has to say.
 */

function startApprise() {
    const seen = { requests: [], status: 200 };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            seen.requests.push({ path: req.url, type: req.headers['content-type'], body: JSON.parse(body || '{}') });
            res.writeHead(seen.status).end();
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

async function openAlerts(page, request) {
    // The stub is on 127.0.0.1, which an alert reaches only with local
    // addresses allowed -- as it does for anyone running apprise-api at home.
    await request.post('/api/settings', {
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
        data: { allowLocalBookmarks: true, monitorNotifyPreset: '', monitorNotifyUrl: '', monitorNotifyAppriseTag: '' },
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const config = window.dashboardInstance.config;
        config.behaviorTab = 'status';
        return config.openConfigView('behavior');
    });
    await expect(page.locator('[data-monitor-notify-test]')).toBeVisible();
}

test.describe('Apprise as the alert service', () => {
    test('a test alert reaches the key with its tag and the type of an outage', async ({ page, request }) => {
        const apprise = await startApprise();
        try {
            await openAlerts(page, request);
            const tag = page.locator('[data-behavior-field="monitorNotifyAppriseTag"]');
            await expect(tag).toHaveCount(0);

            await page.locator('[data-behavior-field="monitorNotifyPreset"]').selectOption('apprise');
            await expect(tag).toBeVisible();
            const url = page.locator('[data-behavior-field="monitorNotifyUrl"]');
            await url.fill(`${apprise.base}/notify/nextdash`);
            await url.blur();
            await tag.fill('admins');
            await tag.blur();
            await page.locator('[data-monitor-notify-test]').click();

            await expect(page.locator('[data-monitor-notify-test-status]')).toHaveText(/Sent/);
            expect(apprise.seen.requests).toHaveLength(1);
            const [sent] = apprise.seen.requests;
            expect(sent.path).toBe('/notify/nextdash');
            expect(sent.type).toBe('application/json');
            expect(sent.body).toMatchObject({ tag: 'admins', type: 'failure', format: 'text' });
            expect(String(sent.body.title)).not.toBe('');
        } finally {
            apprise.server.close();
        }
    });

    test('when Apprise cannot deliver, the panel says so in Apprise\'s terms', async ({ page, request }) => {
        const apprise = await startApprise();
        apprise.seen.status = 424;
        try {
            await openAlerts(page, request);
            await page.locator('[data-behavior-field="monitorNotifyPreset"]').selectOption('apprise');
            const url = page.locator('[data-behavior-field="monitorNotifyUrl"]');
            await url.fill(`${apprise.base}/notify/nextdash`);
            await url.blur();
            await page.locator('[data-monitor-notify-test]').click();

            await expect(page.locator('[data-monitor-notify-test-status]'))
                .toContainText('could not deliver to at least one destination');
        } finally {
            apprise.server.close();
        }
    });
});
