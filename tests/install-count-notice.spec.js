// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The daily install count is on by default, so it is announced once, as a
 * quiet row in the bell (Privacy): what leaves the server, and how to stop it.
 * The row is not a question, and it is not shown to anyone it would be
 * pointless for.
 */

const PROMO_ID = 'install-count-v1';
const ROW = '.notification-bell-row[data-bell-id="install-count-notice"]';

async function loadWithRowPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    // Settings too: the bell's marks below arrive with them, and pages come first.
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0
        && window.dashboardInstance._settingsLoaded === true && window.NotificationBell, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => {
        // A "No" said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            // schedulePersist() runs through the module's own closure, so only the
            // save can be held back: the shared ./data keeps no mark of a test.
            if (opts?.keys?.length === 1 && opts.keys[0] === 'discoverabilityState') return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        // And the bell's own mark for the row: "Turn it off" puts the row aside
        // the way a No does, and a mark another test left in the shared ./data
        // hid the row before this one began. Forgotten here only, not saved.
        const saved = window.DiscoverabilityState?.exportState?.();
        if (saved?.bell?.['install-count-notice']) {
            delete saved.bell['install-count-notice'];
            window.DiscoverabilityState.init(saved);
        }
        window.dashboardInstance.settings.installPingEnabled = true;
        window.dashboardInstance.telemetryLockedOff = false;
    }, PROMO_ID);
}

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('the install count notice', () => {
    test('is a Privacy row that says what it is, and is not a corner card', async ({ page }) => {
        await loadWithRowPending(page);
        await openBell(page);
        const row = page.locator(ROW);
        await expect(row).toBeVisible();
        await expect(row).toContainText('nextDash counts installs');
        await expect(row).not.toContainText('dashboard.installCountNotice');
        await expect(page.locator(`.notification-bell-group[data-bell-group="privacy"] ${ROW}`)).toBeVisible();
        await expect(page.locator('.install-count-notice-card')).toHaveCount(0);
    });

    test('"Fine by me" keeps the count on, records the answer, and the row goes', async ({ page }) => {
        await loadWithRowPending(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'Fine by me' }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.installPingEnabled)).toBe(true);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.DashboardInstallCountNotice.state())).toBeNull();
    });

    test('"Turn it off" switches the setting off and records the answer', async ({ page }) => {
        await loadWithRowPending(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'Turn it off' }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.installPingEnabled)).toBe(false);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        // Put it back: this spec shares a data directory with the others. This
        // key only: a whole save also wrote the bell's mark for the row (the
        // coloured answer puts it aside), and the next test found no row.
        await page.evaluate(async () => {
            window.dashboardInstance.settings.installPingEnabled = true;
            await window.dashboardInstance.saveSettings({ keys: ['installPingEnabled'] });
        });
    });

    test('is not shown when the count is already off or locked off by the operator', async ({ page }) => {
        await loadWithRowPending(page);
        const off = await page.evaluate(() => {
            window.dashboardInstance.settings.installPingEnabled = false;
            return window.DashboardInstallCountNotice.state();
        });
        expect(off).toBeNull();
        const locked = await page.evaluate(() => {
            window.dashboardInstance.settings.installPingEnabled = true;
            window.dashboardInstance.telemetryLockedOff = true;
            return window.DashboardInstallCountNotice.state();
        });
        expect(locked).toBeNull();
    });

    test('"No" in the bell hides it for good', async ({ page }) => {
        await loadWithRowPending(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(page.locator(ROW)).toHaveCount(0);
        // And it is an answer, like "Fine by me": Config sees the promo as seen.
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.dashboardInstance.settings.installPingEnabled)).toBe(true);
    });
});
