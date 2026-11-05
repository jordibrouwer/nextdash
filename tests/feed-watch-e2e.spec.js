// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, openPicker, row, headers } = require('./helpers/feed-watch');

/**
 * The whole path, as a reader walks it, with nothing stubbed on nextDash's side:
 * watch a feed from the right-click menu, let the site publish, let the server
 * poll, and read what arrived. The only stub is the other site.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site, 'Stub News');
});
test.afterEach(async () => { await site.close(); });

test('watch a feed, get the news, read it, and opening the bookmark clears it', async ({ page, request, context }) => {
    await openDashboard(page);

    // 1 · Right-click → Watch this feed… → tick Posts → every hour → Save.
    await openPicker(page, 'Stub News');
    const picker = page.locator('[data-feed-watch-picker]');
    await picker.getByLabel(/Posts/).check();
    await picker.locator('[data-feed-watch-save]').click();
    await expect(page.locator('#app-notification')).toContainText(/Watching Stub News · checked every hour/);

    // 2 · The site publishes two items, one with a picture and a script in its text.
    site.add('Second post');
    site.add('Third post', { image: true, html: '<p>Body <b>bold</b></p><script>window.__pwned = 1</script>' });

    // 3 · The server polls (the scheduler's job, done now through Check now).
    const poll = await request.post('/api/feeds/watch/poll', { headers });
    expect(poll.ok()).toBe(true);

    // 4 · The tab comes back to the front: one bell row (no toast), a purple count, a count in the title.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.feedWatch.totalNew())).toBe(2);
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await expect(page.locator('.notification-bell-row[data-bell-id="feed-watch"]')).toContainText('2 new from a watched feed');
    await expect(page.locator('#app-notification.show')).not.toContainText('has news');
    await page.evaluate(() => window.NotificationBell.close());
    const badge = row(page, 'Stub News').locator('.bookmark-news-badge');
    await expect(badge).toHaveText('2');
    await expect.poll(() => page.title()).toMatch(/^\(2\) /);

    // 5 · Hover: the newest item, its picture served by nextDash, nothing executable.
    await row(page, 'Stub News').hover();
    const news = page.locator('#bookmark-preview-card .bookmark-preview-card-news');
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Third post');
    await expect(news.locator('.bookmark-preview-card-news-image')).toHaveAttribute('src', /^\/data\/preview-images\/pi-/);
    // The server sends both new items, so the card pages between them.
    await expect(news.locator('.bookmark-preview-card-news-count')).toHaveText('1 / 2');
    expect(await news.locator('script').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();

    // 6 · Open reader: one article at a time.
    await news.getByRole('button', { name: 'Open reader' }).click();
    const modal = page.locator('#app-modal .modal.feed-news-modal');
    // The two new posts, and the feed's older one under "Earlier".
    await expect(modal.locator('.feed-news-entry')).toHaveCount(3);
    await expect(modal.locator('.feed-news-chip')).toHaveText('2 unread');
    await expect(modal.locator('.feed-news-index-head')).toHaveText('Earlier from the feeds');
    await modal.locator('.feed-news-entry').first().click();
    await expect(modal.locator('.feed-news-title')).toHaveText('Third post');
    await expect(modal.locator('[data-feed-news-chip]')).toHaveText('1 of 3');
    await modal.getByRole('button', { name: 'Next' }).click();
    await expect(modal.locator('.feed-news-title')).toHaveText('Second post');
    await modal.locator('[data-feed-news-index]').click(); // back to the index
    await expect(modal.locator('.feed-news-entry')).toHaveCount(3);
    await page.keyboard.press('Escape'); // closes
    await expect(modal).toBeHidden();

    // 7 · Opening the bookmark clears the count everywhere. Both posts were read
    // in the paper, so the row has no headlines left to show and goes straight
    // to the site.
    const opened = context.waitForEvent('page');
    await row(page, 'Stub News').locator('a.bookmark-open').click();
    await opened;
    await expect(page.locator('.feed-news-pop')).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await expect.poll(() => page.title()).not.toMatch(/^\(\d+\) /);
    await expect.poll(async () => {
        const list = await (await request.get('/api/feeds/watch')).json();
        return Object.values(list.watches)[0].newCount;
    }).toBe(0);
});
