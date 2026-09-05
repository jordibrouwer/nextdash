// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * "Not today" is an answer about today, and comes back tomorrow. For someone
 * who is not going to do maintenance this month that is the pattern the card's
 * own design warns about: an offer that never goes away is one people learn to
 * stop reading.
 *
 * So the card gains a third answer — a month of quiet. It is deliberately not
 * called "ignore": ignoring is a per-bookmark, server-side mute of one health
 * condition, and this touches no bookmark at all. It only postpones the
 * invitation, which is why the assertions below check the counts are untouched.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        localStorage.removeItem('nextdashHealthReviewDoneOn');
        localStorage.removeItem('nextdashHealthReviewSnoozeUntil');
    });
}

/** How many rows a session would have to work with on this install. */
async function candidateCount(page) {
    return page.evaluate(async () => {
        const counts = await window.HealthReviewSession.reviewCounts();
        return counts ? counts.total : 0;
    });
}

test.describe('putting the review offer away for a month', () => {
    test('the button stamps a month out and stops the card coming back', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 5, 'the card deliberately stays quiet below five');

        await page.evaluate(() => window.HealthReviewSession.render());
        await page.locator(
            '.health-review-notice-card .quickstart-btn[data-health-review-action="remind"]',
        ).click();

        const stamp = await page.evaluate(
            () => Number(localStorage.getItem('nextdashHealthReviewSnoozeUntil')),
        );
        // Thirty days out, give or take the time the test itself took.
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        expect(stamp - Date.now()).toBeGreaterThan(thirtyDays - 60_000);
        expect(stamp - Date.now()).toBeLessThan(thirtyDays + 60_000);

        expect(await page.evaluate(() => window.HealthReviewSession.isSnoozed())).toBe(true);
        expect(await page.evaluate(() => window.HealthReviewSession.shouldShow())).toBe(false);

        // Postponing the offer is not muting a bookmark: every link that was
        // waiting is still waiting, and still reported.
        expect(await candidateCount(page)).toBe(total);
    });

    test('a month of quiet outlasts the day "Not today" answers for', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 5, 'the card deliberately stays quiet below five');

        // "Not today" is keyed on the local day, so tomorrow it has expired --
        // the snooze has to survive that, which is the whole point of it being
        // a separate key rather than a far-future value in the same one.
        await page.evaluate(() => window.HealthReviewSession.remindInThirtyDays());
        await page.evaluate(() => localStorage.setItem('nextdashHealthReviewDoneOn', '1999-01-01'));

        expect(await page.evaluate(() => window.HealthReviewSession.isDoneToday())).toBe(false);
        expect(await page.evaluate(() => window.HealthReviewSession.shouldShow())).toBe(false);
    });

    test('once the month is up the offer returns on its own', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 5, 'the card deliberately stays quiet below five');

        // A stamp that has already passed: nothing has to clear it by hand.
        await page.evaluate(() => localStorage.setItem(
            'nextdashHealthReviewSnoozeUntil', String(Date.now() - 1000)));

        expect(await page.evaluate(() => window.HealthReviewSession.isSnoozed())).toBe(false);
        expect(await page.evaluate(() => window.HealthReviewSession.render())).toBe(true);
        await expect(page.locator('.health-review-notice-card')).toBeVisible();
    });
});
