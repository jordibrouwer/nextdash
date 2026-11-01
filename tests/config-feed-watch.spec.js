// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, headers } = require('./helpers/feed-watch');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Bookmarks → Fresh holds the two things a watch needs: how long the
 * news stays open, and a way to check the watched feeds now.
 */
// Polling is global, so the tests of this file take turns.
test.describe.configure({ mode: 'serial' });

let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

async function openFresh(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.bmTab = 'fresh';
        c.openConfigView('bookmarks');
    });
    await page.waitForSelector('[data-config-action="checkWatched"]', { timeout: 15_000 });
}

test('the window select saves and the news modal uses it', async ({ page, request }) => {
    await openFresh(page);
    const select = page.locator('[data-behavior-field="feedWatchWindowMinutes"]');
    await expect(select).toBeVisible();
    await select.selectOption('60');
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedWatchWindowMinutes).toBe(60);
    expect(await page.evaluate(() => window.dashboardInstance.feedWatch.windowMs())).toBe(3_600_000);
});

test('Check watched feeds now polls and reports how many are watched', async ({ page, request }) => {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
    })).ok()).toBe(true);
    site.add('A brand new post');
    await openFresh(page);
    const status = page.locator('[data-config-action-status="checkWatched"]');
    await expect(status).toContainText('1 of 100 watched');
    await page.locator('[data-config-action="checkWatched"]').click();
    // Any poll in the shared server may have found the post first, so the
    // round can report 0 new; the stored count below is what must be 1.
    await expect(status).toContainText(/\d+ with news/);
    const list = await (await request.get('/api/feeds/watch')).json();
    expect(Object.values(list.watches)[0].newCount).toBe(1);
});

test('Show news as saves the layout and the news modal uses it', async ({ page, request }) => {
    await openFresh(page);
    const select = page.locator('[data-behavior-field="feedWatchNewsView"]');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('paper');
    await select.selectOption('wide');
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedWatchNewsView).toBe('wide');
    expect(await page.evaluate(() => window.dashboardInstance.settings.feedWatchNewsView)).toBe('wide');
});

test('the tab lists what is watched: feed, interval, last check and state, with Change and Stop', async ({ page, request }) => {
    await openFresh(page);
    const list = page.locator('[data-feed-watch-overview]');
    await expect(list).toContainText('You are not watching any feed yet');

    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 120 }] },
    })).ok()).toBe(true);
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));
    const row = list.locator('.feed-watch-list-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Stub Blog');
    await expect(row).toContainText('Stub Posts');
    await expect(row).toContainText('every 2 hours');
    await expect(row.locator('.feed-watch-list-state')).toHaveText('Nothing new');
    await expect(list.locator('.feed-watch-list-summary')).toContainText('1 of 100 watched · 0 with news');

    // News turns the state and the summary.
    site.add('Fresh post');
    await page.locator('[data-config-action="checkWatched"]').click();
    await expect(row.locator('.feed-watch-list-state')).toHaveText('1 new');
    await expect(list.locator('.feed-watch-list-summary')).toContainText('1 with news');

    // Change opens the picker for that bookmark; Stop ends the watch.
    await row.locator('[data-fwl-edit]').click();
    await expect(page.locator('[data-feed-watch-picker]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-feed-watch-picker]')).toBeHidden();
    await row.locator('[data-fwl-stop]').click();
    await expect(list).toContainText('You are not watching any feed yet');
    expect((await (await request.get('/api/feeds/watch')).json()).total).toBe(0);
});

test('a paused feed says why and Retry brings it back', async ({ page, request }) => {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 30 }] },
    })).ok()).toBe(true);
    site.breakFeed();
    for (let i = 0; i < 5; i += 1) await request.post('/api/feeds/watch/poll', { headers, data: {} });
    await openFresh(page);
    const row = page.locator('[data-feed-watch-overview] .feed-watch-list-row');
    await expect(row.locator('.feed-watch-list-state')).toHaveText('Paused after repeated failures · Not found (404)');
    site.breakFeed(false);
    await row.locator('[data-fwl-retry]').click();
    await expect(row.locator('.feed-watch-list-state')).toHaveText('Nothing new');
    await expect(row.locator('[data-fwl-retry]')).toHaveCount(0);
});
