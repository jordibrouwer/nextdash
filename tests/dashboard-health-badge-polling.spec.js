// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Header health-badge polling.
 *
 * It used to run on a fixed 60s setInterval with no backoff. The server caches
 * the health report for healthReportCacheTTL (3 minutes, handlers.go), so two
 * of every three polls could only ever be handed the same cached report back —
 * a full round trip and a full JSON parse to learn nothing. And a server that
 * was down got asked again every 60 seconds, from every open tab, for as long
 * as it stayed down.
 *
 * The delays under test are minutes long, so rather than waiting them out (or
 * replacing the global clock, which catches every other timer in the app too)
 * these drive the poller's own tick directly and assert on the delay it arms
 * next, which it records on the instance.
 */

async function openWithBadge(page, { failRequests = false } = {}) {
    await page.addInitScript(() => { window.__healthRequests = 0; });

    await page.route('**/api/bookmark-health**', async (route) => {
        await page.evaluate(() => { window.__healthRequests += 1; }).catch(() => {});
        if (failRequests) {
            await route.fulfill({ status: 500, contentType: 'text/plain', body: 'nope' });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                generatedAt: Date.now(),
                summary: { totalBookmarks: 1, healthyCount: 1 },
                issues: [],
                duplicateGroups: [],
            }),
        });
    });

    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Arm the poller through the real entry point.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.showHealthDashboard = true;
        d.visual.syncHealthBadgePolling();
    });
}

/** The delay the poller has armed right now. */
const armedFor = (page) =>
    page.evaluate(() => window.dashboardInstance.visual._healthBadgePollArmedFor);

const requestCount = (page) => page.evaluate(() => window.__healthRequests);

/** Fire one poll and wait for it to re-arm. */
const pollOnce = (page) =>
    page.evaluate(() => window.dashboardInstance.visual._healthBadgePollNow());

const constants = (page) => page.evaluate(() => ({
    base: DashboardVisual.HEALTH_POLL_BASE_MS,
    max: DashboardVisual.HEALTH_POLL_MAX_MS,
}));

test.describe('health badge polling', () => {
    test('polls on the server cache TTL, not a shorter fixed interval', async ({ page }) => {
        await openWithBadge(page);
        const { base } = await constants(page);

        // The point of the change: the base delay tracks handlers.go's
        // healthReportCacheTTL rather than the old 60s, which guaranteed two of
        // every three polls hit an unchanged cached report.
        expect(base).toBe(3 * 60 * 1000);
        expect(await armedFor(page)).toBe(base);

        const before = await requestCount(page);
        await pollOnce(page);
        expect(await requestCount(page)).toBe(before + 1);
        expect(await armedFor(page), 'a good poll should re-arm at the base delay').toBe(base);
    });

    test('a failing server backs off exponentially instead of asking every minute', async ({ page }) => {
        await openWithBadge(page, { failRequests: true });
        const { base, max } = await constants(page);

        expect(await armedFor(page)).toBe(base);

        await pollOnce(page);
        expect(await armedFor(page)).toBe(base * 2);
        await pollOnce(page);
        expect(await armedFor(page)).toBe(base * 4);
        // base * 8 would be 24 minutes, past the cap, so this one clamps.
        await pollOnce(page);
        expect(await armedFor(page)).toBe(max);

        // The control: without backoff each of these would still read `base`.
        expect(await armedFor(page)).toBeGreaterThan(base);
    });

    test('the backoff is capped, so a long outage still gets retried', async ({ page }) => {
        await openWithBadge(page, { failRequests: true });
        const { max } = await constants(page);

        for (let i = 0; i < 12; i += 1) {
            await pollOnce(page);
        }

        // Capped rather than growing without bound: a server that comes back
        // after an hour is still noticed within HEALTH_POLL_MAX_MS.
        expect(await armedFor(page)).toBe(max);
    });

    test('a recovered server drops straight back to the base interval', async ({ page }) => {
        await openWithBadge(page, { failRequests: true });
        const { base } = await constants(page);

        await pollOnce(page);
        await pollOnce(page);
        expect(await armedFor(page)).toBeGreaterThan(base);

        await page.unroute('**/api/bookmark-health**');
        await page.route('**/api/bookmark-health**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ generatedAt: Date.now(), summary: {}, issues: [], duplicateGroups: [] }),
        }));

        await pollOnce(page);
        expect(await armedFor(page), 'a good poll should reset the delay').toBe(base);
    });

    test('a hidden tab stops polling without queueing a wakeup', async ({ page }) => {
        await openWithBadge(page);
        expect(await armedFor(page)).not.toBeNull();

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        // Nothing armed at all: a background tab must not wake up for a request
        // it would refuse to make anyway.
        expect(await armedFor(page)).toBeNull();

        // And a tick that does land while hidden makes no request and stays quiet.
        const before = await requestCount(page);
        await pollOnce(page);
        expect(await requestCount(page), 'a hidden tab polled anyway').toBe(before);
        expect(await armedFor(page)).toBeNull();
    });

    test('returning to the tab refreshes at once and restarts at the base interval', async ({ page }) => {
        await openWithBadge(page, { failRequests: true });
        const { base } = await constants(page);

        await pollOnce(page);
        await pollOnce(page);
        expect(await armedFor(page)).toBeGreaterThan(base);

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        const before = await requestCount(page);
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        // Exactly one refresh, from dashboard.js's own visibilitychange
        // handler. The poller deliberately does not fetch here as well: doing
        // it in both places fetched the report twice on every tab switch.
        await expect.poll(() => requestCount(page), { timeout: 5_000 }).toBe(before + 1);
        await page.waitForTimeout(300);
        expect(await requestCount(page), 'the badge was fetched twice on return').toBe(before + 1);

        // And the backoff is reset, so the next poll comes at the base delay
        // rather than whatever the outage had crept up to.
        expect(await armedFor(page)).toBe(base);
    });

    test('the health view is left to refresh itself, but polling resumes after it', async ({ page }) => {
        await openWithBadge(page);
        const { base } = await constants(page);

        await page.evaluate(() => { window.dashboardInstance.activeView = 'health'; });
        const before = await requestCount(page);
        await pollOnce(page);

        expect(await requestCount(page), 'polled while the health view was open').toBe(before);
        // Still armed — otherwise leaving the view would never resume polling.
        expect(await armedFor(page)).toBe(base);

        await page.evaluate(() => { window.dashboardInstance.activeView = 'bookmarks'; });
        await pollOnce(page);
        expect(await requestCount(page)).toBe(before + 1);
    });
});
