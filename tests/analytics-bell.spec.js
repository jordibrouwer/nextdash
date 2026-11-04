// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The analytics invitation is a quiet row in the bell (Privacy): present while
 * analytics is off and the question is open, gone once answered or when the
 * operator locked telemetry off, and never a corner card with a snooze.
 */

const ROW = '.notification-bell-row[data-bell-id="analytics-notice"]';

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.DashboardAnalyticsNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // A "No" said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            // schedulePersist() runs through the module's own closure, so only the
            // save can be held back: the shared ./data keeps no mark of a test.
            if (opts?.keys?.length === 1 && opts.keys[0] === 'discoverabilityState') return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
        const s = window.dashboardInstance.settings;
        s.analyticsOptIn = false;
        s.quickStart = { ...(s.quickStart || {}), analyticsChoiceMade: false, analyticsAskAfter: 0 };
    });
}

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('analytics in the bell', () => {
    test('is a Privacy row with Turn on and What is recorded?, and no corner card', async ({ page }) => {
        await load(page);
        await openBell(page);
        const row = page.locator(ROW);
        await expect(row).toBeVisible();
        await expect(page.locator(`.notification-bell-group[data-bell-group="privacy"] ${ROW}`)).toBeVisible();
        await expect(page.locator('.analytics-notice-card')).toHaveCount(0);
        await expect(row.getByRole('button', { name: 'Turn on' })).toBeVisible();
        await expect(row.getByRole('button', { name: 'What is recorded?' })).toBeVisible();
        await expect(row.getByRole('button', { name: 'No thanks' })).toHaveCount(0);
    });

    test('an old snooze does not hide it any more', async ({ page }) => {
        await load(page);
        await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            s.quickStart = { ...s.quickStart, analyticsAskAfter: Math.floor(Date.now() / 1000) + 30 * 86400 };
        });
        expect(await page.evaluate(() => window.DashboardAnalyticsNotice.state())).not.toBeNull();
    });

    test('stays away once analytics is on, answered, or locked off by the operator', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => {
            window.dashboardInstance.settings.analyticsOptIn = true;
            return window.DashboardAnalyticsNotice.state();
        })).toBeNull();
        expect(await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            s.analyticsOptIn = false;
            s.quickStart = { ...s.quickStart, analyticsChoiceMade: true };
            return window.DashboardAnalyticsNotice.state();
        })).toBeNull();
        expect(await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            s.quickStart = { ...s.quickStart, analyticsChoiceMade: false };
            const meta = document.createElement('meta');
            meta.name = 'nextdash-telemetry-locked';
            document.head.appendChild(meta);
            return window.DashboardAnalyticsNotice.state();
        })).toBeNull();
    });

    test('What is recorded? opens the explanation and keeps the row', async ({ page }) => {
        await load(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'What is recorded?' }).click();
        await expect(page.locator('.analytics-notice-modal-body')).toBeVisible();
        expect(await page.evaluate(() => window.DashboardAnalyticsNotice.state())).not.toBeNull();
    });

    test('No in the bell hides it for good', async ({ page }) => {
        await load(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(page.locator(ROW)).toHaveCount(0);
        // A real decline, as "No thanks" was: the choice is recorded, analytics stays off.
        expect(await page.evaluate(() => window.dashboardInstance.settings.quickStart.analyticsChoiceMade)).toBe(true);
        expect(await page.evaluate(() => window.dashboardInstance.settings.analyticsOptIn)).toBe(false);
        expect(await page.evaluate(() => window.DashboardAnalyticsNotice.state())).toBeNull();
    });
});
