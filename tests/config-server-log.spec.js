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
async function openLogs(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="logs"]').click();
    await expect(page.locator('[data-log-output]')).toBeVisible();
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
        await openLogs(page);
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);

        // A freshly started test server logs no errors, so this empties the
        // list — which also proves the filter reaches the server rather than
        // just hiding rows.
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
