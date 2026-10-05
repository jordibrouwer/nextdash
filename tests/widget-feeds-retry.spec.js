// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A stopped feed in the Feeds widget has a Retry that asks the server to try it
 * again now, and the tile redraws from what comes back.
 */

test('Retry on a stopped feed posts its address and redraws the tile', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    const result = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        const sent = [];
        const dead = { feedUrl: 'https://dead.example/feed', retired: true, failures: 5 };
        const alive = { feedUrl: 'https://dead.example/feed', retired: false, newCount: 2 };
        const savedFreshness = d.feedFreshness;
        delete d.feedFreshness;
        d._widgetFeeds = { 'dead.example': dead };
        window.fetch = async (url, init) => {
            if (String(url).includes('/api/feeds/retry')) {
                sent.push(JSON.parse(init.body));
                return new Response(JSON.stringify({ reset: 1, feeds: { 'dead.example': alive } }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(url, init);
        };
        const body = document.createElement('div');
        document.body.appendChild(body);
        const widget = { id: 'w_feeds_retry', type: 'feeds', config: {} };
        try {
            await window.DashboardWidgets.feeds(body, widget, d);
            const before = body.textContent;
            body.querySelector('.dashboard-widget-feeds-retry').click();
            await new Promise((resolve) => setTimeout(resolve, 300));
            return { before, after: body.textContent, badRows: body.querySelectorAll('.dashboard-widget-row--bad').length, sent, hasRetry: !!body.querySelector('.dashboard-widget-feeds-retry') };
        } finally {
            window.fetch = realFetch;
            delete d._widgetFeeds;
            if (savedFreshness) d.feedFreshness = savedFreshness;
            body.remove();
        }
    });

    expect(result.before).toContain('stopped');
    expect(result.sent).toEqual([{ feedUrl: 'https://dead.example/feed' }]);
    expect(result.hasRetry).toBe(false);
    expect(result.badRows).toBe(0);
    expect(result.after).toContain('2 new');
});
