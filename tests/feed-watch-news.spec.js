// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch, headers } = require('./helpers/feed-watch');

/**
 * The news window: one article at a time, widened on request, closing itself.
 * The watch routes are stubbed; the unread items carry what the server would
 * send (bookmark name and key beside each item).
 */
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

const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');
const link = (page) => row(page, 'Stub Blog');

async function setup(page, { clock = false } = {}) {
    if (clock) await page.clock.install();
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = [1, 2, 3].map((n) => ({
        ...newsItem(n), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    await stubWatch(page, { list: watchPayload(key, items), items });
    await openDashboard(page);
    return { key, items };
}

async function openFromCard(page) {
    await link(page).hover();
    await page.locator('#bookmark-preview-card').getByRole('button', { name: 'Open reader' }).click();
    await expect(modal(page)).toBeVisible();
}

/** Open the news and go from its index into the n-th article. */
async function openArticle(page, n = 0) {
    await openFromCard(page);
    await modal(page).locator('.feed-news-entry').nth(n).click();
    await expect(modal(page).locator('[data-feed-news-chip]')).toBeVisible();
}

test('the news opens on an index, an article opens from it, the Index button goes back, Esc closes at once', async ({ page }) => {
    await setup(page);
    await openFromCard(page);
    // The index: every item, no article yet, and the count of what is new.
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(3);
    await expect(modal(page).locator('.feed-news-site')).toHaveText('News');
    await expect(modal(page).locator('.feed-news-chip')).toHaveText('3 unread');
    await expect(modal(page).locator('.feed-news-title')).toHaveCount(0);
    expect(await page.evaluate(() => window.ScrollLock.isLocked())).toBe(true);

    await modal(page).locator('.feed-news-entry').nth(1).click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 2');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('2 of 3');
    await page.keyboard.press('ArrowRight');
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 3');
    await page.keyboard.press('ArrowRight');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');

    // The Index button goes back to the index, the modal stays.
    await modal(page).locator('[data-feed-news-index]').click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(3);
    await expect(modal(page).locator('.feed-news-title')).toHaveCount(0);

    // Esc closes at once, from an article too, and releases the scroll lock.
    await modal(page).locator('.feed-news-entry').first().click();
    await expect(modal(page).locator('.feed-news-title')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.ScrollLock.isLocked())).toBe(false);
});

test('the Index button goes back too, and a single item opens straight on the article', async ({ page }) => {
    await setup(page);
    await openArticle(page, 0);
    await modal(page).locator('[data-feed-news-index]').click();
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();

    // One item: nothing to index, the article opens and Esc closes at once.
    await page.evaluate(() => { window.__one = true; });
    await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'only', title: 'Only item', summary: '<p>x</p>', bookmarkKey: 'k', bookmarkName: 'Stub Blog', bookmarkUrl: site.url, foundAt: Date.now() }] }),
    }));
    await openFromCard(page);
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Only item');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
});

test('the newspaper lists more than what was found: the feed\'s earlier entries beside the article', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = [1, 2].map((n) => ({ ...newsItem(n), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts' }));
    const recent = Array.from({ length: 12 }, (_, i) => ({
        id: `old${i}`, title: `Earlier entry ${i + 1}`, link: `http://127.0.0.1:1/old${i}`, summary: `<p>Older text ${i + 1}</p>`,
        publishedAt: Date.now() - (i + 5) * 86_400_000, bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    await page.route('**/api/feeds/watch', (route) => (route.request().method() !== 'GET' ? route.continue() : route.fulfill({
        contentType: 'application/json', body: JSON.stringify(watchPayload(key, items)),
    })));
    await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ items, recent }),
    }));
    await openDashboard(page);
    await openFromCard(page);

    // The index holds all of them, the new ones first and the earlier ones under a heading.
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(14);
    await expect(modal(page).locator('.feed-news-chip')).toHaveText('2 unread');
    await expect(modal(page).locator('.feed-news-index-head')).toHaveText('Earlier from the feeds');

    // Into the first article: the newspaper's right-hand list carries the rest.
    await modal(page).locator('.feed-news-entry').first().click();
    await expect(modal(page)).toHaveClass(/is-paper/);
    await expect(modal(page).locator('.feed-news-card')).toHaveCount(13);
    await expect(modal(page).locator('.feed-news-side-head')).toHaveText('Earlier from the feeds');

    // An earlier entry opens as an article too.
    await modal(page).locator('.feed-news-card', { hasText: 'Earlier entry 3' }).click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Earlier entry 3');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('5 of 14');

    // One column is one article at a time: no list beside it, no earlier
    // entries, no front page; Esc closes.
    await modal(page).locator('[data-feed-news-view="single"]').click();
    await expect(modal(page).locator('.feed-news-card')).toHaveCount(0);
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 1');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 2');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
});

test('one column with nothing new still shows one article at a time, from the earlier entries', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const recent = Array.from({ length: 12 }, (_, i) => ({
        id: `old${i}`, title: `Earlier entry ${i + 1}`, link: `http://127.0.0.1:1/old${i}`, summary: `<p>Older text ${i + 1}</p>`,
        publishedAt: Date.now() - (i + 5) * 86_400_000, bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    await page.route('**/api/feeds/watch', (route) => (route.request().method() !== 'GET' ? route.continue() : route.fulfill({
        contentType: 'application/json', body: JSON.stringify(watchPayload(key, [])),
    })));
    await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ items: [], recent }),
    }));
    expect((await request.post('/api/settings', { data: { feedWatchNewsView: 'single' }, headers })).ok()).toBe(true);
    await openDashboard(page);
    await page.keyboard.press('Shift+W');
    await expect(modal(page)).toBeVisible();

    // An article, not the front page with all twelve listed.
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Earlier entry 1');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 12');
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(0);
    await modal(page).locator('[data-feed-news-step="1"]').click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Earlier entry 2');
});

test('the header switches between newspaper, two columns and one column, and the choice is kept', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await setup(page);
    await openArticle(page, 0);
    const views = modal(page).locator('[data-feed-news-view]');
    await expect(views).toHaveCount(3);

    // The newspaper is the default: paper, a masthead, serif type, the others beside the article.
    await expect(modal(page).locator('[data-feed-news-view="paper"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(modal(page)).toHaveClass(/is-paper/);
    await expect(modal(page).locator('.feed-news-mast')).toBeVisible();
    await expect(modal(page).locator('.feed-news-card')).toHaveCount(2);
    expect(await modal(page).locator('.feed-news-title').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Georgia|serif/i);
    expect(await modal(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(244, 239, 228)');
    expect((await modal(page).boundingBox()).width).toBeGreaterThan(900);

    // Two columns in the app's own style; a card becomes the current article.
    await modal(page).locator('[data-feed-news-view="wide"]').click();
    await expect(modal(page)).not.toHaveClass(/is-paper/);
    await expect(modal(page).locator('.feed-news-card')).toHaveCount(2);
    await modal(page).locator('.feed-news-card').first().click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 2');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('2 of 3');

    // One column.
    await modal(page).locator('[data-feed-news-view="single"]').click();
    await expect(modal(page).locator('.feed-news-card')).toHaveCount(0);
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedWatchNewsView).toBe('single');

    // One column is one article: no front page, no index button, no earlier
    // entries. Esc closes at once.
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(0);
    await expect(modal(page).locator('[data-feed-news-index]')).toHaveCount(0);
    await expect(modal(page).locator('.feed-news-title')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();

    // The choice is the setting, so it comes back the next time, straight on one article.
    await openFromCard(page);
    await expect(modal(page).locator('[data-feed-news-view="single"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(0);
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 1');
    await expect(modal(page).locator('.feed-news-card')).toHaveCount(0);
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');
    await modal(page).getByRole('button', { name: 'Next' }).click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 2');

    // A narrow viewport keeps the chosen layout (the newspaper by default) and
    // all three layouts stay on offer.
    await modal(page).locator('[data-feed-news-view="paper"]').click();
    await modal(page).locator('[data-feed-news-close]').click();
    await page.setViewportSize({ width: 600, height: 900 });
    // The hover card is off in the phone layout, so the news opens another way.
    await page.evaluate(() => window.FeedWatchNews.open());
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('[data-feed-news-view]')).toHaveCount(3);
    await expect(modal(page)).toHaveClass(/is-paper/);
    await modal(page).locator('[data-feed-news-view="wide"]').click();
    await expect(modal(page)).toHaveClass(/is-wide/);
    await expect(modal(page)).not.toHaveClass(/is-paper/);
    await modal(page).locator('[data-feed-news-view="single"]').click();
    await expect(modal(page).locator('[data-feed-news-view="single"]')).toHaveAttribute('aria-pressed', 'true');
    await modal(page).locator('[data-feed-news-view="paper"]').click();
    await expect(modal(page)).toHaveClass(/is-paper/);
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Headline 1');
});

test('the bar runs down and the modal closes itself after 30 minutes', async ({ page }) => {
    await setup(page, { clock: true });
    await expect(link(page).locator('.bookmark-news-badge')).toBeVisible();
    await link(page).hover();
    await page.clock.runFor(400);
    await page.locator('#bookmark-preview-card').getByRole('button', { name: 'Open reader' }).click();
    await expect(modal(page)).toBeVisible();
    const bar = modal(page).locator('.feed-news-bar');
    await expect(bar).toHaveAttribute('aria-label', /Closes in 30 min/);

    await page.clock.fastForward('29:00');
    await page.clock.runFor(2000);
    await expect(modal(page)).toBeVisible();
    await expect(bar).toHaveAttribute('aria-label', /Closes in 1 min/);

    await page.clock.fastForward('02:00');
    await page.clock.runFor(2000);
    await expect(modal(page)).toBeHidden();
    // The purple count steps aside; nothing else takes its place on the row.
    await expect(link(page).locator('.bookmark-news-badge')).toHaveCount(0);
});

test('news opened by hand after the window closed stays open and shows no bar', async ({ page }) => {
    await setup(page, { clock: true });
    await expect(link(page).locator('.bookmark-news-badge')).toBeVisible();
    // The window ran out while the reader was away; then /?news=1 (a push) opens the news.
    await page.clock.fastForward('31:00');
    await page.goto('/?news=1');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(modal(page)).toBeVisible();
    expect(await page.evaluate(() => window.dashboardInstance.feedWatch.windowPhase())).toBe('closed');
    await page.clock.runFor(5000);
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.feed-news-bar')).toHaveCount(0);
    await expect(modal(page).locator('[data-feed-news-left]')).toHaveCount(0);
});

test('feed HTML is shown as text styling, never as script', async ({ page }) => {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = [{
        ...newsItem(1), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url,
        summary: '<p>Safe <b>bold</b></p>',
    }];
    await stubWatch(page, { list: watchPayload(key, items), items });
    await openDashboard(page);
    await openFromCard(page);
    await expect(modal(page).locator('.feed-news-summary b')).toHaveText('bold');
    expect(await modal(page).locator('script, iframe, img[onerror]').count()).toBe(0);
});

test('the index lead keeps a space between two paragraphs', async ({ page }) => {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = [1, 2].map((n) => ({
        ...newsItem(n), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url,
        summary: n === 1 ? '<p>First paragraph.</p><p>Second paragraph.</p><ul><li>One</li><li>Two</li></ul>' : '<p>Plain.</p>',
    }));
    await stubWatch(page, { list: watchPayload(key, items), items });
    await openDashboard(page);
    await openFromCard(page);
    // textContent alone would read "First paragraph.Second paragraph.OneTwo".
    await expect(modal(page).locator('.feed-news-entry-lead').filter({ hasText: 'First paragraph' })).toHaveText('First paragraph. Second paragraph. One Two');
});

test('read state per item: an article read, marked unread again, then the site read', async ({ page, request }) => {
    // The real server this time: the bookmark watches the stub site's posts.
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
    })).ok()).toBe(true);
    site.add('Post one');
    site.add('Post two');
    site.add('Post three');
    expect((await request.post('/api/feeds/watch/poll', { headers })).ok()).toBe(true);
    const newCount = async () => Object.values((await (await request.get('/api/feeds/watch')).json()).watches)[0].newCount;
    await openDashboard(page);
    const badge = link(page).locator('.bookmark-news-badge');
    await expect(badge).toHaveText('3');

    // The second item's article: that one is read, the others are not.
    await openFromCard(page);
    await modal(page).locator('.feed-news-entry', { hasText: 'Post two' }).click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('Post two');
    await expect(badge).toHaveText('2');
    await expect.poll(() => page.title()).toMatch(/^\(2\) /);
    await expect.poll(newCount).toBe(2);

    // Marked unread again from the article's foot.
    await modal(page).getByRole('button', { name: 'Mark unread' }).click();
    await expect(badge).toHaveText('3');
    await expect.poll(newCount).toBe(3);

    // The whole site read from its section.
    await modal(page).locator('[data-feed-news-index]').click();
    await modal(page).getByRole('button', { name: 'Mark site read' }).click();
    await expect(badge).toHaveCount(0);
    await expect.poll(newCount).toBe(0);
});
