// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Cleaning as a ritual: ten links, and then an end.
 *
 * Work through was reachable only from a health filter, by someone who had
 * already decided to do maintenance — which is the hard part, not the work. So
 * the same mechanic is offered from the dashboard with the size of the job
 * stated, and it is bounded: ten rows, a count of what was dealt with, and a
 * "done for today" that means the offer does not come back until tomorrow.
 *
 * What is pinned here is the bounding, because that is the whole idea. An
 * unbounded queue is the thing people learn to ignore.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.HealthReviewSession?.markDoneToday && localStorage.removeItem('nextdashHealthReviewDoneOn');
        // A "No" said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            // schedulePersist() runs through the module's own closure, so only the
            // save can be held back: the shared ./data keeps no mark of a test.
            if (opts?.keys?.length === 1 && opts.keys[0] === 'discoverabilityState') return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
    });
}

const ROW = '.notification-bell-row[data-bell-id="health-review-notice"]';

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

/** How many rows a session would have to work with on this install. */
async function candidateCount(page) {
    return page.evaluate(async () => {
        const counts = await window.HealthReviewSession.reviewCounts();
        return counts ? counts.total : 0;
    });
}

test.describe('a review session', () => {
    test('takes at most ten, and says which of them it is on', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 1, 'needs at least one reviewable bookmark');

        const started = await page.evaluate(() => window.HealthReviewSession.start());
        expect(started).toBe(true);

        const card = page.locator('.health-focus-card');
        await expect(card).toBeVisible({ timeout: 15_000 });

        const queue = await page.evaluate(() => {
            const focus = window.dashboardInstance.config.instance._libFocus;
            return { length: focus.queue.length, session: focus.session };
        });
        expect(queue.length).toBeLessThanOrEqual(10);
        expect(queue.session.started).toBe(queue.length);
        // The header says it is a session rather than a filter run — the count
        // is the point of the whole thing.
        await expect(page.locator('.health-focus-progress')).toContainText(`1`);
        await expect(page.locator('.health-focus-progress')).toContainText(String(queue.length));
    });

    test('ends with a count, and Done for today keeps it away until tomorrow', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 1, 'needs at least one reviewable bookmark');

        await page.evaluate(() => window.HealthReviewSession.start());
        await expect(page.locator('.health-focus-card')).toBeVisible({ timeout: 15_000 });

        // Walk to the end the way the keyboard does. Skipping is not handling,
        // so the count below has to be 0 of N rather than N of N.
        const length = await page.evaluate(() =>
            window.dashboardInstance.config.instance._libFocus.queue.length);
        for (let i = 0; i < length; i += 1) {
            await page.keyboard.press('j');
        }

        const done = page.locator('.health-focus-card--done');
        await expect(done).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.health-focus-done-count')).toContainText(String(length));

        await done.locator('[data-focus="done-today"]').click();
        await expect(page.locator('.health-focus-card')).toHaveCount(0);
        expect(await page.evaluate(() => window.HealthReviewSession.isDoneToday())).toBe(true);
        // And the offer is answered: the row does not come back today.
        expect(await page.evaluate(() => window.HealthReviewSession.state())).toBeNull();
    });
});

test.describe('the offer in the bell', () => {
    test('names what is waiting, and starts the session', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 5, 'the row deliberately stays quiet below five');

        await openBell(page);
        const row = page.locator(ROW);
        await expect(row).toBeVisible();
        // The corner is not used: the offer is a quiet row, nothing is drawn there.
        await expect(page.locator('.health-review-notice-card')).toHaveCount(0);
        // The text counts by condition rather than showing one lump number,
        // because "4 broken" is a reason to start and "37 issues" is not.
        await expect(row.locator('.notification-bell-row-label')).toContainText(/\d/);
        await expect(row.getByRole('button', { name: 'Not today' })).toHaveCount(0);

        await row.getByRole('button', { name: 'Start' }).click();
        await expect(page.locator('.health-focus-card')).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() =>
            Boolean(window.dashboardInstance.config.instance._libFocus.session))).toBe(true);
    });

    test('No hides it, without touching the health data, and one more link brings it back', async ({ page }) => {
        await loadDashboard(page);
        const total = await candidateCount(page);
        test.skip(total < 5, 'the row deliberately stays quiet below five');

        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        // Answering is about the offer, not the bookmarks: the same links are
        // still waiting.
        expect(await candidateCount(page)).toBe(total);

        // One more reviewable link is "worse" than when it was answered.
        await page.evaluate((n) => {
            window.HealthBadgeUtils.fetchBookmarkHealthSummary = async () => ({ unusedCount: n + 1 });
        }, total);
        await openBell(page);
        await expect(page.locator(ROW)).toBeVisible();
    });
});
