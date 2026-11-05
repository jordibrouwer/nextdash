// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, keyOf, newsItem, headers } = require('./helpers/feed-watch');

/**
 * Telling the reader: one merged row in the notifications bell, a count in the
 * tab title, and ?news=1 (where a push notification lands). The watch routes
 * are stubbed; two bookmarks have news, 2 items on one and 1 on the other.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    const { pid } = await installWithBookmark(request, site, 'Site A');
    const pages = await (await request.get(`/api/bookmarks?page=${pid}`)).json();
    const cats = await (await request.get(`/api/categories?page=${pid}`)).json();
    await request.post(`/api/bookmarks?page=${pid}`, {
        data: [...pages, { name: 'Site B', url: `${site.base}/b`, category: cats[0].id }], headers,
    });
});
test.afterEach(async () => { await site.close(); });

const toast = (page) => page.locator('#app-notification.show');
const bellRow = (page) => page.locator('.notification-bell-row[data-bell-id="feed-watch"]');
const openBell = async (page) => {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
};
const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');

async function stubTwoSites(page) {
    await page.goto('/');
    const keyA = await keyOf(page, site.url);
    const keyB = await keyOf(page, `${site.base}/b`);
    const a = [1, 2].map((n) => ({ ...newsItem(n), bookmarkKey: keyA, bookmarkName: 'Site A', bookmarkUrl: site.url }));
    const b = [{ ...newsItem(3), bookmarkKey: keyB, bookmarkName: 'Site B', bookmarkUrl: `${site.base}/b` }];
    const entry = (items, key) => ({ newCount: items.length, newAt: Date.now(), newest: items[0],
        feeds: [{ feedUrl: 'http://127.0.0.1:1/f', title: 'T', intervalMinutes: 60 }] });
    const list = { limit: 100, total: 2, watches: { [keyA]: entry(a, keyA), [keyB]: entry(b, keyB) } };
    await page.route('**/api/feeds/watch', (route) => (route.request().method() !== 'GET'
        ? route.continue()
        : route.fulfill({ contentType: 'application/json', body: JSON.stringify(list) })));
    await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ items: [...a, ...b] }),
    }));
}

test('news on two sites gives one merged bell row whose Read opens the news modal', async ({ page }) => {
    await stubTwoSites(page);
    await openDashboard(page);
    await openBell(page);
    await expect(bellRow(page)).toHaveCount(1);
    await expect(bellRow(page)).toContainText('3 new from 2 watched feeds');
    await bellRow(page).getByRole('button', { name: 'Read', exact: true }).click();
    await expect(modal(page)).toBeVisible();
    // It opens on the index of what is new.
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(3);
    await modal(page).locator('.feed-news-entry').first().click();
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');
});

test('news never makes a toast, and a reload brings back the one row', async ({ page }) => {
    await stubTwoSites(page);
    await openDashboard(page);
    await openBell(page);
    await expect(bellRow(page)).toHaveCount(1);
    await page.reload();
    await openDashboard(page);
    await openBell(page);
    await expect(bellRow(page)).toHaveCount(1);
    await expect(page.locator('#app-notification.show', { hasText: 'have news' })).toHaveCount(0);
});

test('the tab title shows the count and keeps it when the title is rewritten', async ({ page }) => {
    await stubTwoSites(page);
    await openDashboard(page);
    await expect.poll(() => page.title()).toMatch(/^\(3\) /);
    // What switching page does: it sets the title from scratch.
    await page.evaluate(() => { document.title = 'Other page — nextDash'; });
    await expect.poll(() => page.title()).toBe('(3) Other page — nextDash');
});

test('opening a bookmark takes its news off the tab title at once', async ({ page, context }) => {
    await stubTwoSites(page);
    await openDashboard(page);
    await expect.poll(() => page.title()).toMatch(/^\(3\) /);
    // The real open path: click the row, then the bar on top of its headlines.
    // No clock jump; the title follows directly.
    const opened = context.waitForEvent('page');
    await page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])', { hasText: 'Site A' }).first()
        .locator('a.bookmark-open').click({ position: { x: 20, y: 10 } });
    await page.locator('.feed-news-pop [data-pop-site]').click();
    await opened;
    await expect.poll(() => page.title(), { timeout: 2000 }).toMatch(/^\(1\) /);
});

test('?news=1 opens the news modal and drops the parameter', async ({ page }) => {
    await stubTwoSites(page);
    await markWhatsNew(page);
    await page.goto('/?news=1');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(modal(page)).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
});

async function markWhatsNew(page) {
    const { markWhatsNewSeen } = require('./e2e-helpers');
    await markWhatsNewSeen(page);
}

test('opening the news again while it is open (?news=1, then the bell Read) leaves a working modal', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await stubTwoSites(page);
    await markWhatsNew(page);
    await page.goto('/?news=1');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(modal(page)).toBeVisible();
    // The bell still holds a row for the same news; its Read opens the news again.
    await openBell(page);
    await expect(bellRow(page)).toContainText('3 new from 2 watched feeds');
    await page.evaluate(() => window.FeedWatchNews.open());
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(3);
    expect(await page.evaluate(() => window.FeedWatchNews.isOpen())).toBe(true);
    await modal(page).locator('.feed-news-entry').first().click();
    await page.keyboard.press('ArrowRight');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('2 of 3');
    await modal(page).locator('[data-feed-news-index]').click(); // back to the index
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    expect(await page.evaluate(() => window.FeedWatchNews.isOpen())).toBe(false);
    expect(errors).toEqual([]);
});

test.describe('a muted feed', () => {
    async function stubMuted(page, { a, b }) {
        await page.goto('/');
        const keyA = await keyOf(page, site.url);
        const keyB = await keyOf(page, `${site.base}/b`);
        const entry = (n, muted) => ({
            newCount: n, newAt: Date.now(), newest: newsItem(n), muted,
            feeds: [{ feedUrl: 'http://127.0.0.1:1/f', title: 'T', intervalMinutes: 60, muted }],
        });
        const watches = {};
        if (a !== null) watches[keyA] = entry(a.n, a.muted);
        if (b !== null) watches[keyB] = entry(b.n, b.muted);
        const list = { limit: 100, total: Object.keys(watches).length, watches };
        await page.route('**/api/feeds/watch', (route) => (route.request().method() !== 'GET'
            ? route.continue()
            : route.fulfill({ contentType: 'application/json', body: JSON.stringify(list) })));
    }

    test('only the loud site is in the bell; the muted one still counts in the tab title', async ({ page }) => {
        await stubMuted(page, { a: { n: 2, muted: true }, b: { n: 1, muted: false } });
        await openDashboard(page);
        await openBell(page);
        await expect(bellRow(page)).toContainText('1 new from a watched feed');
        await expect(page).toHaveTitle(/^\(3\) /);
    });

    test('muted news alone makes no bell row, and its badge does not pulse', async ({ page }) => {
        await stubMuted(page, { a: { n: 2, muted: true }, b: null });
        await openDashboard(page);
        const badge = page.locator('.bookmark-news-badge').first();
        await expect(badge).toHaveText('2');
        await expect(badge).toHaveClass(/is-muted/);
        expect(await badge.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
        await openBell(page);
        await expect(bellRow(page)).toHaveCount(0);
        await expect(toast(page)).toHaveCount(0);
    });
});
