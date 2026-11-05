// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch, headers } = require('./helpers/feed-watch');

/**
 * Watched news that nobody read: the row badge stops at 9+, the hover card
 * pages through ten, and the bell holds one row that is updated, never a
 * second one, and goes when the news is gone (read or expired). The watch
 * routes are stubbed; expiry itself is the server's rule (Go tests).
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => {
    await site.close();
});

const items = (key, n) => Array.from({ length: n }, (_, i) => ({
    ...newsItem(i + 1), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
}));

async function setup(page, count) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const state = { list: watchPayload(key, items(key, count)), items: items(key, count) };
    await stubWatch(page, state);
    await openDashboard(page);
    return { key, state };
}

/** Change what the stubbed server answers and let the page pick it up. */
async function serve(page, state, key, count) {
    state.list = watchPayload(key, items(key, count));
    state.items = items(key, count);
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));
}

const bellRows = (page) => page.locator('.notification-bell-row[data-bell-id="feed-watch"]');
const openBell = async (page) => {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
};

test('the row badge shows 9 as 9 and ten as 9+', async ({ page }) => {
    const { key, state } = await setup(page, 9);
    const badge = row(page, 'Stub Blog').locator('.bookmark-news-badge');
    await expect(badge).toHaveText('9');
    await serve(page, state, key, 10);
    await expect(badge).toHaveText('9+');
    await expect(badge).toHaveAttribute('aria-label', /10/);
});

test('the hover card pages through ten unread items', async ({ page }) => {
    await setup(page, 10);
    await row(page, 'Stub Blog').hover();
    await expect(page.locator('#bookmark-preview-card .bookmark-preview-card-news-count')).toHaveText('1 / 10');
});

test('the tab title keeps the exact count', async ({ page }) => {
    await setup(page, 12);
    await expect.poll(() => page.title()).toMatch(/^\(12\) /);
});

test('new posts update the one bell row, and it leaves with the news', async ({ page }) => {
    const { key, state } = await setup(page, 2);
    await openBell(page);
    await expect(bellRows(page)).toHaveCount(1);
    await expect(bellRows(page)).toContainText('2 new from a watched feed');
    await expect(page.locator('#app-notification.show')).toHaveCount(0);

    await serve(page, state, key, 5);
    await openBell(page);
    await expect(bellRows(page)).toHaveCount(1);
    await expect(bellRows(page)).toContainText('5 new from a watched feed');

    await serve(page, state, key, 0);
    await openBell(page);
    await expect(bellRows(page)).toHaveCount(0);
});

test('a muted feed gives no bell row', async ({ page }) => {
    const { key, state } = await setup(page, 3);
    state.list.watches[key].muted = true;
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));
    await openBell(page);
    await expect(bellRows(page)).toHaveCount(0);
});

test('the expiry setting rides along with settings', async ({ request }) => {
    const settings = await (await request.get('/api/settings')).json();
    expect(settings.feedWatchExpireHours).toBe(24);
    expect((await request.post('/api/settings', { data: { feedWatchExpireHours: 8 }, headers })).ok()).toBe(true);
    expect((await (await request.get('/api/settings')).json()).feedWatchExpireHours).toBe(8);
    await request.post('/api/settings', { data: { feedWatchExpireHours: 24 }, headers });
});

test('the bell rings for more news, not when the news only shrinks', async ({ page }) => {
    const { key, state } = await setup(page, 5);
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => {
        window.__sound = 0;
        window.NotificationBell.playSound = () => { window.__sound++; };
    });
    await serve(page, state, key, 3); // one site opened, an item expired
    await page.evaluate(() => window.NotificationBell.refreshAll());
    expect(await page.evaluate(() => window.__sound)).toBe(0);
    await serve(page, state, key, 7);
    await page.evaluate(() => window.NotificationBell.refreshAll());
    expect(await page.evaluate(() => window.__sound)).toBe(1);
});
