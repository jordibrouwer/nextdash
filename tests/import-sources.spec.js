// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Data & backups says what can be brought in: a card per kind of source with
 * its file type, what it covers, what comes along and what does not.
 */

async function openBackups(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.dbTab = 'backups';
        return c.openConfigView('data-backups');
    });
    await page.waitForSelector('.config-import-grid', { timeout: 20_000 });
}

test.describe('what can be imported', () => {
    test('six cards say the file type, the services and what comes along', async ({ page }) => {
        await openBackups(page);
        const cards = page.locator('.config-import-card');
        await expect(cards).toHaveCount(6);
        const dashboards = page.locator('.config-import-card--dashboards');
        await expect(dashboards).toContainText('Homepage, Dashy, Homer');
        await expect(dashboards.locator('code')).toHaveText(['.yaml', '.yml']);
        await expect(dashboards.locator('.config-import-chip.is-yes')).toHaveText(['Links', 'Groups']);
        // Said as plainly as what is carried: widgets and keys are not.
        await expect(dashboards.locator('.config-import-chip.is-no')).toHaveText(['Widgets', 'Keys']);
        await expect(page.locator('.config-import-card--services')).toContainText('Pocket');
        await expect(page.locator('.config-import-card--backup .config-import-chip.is-no')).toContainText('Replaces what is here');
    });

    test('each card keeps the button that was there, and a file picker still opens', async ({ page }) => {
        await openBackups(page);
        const actions = await page.locator('.config-import-card [data-backup-action]').evaluateAll((els) => els.map((e) => e.getAttribute('data-backup-action')));
        expect(actions).toEqual(['browser-import', 'browser-import', 'browser-import', 'csv-import', 'settings-import', 'import']);
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.config-import-card--dashboards [data-backup-action]').click();
        const fc = await chooser;
        expect(fc.isMultiple()).toBe(false);
    });

    test('the Move group keeps only what takes things out', async ({ page }) => {
        await openBackups(page);
        const actions = await page.locator('.config-panel [data-backup-action]').evaluateAll((els) => els.map((e) => e.getAttribute('data-backup-action')));
        for (const gone of ['csv-import']) {
            // csv-import now lives only on its card
            expect(actions.filter((a) => a === gone)).toHaveLength(1);
        }
        expect(actions).toContain('html-export');
        expect(actions).toContain('csv-export');
        expect(actions).toContain('settings-export');
    });
});
