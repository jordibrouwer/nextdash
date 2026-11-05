// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, headers } = require('./helpers/feed-watch');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Watch feeds holds the list of watched feeds, a way to check them
 * now, and how long the news stays open.
 */
// Polling is global, so the tests of this file take turns.
test.describe.configure({ mode: 'serial' });

let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async ({ request }) => {
    await site.close();
    // The server is shared with whoever runs the dev server on this data: put the
    // news layout and window back, so a test never leaves the reader's choice changed.
    await request.post('/api/settings', { data: { feedWatchNewsView: 'paper', feedWatchWindowMinutes: 30 }, headers });
});

async function openFresh(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    // Through the rail, the way a reader gets there.
    await page.locator('[data-config-section="feed-watch"]').click();
    await page.waitForSelector('[data-feed-watch-overview] [data-fwm-more]', { timeout: 15_000 });
}

test('with nothing watched the section explains itself in three steps and starts the chooser', async ({ page }) => {
    await openFresh(page);
    const empty = page.locator('[data-feed-watch-overview] .feed-watch-empty');
    await expect(empty).toContainText('You are not watching any feed yet');
    await expect(empty.locator('.feed-watch-empty-steps li')).toHaveCount(3);
    // No list controls over an empty list.
    await expect(page.locator('[data-feed-watch-overview] .fwm-toolbar')).toHaveCount(0);
    await empty.locator('[data-fwm-more]').click();
    await expect(page.locator('[data-feed-watch-picker], .modal.feed-watch-modal').first()).toBeVisible();
});

test('the window select saves and the news modal uses it', async ({ page, request }) => {
    await openFresh(page);
    // The settings are their own tab; the list is the first.
    await page.locator('[data-fw-tab="settings"]').click();
    const select = page.locator('[data-behavior-field="feedWatchWindowMinutes"]');
    await expect(select).toBeVisible();
    await select.selectOption('60');
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedWatchWindowMinutes).toBe(60);
    expect(await page.evaluate(() => window.dashboardInstance.feedWatch.windowMs())).toBe(3_600_000);
});

test('the expiry select saves news age', async ({ page, request }) => {
    await openFresh(page);
    await page.locator('[data-fw-tab="settings"]').click();
    const select = page.locator('[data-behavior-field="feedWatchExpireHours"]');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(8);
    await expect(select).toHaveValue('24');
    await select.selectOption('168');
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedWatchExpireHours).toBe(168);
    await request.post('/api/settings', { data: { feedWatchExpireHours: 24 }, headers });
});

test('Check all now polls and reports how many are watched', async ({ page, request }) => {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
    })).ok()).toBe(true);
    site.add('A brand new post');
    await openFresh(page);
    const status = page.locator('[data-feed-watch-overview] .feed-watch-list-summary');
    await expect(status).toContainText('1 of 100 watched');
    await page.locator('[data-fwm-check]').click();
    // Any poll in the shared server may have found the post first; the stored
    // count is what must be 1, and the summary follows it.
    await expect.poll(async () => Object.values((await (await request.get('/api/feeds/watch')).json()).watches)[0].newCount).toBe(1);
    await expect(status).toContainText('1 with news');
});

test('Show news as saves the layout and the news modal uses it', async ({ page, request }) => {
    await openFresh(page);
    await page.locator('[data-fw-tab="settings"]').click();
    const select = page.locator('[data-behavior-field="feedWatchNewsView"]');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('paper');
    await select.selectOption('wide');
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedWatchNewsView).toBe('wide');
    expect(await page.evaluate(() => window.dashboardInstance.settings.feedWatchNewsView)).toBe('wide');
});

test('the section lists what is watched: feed, interval, last check and state, with Choose feeds and Stop', async ({ page, request }) => {
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
    await expect(row.locator('[data-fwm-interval]')).toHaveValue('120');
    await expect(row.locator('.feed-watch-list-state')).toHaveText('Nothing new');
    await expect(list.locator('.feed-watch-list-summary')).toContainText('1 of 100 watched · 0 with news');

    // News turns the state and the summary.
    site.add('Fresh post');
    await page.locator('[data-fwm-check]').click();
    await expect(row.locator('.feed-watch-list-state')).toHaveText('1 new');
    await expect(list.locator('.feed-watch-list-summary')).toContainText('1 with news');

    // The row opens its detail; Choose feeds… opens the picker for that
    // bookmark, and Stop watching ends the watch once confirmed.
    await row.locator('[data-fwm-toggle]').click();
    const detail = list.locator('.fwm-detail');
    await detail.locator('[data-fwl-edit]').click();
    await expect(page.locator('[data-feed-watch-picker]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-feed-watch-picker]')).toBeHidden();
    await detail.locator('[data-fwl-stop]').click();
    await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
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
