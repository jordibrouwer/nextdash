// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch, PNG } = require('./helpers/feed-watch');

/**
 * What the dashboard shows for news from a watched feed: a purple count on the
 * row and the newest item on the hover card. The watch routes are stubbed (this
 * is a painting test); the real poll path is covered by the end-to-end spec.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

async function withNews(page, items) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const state = { list: watchPayload(key, items), items };
    await stubWatch(page, state);
    return { key, state };
}

const link = (page) => row(page, 'Stub Blog');

/** Serve the stub items' pages and picture, so a popup lands on a real URL and the picture loads. */
async function serveItems(page) {
    await page.context().route('http://127.0.0.1:1/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>item</title>' }));
    await page.route('**/data/preview-images/pi-test.png', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
}

test('a watched bookmark with news pulses purple with the count', async ({ page }) => {
    await withNews(page, [newsItem(1), newsItem(2)]);
    await openDashboard(page);
    const badge = link(page).locator('.bookmark-news-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
    await expect(badge).toHaveAttribute('aria-label', /2 new from a watched feed/);
    await expect(link(page).locator('.bookmark-fresh-badge')).toHaveCount(0);
});

test('hovering shows the newest item with Open reader and Open page', async ({ page }) => {
    await serveItems(page);
    await withNews(page, [newsItem(1, { image: '/data/preview-images/pi-test.png' }), newsItem(2)]);
    await openDashboard(page);
    await link(page).hover();
    const news = page.locator('#bookmark-preview-card .bookmark-preview-card-news');
    await expect(news).toBeVisible();
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 1');
    await expect(news.locator('.bookmark-preview-card-news-image')).toHaveAttribute('src', /^\/data\/preview-images\//);
    await expect(news.locator('.bookmark-preview-card-news-lead b')).toHaveText('1');
    await expect(news.getByRole('button', { name: 'Open reader' })).toBeVisible();
    await expect(news.getByRole('button', { name: 'Open page' })).toBeVisible();
    expect(await news.locator('script').count()).toBe(0);
});

test('Open page opens the item and clears the purple count', async ({ page }) => {
    await serveItems(page);
    await withNews(page, [newsItem(1)]);
    await openDashboard(page);
    await expect(link(page).locator('.bookmark-news-badge')).toBeVisible();
    await link(page).hover();
    const popup = page.waitForEvent('popup');
    await page.locator('#bookmark-preview-card').getByRole('button', { name: 'Open page' }).click();
    const opened = await popup;
    await opened.waitForLoadState();
    expect(opened.url()).toContain('/n1');
    await expect(link(page).locator('.bookmark-news-badge')).toHaveCount(0);
});

test('the news card leads with the item and keeps the site to one line', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await serveItems(page);
    const long = 'A very long headline that keeps going and going so that it has to wrap over more lines than the card allows ';
    await withNews(page, [newsItem(1, { image: '/data/preview-images/pi-test.png', title: long.repeat(3), summary: '<p>' + 'Long lead text. '.repeat(60) + '</p>' }), newsItem(2)]);
    await openDashboard(page);
    await link(page).hover();
    const card = page.locator('#bookmark-preview-card');
    const news = card.locator('.bookmark-preview-card-news');
    await expect(news).toBeVisible();
    // News first, the site under it; the site's own picture, description and fact rows step aside.
    await expect(card.locator('.bookmark-preview-card-news-site-name')).toHaveText('Stub Blog');
    for (const part of ['.bookmark-preview-card-image-wrap', '.bookmark-preview-card-head', '.bookmark-preview-card-description', '.bookmark-preview-card-facts']) {
        await expect(card.locator(part)).toBeHidden();
    }
    // The picture sits on top at a fixed height, full card width.
    const media = await card.locator('.bookmark-preview-card-news-media').boundingBox();
    const box = await card.boundingBox();
    expect(media.height).toBeGreaterThanOrEqual(110);
    expect(media.height).toBeLessThanOrEqual(150);
    expect(Math.abs(media.width - box.width)).toBeLessThanOrEqual(2);
    // Two equal buttons, both at least 32px high.
    const read = await news.getByRole('button', { name: 'Open reader' }).boundingBox();
    const open = await news.getByRole('button', { name: 'Open page' }).boundingBox();
    expect(Math.abs(read.width - open.width)).toBeLessThanOrEqual(1);
    expect(read.height).toBeGreaterThanOrEqual(32);
    expect(open.height).toBeGreaterThanOrEqual(32);
    // The whole card fits without scrolling, however long the headline and lead.
    expect(box.height).toBeLessThanOrEqual(460);
    expect(await card.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
});

test('the pager steps through three items and Open page follows it', async ({ page }) => {
    await serveItems(page);
    await withNews(page, [newsItem(1), newsItem(2), newsItem(3)]);
    await openDashboard(page);
    await link(page).hover();
    const card = page.locator('#bookmark-preview-card');
    const news = card.locator('.bookmark-preview-card-news');
    await expect(news.locator('.bookmark-preview-card-news-count')).toHaveText('1 / 3');
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 1');
    await expect(news.getByRole('button', { name: 'Open page' })).toHaveAttribute('data-href', /\/n1$/);

    await news.getByRole('button', { name: 'Next' }).click();
    await expect(card).toBeVisible();
    await expect(news.locator('.bookmark-preview-card-news-count')).toHaveText('2 / 3');
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 2');
    await expect(news.locator('.bookmark-preview-card-news-lead b')).toHaveText('2');
    await expect(news.getByRole('button', { name: 'Open page' })).toHaveAttribute('data-href', /\/n2$/);

    // The arrow keys page too, from a button on the card; the ends wrap.
    await news.getByRole('button', { name: 'Previous' }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(news.locator('.bookmark-preview-card-news-count')).toHaveText('3 / 3');
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 3');

    await page.keyboard.press('ArrowRight');
    await news.getByRole('button', { name: 'Next' }).click();
    const popup = page.waitForEvent('popup');
    await news.getByRole('button', { name: 'Open page' }).click();
    const opened = await popup;
    await opened.waitForLoadState();
    expect(opened.url()).toContain('/n2');
});

test('a single item has no pager', async ({ page }) => {
    await withNews(page, [newsItem(1)]);
    await openDashboard(page);
    await link(page).hover();
    const news = page.locator('#bookmark-preview-card .bookmark-preview-card-news');
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 1');
    await expect(news.locator('.bookmark-preview-card-news-pager')).toHaveCount(0);
    await expect(news.getByRole('button', { name: 'Next' })).toHaveCount(0);
});

test('an item without a picture, or with a broken one, gets the calm panel', async ({ page }) => {
    await withNews(page, [newsItem(1), newsItem(2, { image: '/data/preview-images/missing-agent-test.png' })]);
    await openDashboard(page);
    await link(page).hover();
    const news = page.locator('#bookmark-preview-card .bookmark-preview-card-news');
    const media = news.locator('.bookmark-preview-card-news-media');
    await expect(media).toHaveClass(/is-fallback/);
    await expect(media.locator('.bookmark-preview-card-news-image')).toHaveCount(0);
    await news.getByRole('button', { name: 'Next' }).click();
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 2');
    // The picture fails to load: no broken glyph, the same panel instead.
    await expect(media).toHaveClass(/is-fallback/);
    await expect(media.locator('.bookmark-preview-card-news-image')).toHaveCount(0);
});

// A picture makes the card tall; it still has to fit the screen, however short.
for (const height of [900, 600, 360]) {
    test(`the hover card fits a ${height} px high window`, async ({ page }) => {
        await page.setViewportSize({ width: 1300, height });
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        await withNews(page, [newsItem(1, { image: png, summary: '<p>' + 'Long lead text. '.repeat(40) + '</p>' }), newsItem(2)]);
        await openDashboard(page);
        await link(page).hover();
        const card = page.locator('#bookmark-preview-card');
        await expect(card.locator('.bookmark-preview-card-news')).toBeVisible();
        // Give the picture a moment to arrive and the card to settle.
        await page.waitForTimeout(500);
        const box = await card.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(height + 0.5);
        // The two buttons stay reachable: inside the window, or by scrolling the card.
        await expect(card.getByRole('button', { name: 'Open reader' })).toBeAttached();
    });
}
