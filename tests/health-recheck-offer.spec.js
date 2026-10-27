// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The second health card: the last link check is over a week old and nothing
 * is going to run another, because background re-checks are switched off.
 */

const DAY = 86400000;
const CARD = '.health-recheck-offer-card';

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
        ['nextdashHealthRecheckOfferDoneOn', 'nextdashHealthRecheckOfferSnoozeUntil',
            'nextdashHealthReviewDoneOn', 'nextdashHealthReviewSnoozeUntil'].forEach((k) => localStorage.removeItem(k));
        const s = window.dashboardInstance.settings;
        s.healthAutoRecheckEnabled = auto;
        s.enableHealthRecheckNotice = notice;
        s.enableHealthReviewNotice = false;
    }, { auto, notice });
}

const canShow = (page) => page.evaluate(() => window.HealthRecheckOffer.shouldShow());

test.describe('re-check offer', () => {
    test('shows when auto is off, links are monitored and the last check is old', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => window.HealthRecheckOffer.render())).toBe(true);
        await expect(page.locator(CARD)).toBeVisible();
        await expect(page.locator(`${CARD} .quickstart-title`)).toHaveText('Last link check was 10 days ago');
    });

    test('stays quiet when auto is on', async ({ page }) => {
        await load(page, { auto: true });
        expect(await canShow(page)).toBe(false);
    });

    test('stays quiet without monitors', async ({ page }) => {
        await load(page, { monitored: 0 });
        expect(await canShow(page)).toBe(false);
    });

    test('stays quiet when the last check is recent', async ({ page }) => {
        await load(page, { daysAgo: 2 });
        expect(await canShow(page)).toBe(false);
    });

    test('stays quiet when the setting is off', async ({ page }) => {
        await load(page, { notice: false });
        expect(await canShow(page)).toBe(false);
    });

    test('"Remind me in 30 days" snoozes it', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.HealthRecheckOffer.render());
        await page.locator(`${CARD} [data-health-recheck-action="remind"]`).click();
        expect(await page.evaluate(() => window.HealthRecheckOffer.isSnoozed())).toBe(true);
        expect(await canShow(page)).toBe(false);
    });

    test('"Every day" turns background re-checks on, explicitly', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.HealthRecheckOffer.render());
        const save = page.waitForRequest((r) => r.url().includes('/api/settings') && r.method() !== 'GET');
        await page.locator(`${CARD} [data-health-recheck-action="auto"]`).click();
        await save;
        const after = await page.evaluate(() => ({
            on: window.dashboardInstance.settings.healthAutoRecheckEnabled,
            hours: window.dashboardInstance.settings.healthAutoRecheckIntervalHours,
        }));
        expect(after).toEqual({ on: true, hours: 24 });
        await expect(page.locator(CARD)).toHaveCount(0);
    });

    test('"Re-check now" posts retest-all', async ({ page }) => {
        await load(page);
        let called = '';
        await page.route('**/api/health/retest-all**', (route) => {
            called = route.request().url();
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await page.evaluate(() => window.HealthRecheckOffer.render());
        await page.locator(`${CARD} [data-health-recheck-action="now"]`).click();
        await expect.poll(() => called).toContain('scope=all');
    });
});
