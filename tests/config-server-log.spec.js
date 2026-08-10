// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The server log viewer on Data & backups → Server log.
 *
 * Deliberately short: the buffer, parsing and retention are covered by Go tests
 * in log_buffer_test.go. What only a browser can show is that the tab renders
 * real lines, that clearing empties it, and that the refresh interval — the
 * only polling timer in config — is taken down when you leave.
 */
/**
 * Open the tab, optionally with collecting switched on.
 *
 * Capture is off on a fresh install, so a test that wants lines has to turn it
 * on the way a user would.
 */
async function openLogs(page, { capture = true, clear = false } = {}) {
    // One server is shared across the file, so the previous test's choice is
    // still persisted. Set the switch before the page loads, so the tab paints
    // from the state this test wants rather than the last one's.
    await page.request.post('/api/settings', { data: { serverLogEnabled: capture } });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="logs"]').click();
    await expect(page.locator('[data-log-output]')).toBeVisible();

    const toggle = page.locator('[data-log-toggle="capture"]');
    if (capture !== await toggle.isChecked()) {
        await toggle.click();
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/logs')).json()).capturing), { timeout: 10_000 }).toBe(capture);
    }
    // One server is shared across the file, so a previous test's lines are
    // still in the buffer. Tests that assert on what is *not* there start clean.
    if (clear) {
        await page.evaluate(async () => {
            await fetch('/api/logs', { method: 'DELETE' });
            // Awaited rather than clicking Refresh: the click returns before
            // the fetch behind it lands, and the next assertion would race it.
            await window.dashboardInstance.config.loadServerLog({ reset: true });
        });
    }
    if (capture) {
        // Give the server something to have logged, then pull it in.
        await page.evaluate(async () => {
            await fetch('/api/pages');
            await window.dashboardInstance.config.loadServerLog({ reset: true });
        });
    }
}

test.describe('Data & backups → Server log', () => {
    test('shows captured lines, with tiles and controls', async ({ page }) => {
        await openLogs(page);

        // Loading the page necessarily logs requests, so there is always
        // something to show.
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);
        await expect(page.locator('#config-log-tiles .config-tile')).toHaveCount(3);

        // The controls the feature is made of.
        for (const kind of ['interval', 'retention', 'level']) {
            await expect(page.locator(`[data-log-select="${kind}"]`)).toBeVisible();
        }
        for (const action of ['refresh', 'copy', 'download', 'clear']) {
            await expect(page.locator(`[data-log-action="${action}"]`)).toBeVisible();
        }
    });

    test('the level filter narrows what is listed', async ({ page }) => {
        await openLogs(page, { clear: true });
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);

        // Nothing since the clear has failed, so asking for errors empties the
        // list — which also proves the filter reaches the server rather than
        // just hiding rows that were already fetched.
        await page.locator('[data-log-select="level"]').selectOption('error');
        await expect.poll(() => page.locator('.config-log-line--info').count()).toBe(0);

        await page.locator('[data-log-select="level"]').selectOption('');
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);
    });

    test('clearing empties the buffer on the server', async ({ page }) => {
        await openLogs(page);
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(1);

        await page.locator('[data-log-action="clear"]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();

        // The DELETE is itself logged, so "empty" means down to a line or two
        // rather than zero.
        await expect.poll(() => page.evaluate(async () => {
            const res = await fetch('/api/logs');
            return (await res.json()).stats.total;
        }), { timeout: 10_000 }).toBeLessThan(5);
        await expect.poll(() => page.locator('.config-log-line').count()).toBeLessThan(5);
    });

    test('collecting is off until switched on, and stopping keeps what is held', async ({ page }) => {
        await openLogs(page, { capture: false, clear: true });

        // Off by default, so an install nobody debugs pays nothing for it.
        await expect(page.locator('[data-log-toggle="capture"]')).not.toBeChecked();
        // The empty state says why the list is empty. Asserted on the rendered
        // string rather than the DOM node: these tests share one server, so
        // whether any lines survive the clear depends on what ran before.
        expect(await page.evaluate(() => {
            window.dashboardInstance.config._logLines = [];
            return window.dashboardInstance.config.renderServerLogLines();
        })).toContain('Not collecting');

        await page.locator('[data-log-toggle="capture"]').click();
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).serverLogEnabled), { timeout: 10_000 }).toBe(true);
        await page.evaluate(() => fetch('/api/pages'));
        await page.locator('[data-log-action="refresh"]').click();
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);

        // Stopping halts capture without discarding what is already there.
        await page.locator('[data-log-toggle="capture"]').click();
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/logs')).json()).capturing), { timeout: 10_000 }).toBe(false);

        const total = () => page.evaluate(async () => (await (await fetch('/api/logs')).json()).stats.total);
        const before = await total();
        expect(before).toBeGreaterThan(0);
        for (let i = 0; i < 5; i++) await page.evaluate(() => fetch('/api/pages'));
        expect(await total()).toBe(before);
    });

    test('the refresh timer stops when the tab is left', async ({ page }) => {
        await openLogs(page);
        const hasTimer = () => page.evaluate(() => !!window.dashboardInstance.config._logTimer);

        expect(await hasTimer()).toBe(false);
        await page.locator('[data-log-select="interval"]').selectOption('2');
        expect(await hasTimer()).toBe(true);

        // This is the whole risk of a polling view: leaving must take the timer
        // with it, or it keeps fetching behind whatever is opened next.
        await page.locator('[data-db-tab="backups"]').click();
        expect(await hasTimer()).toBe(false);

        await page.locator('[data-db-tab="logs"]').click();
        await page.locator('[data-log-select="interval"]').selectOption('2');
        expect(await hasTimer()).toBe(true);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        expect(await hasTimer()).toBe(false);
    });
});
