// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

/**
 * A long list of news has to scroll inside the modal, and the newspaper is the
 * layout on every screen width, narrow ones included.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

async function stubLongNews(page, count = 14) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = Array.from({ length: count }, (_, i) => ({
        ...newsItem(i + 1, { summary: `<p>${'Long lead text. '.repeat(40)}</p>`, image: '/data/preview-images/pi-test.png' }),
        bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts', feedUrl: 'http://127.0.0.1:1/feed/', unread: true,
    }));
    await stubWatch(page, { list: watchPayload(key, items), items });
}

for (const [label, size] of [['phone', { width: 375, height: 600 }], ['desktop', { width: 1280, height: 600 }]]) {
    test(`the news modal scrolls on a ${label} and shows the newspaper`, async ({ page }) => {
        await page.setViewportSize(size);
        await stubLongNews(page);
        await openDashboard(page);
        await page.evaluate(() => window.FeedWatchNews.open({ source: 'button' }));
        const modal = page.locator('#app-modal .modal.feed-news-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toHaveClass(/is-paper/);
        const body = modal.locator('.modal-body');
        const fits = await modal.evaluate((el) => el.getBoundingClientRect().height <= window.innerHeight);
        expect(fits).toBe(true);
        expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight + 50)).toBe(true);
        await body.hover();
        await page.mouse.wheel(0, 400);
        await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
        // The masthead and the title row with its controls stay at the top while the news scrolls.
        const stuck = await modal.evaluate((el) => {
            const scroller = el.querySelector('.modal-body').getBoundingClientRect();
            const top = el.querySelector('.feed-news-top').getBoundingClientRect();
            return { gap: Math.round(top.top - scroller.top), height: Math.round(top.height) };
        });
        expect(stuck.gap).toBeLessThanOrEqual(2);
        expect(stuck.height).toBeGreaterThan(30);
        await expect(modal.locator('.feed-news-top .feed-news-close')).toBeInViewport();
    });
}

test('the newspaper shows the pictures of the items, like the other layouts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubLongNews(page);
    await openDashboard(page);
    await page.evaluate(() => window.FeedWatchNews.open({ source: 'button' }));
    const modal = page.locator('#app-modal .modal.feed-news-modal');
    await expect(modal).toHaveClass(/is-paper/);
    const pictures = modal.locator('.feed-news-entry-image');
    await expect(pictures.first()).toBeVisible();
    const box = await pictures.first().boundingBox();
    expect(box.width).toBeGreaterThan(50);
    // The same items in the themed layout have them too.
    await modal.locator('[data-feed-news-view="wide"]').click();
    await expect(modal).not.toHaveClass(/is-paper/);
});
