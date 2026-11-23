// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * An outage reaches the bell without waiting for a poll.
 *
 * The badge poll runs every 3 minutes and the bell tick every 5, so a row that
 * shows up within seconds can only have come from the live channel. The write
 * is the real one: a status batch posted to the server, which invalidates the
 * health report and pings every open stream.
 */

const HEALTH_ROW = '.notification-bell-row[data-bell-id="health-outage"]';

test('a health write reaches the bell through the live channel', async ({ page }) => {
    let down = 0;
    await page.route('**/api/bookmark-health?view=facts*', (route) => route.fulfill({ json: {
        generatedAt: Date.now(),
        summary: { monitorDownCount: down, brokenCount: 0 },
        rows: Array.from({ length: down }, (_, i) => ({ url: `https://down-${i}.example.test/`, monitor: true, downSince: Date.now() - 60_000, lastError: 'timeout' })),
    } }));

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.LiveChannel, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.LiveChannel.connected === true, null, { timeout: 10_000 });
    // The channel refreshes once on connecting; let that settle so the outage
    // below cannot be picked up by it.
    await page.waitForTimeout(2000);
    await expect(page.locator(HEALTH_ROW)).toHaveCount(0);

    // The outage starts; only the server knows until something tells the page.
    down = 1;
    const target = await page.evaluate(() => {
        const d = window.dashboardInstance;
        return { pageId: d.currentPageId ?? d.pages[0].id, url: d.bookmarks[0]?.url };
    });
    expect(target.url).toBeTruthy();
    const res = await page.request.post('/api/health/statuses', {
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
        data: { pageId: target.pageId, results: [{ url: target.url, status: 'offline', error: 'timeout' }] },
    });
    expect(res.ok()).toBe(true);

    await page.evaluate(() => window.NotificationBell.open());
    await expect(page.locator(HEALTH_ROW)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(HEALTH_ROW)).toContainText('1 monitored bookmarks not responding');
});

test('the stream closes while the tab is hidden and opens again on return', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.LiveChannel?.connected === true, null, { timeout: 15_000 });
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.LiveChannel.connected === false, null, { timeout: 5_000 });
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.LiveChannel.connected === true, null, { timeout: 10_000 });
});
