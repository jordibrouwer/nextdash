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

    // 1b · A feed that was just added shows what it already holds: the popover opens
    // on the row with the feed's first post as news. Read it, so the rest of the
    // walk starts from nothing new, as it always did.
    const pop = page.locator('.feed-news-pop');
    await expect(pop).toBeVisible({ timeout: 8000 });
    await expect(pop.locator('.feed-news-pop-list > li')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    expect((await request.post('/api/feeds/watch/seen', { data: { bookmarkUrl: site.url }, headers })).ok()).toBe(true);
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.feedWatch.totalNew())).toBe(0);

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
    // The first post, held as read news since the feed was added, is the third.
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

test.describe('on a phone', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    test('adding a feed offers the popover with its latest entries at once', async ({ page }) => {
        await expectOffer(page);
    });
});

test('adding a feed offers the popover with its latest entries at once, on a desktop', async ({ page }) => {
    await expectOffer(page);
});

async function expectOffer(page) {
    for (let i = 0; i < 12; i += 1) site.add(`Older post ${i}`);
    await openDashboard(page);
    await openPicker(page, 'Stub News');
    const picker = page.locator('[data-feed-watch-picker]');
    await picker.getByLabel(/Posts/).check();
    await picker.locator('[data-feed-watch-save]').click();
    const pop = page.locator('.feed-news-pop');
    await expect(pop).toBeVisible({ timeout: 8000 });
    // The server keeps ten; the popover shows up to six and "+n more" brings in the rest.
    await expect(pop.locator('.feed-news-pop-list > li')).not.toHaveCount(0);
    // It belongs to the bookmark: the row wears the ring, the head carries the feed
    // mark and the site's name, and a line says why it opened.
    await expect(row(page, 'Stub News')).toHaveClass(/feed-pop-anchor/);
    await expect(pop).toHaveClass(/is-offer/);
    await expect(pop.locator('.feed-news-pop-glyph')).toBeVisible();
    await expect(pop.locator('.feed-news-pop-name')).toHaveText('Stub News');
    await expect(pop.locator('.feed-news-pop-offer')).toBeVisible();
    // A pointer of its own links the popover to the bookmark, and nods once offered.
    await expect(page.locator('.feed-pop-pointer.is-offer')).toBeVisible();
    // It is animated in (reduced motion off in the test browser).
    expect(await pop.evaluate((el) => el.style.animation)).toContain('feed-news-pop-grow');
    // Watch for the closing popover as it appears: it lives for a quarter of a second.
    await page.evaluate(() => {
        window.__closing = [];
        new MutationObserver(() => {
            const el = document.querySelector('.feed-news-pop-closing');
            if (el && !window.__closing.length) window.__closing.push(el.style.animation);
        }).observe(document.body, { childList: true, subtree: true, attributes: true });
    });
    await page.keyboard.press('Escape');
    await expect(row(page, 'Stub News')).not.toHaveClass(/feed-pop-anchor/);
    // It folds back into the bookmark, and then both it and the pointer are gone.
    await expect.poll(() => page.evaluate(() => window.__closing[0] || '')).toContain('feed-news-pop-shrink');
    await expect(page.locator('.feed-news-pop-closing')).toHaveCount(0);
    await expect(page.locator('.feed-pop-pointer')).toHaveCount(0);
    const waiting = await page.evaluate(() => window.dashboardInstance.feedWatch.totalNew());
    expect(waiting).toBe(10);
}
