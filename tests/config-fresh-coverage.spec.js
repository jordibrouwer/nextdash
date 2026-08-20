// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * An empty Fresh is the normal state, and it looked exactly like a broken one.
 *
 * Most saved pages carry no feed, so a reader who switches Fresh on usually
 * sees nothing change — with no way to tell "nothing new" from "nothing to look
 * at", or from "this feature does not work". The panel says which it is now:
 * how many bookmarks have been asked, and how many of them publish anything.
 */

async function openFreshPanel(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.openConfigView('behavior');
        c.behaviorTab = 'fresh';
        c.render();
    });
    await page.waitForSelector('[data-config-action="findFeeds"]', { timeout: 15_000 });
}

test.describe('Fresh says what it found', () => {
    test('the panel reports coverage rather than leaving an empty dashboard unexplained', async ({ page }) => {
        // A collection where every page has been asked and none publishes
        // anything — the case that reads as a broken feature.
        await page.route('**/api/feeds', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                enabled: true, feeds: {}, lastPoll: Date.now(),
                bookmarks: 7, checked: 7, withFeed: 0, lastDiscovery: Date.now(),
            }),
        }));

        await openFreshPanel(page);
        await page.evaluate(async () => {
            await window.dashboardInstance.feeds.load({ force: true });
            window.dashboardInstance.config.paintFeedCoverage();
        });

        const status = page.locator('[data-config-action-status="findFeeds"]');
        await expect(status).toContainText('7');
        // And the sentence that says an empty Fresh is not a fault.
        await expect(status).toContainText(/nothing for Fresh to count|niets te tellen|nichts zu zählen|rien à compter/);
    });

    test('the button looks for feeds and repaints what it found', async ({ page }) => {
        await page.route('**/api/feeds', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ enabled: true, feeds: {}, bookmarks: 7, checked: 0, withFeed: 0 }),
        }));

        let polls = 0;
        await page.route('**/api/feeds/poll', (route) => {
            polls += 1;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    polled: 1, discovered: 7, found: 1,
                    bookmarks: 7, checked: 7, withFeed: 1,
                    feeds: {}, lastPoll: Date.now(), lastDiscovery: Date.now(),
                }),
            });
        });

        await openFreshPanel(page);
        await page.click('[data-config-action="findFeeds"]');

        await expect.poll(() => polls, { timeout: 10_000 }).toBe(1);
        const status = page.locator('[data-config-action-status="findFeeds"]');
        await expect(status).toContainText('7');
        await expect(status).toContainText('1');
    });
});
