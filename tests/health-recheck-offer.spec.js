// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The second health offer, a quiet row in the bell: the last link check is
 * over a week old and nothing is going to run another, because background
 * re-checks are switched off.
 */

const DAY = 86400000;
const ROW = '.notification-bell-row[data-bell-id="health-recheck-offer"]';

async function load(page, { monitored = 4, daysAgo = 10, auto = false, notice = true } = {}) {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            generatedAt: Date.now(),
            summary: { totalBookmarks: 6, monitoredCount: monitored, lastCheckedAt: Date.now() - daysAgo * DAY },
            issues: [],
        }),
    }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ auto, notice }) => {
        localStorage.removeItem('nextdashHealthReviewDoneOn');
        // A "No" said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            // schedulePersist() runs through the module's own closure, so only the
            // save can be held back: the shared ./data keeps no mark of a test.
            if (opts?.keys?.length === 1 && opts.keys[0] === 'discoverabilityState') return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
        const s = window.dashboardInstance.settings;
        s.healthAutoRecheckEnabled = auto;
        s.enableHealthRecheckNotice = notice;
        s.enableHealthReviewNotice = false;
    }, { auto, notice });
}

const state = (page) => page.evaluate(() => window.HealthRecheckOffer.state());

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('re-check offer', () => {
    test('shows when auto is off, links are monitored and the last check is old', async ({ page }) => {
        await load(page);
        await openBell(page);
        await expect(page.locator(ROW)).toBeVisible();
        await expect(page.locator(ROW).locator('.notification-bell-row-label')).toHaveText('Last link check was 10 days ago');
        // Nothing in the corner, and no postponing buttons: "No" is the bell's own.
        await expect(page.locator('.health-recheck-offer-card')).toHaveCount(0);
        await expect(page.locator(ROW).getByRole('button', { name: /Remind me|Not now/ })).toHaveCount(0);
        const row = await state(page);
        expect(row.count).toBe(10);
        expect(row.ids).toHaveLength(1);
    });

    test('stays quiet when auto is on', async ({ page }) => {
        await load(page, { auto: true });
        expect(await state(page)).toBeNull();
    });

    test('stays quiet without monitors', async ({ page }) => {
        await load(page, { monitored: 0 });
        expect(await state(page)).toBeNull();
    });

    test('stays quiet when the last check is recent', async ({ page }) => {
        await load(page, { daysAgo: 2 });
        expect(await state(page)).toBeNull();
    });

    test('stays quiet when the setting is off', async ({ page }) => {
        await load(page, { notice: false });
        expect(await state(page)).toBeNull();
    });

    test('No hides it until a newer check has gone stale again', async ({ page }) => {
        await load(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        // Still the same check, only older: that is not a new reason.
        await page.evaluate(() => { window.HealthBadgeUtils.fetchBookmarkHealthSummary = async () => ({ monitoredCount: 4, lastCheckedAt: Date.now() - 10 * 86400000 }); });
        await openBell(page);
        await expect(page.locator(ROW)).toHaveCount(0);
        // A different check date is a new id, so the row is back.
        await page.evaluate(() => { window.HealthBadgeUtils.fetchBookmarkHealthSummary = async () => ({ monitoredCount: 4, lastCheckedAt: Date.now() - 20 * 86400000 }); });
        await openBell(page);
        await expect(page.locator(ROW)).toBeVisible();
    });

    test('"Every day" turns background re-checks on, explicitly', async ({ page }) => {
        await load(page);
        await openBell(page);
        const save = page.waitForRequest((r) => r.url().includes('/api/settings') && r.method() !== 'GET');
        await page.locator(ROW).getByRole('button', { name: 'Every day' }).click();
        await save;
        const after = await page.evaluate(() => ({
            on: window.dashboardInstance.settings.healthAutoRecheckEnabled,
            hours: window.dashboardInstance.settings.healthAutoRecheckIntervalHours,
        }));
        expect(after).toEqual({ on: true, hours: 24 });
        await expect(page.locator(ROW)).toHaveCount(0);
    });

    test('"Re-check now" posts retest-all', async ({ page }) => {
        await load(page);
        let called = '';
        await page.route('**/api/health/retest-all**', (route) => {
            called = route.request().url();
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'Re-check now' }).click();
        await expect.poll(() => called).toContain('scope=all');
    });
});
