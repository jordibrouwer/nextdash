// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

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

test('a watched bookmark with news pulses purple with the count', async ({ page }) => {
    await withNews(page, [newsItem(1), newsItem(2)]);
    await openDashboard(page);
    const badge = link(page).locator('.bookmark-news-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
    await expect(badge).toHaveAttribute('aria-label', /2 new from a watched feed/);
    await expect(link(page).locator('.bookmark-fresh-badge')).toHaveCount(0);
});

test('hovering shows the newest item with Read in full and Open page', async ({ page }) => {
    await withNews(page, [newsItem(1, { image: '/data/preview-images/pi-test.png' }), newsItem(2)]);
    await openDashboard(page);
    await link(page).hover();
    const news = page.locator('#bookmark-preview-card .bookmark-preview-card-news');
    await expect(news).toBeVisible();
    await expect(news.locator('.bookmark-preview-card-news-title')).toHaveText('Headline 1');
    await expect(news.locator('img')).toHaveAttribute('src', /^\/data\/preview-images\//);
    await expect(news.locator('.bookmark-preview-card-news-lead b')).toHaveText('1');
    await expect(news.getByRole('button', { name: 'Read in full' })).toBeVisible();
    await expect(news.getByRole('button', { name: 'Open page' })).toBeVisible();
    expect(await news.locator('script').count()).toBe(0);
});

test('Open page opens the bookmark and clears the purple count', async ({ page }) => {
    await withNews(page, [newsItem(1)]);
    await openDashboard(page);
    await expect(link(page).locator('.bookmark-news-badge')).toBeVisible();
    await link(page).hover();
    const popup = page.waitForEvent('popup');
    await page.locator('#bookmark-preview-card').getByRole('button', { name: 'Open page' }).click();
    await popup;
    await expect(link(page).locator('.bookmark-news-badge')).toHaveCount(0);
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
        await expect(card.getByRole('button', { name: 'Read in full' })).toBeAttached();
    });
}
